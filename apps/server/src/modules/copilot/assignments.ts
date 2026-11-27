/**
 * Accept-and-escalate (SA §8.3). Every lead assignment — a web-form enquiry (lead.assigned), a manual assignLead
 * (lead.assigned, added in crm.ts) or a reassignment — creates a work_assignment row with a deadline in BUSINESS
 * hours (company calendar in copilot_settings):
 *   accept within 4 business hours · reminder at 50 % · then escalate to the rep's team manager (an admin when there
 *   is none or the manager is inactive) · 4 more business hours → admin.
 * Every step notifies (in-app) and writes a timeline entry. Managers may accept or reassign for their reps.
 * Time to accept (wall-clock and business minutes) and time to first contact (first logged call or meeting after the
 * assignment) are recorded. All timers are deterministic code run by the scheduled scans; the AI never decides them.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { type AssignmentStatus, workAssignment } from '../../db/schema-copilot.ts';
import { type AppContext, conflict, forbidden, notFound, rule, SYSTEM, schema, type Tx, type Uow, type UserActor, unitOfWork } from '../../platform/core.ts';
import * as crm from '../crm.ts';
import { addWriteTool, notifyInApp } from './actions.ts';
import { addBusinessHours, businessMinutesBetween } from './business-hours.ts';
import { loadCopilotSettings } from './settings.ts';
import { ALL, notVisible, refInput } from './tools.ts';

type Row = typeof workAssignment.$inferSelect;
const OPEN: AssignmentStatus[] = ['pending', 'escalated_manager', 'escalated_admin'];
const { appUserProfile, teamMembership, teamManager } = schema;

const anchors = (r: { recordType: string; recordId: string }) => (r.recordType === 'deal' ? [{ type: 'deal' as const, id: r.recordId }] : []);
const linkOf = (r: { recordType: string; recordId: string }) => (r.recordType === 'deal' ? `/deals/${r.recordId}` : '/leads');
async function nameOf(tx: Tx, userId: string | null) {
  if (!userId) return 'someone';
  const [u] = await tx.select({ name: appUserProfile.fullName }).from(appUserProfile).where(eq(appUserProfile.userId, userId));
  return u?.name ?? 'someone';
}
/** The rep's active team manager (not the rep), else an active admin. */
async function escalationTarget(tx: Tx, userId: string, level: 1 | 2): Promise<string | null> {
  if (level === 1) {
    const [m] = await tx
      .select({ id: teamManager.userId })
      .from(teamMembership)
      .innerJoin(teamManager, eq(teamManager.teamId, teamMembership.teamId))
      .innerJoin(appUserProfile, eq(appUserProfile.userId, teamManager.userId))
      .where(
        and(eq(teamMembership.userId, userId), eq(teamMembership.isActive, true), eq(appUserProfile.status, 'active'), sql`${teamManager.userId} <> ${userId}`),
      )
      .limit(1);
    if (m) return m.id;
  }
  const [a] = await tx
    .select({ id: appUserProfile.userId })
    .from(appUserProfile)
    .where(and(eq(appUserProfile.role, 'admin'), eq(appUserProfile.status, 'active')))
    .orderBy(asc(appUserProfile.fullName))
    .limit(1);
  return a?.id ?? null;
}

