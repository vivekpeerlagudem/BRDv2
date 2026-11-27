/**
 * Role home cards (GET /api/v1/copilot/home) — deterministic data per role, scoped like every other read:
 *  - salesperson → "My Day": leads to accept, tasks due, deals at risk, proposals viewed but not answered.
 *  - sales manager → "My Team": pending and escalated assignments, stalled deals by rep, approvals waiting,
 *    weighted forecast now vs a week ago.
 *  - admin → "Company": pipeline, won this week, lead → opportunity → won throughput (30 days), time-to-accept and
 *    first-contact KPIs, Sales Brief status.
 * An optional one-line AI summary (fast model) is grounded: every figure must come from the card itself.
 */
import { and, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm';
import { agentAction, workAssignment } from '../../db/schema-copilot.ts';
import { salesBriefRun } from '../../db/schema-sales-brief.ts';
import { type AppContext, ownerScope, schema, type UserActor } from '../../platform/core.ts';
import { runAgent } from './loop.ts';

const DAY = 86_400_000;
const { deal, pipelineStage, dealStageHistory, task, dealFlag, proposal, lead, appUserProfile } = schema;

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : Math.round(((s[m - 1] as number) + (s[m] as number)) / 2);
};
const money = (n: number) => n.toFixed(2);

/** Weighted forecast of the scoped deals now and as it stood `daysAgo` days ago (stage history replay). */
async function forecast(ctx: AppContext, actor: UserActor, daysAgo: number) {
  const then = new Date(ctx.now().getTime() - daysAgo * DAY);
  const stages = await ctx.db.select().from(pipelineStage);
  const prob = new Map(stages.map((s) => [s.id, s.kind === 'open' ? Number(s.probability) : null]));
  const deals = await ctx.db
    .select({ id: deal.id, amount: deal.amount, status: deal.status, stageId: deal.stageId, createdAt: deal.createdAt, closedAt: deal.closedAt })
    .from(deal)
    .where(and(isNull(deal.archivedAt), ownerScope(actor, deal.ownerId, 'deals')));
  const ids = deals.map((d) => d.id);
  const history = ids.length
    ? await ctx.db
        .select({ dealId: dealStageHistory.dealId, toStageId: dealStageHistory.toStageId, changedAt: dealStageHistory.changedAt })
        .from(dealStageHistory)
        .where(and(inArray(dealStageHistory.dealId, ids), lte(dealStageHistory.changedAt, then)))
        .orderBy(dealStageHistory.changedAt)
    : [];
  const stageThen = new Map<string, string>();
  for (const h of history) stageThen.set(h.dealId, h.toStageId);
  let now = 0;
  let before = 0;
  for (const d of deals) {
    const amount = Number(d.amount ?? 0);
    if (d.status === 'open') now += (amount * (prob.get(d.stageId) ?? 0)) / 100;
    if (d.createdAt <= then) {
      const s = stageThen.get(d.id) ?? (d.status === 'open' || (d.closedAt && d.closedAt > then) ? d.stageId : null);
      const p = s ? prob.get(s) : null;
      if (p !== null && p !== undefined && !(d.closedAt && d.closedAt <= then)) before += (amount * p) / 100;
    }
  }
  return { weightedNow: money(now), weightedLastWeek: money(before) };
}

