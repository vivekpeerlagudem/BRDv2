/**
 * reporting module — read-only dashboards (BR-RPT-001..010). Every query is restricted to the actor's report
 * scope (BR-RPT-008): Admin = organization, Sales Manager = own team, Salesperson = own performance.
 * Metric definitions follow OD-35 (win rate = won ÷ (won + lost) by close date).
 */
import { scopeFor } from '@crm/shared';
import { and, eq, gte, inArray, isNull, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import { workAssignment } from '../db/schema-copilot.ts';
import { type AppContext, canAccessOwner, forbidden, notFound, ownerScope, requirePerm, schema, type UserActor, unitOfWork } from '../platform/core.ts';

const { deal, pipelineStage, appUserProfile, proposal, proposalVersion, dealFlag, shareLink, lostReason, task, activityLog } = schema;
const { pipeline: pipelineTable, team, teamMembership, teamManager, organizationSettings } = schema;

export async function dashboard(ctx: AppContext, actor: UserActor, days = 90) {
  requirePerm(actor, 'report.view');
  const scope = ownerScope(actor, deal.ownerId, 'deals', 'report.view');
  const since = new Date(ctx.now().getTime() - days * 86_400_000);
  const live = and(isNull(deal.archivedAt), scope);
  const num = (c: unknown) => sql<string>`coalesce(sum(${c}),0)::text`;

  const pipeline = await ctx.db
    .select({
      stageId: pipelineStage.id,
      stage: pipelineStage.name,
      sortOrder: pipelineStage.sortOrder,
      probability: pipelineStage.probability,
      count: sql<number>`count(${deal.id})::int`,
      value: num(deal.amount),
      weighted: sql<string>`coalesce(sum(${deal.amount} * ${pipelineStage.probability} / 100),0)::numeric(18,2)::text`,
    })
    .from(pipelineStage)
    .leftJoin(deal, and(eq(deal.stageId, pipelineStage.id), eq(deal.status, 'open'), live))
    .where(eq(pipelineStage.kind, 'open'))
    .groupBy(pipelineStage.id)
    .orderBy(pipelineStage.sortOrder);

  const [wonLost] = await ctx.db
    .select({
      won: sql<number>`count(*) filter (where ${deal.status} = 'won')::int`,
      lost: sql<number>`count(*) filter (where ${deal.status} = 'lost')::int`,
      wonValue: sql<string>`coalesce(sum(${deal.amount}) filter (where ${deal.status} = 'won'),0)::text`,
    })
    .from(deal)
    .where(and(live, gte(deal.closedAt, since)));
  const closed = (wonLost?.won ?? 0) + (wonLost?.lost ?? 0);

  const lostReasons = await ctx.db
    .select({ reason: lostReason.name, count: sql<number>`count(*)::int` })
    .from(deal)
    .innerJoin(lostReason, eq(lostReason.id, deal.lostReasonId))
    .where(and(live, eq(deal.status, 'lost'), gte(deal.closedAt, since)))
    .groupBy(lostReason.name);

  const reps = await ctx.db
    .select({
      userId: appUserProfile.userId,
      name: appUserProfile.fullName,
      openDeals: sql<number>`count(*) filter (where ${deal.status} = 'open')::int`,
      won: sql<number>`count(*) filter (where ${deal.status} = 'won' and ${deal.closedAt} >= ${since.toISOString()}::timestamptz)::int`,
      lost: sql<number>`count(*) filter (where ${deal.status} = 'lost' and ${deal.closedAt} >= ${since.toISOString()}::timestamptz)::int`,
      wonRevenue: sql<string>`coalesce(sum(${deal.amount}) filter (where ${deal.status} = 'won' and ${deal.closedAt} >= ${since.toISOString()}::timestamptz),0)::text`,
      avgCycleDays: sql<
        number | null
      >`round(avg(extract(epoch from (${deal.closedAt} - ${deal.createdAt})) / 86400) filter (where ${deal.status} = 'won'))::int`,
    })
    .from(deal)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, deal.ownerId))
    .where(live)
    .groupBy(appUserProfile.userId)
    .orderBy(appUserProfile.fullName);

  const [prop] = await ctx.db
    .select({
      sent: sql<number>`count(*) filter (where ${proposal.lastSentVersionId} is not null)::int`,
      viewed: sql<number>`count(*) filter (where ${proposal.status} in ('viewed','accepted','signed','declined'))::int`,
      signed: sql<number>`count(*) filter (where ${proposal.status} in ('signed','accepted'))::int`,
    })
    .from(proposal)
    .innerJoin(deal, eq(deal.id, proposal.dealId))
    .where(and(live, gte(proposal.createdAt, since)));
  const [timing] = await ctx.db
    .select({
      hoursToFirstView: sql<number | null>`round(avg(extract(epoch from (${shareLink.firstViewedAt} - ${proposalVersion.sentAt})) / 3600)::numeric, 1)::float`,
    })
    .from(shareLink)
    .innerJoin(proposalVersion, eq(proposalVersion.id, shareLink.proposalVersionId))
    .innerJoin(deal, eq(deal.id, shareLink.dealId))
    .where(and(live, sql`${shareLink.firstViewedAt} is not null`));

  const attention = await ctx.db
    .select({ dealId: deal.id, name: deal.name, kind: dealFlag.kind, raisedAt: dealFlag.raisedAt })
    .from(dealFlag)
    .innerJoin(deal, eq(deal.id, dealFlag.dealId))
    .where(and(live, isNull(dealFlag.clearedAt)))
    .limit(50);
  const unviewed = await ctx.db
    .select({ dealId: deal.id, name: deal.name })
    .from(proposal)
    .innerJoin(deal, eq(deal.id, proposal.dealId))
    .where(and(live, eq(proposal.status, 'sent'), eq(deal.status, 'open')))
    .limit(50);

  const [activity] = await ctx.db
    .select({ tasksCompleted: sql<number>`count(*)::int` })
    .from(task)
    .where(and(eq(task.status, 'completed'), gte(task.completedAt, since), actor.role === 'admin' ? undefined : inArray(task.assigneeId, actor.teamScopeIds)));
  const [calls] = await ctx.db
    .select({ logged: sql<number>`count(*)::int` })
    .from(activityLog)
    .where(and(gte(activityLog.occurredAt, since), actor.role === 'admin' ? undefined : inArray(activityLog.loggedBy, actor.teamScopeIds)));

  const openValue = pipeline.reduce((s, p) => s + Number(p.value), 0);
  const weighted = pipeline.reduce((s, p) => s + Number(p.weighted), 0);
  return {
    scope: actor.role === 'admin' ? 'organization' : actor.role === 'sales_manager' ? 'team' : 'own',
    periodDays: days,
    kpis: {
      openPipelineValue: openValue.toFixed(2),
      weightedForecast: weighted.toFixed(2),
      wonRevenue: wonLost?.wonValue ?? '0',
      winRate: closed ? Math.round(((wonLost?.won ?? 0) / closed) * 100) : null,
      dealsWon: wonLost?.won ?? 0,
      dealsLost: wonLost?.lost ?? 0,
    },
    pipeline,
    lostReasons,
    reps: reps.map((r) => ({ ...r, winRate: r.won + r.lost ? Math.round((r.won / (r.won + r.lost)) * 100) : null })),
    proposals: {
      sent: prop?.sent ?? 0,
      viewRate: prop?.sent ? Math.round(((prop.viewed ?? 0) / prop.sent) * 100) : null,
      winRate: prop?.sent ? Math.round(((prop.signed ?? 0) / prop.sent) * 100) : null,
      hoursToFirstView: timing?.hoursToFirstView ?? null,
    },
    attention: [
      ...attention.map((a) => ({ dealId: a.dealId, name: a.name, reason: a.kind as string })),
      ...unviewed.map((u) => ({ dealId: u.dealId, name: u.name, reason: 'unviewed_proposal' })),
    ],
    activity: { tasksCompleted: activity?.tasksCompleted ?? 0, callsAndMeetingsLogged: calls?.logged ?? 0 },
  };
}