/** Creates the assignment (superseding an open one for another person). Idempotent for the same assignee. */
export async function createAssignment(
  ctx: AppContext,
  u: Uow,
  input: {
    recordType: 'lead' | 'deal';
    recordId: string;
    label: string;
    assigneeId: string;
    assignedBy: string | null;
    source?: 'web_form' | 'manual' | 'reassignment';
  },
): Promise<Row | null> {
  const open = await u.tx
    .select()
    .from(workAssignment)
    .where(and(eq(workAssignment.recordType, input.recordType), eq(workAssignment.recordId, input.recordId), inArray(workAssignment.status, OPEN)))
    .for('update');
  if (open.some((o) => o.assigneeId === input.assigneeId)) return null;
  const [previous] = await u.tx
    .select({ id: workAssignment.id })
    .from(workAssignment)
    .where(and(eq(workAssignment.recordType, input.recordType), eq(workAssignment.recordId, input.recordId)))
    .limit(1);
  if (open.length)
    await u.tx
      .update(workAssignment)
      .set({ status: 'superseded', updatedAt: ctx.now() })
      .where(
        inArray(
          workAssignment.id,
          open.map((o) => o.id),
        ),
      );
  const settings = await loadCopilotSettings(ctx);
  const now = ctx.now();
  const due = addBusinessHours(now, settings.acceptSlaHours, settings.calendar, settings.timeZone);
  const [row] = await u.tx
    .insert(workAssignment)
    .values({
      recordType: input.recordType,
      recordId: input.recordId,
      recordLabel: input.label.slice(0, 200),
      assigneeId: input.assigneeId,
      assignedBy: input.assignedBy,
      source: input.source ?? (previous ? 'reassignment' : 'manual'),
      assignedAt: now,
      acceptDueAt: due,
      reminderAt: addBusinessHours(now, settings.acceptSlaHours / 2, settings.calendar, settings.timeZone),
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  await u.timeline({
    eventType: 'assignment_created',
    source: { type: input.recordType, id: input.recordId },
    summary: `Assigned to ${await nameOf(u.tx, input.assigneeId)} — accept within ${settings.acceptSlaHours} business hours`,
    anchors: anchors(input),
    isAutomated: true,
  });
  return row ?? null;
}

/** Job handler for the lead.assigned event (web form: deal; manual assignLead: lead). */
export async function onLeadAssigned(ctx: AppContext, e: Record<string, unknown>): Promise<void> {
  await unitOfWork(ctx, SYSTEM, async (u) => {
    if (typeof e.leadId === 'string') {
      const [l] = await u.tx.select({ name: schema.lead.name, ownerId: schema.lead.ownerId }).from(schema.lead).where(eq(schema.lead.id, e.leadId));
      if (!l || l.ownerId !== e.userId) return; // reassigned again since: the later event wins
      await createAssignment(ctx, u, {
        recordType: 'lead',
        recordId: e.leadId,
        label: l.name,
        assigneeId: l.ownerId,
        assignedBy: (e.assignedBy as string) ?? null,
      });
    } else if (typeof e.dealId === 'string') {
      const [d] = await u.tx.select({ name: schema.deal.name, ownerId: schema.deal.ownerId }).from(schema.deal).where(eq(schema.deal.id, e.dealId));
      if (!d || d.ownerId !== e.userId) return; // owner changed before the job ran: the later change wins
      await createAssignment(ctx, u, {
        recordType: 'deal',
        recordId: e.dealId,
        label: d.name,
        assigneeId: e.userId as string,
        assignedBy: null,
        source: 'web_form',
      });
    }
  });
}

// ───────────────────────── read ─────────────────────────
const visibleTo = (actor: UserActor) =>
  actor.role === 'admin' ? sql`true` : inArray(workAssignment.assigneeId, actor.teamScopeIds.length ? actor.teamScopeIds : [actor.userId]);
const publicRow = (ctx: AppContext, r: Row & { assigneeName?: string | null }) => ({
  id: r.id,
  recordType: r.recordType,
  recordId: r.recordId,
  recordLabel: r.recordLabel,
  assigneeId: r.assigneeId,
  assigneeName: r.assigneeName ?? null,
  status: r.status,
  source: r.source,
  assignedAt: r.assignedAt,
  acceptDueAt: r.acceptDueAt,
  escalationDueAt: r.escalationDueAt,
  escalationLevel: r.escalationLevel,
  secondsLeft: Math.round(((r.status === 'pending' ? r.acceptDueAt : (r.escalationDueAt ?? r.acceptDueAt)).getTime() - ctx.now().getTime()) / 1000),
  acceptedAt: r.acceptedAt,
  declineReason: r.declineReason,
});
export async function listAssignments(ctx: AppContext, actor: UserActor, opts: { mine?: boolean }) {
  const rows = await ctx.db
    .select({ a: workAssignment, assigneeName: appUserProfile.fullName })
    .from(workAssignment)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, workAssignment.assigneeId))
    .where(
      and(
        inArray(workAssignment.status, OPEN),
        opts.mine ? or(eq(workAssignment.assigneeId, actor.userId), eq(workAssignment.escalatedTo, actor.userId)) : visibleTo(actor),
      ),
    )
    .orderBy(asc(workAssignment.acceptDueAt))
    .limit(100);
  return { items: rows.map((r) => publicRow(ctx, { ...r.a, assigneeName: r.assigneeName })) };
}

// ───────────────────────── decisions ─────────────────────────
async function load(u: Uow, actor: UserActor, id: string): Promise<Row> {
  const [r] = await u.tx.select().from(workAssignment).where(eq(workAssignment.id, id)).for('update');
  const mayAct =
    r &&
    (r.assigneeId === actor.userId ||
      r.escalatedTo === actor.userId ||
      actor.role === 'admin' ||
      (actor.role === 'sales_manager' && actor.teamScopeIds.includes(r.assigneeId)));
  if (!r || !mayAct) throw notFound('Assignment');
  if (!OPEN.includes(r.status)) throw conflict('ASSIGNMENT_DECIDED', 'This assignment is no longer waiting.');
  return r;
}