async function myDay(ctx: AppContext, actor: UserActor) {
  const now = ctx.now();
  const endOfDay = new Date(`${now.toISOString().slice(0, 10)}T23:59:59.999Z`);
  const leads = await ctx.db
    .select({
      id: workAssignment.id,
      label: workAssignment.recordLabel,
      recordType: workAssignment.recordType,
      recordId: workAssignment.recordId,
      due: workAssignment.acceptDueAt,
    })
    .from(workAssignment)
    .where(and(eq(workAssignment.assigneeId, actor.userId), eq(workAssignment.status, 'pending')))
    .orderBy(workAssignment.acceptDueAt)
    .limit(10);
  const tasks = await ctx.db
    .select({ id: task.id, title: task.title, due: task.dueAt, relatedType: task.relatedType, relatedId: task.relatedId })
    .from(task)
    .where(and(eq(task.assigneeId, actor.userId), eq(task.status, 'open'), lte(task.dueAt, endOfDay)))
    .orderBy(task.dueAt)
    .limit(10);
  const atRisk = await ctx.db
    .selectDistinct({ id: deal.id, name: deal.name, amount: deal.amount, kind: dealFlag.kind })
    .from(deal)
    .innerJoin(dealFlag, and(eq(dealFlag.dealId, deal.id), isNull(dealFlag.clearedAt), inArray(dealFlag.kind, ['stalled', 'past_close_date'])))
    .where(and(eq(deal.ownerId, actor.userId), eq(deal.status, 'open'), isNull(deal.archivedAt)))
    .limit(10);
  const viewed = await ctx.db
    .select({ id: proposal.id, title: proposal.title, dealId: deal.id, dealName: deal.name })
    .from(proposal)
    .innerJoin(deal, eq(deal.id, proposal.dealId))
    .where(and(eq(deal.ownerId, actor.userId), eq(proposal.status, 'viewed'), eq(deal.status, 'open')))
    .limit(10);
  return {
    kind: 'my_day' as const,
    title: 'My Day',
    leadsToAccept: leads.map((l) => ({ ...l, overdue: l.due <= now })),
    tasksDue: tasks.map((t) => ({ ...t, overdue: t.due < now })),
    dealsAtRisk: atRisk,
    proposalsViewedNotAnswered: viewed,
    counts: { leadsToAccept: leads.length, tasksDue: tasks.length, dealsAtRisk: new Set(atRisk.map((d) => d.id)).size, proposalsViewed: viewed.length },
  };
}

async function myTeam(ctx: AppContext, actor: UserActor) {
  const team = actor.teamScopeIds.filter((id) => id !== actor.userId);
  const assignments = team.length
    ? await ctx.db
        .select({
          id: workAssignment.id,
          label: workAssignment.recordLabel,
          assigneeId: workAssignment.assigneeId,
          status: workAssignment.status,
          due: workAssignment.acceptDueAt,
          assignee: appUserProfile.fullName,
        })
        .from(workAssignment)
        .innerJoin(appUserProfile, eq(appUserProfile.userId, workAssignment.assigneeId))
        .where(and(inArray(workAssignment.assigneeId, team), inArray(workAssignment.status, ['pending', 'escalated_manager', 'escalated_admin'])))
        .orderBy(workAssignment.acceptDueAt)
        .limit(20)
    : [];
  const stalled = await ctx.db
    .select({ owner: appUserProfile.fullName, ownerId: deal.ownerId, deals: sql<number>`count(distinct ${deal.id})::int` })
    .from(deal)
    .innerJoin(dealFlag, and(eq(dealFlag.dealId, deal.id), isNull(dealFlag.clearedAt), eq(dealFlag.kind, 'stalled')))
    .innerJoin(appUserProfile, eq(appUserProfile.userId, deal.ownerId))
    .where(and(eq(deal.status, 'open'), isNull(deal.archivedAt), ownerScope(actor, deal.ownerId, 'deals')))
    .groupBy(appUserProfile.fullName, deal.ownerId)
    .orderBy(desc(sql`count(distinct ${deal.id})`));
  const [approvals] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(agentAction)
    .where(
      and(
        eq(agentAction.principalUserId, actor.userId),
        eq(agentAction.status, 'proposed'),
        eq(agentAction.tier, 'approval'),
        gte(agentAction.expiresAt, ctx.now()),
      ),
    );
  return {
    kind: 'my_team' as const,
    title: 'My Team',
    pendingAssignments: assignments.filter((a) => a.status === 'pending'),
    escalatedAssignments: assignments.filter((a) => a.status !== 'pending'),
    stalledByRep: stalled,
    approvalsWaiting: approvals?.n ?? 0,
    forecast: await forecast(ctx, actor, 7),
    counts: {
      pending: assignments.filter((a) => a.status === 'pending').length,
      escalated: assignments.filter((a) => a.status !== 'pending').length,
      stalledDeals: stalled.reduce((s, r) => s + r.deals, 0),
    },
  };
}