// ═════════════════════════ Filtered reports + CSV export (BR-RPT-001..010) ═════════════════════════
//
// Metric definitions (FUNCTIONAL-REQUIREMENTS §15, RULE-RPT-01..11):
//  · Scope (RULE-RPT-01): every query carries ownerScope(actor, <owner column>, 'deals', 'report.view') — Admin = all,
//    Sales Manager = team scope, Salesperson = own. Team / owner filters only ever NARROW that scope.
//  · Periods are inclusive calendar days in the organization time zone (RULE-RPT-10): won/lost by closed_at,
//    proposal metrics by first sent_at, activity by activity date.
//  · Values are in the organization default currency. There is no exchange-rate table, so a deal in another currency
//    has no applicable rate: it is left out of value totals and counted as "not converted" (RULE-RPT-03).

const isoDay = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the format YYYY-MM-DD')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v, 'This is not a real date');
const dayNumber = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
export const MAX_RANGE_DAYS = 5 * 366;
export const reportQuery = z
  .object({ from: isoDay.optional(), to: isoDay.optional(), teamId: z.uuid().optional(), ownerId: z.uuid().optional() })
  .superRefine((q, c) => {
    if (!q.from || !q.to) return;
    if (dayNumber(q.from) > dayNumber(q.to)) c.addIssue({ code: 'custom', path: ['to'], message: '"To" must be on or after "From"' });
    else if (dayNumber(q.to) - dayNumber(q.from) > MAX_RANGE_DAYS)
      c.addIssue({ code: 'custom', path: ['to'], message: 'The date range can be at most 5 years' });
  });
export type ReportQuery = z.infer<typeof reportQuery>;

export const REPORT_SECTIONS = [
  'pipeline-by-stage',
  'pipeline-by-owner',
  'won-lost',
  'lost-reasons',
  'rep-performance',
  'proposal-metrics',
  'proposals',
  'activity',
  'attention',
] as const;
export type ReportSection = (typeof REPORT_SECTIONS)[number];
export const reportSection = z.enum(REPORT_SECTIONS);

interface ReportScope {
  from: string;
  to: string;
  teamId: string | null;
  ownerId: string | null;
  timeZone: string;
  currency: string;
  followUpAfterDays: number;
  now: Date;
  /** Restricts an owner-like column to the actor's report scope AND the chosen team / owner filters. */
  owners: (column: PgColumn) => SQL;
  /** True when the timestamp falls inside the inclusive period, in the organization time zone. */
  inRange: (column: PgColumn | SQL) => SQL;
}

const shiftDay = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * 86_400_000).toISOString().slice(0, 10);
const scopeLabel = (actor: UserActor) => {
  const s = scopeFor(actor.role, 'report.view');
  return s === 'all' ? 'organization' : s === 'team' ? 'team' : 'own';
};

/**
 * Validates the filters against what the actor may see and returns the SQL conditions every report query uses.
 * A filter outside the actor's scope is refused with 403 (never silently widened or ignored).
 */