export async function acceptAssignment(ctx: AppContext, actor: UserActor, id: string) {
  const settings = await loadCopilotSettings(ctx);
  return unitOfWork(ctx, actor, async (u) => {
    const r = await load(u, actor, id);
    const now = ctx.now();
    const [row] = await u.tx
      .update(workAssignment)
      .set({
        status: 'accepted',
        acceptedAt: now,
        acceptedBy: actor.userId,
        minutesToAccept: Math.round((now.getTime() - r.assignedAt.getTime()) / 60_000),
        businessMinutesToAccept: businessMinutesBetween(r.assignedAt, now, settings.calendar, settings.timeZone),
        acceptedWithinSla: now <= r.acceptDueAt,
        updatedAt: now,
      })
      .where(eq(workAssignment.id, id))
      .returning();
    const by = actor.userId === r.assigneeId ? '' : ` by ${actor.name} for ${await nameOf(u.tx, r.assigneeId)}`;
    await u.timeline({
      eventType: 'assignment_accepted',
      source: { type: r.recordType, id: r.recordId },
      summary: `Assignment accepted${by}`,
      anchors: anchors(r),
    });
    if (r.escalatedTo && r.escalatedTo !== actor.userId)
      await notifyInApp(u.tx, {
        userId: r.escalatedTo,
        eventType: 'assignment_accepted',
        title: 'Escalated lead accepted',
        body: r.recordLabel,
        linkPath: linkOf(r),
        dedupeKey: `assignment_accepted:${id}`,
      });
    return publicRow(ctx, row!);
  });
}

export async function declineAssignment(ctx: AppContext, actor: UserActor, id: string, reason: string) {
  return unitOfWork(ctx, actor, async (u) => {
    const r = await load(u, actor, id);
    if (r.assigneeId !== actor.userId) throw forbidden('ASSIGNMENT_NOT_YOURS', 'Only the person it is assigned to can decline it.');
    const [row] = await u.tx
      .update(workAssignment)
      .set({ status: 'declined', declinedAt: ctx.now(), declineReason: reason, updatedAt: ctx.now() })
      .where(eq(workAssignment.id, id))
      .returning();
    await u.timeline({
      eventType: 'assignment_declined',
      source: { type: r.recordType, id: r.recordId },
      summary: `Assignment declined by ${actor.name}: ${reason}`,
      anchors: anchors(r),
    });
    const to = await escalationTarget(u.tx, r.assigneeId, 1);
    if (to)
      await notifyInApp(u.tx, {
        userId: to,
        eventType: 'assignment_declined',
        title: `${actor.name} declined a lead — please reassign it`,
        body: `${r.recordLabel}: ${reason}`,
        linkPath: linkOf(r),
        dedupeKey: `assignment_declined:${id}`,
      });
    return publicRow(ctx, row!);
  });
}

/** Manager or admin hands the record to another active rep: the owner changes and a new assignment starts. */
export async function reassignAssignment(ctx: AppContext, actor: UserActor, id: string, assigneeId: string) {
  if (actor.role === 'salesperson') throw forbidden('FORBIDDEN_REASSIGN', 'Only managers and admins can reassign.');
  const [r] = await ctx.db.select().from(workAssignment).where(eq(workAssignment.id, id));
  if (!r || (actor.role !== 'admin' && !actor.teamScopeIds.includes(r.assigneeId) && r.escalatedTo !== actor.userId)) throw notFound('Assignment');
  if (!OPEN.includes(r.status) && r.status !== 'declined') throw conflict('ASSIGNMENT_DECIDED', 'This assignment can no longer be reassigned.');
  // Checked before the owner changes, so a no-op reassignment never leaves the record without an open assignment.
  if (OPEN.includes(r.status) && r.assigneeId === assigneeId) throw conflict('ALREADY_ASSIGNED', 'It is already assigned to that person.');
  const settings = await loadCopilotSettings(ctx);
  // The CRM service checks the permission and the target again (active user inside the actor's scope).
  if (r.recordType === 'lead') await crm.assignLead(ctx, actor, r.recordId, assigneeId);
  else await crm.changeDealOwner(ctx, actor, r.recordId, assigneeId);
  return unitOfWork(ctx, actor, async (u) => {
    if (r.status === 'declined') await u.tx.update(workAssignment).set({ status: 'superseded', updatedAt: ctx.now() }).where(eq(workAssignment.id, id));
    const row = await createAssignment(ctx, u, {
      recordType: r.recordType,
      recordId: r.recordId,
      label: r.recordLabel,
      assigneeId,
      assignedBy: actor.userId,
      source: 'reassignment',
    });
    if (row)
      await notifyInApp(u.tx, {
        userId: assigneeId,
        eventType: 'new_lead_assigned',
        title: 'A lead was handed to you',
        body: `${r.recordLabel} — accept it before ${new Intl.DateTimeFormat('en-GB', { timeZone: settings.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(row.acceptDueAt)} (${settings.timeZone})`,
        linkPath: linkOf(r),
        dedupeKey: `assignment:${row.id}`,
      });
    return row ? publicRow(ctx, row) : null;
  });
}