async function company(ctx: AppContext, actor: UserActor) {
  const now = ctx.now();
  const since30 = new Date(now.getTime() - 30 * DAY);
  const dow = (now.getUTCDay() + 6) % 7; // Monday = 0
  const weekStart = new Date(`${new Date(now.getTime() - dow * DAY).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const scope = ownerScope(actor, deal.ownerId, 'deals');
  const [pipe] = await ctx.db
    .select({
      openDeals: sql<number>`count(*) filter (where ${deal.status} = 'open')::int`,
      openValue: sql<string>`coalesce(sum(${deal.amount}) filter (where ${deal.status} = 'open'),0)::numeric(18,2)::text`,
      wonThisWeek: sql<number>`count(*) filter (where ${deal.status} = 'won' and ${deal.closedAt} >= ${weekStart})::int`,
      wonThisWeekValue: sql<string>`coalesce(sum(${deal.amount}) filter (where ${deal.status} = 'won' and ${deal.closedAt} >= ${weekStart}),0)::numeric(18,2)::text`,
      opportunities30: sql<number>`count(*) filter (where ${deal.createdAt} >= ${since30})::int`,
      won30: sql<number>`count(*) filter (where ${deal.status} = 'won' and ${deal.closedAt} >= ${since30})::int`,
    })
    .from(deal)
    .where(and(isNull(deal.archivedAt), scope));
  const [leads30] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(lead)
    .where(and(gte(lead.createdAt, since30), isNull(lead.archivedAt)));
  const [forms30] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.leadSubmission)
    .where(and(gte(schema.leadSubmission.receivedAt, since30), eq(schema.leadSubmission.spamVerdict, 'clean')));
  const assigned = await ctx.db
    .select({
      minutes: workAssignment.minutesToAccept,
      within: workAssignment.acceptedWithinSla,
      assignedAt: workAssignment.assignedAt,
      firstContactAt: workAssignment.firstContactAt,
    })
    .from(workAssignment)
    .where(and(gte(workAssignment.assignedAt, since30), eq(workAssignment.status, 'accepted')));
  const accepted = assigned.filter((a) => a.minutes !== null);
  const [brief] = await ctx.db
    .select({ status: salesBriefRun.status, periodStart: salesBriefRun.periodStart, periodEnd: salesBriefRun.periodEnd, approvedAt: salesBriefRun.approvedAt })
    .from(salesBriefRun)
    .orderBy(desc(salesBriefRun.createdAt))
    .limit(1);
  return {
    kind: 'company' as const,
    title: 'Company view',
    pipeline: { openDeals: pipe?.openDeals ?? 0, openValue: pipe?.openValue ?? '0.00', ...(await forecast(ctx, actor, 7)) },
    wonThisWeek: { deals: pipe?.wonThisWeek ?? 0, value: pipe?.wonThisWeekValue ?? '0.00', weekStart: weekStart.toISOString().slice(0, 10) },
    throughput30Days: { leads: (leads30?.n ?? 0) + (forms30?.n ?? 0), opportunities: pipe?.opportunities30 ?? 0, won: pipe?.won30 ?? 0 },
    responseTimes30Days: {
      accepted: accepted.length,
      medianMinutesToAccept: median(accepted.map((a) => a.minutes as number)),
      acceptedWithinSlaPercent: accepted.length ? Math.round((accepted.filter((a) => a.within).length / accepted.length) * 100) : null,
      medianMinutesToFirstContact: median(
        assigned.filter((a) => a.firstContactAt).map((a) => Math.round(((a.firstContactAt as Date).getTime() - a.assignedAt.getTime()) / 60_000)),
      ),
    },
    salesBrief: brief ? { status: brief.status, weekFrom: brief.periodStart, weekTo: brief.periodEnd, approved: Boolean(brief.approvedAt) } : null,
  };
}

export async function homeCard(ctx: AppContext, actor: UserActor, opts: { summary?: boolean; requestId?: string | null } = {}) {
  const card = actor.role === 'admin' ? await company(ctx, actor) : actor.role === 'sales_manager' ? await myTeam(ctx, actor) : await myDay(ctx, actor);
  let summary: string | null = null;
  if (opts.summary) {
    const facts = JSON.stringify(card, (_k, v) => (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v) ? undefined : v));
    const run = await runAgent(ctx, {
      actor,
      kind: 'home',
      trigger: 'home_card',
      model: 'fast',
      tools: [],
      question: `Summarise this card for the user in one short sentence (at most 25 words), plain text, using only these figures:\n${facts}`,
      requestId: opts.requestId ?? null,
    });
    // Only a clean, grounded line is shown; anything else is simply left out.
    if (run.status === 'completed' && !run.flags.includes('unverified_figures') && run.answer.length <= 300) summary = run.answer;
  }
  return { ...card, summary };
}