async function resolveScope(ctx: AppContext, actor: UserActor, q: ReportQuery): Promise<ReportScope> {
  requirePerm(actor, 'report.view');
  const roleScope = scopeFor(actor.role, 'report.view');
  const [settings] = await ctx.db
    .select({ timeZone: organizationSettings.timeZone, currency: organizationSettings.defaultCurrency, automation: organizationSettings.automationSettings })
    .from(organizationSettings);
  if (!settings) throw notFound('Organization settings');

  if (q.ownerId) {
    if (!canAccessOwner(actor, q.ownerId, 'read', 'deals', 'report.view'))
      throw forbidden('REPORT_OWNER_OUT_OF_SCOPE', 'You can only see reports for people in your own reporting scope');
    const [u] = await ctx.db.select({ id: appUserProfile.userId }).from(appUserProfile).where(eq(appUserProfile.userId, q.ownerId));
    if (!u) throw notFound('User');
  }
  let memberIds: string[] | null = null;
  if (q.teamId) {
    if (roleScope !== 'all' && roleScope !== 'team') throw forbidden('REPORT_TEAM_OUT_OF_SCOPE', 'You can only see your own performance');
    if (roleScope === 'team') {
      const [managed] = await ctx.db
        .select({ teamId: teamManager.teamId })
        .from(teamManager)
        .where(and(eq(teamManager.teamId, q.teamId), eq(teamManager.userId, actor.userId)));
      if (!managed) throw forbidden('REPORT_TEAM_OUT_OF_SCOPE', 'You can only see reports for teams you manage');
    }
    const [t] = await ctx.db.select({ id: team.id }).from(team).where(eq(team.id, q.teamId));
    if (!t) throw notFound('Team');
    // Team filter = owners currently in the team (BR-RPT-007, OD-32).
    memberIds = (
      await ctx.db
        .select({ userId: teamMembership.userId })
        .from(teamMembership)
        .where(and(eq(teamMembership.teamId, q.teamId), eq(teamMembership.isActive, true)))
    ).map((m) => m.userId);
  }

  const now = ctx.now();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: settings.timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const to = q.to ?? (q.from && dayNumber(q.from) > dayNumber(today) ? q.from : today);
  const from = q.from ?? shiftDay(to, -89);
  const tz = settings.timeZone;
  const start = sql`(${from}::date::timestamp at time zone ${tz})`;
  const end = sql`((${to}::date + 1)::timestamp at time zone ${tz})`;
  const ownerId = q.ownerId ?? null;
  return {
    from,
    to,
    teamId: q.teamId ?? null,
    ownerId,
    timeZone: tz,
    currency: settings.currency,
    followUpAfterDays: settings.automation.followUpAfterDays,
    now,
    owners: (column) => {
      const parts: SQL[] = [ownerScope(actor, column, 'deals', 'report.view')];
      if (memberIds) parts.push(memberIds.length ? inArray(column, memberIds) : sql`false`);
      if (ownerId) parts.push(eq(column, ownerId));
      return sql`(${sql.join(parts, sql` and `)})`;
    },
    inRange: (column) => sql`(${column} >= ${start} and ${column} < ${end})`,
  };
}

