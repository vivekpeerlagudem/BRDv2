/**
 * Collector: freezes what a weekly report is built from. It reads with the COMPANY OWNER's scope (the user the
 * report runs as), so a report can never contain a record that user could not open in the CRM.
 * Tasks, notes and activities are polymorphic (related to a company, a contact or a deal), so all three are read.
 */
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, type SQL } from 'drizzle-orm';
import type { SheetStatus } from '../../db/schema-weekly-reports.ts';
import { type AppContext, ownerScope, schema, type UserActor } from '../../platform/core.ts';
import { latestEstimates } from './estimates.ts';

const { company, contact, deal, task, activityLog, pipelineStage, appUserProfile } = schema;

export interface WeeklySnapshot {
  schema: 1;
  runId: string;
  /** When the data was read. */
  cutoff: string;
  company: { id: string; name: string; ownerName: string };
  period: { start: string; end: string; timeZone: string; startInstant: string; endInstant: string };
  deals: { id: string; name: string; status: string; stage: string }[];
  tasks: { id: string; title: string; status: 'open' | 'completed' | 'cancelled'; dueAt: string; completedAt: string | null }[];
  activities: { id: string; kind: 'call' | 'meeting'; occurredAt: string; outcome: string | null }[];
  estimates: {
    importId: string;
    fileName: string;
    items: {
      id: string;
      rowNo: number;
      scopeId: string | null;
      title: string;
      phase: string | null;
      estimateHours: string;
      sheetStatus: SheetStatus | null;
      pctDone: string | null;
      actualHours: string | null;
    }[];
  };
}

export type CollectResult = { ok: true; snapshot: WeeklySnapshot } | { ok: false; reason: 'COMPANY_NOT_VISIBLE' | 'NO_ESTIMATES' };

export async function collect(
  ctx: AppContext,
  owner: UserActor,
  run: { id: string; companyId: string; periodStart: string; periodEnd: string; timeZone: string },
  instants: { startInstant: Date; endInstant: Date },
): Promise<CollectResult> {
  const { db } = ctx;
  const [co] = await db
    .select({ id: company.id, name: company.name, ownerName: appUserProfile.fullName })
    .from(company)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, company.ownerId))
    .where(and(eq(company.id, run.companyId), isNull(company.archivedAt), ownerScope(owner, company.ownerId, 'companies')));
  if (!co) return { ok: false, reason: 'COMPANY_NOT_VISIBLE' };
  const estimates = await latestEstimates(db, run.companyId);
  if (!estimates) return { ok: false, reason: 'NO_ESTIMATES' };

  const deals = await db
    .select({ id: deal.id, name: deal.name, status: deal.status, stage: pipelineStage.name })
    .from(deal)
    .innerJoin(pipelineStage, eq(pipelineStage.id, deal.stageId))
    .where(and(eq(deal.companyId, co.id), isNull(deal.archivedAt), ownerScope(owner, deal.ownerId, 'deals')))
    .orderBy(asc(deal.id));
  const contacts = await db
    .select({ id: contact.id })
    .from(contact)
    .where(and(eq(contact.companyId, co.id), isNull(contact.archivedAt), ownerScope(owner, contact.ownerId, 'contacts')));

  /** Records related to the company itself, to one of its contacts, or to one of its deals. */
  const related = (typeColumn: typeof task.relatedType | typeof activityLog.relatedType, idColumn: typeof task.relatedId | typeof activityLog.relatedId) => {
    const any: SQL[] = [and(eq(typeColumn, 'company'), eq(idColumn, co.id)) as SQL];
    if (contacts.length)
      any.push(
        and(
          eq(typeColumn, 'contact'),
          inArray(
            idColumn,
            contacts.map((c) => c.id),
          ),
        ) as SQL,
      );
    if (deals.length)
      any.push(
        and(
          eq(typeColumn, 'deal'),
          inArray(
            idColumn,
            deals.map((d) => d.id),
          ),
        ) as SQL,
      );
    return or(...any) as SQL;
  };

  const tasks = await db
    .select({ id: task.id, title: task.title, status: task.status, dueAt: task.dueAt, completedAt: task.completedAt })
    .from(task)
    .where(and(related(task.relatedType, task.relatedId), ne(task.status, 'cancelled')))
    .orderBy(asc(task.id));
  const activities = await db
    .select({ id: activityLog.id, kind: activityLog.kind, occurredAt: activityLog.occurredAt, outcome: activityLog.outcome })
    .from(activityLog)
    .where(
      and(
        related(activityLog.relatedType, activityLog.relatedId),
        gte(activityLog.occurredAt, instants.startInstant),
        lte(activityLog.occurredAt, instants.endInstant),
      ),
    )
    .orderBy(asc(activityLog.occurredAt), asc(activityLog.id));

  return {
    ok: true,
    snapshot: {
      schema: 1,
      runId: run.id,
      cutoff: ctx.now().toISOString(),
      company: co,
      period: {
        start: run.periodStart,
        end: run.periodEnd,
        timeZone: run.timeZone,
        startInstant: instants.startInstant.toISOString(),
        endInstant: instants.endInstant.toISOString(),
      },
      deals,
      tasks: tasks.map((t) => ({ ...t, dueAt: t.dueAt.toISOString(), completedAt: t.completedAt?.toISOString() ?? null })),
      activities: activities.map((a) => ({ ...a, occurredAt: a.occurredAt.toISOString() })),
      estimates: {
        importId: estimates.import.id,
        fileName: estimates.import.fileName,
        items: estimates.items.map((i) => ({
          id: i.id,
          rowNo: i.rowNo,
          scopeId: i.scopeId,
          title: i.title,
          phase: i.phase,
          estimateHours: i.estimateHours,
          sheetStatus: i.sheetStatus,
          pctDone: i.pctDone,
          actualHours: i.actualHours,
        })),
      },
    },
  };
}
