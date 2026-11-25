/**
 * Collector of the Weekly Sales Brief: reads the whole company's sales data for the reported week and three
 * comparison windows (the week before, month to date, quarter to date), as an Admin.
 *
 * Everything the Reports page already computes is taken from `reportOverview` with the admin actor, so the brief
 * shows the same numbers as the Reports page for the same dates. Only what that page lacks is queried here:
 * leads, opportunities created, forward stage moves, the won and lost deals of the week, lead sources and how long
 * each deal needing attention has been in its stage.
 */
import { and, eq, isNull, type SQL, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { AppContext, UserActor } from '../../platform/core.ts';
import { schema } from '../../platform/core.ts';
import { type ReportOverview, reportOverview } from '../reporting.ts';

const { deal, lead, organizationSettings, appUserProfile } = schema;
const DAY = 86_400_000;
const shift = (day: string, by: number) => new Date(Date.parse(`${day}T00:00:00Z`) + by * DAY).toISOString().slice(0, 10);

export interface SalesWindow {
  from: string;
  to: string;
  leadsCreated: number;
  leadsQualified: number;
  leadsConverted: number;
  leadsDisqualified: number;
  dealsCreated: number;
  dealsAdvanced: number;
  won: number;
  lost: number;
  wonValue: string;
  winRate: number | null;
  proposalsSent: number;
  proposalsViewed: number;
  proposalsSigned: number;
  calls: number;
  meetings: number;
  tasksCompleted: number;
}
export interface SalesSnapshot {
  schema: 1;
  runId: string;
  /** When the data was read. Pipeline and attention figures are "as of" this moment. */
  cutoff: string;
  orgName: string;
  currency: string;
  timeZone: string;
  followUpAfterDays: number;
  period: { start: string; end: string };
  week: SalesWindow;
  lastWeek: SalesWindow;
  mtd: SalesWindow;
  qtd: SalesWindow;
  pipelineByStage: { stage: string; count: number; value: string; weighted: string }[];
  pipelineTotals: { count: number; value: string; weighted: string };
  pipelineByOwner: { ownerId: string; owner: string; count: number; value: string }[];
  openDeals: {
    dealId: string;
    name: string;
    ownerId: string;
    owner: string;
    stage: string;
    amount: string | null;
    daysInStage: number | null;
    stallThresholdDays: number | null;
  }[];
  reps: ReportOverview['reps'];
  activity: ReportOverview['activity'];
  lostReasons: { reason: string; count: number }[];
  wonDeals: { dealId: string; name: string; owner: string; ownerId: string; amount: string | null; cycleDays: number | null }[];
  lostDeals: { dealId: string; name: string; owner: string; ownerId: string; amount: string | null; reason: string }[];
  /** Won deals of the quarter to date, for average size and cycle length (sales velocity). */
  qtdWon: { amount: string | null; cycleDays: number | null }[];
  attention: {
    dealId: string;
    name: string;
    owner: string;
    ownerId: string;
    stage: string;
    amount: string | null;
    reasons: string[];
    daysInStage: number | null;
    stallThresholdDays: number | null;
    daysSinceActivity: number;
  }[];
  /** Deals with an open "past expected close date" flag raised before the reported week started (for slippage). */
  pastCloseBeforeWeek: number;
  leadSources: { source: string; created: number; converted: number }[];
  users: { userId: string; name: string }[];
}

/** First day of the month and of the quarter that contain `day`. */
export function monthAndQuarterStart(day: string): { month: string; quarter: string } {
  const [y, m] = day.split('-').map(Number) as [number, number, number];
  const pad = (n: number) => String(n).padStart(2, '0');
  return { month: `${y}-${pad(m)}-01`, quarter: `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01` };
}

export async function collectSalesBrief(
  ctx: AppContext,
  admin: UserActor,
  run: { id: string; periodStart: string; periodEnd: string },
): Promise<SalesSnapshot> {
  const [org] = await ctx.db
    .select({ name: organizationSettings.organizationName, timeZone: organizationSettings.timeZone, automation: organizationSettings.automationSettings })
    .from(organizationSettings);
  const tz = org?.timeZone ?? 'UTC';
  const inRange = (column: SQL | PgColumn, from: string, to: string) =>
    sql`(${column} >= (${from}::date::timestamp at time zone ${tz}) and ${column} < ((${to}::date + 1)::timestamp at time zone ${tz}))`;
  const count = async (query: SQL) => Number(((await ctx.db.execute(query)).rows[0] as { n?: unknown } | undefined)?.n ?? 0);

  async function window(from: string, to: string): Promise<{ win: SalesWindow; overview: ReportOverview }> {
    const overview = await reportOverview(ctx, admin, { from, to });
    const auditCount = (action: string) =>
      count(sql`select count(distinct target_id)::int as n from audit_log where action = ${action} and ${inRange(sql`occurred_at`, from, to)}`);
    const win: SalesWindow = {
      from,
      to,
      leadsCreated: await count(sql`select count(*)::int as n from lead where archived_at is null and ${inRange(sql`created_at`, from, to)}`),
      leadsQualified: await auditCount('lead.qualified'),
      leadsConverted: await count(sql`select count(*)::int as n from lead where converted_at is not null and ${inRange(sql`converted_at`, from, to)}`),
      leadsDisqualified: await auditCount('lead.disqualified'),
      dealsCreated: await count(sql`select count(*)::int as n from deal where archived_at is null and ${inRange(sql`created_at`, from, to)}`),
      dealsAdvanced: await count(sql`
        select count(distinct h.deal_id)::int as n
        from deal_stage_history h
        join pipeline_stage f on f.id = h.from_stage_id
        join pipeline_stage t on t.id = h.to_stage_id
        join deal d on d.id = h.deal_id and d.archived_at is null
        where t.sort_order > f.sort_order and t.kind = 'open' and ${inRange(sql`h.changed_at`, from, to)}`),
      won: overview.wonLost.won,
      lost: overview.wonLost.lost,
      wonValue: overview.wonLost.wonValue,
      winRate: overview.wonLost.winRateCount,
      proposalsSent: overview.proposals.sent,
      proposalsViewed: overview.proposals.viewed,
      proposalsSigned: overview.proposals.won,
      calls: overview.activity.reduce((n, a) => n + a.calls, 0),
      meetings: overview.activity.reduce((n, a) => n + a.meetings, 0),
      tasksCompleted: overview.activity.reduce((n, a) => n + a.tasksCompleted, 0),
    };
    return { win, overview };
  }

  const { periodStart: start, periodEnd: end } = run;
  const starts = monthAndQuarterStart(end);
  const week = await window(start, end);
  const lastWeek = await window(shift(start, -7), shift(end, -7));
  const mtd = await window(starts.month, end);
  const qtd = await window(starts.quarter, end);
  const o = week.overview;
  const currency = o.currency;

  const closed = async (status: 'won' | 'lost', from: string, to: string) =>
    (
      await ctx.db.execute(sql`
        select d.id, d.name, d.owner_id, u.full_name as owner, case when d.currency = ${currency} then d.amount::text end as amount,
          ((d.closed_at at time zone ${tz})::date - (d.created_at at time zone ${tz})::date)::int as cycle_days,
          coalesce(r.name, 'No reason recorded') as reason
        from deal d
        join app_user_profile u on u.user_id = d.owner_id
        left join lost_reason r on r.id = d.lost_reason_id
        where d.status = ${status} and d.archived_at is null and ${inRange(sql`d.closed_at`, from, to)}
        order by d.amount desc nulls last, d.name`)
    ).rows as Record<string, unknown>[];
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const wonRows = await closed('won', start, end);
  const lostRows = await closed('lost', start, end);
  const qtdWonRows = await closed('won', starts.quarter, end);

  const stageAges = new Map(
    (
      (
        await ctx.db.execute(sql`
          select d.id, d.owner_id, st.stall_threshold_days,
            floor(extract(epoch from (${ctx.now().toISOString()}::timestamptz - coalesce(d.stage_entered_at, d.created_at))) / 86400)::int as days_in_stage
          from deal d join pipeline_stage st on st.id = d.stage_id
          where d.status = 'open' and d.archived_at is null`)
      ).rows as Record<string, unknown>[]
    ).map((r) => [String(r.id), r]),
  );
  const openRows = await ctx.db
    .select({
      dealId: deal.id,
      name: deal.name,
      ownerId: deal.ownerId,
      owner: appUserProfile.fullName,
      stage: schema.pipelineStage.name,
      amount: sql<string | null>`case when ${deal.currency} = ${currency} then ${deal.amount}::text end`,
    })
    .from(deal)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, deal.ownerId))
    .innerJoin(schema.pipelineStage, eq(schema.pipelineStage.id, deal.stageId))
    .where(and(eq(deal.status, 'open'), isNull(deal.archivedAt)))
    .orderBy(sql`${deal.amount} desc nulls last`, deal.name);
  const ageOf = (dealId: string) => {
    const age = stageAges.get(dealId);
    return {
      daysInStage: age ? Number(age.days_in_stage) : null,
      stallThresholdDays: age === undefined || age.stall_threshold_days === null ? null : Number(age.stall_threshold_days),
    };
  };
  const openDeals = openRows.map((d) => ({ ...d, ...ageOf(d.dealId) }));

  const sources = (
    await ctx.db
      .select({
        source: lead.source,
        created: sql<number>`count(*) filter (where ${inRange(lead.createdAt, start, end)})::int`,
        converted: sql<number>`count(*) filter (where ${lead.convertedAt} is not null and ${inRange(sql`${lead.convertedAt}`, start, end)})::int`,
      })
      .from(lead)
      .groupBy(lead.source)
  ).filter((s) => s.created > 0 || s.converted > 0);

  const users = await ctx.db
    .select({ userId: appUserProfile.userId, name: appUserProfile.fullName })
    .from(appUserProfile)
    .where(eq(appUserProfile.status, 'active'));

  return {
    schema: 1,
    runId: run.id,
    cutoff: ctx.now().toISOString(),
    orgName: org?.name ?? '',
    currency,
    timeZone: tz,
    followUpAfterDays: org?.automation.followUpAfterDays ?? 0,
    period: { start, end },
    week: week.win,
    lastWeek: lastWeek.win,
    mtd: mtd.win,
    qtd: qtd.win,
    pipelineByStage: o.pipelineByStage.map((s) => ({ stage: s.stage, count: s.count, value: s.value, weighted: s.weighted })),
    pipelineTotals: { count: o.pipelineTotals.count, value: o.pipelineTotals.value, weighted: o.pipelineTotals.weighted },
    pipelineByOwner: o.pipelineByOwner.map((p) => ({ ownerId: p.ownerId, owner: p.owner, count: p.count, value: p.value })),
    openDeals,
    reps: o.reps,
    activity: o.activity,
    lostReasons: o.lostReasons.map((r) => ({ reason: r.reason, count: r.count })),
    wonDeals: wonRows.map((r) => ({
      dealId: String(r.id),
      name: String(r.name),
      owner: String(r.owner),
      ownerId: String(r.owner_id),
      amount: text(r.amount),
      cycleDays: r.cycle_days === null ? null : Number(r.cycle_days),
    })),
    lostDeals: lostRows.map((r) => ({
      dealId: String(r.id),
      name: String(r.name),
      owner: String(r.owner),
      ownerId: String(r.owner_id),
      amount: text(r.amount),
      reason: String(r.reason),
    })),
    qtdWon: qtdWonRows.map((r) => ({ amount: text(r.amount), cycleDays: r.cycle_days === null ? null : Number(r.cycle_days) })),
    attention: o.attention.map((a) => {
      const age = stageAges.get(a.dealId);
      return {
        dealId: a.dealId,
        name: a.name,
        owner: a.owner,
        ownerId: String(age?.owner_id ?? ''),
        stage: a.stage,
        amount: a.currency === currency ? a.amount : null,
        reasons: a.reasons,
        ...ageOf(a.dealId),
        daysSinceActivity: a.daysSinceActivity,
      };
    }),
    pastCloseBeforeWeek: await count(sql`
      select count(*)::int as n from deal_flag f join deal d on d.id = f.deal_id
      where f.kind = 'past_close_date' and d.archived_at is null
        and f.raised_at < (${start}::date::timestamp at time zone ${tz})
        and (f.cleared_at is null or f.cleared_at >= (${start}::date::timestamp at time zone ${tz}))`),
    leadSources: sources,
    users,
  };
}