/** Exact decimal addition for numeric(18,2) text values — money is never summed as a float. */
function sumMoney(values: string[]): string {
  let cents = 0n;
  for (const v of values) {
    const neg = v.startsWith('-');
    const [whole = '0', frac = ''] = (neg ? v.slice(1) : v).split('.');
    const n = BigInt(whole) * 100n + BigInt(`${frac}00`.slice(0, 2));
    cents += neg ? -n : n;
  }
  const abs = cents < 0n ? -cents : cents;
  return `${cents < 0n ? '-' : ''}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? new Date(v).toISOString() : null);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const displayName = (name: string, status: string) => (status === 'deactivated' ? `${name} (deactivated)` : name);

/** Filter options limited to the actor's scope (BR-RPT-008). */
export async function reportFilters(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'report.view');
  const roleScope = scopeFor(actor.role, 'report.view');
  const owners = await ctx.db
    .select({ id: appUserProfile.userId, name: appUserProfile.fullName, status: appUserProfile.status, teamId: teamMembership.teamId })
    .from(appUserProfile)
    .leftJoin(teamMembership, and(eq(teamMembership.userId, appUserProfile.userId), eq(teamMembership.isActive, true)))
    .where(and(ownerScope(actor, appUserProfile.userId, 'deals', 'report.view'), sql`${appUserProfile.status} <> 'invited'`))
    .orderBy(appUserProfile.fullName);
  const teams =
    roleScope === 'all'
      ? await ctx.db.select({ id: team.id, name: team.name }).from(team).where(isNull(team.archivedAt)).orderBy(team.name)
      : roleScope === 'team'
        ? await ctx.db
            .select({ id: team.id, name: team.name })
            .from(team)
            .innerJoin(teamManager, eq(teamManager.teamId, team.id))
            .where(and(eq(teamManager.userId, actor.userId), isNull(team.archivedAt)))
            .orderBy(team.name)
        : [];
  return {
    scope: scopeLabel(actor),
    teams,
    owners: owners.map((o) => ({ id: o.id, name: displayName(o.name, o.status), teamId: o.teamId })),
  };
}

/**
 * Lead response times (Kensium Copilot accept-and-escalate): assignments made in the period, scoped like every other
 * section by the assignee. Median and p90 of business minutes to accept, % accepted within the time limit, and the
 * median minutes to first contact — overall, by rep and by team (current active team).
 */
async function responseTimesSection(ctx: AppContext, s: ReportScope) {
  const wa = workAssignment;
  const figures = {
    assigned: sql<number>`count(*)::int`,
    accepted: sql<number>`count(${wa.acceptedAt})::int`,
    acceptedWithinSla: sql<number>`count(*) filter (where ${wa.acceptedWithinSla})::int`,
    escalated: sql<number>`count(*) filter (where ${wa.escalationLevel} > 0)::int`,
    medianBusinessMinutesToAccept: sql<string | null>`round(percentile_cont(0.5) within group (order by ${wa.businessMinutesToAccept}))::text`,
    p90BusinessMinutesToAccept: sql<string | null>`round(percentile_cont(0.9) within group (order by ${wa.businessMinutesToAccept}))::text`,
    medianMinutesToAccept: sql<string | null>`round(percentile_cont(0.5) within group (order by ${wa.minutesToAccept}))::text`,
    medianMinutesToFirstContact: sql<
      string | null
    >`round(percentile_cont(0.5) within group (order by extract(epoch from (${wa.firstContactAt} - ${wa.assignedAt})) / 60))::text`,
  };
  const where = and(s.owners(wa.assigneeId), s.inRange(wa.assignedAt), sql`${wa.status} <> 'superseded'`);
  const shape = (r: { [K in keyof typeof figures]: unknown }) => ({
    assigned: Number(r.assigned),
    accepted: Number(r.accepted),
    acceptedWithinSla: Number(r.acceptedWithinSla),
    escalated: Number(r.escalated),
    acceptedWithinSlaPercent: Number(r.accepted) ? Math.round((Number(r.acceptedWithinSla) / Number(r.accepted)) * 100) : null,
    medianBusinessMinutesToAccept: r.medianBusinessMinutesToAccept === null ? null : Number(r.medianBusinessMinutesToAccept),
    p90BusinessMinutesToAccept: r.p90BusinessMinutesToAccept === null ? null : Number(r.p90BusinessMinutesToAccept),
    medianMinutesToAccept: r.medianMinutesToAccept === null ? null : Number(r.medianMinutesToAccept),
    medianMinutesToFirstContact: r.medianMinutesToFirstContact === null ? null : Number(r.medianMinutesToFirstContact),
  });
  const [total] = await ctx.db.select(figures).from(wa).where(where);
  const byRep = await ctx.db
    .select({ ownerId: wa.assigneeId, name: appUserProfile.fullName, ...figures })
    .from(wa)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, wa.assigneeId))
    .where(where)
    .groupBy(wa.assigneeId, appUserProfile.fullName)
    .orderBy(appUserProfile.fullName);
  const byTeam = await ctx.db
    .select({ teamId: team.id, team: team.name, ...figures })
    .from(wa)
    .innerJoin(teamMembership, and(eq(teamMembership.userId, wa.assigneeId), eq(teamMembership.isActive, true)))
    .innerJoin(team, eq(team.id, teamMembership.teamId))
    .where(where)
    .groupBy(team.id, team.name)
    .orderBy(team.name);
  return {
    total: total ? shape(total) : null,
    byRep: byRep.map((r) => ({ ownerId: r.ownerId, name: r.name, ...shape(r) })),
    byTeam: byTeam.map((r) => ({ teamId: r.teamId, team: r.team, ...shape(r) })),
  };
}

export async function reportOverview(ctx: AppContext, actor: UserActor, q: ReportQuery) {
  const s = await resolveScope(ctx, actor, q);
  const live = and(isNull(deal.archivedAt), s.owners(deal.ownerId));
  const conv = sql`${deal.currency} = ${s.currency}`;
  const isOpen = sql`${deal.status} = 'open'`;
  const wonIn = sql`${deal.status} = 'won' and ${s.inRange(deal.closedAt)}`;
  const lostIn = sql`${deal.status} = 'lost' and ${s.inRange(deal.closedAt)}`;
  const localDay = (c: PgColumn) => sql`(${c} at time zone ${s.timeZone})::date`;
  const pctOf = (part: SQL, whole: SQL) => sql<number | null>`round(100.0 * ${part} / nullif(${whole}, 0), 1)::float8`;

  // ── Pipeline (BR-RPT-001/006): current open deals; weighted = Σ amount × stage probability ÷ 100 (RULE-RPT-04).
  const openAgg = {
    count: sql<number>`count(${deal.id})::int`,
    value: sql<string>`coalesce(sum(${deal.amount}) filter (where ${conv}), 0)::numeric(18,2)::text`,
    weighted: sql<string>`coalesce(sum(${deal.amount} * ${pipelineStage.probability} / 100) filter (where ${conv}), 0)::numeric(18,2)::text`,
    noAmount: sql<number>`count(${deal.id}) filter (where ${deal.amount} is null)::int`,
    notConverted: sql<number>`count(${deal.id}) filter (where ${deal.amount} is not null and not ${conv})::int`,
    createdInPeriod: sql<number>`count(${deal.id}) filter (where ${s.inRange(deal.createdAt)})::int`,
  };
  const pipelineByStage = await ctx.db
    .select({ stageId: pipelineStage.id, pipeline: pipelineTable.name, stage: pipelineStage.name, probability: pipelineStage.probability, ...openAgg })
    .from(pipelineStage)
    .innerJoin(pipelineTable, eq(pipelineTable.id, pipelineStage.pipelineId))
    .leftJoin(deal, and(eq(deal.stageId, pipelineStage.id), isOpen, live))
    .where(eq(pipelineStage.kind, 'open'))
    .groupBy(pipelineStage.id, pipelineTable.id)
    .orderBy(pipelineTable.name, pipelineStage.sortOrder);
  const pipelineByOwner = (
    await ctx.db
      .select({ ownerId: appUserProfile.userId, owner: appUserProfile.fullName, status: appUserProfile.status, ...openAgg })
      .from(deal)
      .innerJoin(pipelineStage, eq(pipelineStage.id, deal.stageId))
      .innerJoin(appUserProfile, eq(appUserProfile.userId, deal.ownerId))
      .where(and(live, isOpen))
      .groupBy(appUserProfile.userId)
      .orderBy(appUserProfile.fullName)
  ).map(({ status, ...r }) => ({ ...r, owner: displayName(r.owner, status) }));

  // ── Won / lost (BR-RPT-002): by close date in the period; rates per RULE-RPT-02.
  const wonValue = sql`coalesce(sum(${deal.amount}) filter (where ${deal.status} = 'won' and ${conv}), 0)`;
  const lostValue = sql`coalesce(sum(${deal.amount}) filter (where ${deal.status} = 'lost' and ${conv}), 0)`;
  const [wl] = await ctx.db
    .select({
      won: sql<number>`count(*) filter (where ${deal.status} = 'won')::int`,
      lost: sql<number>`count(*) filter (where ${deal.status} = 'lost')::int`,
      wonValue: sql<string>`${wonValue}::numeric(18,2)::text`,
      lostValue: sql<string>`${lostValue}::numeric(18,2)::text`,
      winRateCount: pctOf(sql`count(*) filter (where ${deal.status} = 'won')`, sql`count(*)`),
      winRateValue: pctOf(wonValue, sql`(${wonValue} + ${lostValue})`),
      notConverted: sql<number>`count(*) filter (where ${deal.amount} is not null and not ${conv})::int`,
    })
    .from(deal)
    .where(and(live, sql`${deal.status} in ('won','lost')`, s.inRange(deal.closedAt)));
  const lostReasons = await ctx.db
    .select({
      reason: sql<string>`coalesce(${lostReason.name}, 'No reason recorded')`,
      count: sql<number>`count(*)::int`,
      value: sql<string>`coalesce(sum(${deal.amount}) filter (where ${conv}), 0)::numeric(18,2)::text`,
      percent: sql<number>`round(100.0 * count(*) / sum(count(*)) over (), 1)::float8`,
    })
    .from(deal)
    .leftJoin(lostReason, eq(lostReason.id, deal.lostReasonId))
    .where(and(live, lostIn))
    .groupBy(lostReason.name)
    .orderBy(sql`count(*) desc`, lostReason.name);

  // ── Rep performance (BR-RPT-003): current owner; cycle length = close date − created date in calendar days, won deals.
  const wonCount = sql`count(*) filter (where ${wonIn})`;
  const lostCount = sql`count(*) filter (where ${lostIn})`;
  const reps = (
    await ctx.db
      .select({
        userId: appUserProfile.userId,
        name: appUserProfile.fullName,
        status: appUserProfile.status,
        openDeals: sql<number>`count(*) filter (where ${isOpen})::int`,
        openValue: sql<string>`coalesce(sum(${deal.amount}) filter (where ${isOpen} and ${conv}), 0)::numeric(18,2)::text`,
        won: sql<number>`${wonCount}::int`,
        lost: sql<number>`${lostCount}::int`,
        wonRevenue: sql<string>`coalesce(sum(${deal.amount}) filter (where ${wonIn} and ${conv}), 0)::numeric(18,2)::text`,
        winRate: pctOf(wonCount, sql`(${wonCount} + ${lostCount})`),
        avgDealSize: sql<string | null>`(avg(${deal.amount}) filter (where ${wonIn} and ${conv}))::numeric(18,2)::text`,
        avgCycleDays: sql<number | null>`round(avg(${localDay(deal.closedAt)} - ${localDay(deal.createdAt)}) filter (where ${wonIn}), 1)::float8`,
      })
      .from(deal)
      .innerJoin(appUserProfile, eq(appUserProfile.userId, deal.ownerId))
      .where(live)
      .groupBy(appUserProfile.userId)
      .having(sql`count(*) filter (where ${isOpen}) > 0 or ${wonCount} + ${lostCount} > 0`)
      .orderBy(appUserProfile.fullName)
  ).map(({ status, ...r }) => ({ ...r, name: displayName(r.name, status) }));

  // ── Proposal metrics (BR-RPT-004, RULE-RPT-07): cohort = proposals whose FIRST sent version falls in the period.
  const cohort = sql`
    with first_sent as (
      select p.id, p.title, p.status, p.deal_id, min(pv.sent_at) as first_sent_at
      from proposal p
      join deal on deal.id = p.deal_id
      join proposal_version pv on pv.proposal_id = p.id and pv.sent_at is not null
      where deal.archived_at is null and ${s.owners(deal.ownerId)}
      group by p.id
    ),
    cohort as (
      select fs.*, deal.name as deal_name, deal.owner_id,
        (select min(sl.first_viewed_at) from share_link sl
           where sl.proposal_id = fs.id and exists (select 1 from view_session vs where vs.share_link_id = sl.id and vs.counted)) as first_view_at,
        sg.completed_at as signed_at, sg.sent_at as signed_version_sent_at
      from first_sent fs
      join deal on deal.id = fs.deal_id
      left join lateral (
        select sr.completed_at, spv.sent_at from signature_request sr
        join proposal_version spv on spv.id = sr.proposal_version_id
        where sr.proposal_id = fs.id and sr.status = 'signed' and sr.completed_at is not null
        order by sr.completed_at limit 1
      ) sg on true
      where ${s.inRange(sql`fs.first_sent_at`)}
    )`;
  const hours = (a: string, b: string) => sql.raw(`extract(epoch from (${a} - ${b})) / 3600.0`);
  const days = (a: string, b: string) => sql.raw(`extract(epoch from (${a} - ${b})) / 86400.0`);
  const r1 = (x: SQL) => sql`round((${x})::numeric, 1)::float8`;
  const [pm] = (
    await ctx.db.execute(sql`${cohort}
    select count(*)::int as sent,
      count(*) filter (where first_view_at is not null)::int as viewed,
      count(*) filter (where status in ('signed','accepted'))::int as won,
      ${r1(sql`100.0 * count(*) filter (where first_view_at is not null) / nullif(count(*), 0)`)} as view_rate,
      ${r1(sql`100.0 * count(*) filter (where status in ('signed','accepted')) / nullif(count(*), 0)`)} as win_rate,
      ${r1(sql`percentile_cont(0.5) within group (order by ${hours('first_view_at', 'first_sent_at')})`)} as median_hours_to_first_view,
      ${r1(sql`avg(${hours('first_view_at', 'first_sent_at')})`)} as avg_hours_to_first_view,
      ${r1(sql`percentile_cont(0.5) within group (order by ${days('signed_at', 'signed_version_sent_at')})`)} as median_days_to_sign,
      ${r1(sql`avg(${days('signed_at', 'signed_version_sent_at')})`)} as avg_days_to_sign
    from cohort`)
  ).rows as Record<string, unknown>[];
  const [vs] = (
    await ctx.db.execute(sql`
    select count(*)::int as versions_sent from proposal_version pv
    join proposal p on p.id = pv.proposal_id join deal on deal.id = p.deal_id
    where deal.archived_at is null and ${s.owners(deal.ownerId)} and pv.sent_at is not null and ${s.inRange(sql`pv.sent_at`)}`)
  ).rows as Record<string, unknown>[];
  // Deal creation → first proposal: the first sent version of ANY proposal on the deal, deals whose first send is in the period.
  const [dp] = (
    await ctx.db.execute(sql`
    with d as (
      select deal.id, deal.created_at, min(pv.sent_at) as first_sent_at
      from deal join proposal p on p.deal_id = deal.id join proposal_version pv on pv.proposal_id = p.id and pv.sent_at is not null
      where deal.archived_at is null and ${s.owners(deal.ownerId)}
      group by deal.id
    )
    select count(*)::int as deals,
      ${r1(sql`percentile_cont(0.5) within group (order by ${days('first_sent_at', 'created_at')})`)} as median_days,
      ${r1(sql`avg(${days('first_sent_at', 'created_at')})`)} as avg_days
    from d where ${s.inRange(sql`d.first_sent_at`)}`)
  ).rows as Record<string, unknown>[];
  const proposalRows = (
    await ctx.db.execute(sql`${cohort}
    select c.id, c.title, c.status, c.deal_id, c.deal_name, u.full_name as owner, u.status as owner_status, c.first_sent_at, c.first_view_at, c.signed_at,
      ${r1(hours('c.first_view_at', 'c.first_sent_at'))} as hours_to_first_view,
      ${r1(days('c.signed_at', 'c.signed_version_sent_at'))} as days_to_sign
    from cohort c join app_user_profile u on u.user_id = c.owner_id
    order by c.first_sent_at desc, c.id limit 500`)
  ).rows as Record<string, unknown>[];

  // ── Activity per rep (BR-RPT-010): logged calls and meetings, notes added, tasks completed, by activity date.
  const activity = (
    (
      await ctx.db.execute(sql`
    select app_user_profile.user_id, app_user_profile.full_name, app_user_profile.status,
      sum(a.calls)::int as calls, sum(a.meetings)::int as meetings, sum(a.notes)::int as notes, sum(a.tasks)::int as tasks
    from app_user_profile join (
      select logged_by as user_id, count(*) filter (where kind = 'call') as calls, count(*) filter (where kind = 'meeting') as meetings, 0 as notes, 0 as tasks
        from activity_log where ${s.inRange(sql`occurred_at`)} group by 1
      union all
      select author_id, 0, 0, count(*), 0 from note where ${s.inRange(sql`created_at`)} group by 1
      union all
      select assignee_id, 0, 0, 0, count(*) from task where status = 'completed' and completed_at is not null and ${s.inRange(sql`completed_at`)} group by 1
    ) a on a.user_id = app_user_profile.user_id
    where ${s.owners(appUserProfile.userId)}
    group by app_user_profile.user_id
    order by app_user_profile.full_name`)
    ).rows as Record<string, unknown>[]
  ).map((r) => ({
    userId: String(r.user_id),
    name: displayName(String(r.full_name), String(r.status)),
    calls: Number(r.calls),
    meetings: Number(r.meetings),
    notes: Number(r.notes),
    tasksCompleted: Number(r.tasks),
  }));

  // ── Deals needing attention (BR-RPT-005, RULE-RPT-06): open deals with a stalled flag, an overdue flag, or a
  //    current sent proposal version nobody has viewed within the follow-up window. A "now" list — not date-filtered.
  const nowIso = s.now.toISOString();
  const attention = (
    (
      await ctx.db.execute(sql`
    select * from (
      select deal.id, deal.name, deal.amount::text as amount, deal.currency, deal.owner_id,
        app_user_profile.full_name as owner, app_user_profile.status as owner_status, st.name as stage,
        floor(extract(epoch from (${nowIso}::timestamptz - coalesce(deal.last_activity_at, deal.created_at))) / 86400)::int as days_since_activity,
        exists (select 1 from deal_flag f where f.deal_id = deal.id and f.kind = 'stalled' and f.cleared_at is null) as stalled,
        exists (select 1 from deal_flag f where f.deal_id = deal.id and f.kind = 'past_close_date' and f.cleared_at is null) as overdue,
        exists (
          select 1 from proposal p join proposal_version pv on pv.id = p.last_sent_version_id
          where p.deal_id = deal.id and p.status = 'sent' and pv.sent_at < ${nowIso}::timestamptz - make_interval(days => ${s.followUpAfterDays}::int)
            and not exists (select 1 from share_link sl join view_session v on v.share_link_id = sl.id where sl.proposal_version_id = pv.id and v.counted)
        ) as unviewed,
        (select p.status from proposal p where p.deal_id = deal.id order by p.updated_at desc, p.id desc limit 1) as last_proposal_status
      from deal
      join app_user_profile on app_user_profile.user_id = deal.owner_id
      join pipeline_stage st on st.id = deal.stage_id
      where deal.status = 'open' and deal.archived_at is null and ${s.owners(deal.ownerId)}
    ) x
    where x.stalled or x.overdue or x.unviewed
    order by x.amount::numeric desc nulls last, x.name limit 500`)
    ).rows as Record<string, unknown>[]
  ).map((r) => ({
    dealId: String(r.id),
    name: String(r.name),
    owner: displayName(String(r.owner), String(r.owner_status)),
    stage: String(r.stage),
    amount: (r.amount as string | null) ?? null,
    currency: String(r.currency),
    reasons: [r.stalled ? 'stalled' : null, r.overdue ? 'overdue' : null, r.unviewed ? 'unviewed_proposal' : null].filter((x): x is string => x !== null),
    daysSinceActivity: Number(r.days_since_activity),
    lastProposalStatus: (r.last_proposal_status as string | null) ?? null,
  }));

  const responseTimes = await responseTimesSection(ctx, s);

  return {
    scope: scopeLabel(actor),
    filters: { from: s.from, to: s.to, teamId: s.teamId, ownerId: s.ownerId },
    currency: s.currency,
    timeZone: s.timeZone,
    generatedAt: nowIso,
    responseTimes,
    pipelineByStage,
    pipelineByOwner,
    pipelineTotals: {
      count: pipelineByStage.reduce((n, r) => n + r.count, 0),
      value: sumMoney(pipelineByStage.map((r) => r.value)),
      weighted: sumMoney(pipelineByStage.map((r) => r.weighted)),
      noAmount: pipelineByStage.reduce((n, r) => n + r.noAmount, 0),
      notConverted: pipelineByStage.reduce((n, r) => n + r.notConverted, 0),
    },
    wonLost: {
      won: wl?.won ?? 0,
      lost: wl?.lost ?? 0,
      wonValue: wl?.wonValue ?? '0.00',
      lostValue: wl?.lostValue ?? '0.00',
      winRateCount: wl?.winRateCount ?? null,
      winRateValue: wl?.winRateValue ?? null,
      notConverted: wl?.notConverted ?? 0,
    },
    lostReasons,
    reps,
    proposals: {
      sent: Number(pm?.sent ?? 0),
      versionsSent: Number(vs?.versions_sent ?? 0),
      viewed: Number(pm?.viewed ?? 0),
      won: Number(pm?.won ?? 0),
      viewRate: numOrNull(pm?.view_rate),
      winRate: numOrNull(pm?.win_rate),
      medianHoursToFirstView: numOrNull(pm?.median_hours_to_first_view),
      avgHoursToFirstView: numOrNull(pm?.avg_hours_to_first_view),
      medianDaysToSign: numOrNull(pm?.median_days_to_sign),
      avgDaysToSign: numOrNull(pm?.avg_days_to_sign),
      dealsWithFirstProposal: Number(dp?.deals ?? 0),
      medianDaysDealToFirstProposal: numOrNull(dp?.median_days),
      avgDaysDealToFirstProposal: numOrNull(dp?.avg_days),
      list: proposalRows.map((r) => ({
        proposalId: String(r.id),
        title: String(r.title),
        status: String(r.status),
        dealId: String(r.deal_id),
        dealName: String(r.deal_name),
        owner: displayName(String(r.owner), String(r.owner_status)),
        firstSentAt: iso(r.first_sent_at),
        firstViewAt: iso(r.first_view_at),
        signedAt: iso(r.signed_at),
        hoursToFirstView: numOrNull(r.hours_to_first_view),
        daysToSign: numOrNull(r.days_to_sign),
      })),
    },
    activity,
    attention,
  };
}
export type ReportOverview = Awaited<ReturnType<typeof reportOverview>>;

// ───────────── CSV export (BR-RPT-009, RULE-RPT-11) ─────────────
type Cell = string | number | null;
/**
 * One CSV cell. Text that a spreadsheet would run as a formula (starts with = + - @, or a tab / carriage return) is
 * prefixed with an apostrophe; plain numbers such as -12.50 are left alone. Quotes, commas and line breaks are escaped.
 */
export function csvCell(v: Cell): string {
  if (v === null) return '';
  let out = typeof v === 'number' ? String(v) : v;
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(out) && !/^-?\d+(\.\d+)?$/.test(out)) out = `'${out}`;
  return /[",\r\n]/.test(out) ? `"${out.replaceAll('"', '""')}"` : out;
}
export const toCsv = (head: string[], rows: Cell[][]) => `﻿${[head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

const REASON_LABEL: Record<string, string> = { stalled: 'Stalled', overdue: 'Past expected close date', unviewed_proposal: 'Proposal not viewed' };
function sectionTable(section: ReportSection, d: ReportOverview): { head: string[]; rows: Cell[][] } {
  const cur = d.currency;
  switch (section) {
    case 'pipeline-by-stage':
      return {
        head: [
          'Pipeline',
          'Stage',
          'Probability %',
          'Open deals',
          'Value',
          'Weighted value',
          'Currency',
          'Deals without amount',
          'Deals not converted',
          'Created in period',
        ],
        rows: d.pipelineByStage.map((r) => [
          r.pipeline,
          r.stage,
          r.probability,
          r.count,
          r.value,
          r.weighted,
          cur,
          r.noAmount,
          r.notConverted,
          r.createdInPeriod,
        ]),
      };
    case 'pipeline-by-owner':
      return {
        head: ['Owner', 'Open deals', 'Value', 'Weighted value', 'Currency', 'Deals without amount', 'Deals not converted', 'Created in period'],
        rows: d.pipelineByOwner.map((r) => [r.owner, r.count, r.value, r.weighted, cur, r.noAmount, r.notConverted, r.createdInPeriod]),
      };
    case 'won-lost':
      return {
        head: [
          'From',
          'To',
          'Won deals',
          'Lost deals',
          'Won value',
          'Lost value',
          'Currency',
          'Win rate % (count)',
          'Win rate % (value)',
          'Deals not converted',
        ],
        rows: [
          [
            d.filters.from,
            d.filters.to,
            d.wonLost.won,
            d.wonLost.lost,
            d.wonLost.wonValue,
            d.wonLost.lostValue,
            cur,
            d.wonLost.winRateCount,
            d.wonLost.winRateValue,
            d.wonLost.notConverted,
          ],
        ],
      };
    case 'lost-reasons':
      return {
        head: ['Lost reason', 'Deals', 'Value', 'Currency', '% of lost deals'],
        rows: d.lostReasons.map((r) => [r.reason, r.count, r.value, cur, r.percent]),
      };
    case 'rep-performance':
      return {
        head: [
          'Rep',
          'Open deals',
          'Open value',
          'Won deals',
          'Lost deals',
          'Won revenue',
          'Currency',
          'Win rate %',
          'Average deal size',
          'Average cycle (days)',
        ],
        rows: d.reps.map((r) => [r.name, r.openDeals, r.openValue, r.won, r.lost, r.wonRevenue, cur, r.winRate, r.avgDealSize, r.avgCycleDays]),
      };
    case 'proposal-metrics': {
      const p = d.proposals;
      return {
        head: ['Metric', 'Value', 'Unit'],
        rows: [
          ['Proposals sent', p.sent, 'proposals'],
          ['Versions sent', p.versionsSent, 'versions'],
          ['Proposals viewed', p.viewed, 'proposals'],
          ['View rate', p.viewRate, '%'],
          ['Proposals signed or accepted', p.won, 'proposals'],
          ['Proposal win rate', p.winRate, '%'],
          ['Time to first view (median)', p.medianHoursToFirstView, 'hours'],
          ['Time to first view (average)', p.avgHoursToFirstView, 'hours'],
          ['Time to sign (median)', p.medianDaysToSign, 'days'],
          ['Time to sign (average)', p.avgDaysToSign, 'days'],
          ['Deal creation to first proposal (median)', p.medianDaysDealToFirstProposal, 'days'],
          ['Deal creation to first proposal (average)', p.avgDaysDealToFirstProposal, 'days'],
        ],
      };
    }
    case 'proposals':
      return {
        head: ['Proposal', 'Deal', 'Owner', 'Status', 'First sent', 'First viewed', 'Signed', 'Hours to first view', 'Days to sign'],
        rows: d.proposals.list.map((r) => [r.title, r.dealName, r.owner, r.status, r.firstSentAt, r.firstViewAt, r.signedAt, r.hoursToFirstView, r.daysToSign]),
      };
    case 'activity':
      return {
        head: ['Rep', 'Calls', 'Meetings', 'Notes', 'Tasks completed'],
        rows: d.activity.map((r) => [r.name, r.calls, r.meetings, r.notes, r.tasksCompleted]),
      };
    case 'attention':
      return {
        head: ['Deal', 'Owner', 'Stage', 'Amount', 'Currency', 'Reasons', 'Days since last activity', 'Last proposal status'],
        rows: d.attention.map((r) => [
          r.name,
          r.owner,
          r.stage,
          r.amount,
          r.currency,
          r.reasons.map((x) => REASON_LABEL[x] ?? x).join('; '),
          r.daysSinceActivity,
          r.lastProposalStatus,
        ]),
      };
  }
}

/** Same scope and filters as the screen (it is built from the same overview); every export is audited. */
export async function exportReportCsv(ctx: AppContext, actor: UserActor, section: ReportSection, q: ReportQuery) {
  const data = await reportOverview(ctx, actor, q);
  const { head, rows } = sectionTable(section, data);
  await unitOfWork(ctx, actor, (u) => u.audit('report.exported', null, { section, filters: data.filters, rows: rows.length }));
  return {
    bytes: new TextEncoder().encode(toCsv(head, rows)),
    contentType: 'text/csv; charset=utf-8',
    fileName: `report-${section}-${data.filters.from}-to-${data.filters.to}.csv`,
  };
}