// ───────────────────────── timers (scheduled scans) ─────────────────────────
export async function runAssignmentTimers(ctx: AppContext): Promise<{ reminded: number; escalated: number; firstContacts: number }> {
  const settings = await loadCopilotSettings(ctx);
  const now = ctx.now();
  let reminded = 0;
  let escalated = 0;
  const due = await ctx.db
    .select()
    .from(workAssignment)
    .where(
      or(
        and(eq(workAssignment.status, 'pending'), isNull(workAssignment.remindedAt), lte(workAssignment.reminderAt, now)),
        and(eq(workAssignment.status, 'pending'), lte(workAssignment.acceptDueAt, now)),
        and(eq(workAssignment.status, 'escalated_manager'), lte(workAssignment.escalationDueAt, now)),
      ),
    )
    .orderBy(asc(workAssignment.acceptDueAt))
    .limit(200);
  for (const r of due) {
    await unitOfWork(ctx, SYSTEM, async (u) => {
      const [cur] = await u.tx.select().from(workAssignment).where(eq(workAssignment.id, r.id)).for('update');
      if (!cur) return;
      if (cur.status === 'pending' && cur.acceptDueAt <= now) {
        const to = await escalationTarget(u.tx, cur.assigneeId, 1);
        const toAdmin = to
          ? (await u.tx.select({ role: appUserProfile.role }).from(appUserProfile).where(eq(appUserProfile.userId, to)))[0]?.role === 'admin'
          : false;
        await u.tx
          .update(workAssignment)
          .set({
            status: toAdmin ? 'escalated_admin' : 'escalated_manager',
            escalationLevel: toAdmin ? 2 : 1,
            escalatedTo: to,
            escalatedAt: now,
            escalationDueAt: addBusinessHours(now, settings.escalationSlaHours, settings.calendar, settings.timeZone),
            updatedAt: now,
          })
          .where(eq(workAssignment.id, cur.id));
        await stepNotice(u, cur, to, toAdmin ? 'an admin' : 'the team manager', `escalated:${cur.id}:1`);
        escalated++;
      } else if (cur.status === 'escalated_manager' && cur.escalationDueAt && cur.escalationDueAt <= now) {
        const to = await escalationTarget(u.tx, cur.assigneeId, 2);
        await u.tx
          .update(workAssignment)
          .set({ status: 'escalated_admin', escalationLevel: 2, escalatedTo: to, escalatedAt: now, updatedAt: now })
          .where(eq(workAssignment.id, cur.id));
        await stepNotice(u, cur, to, 'an admin', `escalated:${cur.id}:2`);
        escalated++;
      } else if (cur.status === 'pending' && !cur.remindedAt && cur.reminderAt && cur.reminderAt <= now) {
        await u.tx.update(workAssignment).set({ remindedAt: now, updatedAt: now }).where(eq(workAssignment.id, cur.id));
        await notifyInApp(u.tx, {
          userId: cur.assigneeId,
          eventType: 'assignment_reminder',
          title: 'Reminder: accept your new lead',
          body: `${cur.recordLabel} — half of the time to accept has passed`,
          linkPath: linkOf(cur),
          dedupeKey: `reminder:${cur.id}`,
        });
        await u.timeline({
          eventType: 'assignment_reminder',
          source: { type: cur.recordType, id: cur.recordId },
          summary: 'Reminder sent: the assignment is still waiting to be accepted',
          anchors: anchors(cur),
          isAutomated: true,
        });
        reminded++;
      }
    });
  }
  return { reminded, escalated, firstContacts: await recordFirstContacts(ctx) };
}
async function stepNotice(u: Uow, r: Row, to: string | null, who: string, key: string) {
  const assignee = await nameOf(u.tx, r.assigneeId);
  await u.timeline({
    eventType: 'assignment_escalated',
    source: { type: r.recordType, id: r.recordId },
    summary: `Not accepted in time by ${assignee} — escalated to ${who}`,
    anchors: anchors(r),
    isAutomated: true,
  });
  if (to)
    await notifyInApp(u.tx, {
      userId: to,
      eventType: 'assignment_escalated',
      title: `Lead not accepted in time by ${assignee}`,
      body: `${r.recordLabel} — accept it for them or reassign it`,
      linkPath: linkOf(r),
      dedupeKey: key,
    });
  await notifyInApp(u.tx, {
    userId: r.assigneeId,
    eventType: 'assignment_escalated',
    title: 'Your lead was escalated',
    body: `${r.recordLabel} was not accepted in time`,
    linkPath: linkOf(r),
    dedupeKey: `${key}:rep`,
  });
}

/** Time to first contact: the first call or meeting logged on the record (or its company / people) after assignment. */
export async function recordFirstContacts(ctx: AppContext): Promise<number> {
  const since = new Date(ctx.now().getTime() - 60 * 86_400_000);
  const open = await ctx.db
    .select()
    .from(workAssignment)
    .where(
      and(
        isNull(workAssignment.firstContactAt),
        gte(workAssignment.assignedAt, since),
        sql`${workAssignment.status} <> 'superseded'`,
        // A lead can only be contacted on a record once it is converted; unconverted leads would fill every batch.
        sql`(${workAssignment.recordType} = 'deal' or exists (select 1 from lead l where l.id = ${workAssignment.recordId} and l.converted_at is not null))`,
      ),
    )
    .orderBy(desc(workAssignment.assignedAt))
    .limit(500);
  let found = 0;
  for (const a of open) {
    const related: { type: 'deal' | 'company' | 'contact'; id: string }[] = [];
    let dealId: string | null = null;
    if (a.recordType === 'deal') dealId = a.recordId;
    else {
      const [l] = await ctx.db.select().from(schema.lead).where(eq(schema.lead.id, a.recordId));
      if (l?.convertedDealId) dealId = l.convertedDealId;
      if (l?.convertedCompanyId) related.push({ type: 'company', id: l.convertedCompanyId });
      if (l?.convertedContactId) related.push({ type: 'contact', id: l.convertedContactId });
    }
    if (dealId) {
      related.push({ type: 'deal', id: dealId });
      const [d] = await ctx.db.select({ companyId: schema.deal.companyId }).from(schema.deal).where(eq(schema.deal.id, dealId));
      if (d?.companyId) related.push({ type: 'company', id: d.companyId });
      for (const c of await ctx.db.select({ id: schema.dealContact.contactId }).from(schema.dealContact).where(eq(schema.dealContact.dealId, dealId)))
        related.push({ type: 'contact', id: c.id });
    }
    if (!related.length) continue;
    const [first] = await ctx.db
      .select({ id: schema.activityLog.id, at: schema.activityLog.occurredAt })
      .from(schema.activityLog)
      .where(
        and(
          gte(schema.activityLog.occurredAt, a.assignedAt),
          or(...related.map((r) => and(eq(schema.activityLog.relatedType, r.type), eq(schema.activityLog.relatedId, r.id)))),
        ),
      )
      .orderBy(asc(schema.activityLog.occurredAt))
      .limit(1);
    if (!first) continue;
    await ctx.db.update(workAssignment).set({ firstContactAt: first.at, firstContactRef: first.id, updatedAt: ctx.now() }).where(eq(workAssignment.id, a.id));
    found++;
  }
  return found;
}

// ───────────────────────── Copilot tool ─────────────────────────
addWriteTool(
  {
    name: 'accept_assignment',
    description:
      'Accept a lead assignment that is waiting (APPROVAL: one click by the user). Managers may accept for their reps. Use the assignment alias from my_lead_inbox.',
    tier: 'approval',
    roles: ALL,
    input: z.object({ assignment: refInput('the assignment') }),
  },
  async (env, input) => {
    const ref = env.turn.aliases.resolve(input.assignment, 'assignment');
    const [r] = await env.ctx.db.select().from(workAssignment).where(eq(workAssignment.id, ref.id));
    const a = env.actor;
    if (
      !r ||
      !(r.assigneeId === a.userId || r.escalatedTo === a.userId || a.role === 'admin' || (a.role === 'sales_manager' && a.teamScopeIds.includes(r.assigneeId)))
    )
      throw notVisible();
    if (!OPEN.includes(r.status)) throw rule('ASSIGNMENT_DECIDED', 'This assignment is no longer waiting.');
    return { args: { assignmentId: r.id }, target: null, rowVersion: null, summary: `Accept the lead ${r.recordLabel}`, freeText: false };
  },
  async (ctx, actor, args) => ({ result: await acceptAssignment(ctx, actor, args.assignmentId as string) }),
);
