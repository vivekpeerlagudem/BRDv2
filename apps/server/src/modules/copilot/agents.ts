/**
 * Background agents (job_outbox), each on behalf of a NAMED, ACTIVE user, idempotent by key kind:record:period:
 *  - copilot.triage  on lead.assigned: the model (fast) reads the lead and scores + tags it with a short reason
 *                    (set_lead_score; an approval card instead when the lead text was outside text = tainted).
 *  - copilot.my_day  nightly 02:00 (org time) per active user: up to 10 follow-up tasks for stalled deals and
 *                    proposals viewed but not answered (auto + Undo). Candidates are chosen by code.
 *  - copilot.digest  Mondays, once the Sales Brief is approved, per manager and admin: digest notification, no writes.
 *  - copilot.handoff on deal won: a handoff checklist task and a won-summary note (auto).
 * Every write goes through the same policy engine and action ledger as chat (executeTool), with the background cap
 * of 20 auto writes. A deactivated principal means the job is skipped and logged (agent_run status "skipped").
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { type AgentRunKind, type AgentRunStatus, agentRun } from '../../db/schema-copilot.ts';
import { salesBriefRun } from '../../db/schema-sales-brief.ts';
import { type AppContext, buildUserActor, schema, type UserActor } from '../../platform/core.ts';
import { DomainError } from '../../platform/errors/domain-error.ts';
import type { CopilotFeature } from '../../platform/ports.ts';
import { assertCopilotAllowed } from './budget.ts';
import { homeCard } from './home.ts';
import { suggestLeadFields } from './lead-fields.ts';
import { runAgent } from './loop.ts';
import { executeTool } from './policy.ts';
import { loadCopilotSettings } from './settings.ts';
import { newNonce } from './text.ts';
import { AliasBook, type ToolEnv } from './tools.ts';

export const QUEUES = ['copilot.triage', 'copilot.my_day', 'copilot.digest', 'copilot.handoff'] as const;
type Queue = (typeof QUEUES)[number];
const KIND: Record<Queue, AgentRunKind> = { 'copilot.triage': 'triage', 'copilot.my_day': 'my_day', 'copilot.digest': 'digest', 'copilot.handoff': 'handoff' };
const FEATURE: Record<Queue, CopilotFeature> = {
  'copilot.triage': 'copilot_triage',
  'copilot.my_day': 'copilot_background',
  'copilot.digest': 'copilot_background',
  'copilot.handoff': 'copilot_background',
};
const DAY = 86_400_000;

/** Local date, weekday (1 = Monday) and hour in the organization's time zone. */
function orgClock(now: Date, timeZone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', weekday: 'short' })
      .formatToParts(now)
      .map((x) => [x.type, x.value]),
  );
  const date = `${p.year}-${p.month}-${p.day}`;
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday as string) + 1;
  return { date, weekday, hour: Number(p.hour) };
}
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

/** Queues a job once per key (a key already queued or done is not queued again). */
export async function enqueueOnce(ctx: AppContext, queue: Queue, key: string, payload: Record<string, unknown>): Promise<boolean> {
  const [exists] = await ctx.db
    .select({ id: schema.jobOutbox.id })
    .from(schema.jobOutbox)
    .where(and(eq(schema.jobOutbox.queue, queue), sql`${schema.jobOutbox.payload}->>'key' = ${key}`))
    .limit(1);
  if (exists) return false;
  await ctx.db.insert(schema.jobOutbox).values({ queue, payload: { ...payload, key }, runAfter: ctx.now() });
  return true;
}

/** Scheduled scans: nightly My Day jobs and Monday digests. */
export async function scheduleBackgroundAgents(ctx: AppContext): Promise<{ myDay: number; digest: number }> {
  const settings = await loadCopilotSettings(ctx);
  if (!settings.enabled) return { myDay: 0, digest: 0 };
  const clock = orgClock(ctx.now(), settings.timeZone);
  let myDay = 0;
  let digest = 0;
  const users = await ctx.db
    .select({ id: schema.appUserProfile.userId, role: schema.appUserProfile.role })
    .from(schema.appUserProfile)
    .where(eq(schema.appUserProfile.status, 'active'));
  if (clock.hour >= 2)
    for (const u of users)
      if (settings.roles[u.role] && (await enqueueOnce(ctx, 'copilot.my_day', `my_day:${u.id}:${clock.date}`, { userId: u.id, date: clock.date }))) myDay++;
  if (clock.weekday === 1) {
    const [brief] = await ctx.db
      .select({ id: salesBriefRun.id, approvedAt: salesBriefRun.approvedAt, periodStart: salesBriefRun.periodStart })
      .from(salesBriefRun)
      .where(sql`${salesBriefRun.approvedAt} is not null`)
      .orderBy(sql`${salesBriefRun.approvedAt} desc`)
      .limit(1);
    // Approved this week (since Monday 00:00 org time, give or take the zone offset).
    if (brief?.approvedAt && brief.approvedAt.getTime() >= Date.parse(`${clock.date}T00:00:00Z`) - DAY)
      for (const u of users)
        if (
          u.role !== 'salesperson' &&
          settings.roles[u.role] &&
          (await enqueueOnce(ctx, 'copilot.digest', `digest:${u.id}:${brief.periodStart}`, { userId: u.id, briefId: brief.id }))
        )
          digest++;
  }
  return { myDay, digest };
}

/** Event hooks (job runner): triage once per newly assigned record; handoff once per won deal. */
export async function onCopilotEvent(ctx: AppContext, e: Record<string, unknown>): Promise<void> {
  if (e.name === 'lead.assigned') {
    const [recordType, recordId] = typeof e.leadId === 'string' ? ['lead', e.leadId] : ['deal', e.dealId as string];
    if (recordId) await enqueueOnce(ctx, 'copilot.triage', `triage:${recordType}:${recordId}`, { recordType, recordId, userId: e.userId });
  }
  if (e.name === 'deal.closed_won' && typeof e.dealId === 'string') await enqueueOnce(ctx, 'copilot.handoff', `handoff:deal:${e.dealId}`, { dealId: e.dealId });
}

async function recordRun(
  ctx: AppContext,
  r: {
    kind: AgentRunKind;
    trigger: string;
    actorId: string;
    role: UserActor['role'] | null;
    status: AgentRunStatus;
    key: string;
    env?: ToolEnv;
    errorCode?: string | null;
    startedAt: Date;
  },
) {
  await ctx.db
    .insert(agentRun)
    .values({
      id: r.env?.turn.runId ?? crypto.randomUUID(),
      kind: r.kind,
      trigger: r.trigger,
      principalUserId: r.actorId,
      principalRole: r.role ?? 'salesperson',
      status: r.status,
      toolCalls: r.env?.turn.toolCalls ?? 0,
      autoWrites: r.env?.turn.autoWrites ?? 0,
      proposals: r.env?.turn.proposals ?? 0,
      provider: ctx.ai.name,
      model: 'rules',
      simulated: ctx.ai.simulated,
      tainted: r.env?.turn.tainted ?? false,
      errorCode: r.errorCode ?? null,
      idempotencyKey: r.key,
      startedAt: r.startedAt,
      latencyMs: Math.max(0, ctx.now().getTime() - r.startedAt.getTime()),
    })
    .onConflictDoNothing();
  ctx.logger.info({ kind: r.kind, key: r.key, status: r.status, errorCode: r.errorCode ?? null }, 'copilot background run');
}

async function backgroundEnv(ctx: AppContext, actor: UserActor, kind: AgentRunKind, key: string): Promise<ToolEnv> {
  return {
    ctx,
    actor,
    settings: await loadCopilotSettings(ctx),
    turn: {
      runId: crypto.randomUUID(),
      kind: kind as ToolEnv['turn']['kind'],
      conversationId: null,
      nonce: newNonce(),
      aliases: new AliasBook(),
      tainted: false,
      injectionFlags: 0,
      hiddenTextRemoved: 0,
      toolCalls: 0,
      autoWrites: 0,
      proposals: 0,
      requestId: null,
      idempotencyPrefix: key,
    },
  };
}

/** Job handler for the copilot.* queues. */
export async function runBackgroundJob(ctx: AppContext, queue: Queue, payload: Record<string, unknown>): Promise<void> {
  const key = payload.key as string;
  const kind = KIND[queue];
  const startedAt = ctx.now();
  const [already] = await ctx.db.select({ id: agentRun.id }).from(agentRun).where(eq(agentRun.idempotencyKey, key));
  if (already) return;

  // The principal: the named user (triage, My Day, digest) or the deal's current owner (handoff).
  let principalId = payload.userId as string | undefined;
  if (queue === 'copilot.handoff') {
    const [d] = await ctx.db
      .select({ ownerId: schema.deal.ownerId })
      .from(schema.deal)
      .where(eq(schema.deal.id, payload.dealId as string));
    principalId = d?.ownerId;
  }
  if (!principalId) return;
  const actor = await buildUserActor(ctx.db, principalId);
  if (!actor)
    return recordRun(ctx, { kind, trigger: queue, actorId: principalId, role: null, status: 'skipped', key, errorCode: 'PRINCIPAL_INACTIVE', startedAt });
  const settings = await loadCopilotSettings(ctx);
  try {
    await assertCopilotAllowed(ctx, actor, settings, FEATURE[queue]);
  } catch (error) {
    if (error instanceof DomainError)
      return recordRun(ctx, { kind, trigger: queue, actorId: actor.userId, role: actor.role, status: 'blocked', key, errorCode: error.code, startedAt });
    throw error;
  }

  if (queue === 'copilot.triage') {
    // The model reads the record and scores it; the loop writes its own agent_run (with this key).
    const recordType = payload.recordType as 'lead' | 'deal';
    await runAgent(ctx, {
      actor,
      kind: 'triage',
      trigger: 'lead.assigned',
      model: 'fast',
      tools: ['get_record', 'set_lead_score'],
      open: { type: recordType, id: payload.recordId as string },
      question: 'Triage this newly assigned lead: read it, then score it with set_lead_score, choosing tags from the list and writing a one-line reason.',
      idempotencyKey: key,
    });
    // Missing qualification fields: a quarantined, tool-less step suggests them from the lead's own text, as an
    // approval card the salesperson confirms (then the record is rescored by the rules). Never blocks the triage.
    try {
      await suggestLeadFields(await backgroundEnv(ctx, actor, kind, `${key}:fields`), { type: recordType, id: payload.recordId as string });
    } catch (error) {
      ctx.logger.warn({ key, code: error instanceof DomainError ? error.code : 'failed' }, 'lead field suggestion skipped');
    }
    return;
  }

  const env = await backgroundEnv(ctx, actor, kind, key);
  const run = (name: string, input: Record<string, unknown>) => executeTool(env, { id: crypto.randomUUID(), name, input });
  if (queue === 'copilot.my_day') await myDayFollowUps(env, run);
  if (queue === 'copilot.handoff') await handoff(env, run, payload.dealId as string);
  if (queue === 'copilot.digest') await digest(env);
  await recordRun(ctx, { kind, trigger: queue, actorId: actor.userId, role: actor.role, status: 'completed', key, env, startedAt });
}

type Run = (name: string, input: Record<string, unknown>) => ReturnType<typeof executeTool>;

/** Up to 10 follow-up tasks: stalled deals and viewed-but-unanswered proposals without an open future task. */
async function myDayFollowUps(env: ToolEnv, run: Run) {
  const { ctx, actor } = env;
  const today = orgClock(ctx.now(), env.settings.timeZone).date;
  const stalled = await ctx.db
    .selectDistinct({ id: schema.deal.id, name: schema.deal.name, last: schema.deal.lastActivityAt })
    .from(schema.deal)
    .innerJoin(schema.dealFlag, and(eq(schema.dealFlag.dealId, schema.deal.id), eq(schema.dealFlag.kind, 'stalled'), isNull(schema.dealFlag.clearedAt)))
    .where(and(eq(schema.deal.ownerId, actor.userId), eq(schema.deal.status, 'open'), isNull(schema.deal.archivedAt)));
  const viewed = await ctx.db
    .selectDistinct({ id: schema.deal.id, name: schema.deal.name })
    .from(schema.proposal)
    .innerJoin(schema.deal, eq(schema.deal.id, schema.proposal.dealId))
    .where(and(eq(schema.deal.ownerId, actor.userId), eq(schema.deal.status, 'open'), eq(schema.proposal.status, 'viewed')));
  const ids = [...new Set([...stalled, ...viewed].map((d) => d.id))];
  const busy = ids.length
    ? new Set(
        (
          await ctx.db
            .select({ id: schema.task.relatedId })
            .from(schema.task)
            .where(
              and(
                eq(schema.task.relatedType, 'deal'),
                inArray(schema.task.relatedId, ids),
                eq(schema.task.status, 'open'),
                sql`${schema.task.dueAt} >= ${ctx.now()}`,
              ),
            )
        ).map((t) => t.id),
      )
    : new Set<string>();
  const plan: { id: string; name: string; title: string }[] = [];
  for (const d of viewed) if (!busy.has(d.id)) plan.push({ ...d, title: `Follow up: the proposal for ${d.name} was viewed but not answered` });
  for (const d of stalled)
    if (!busy.has(d.id) && !plan.some((p) => p.id === d.id)) {
      const days = d.last ? Math.floor((ctx.now().getTime() - d.last.getTime()) / DAY) : null;
      plan.push({ ...d, title: `Follow up on ${d.name}${days !== null ? `: no activity for ${days} days` : ': stalled'}` });
    }
  for (const p of plan.slice(0, 10))
    await run('create_task', { related: env.turn.aliases.alias('deal', p.id, p.name), title: p.title.slice(0, 120), due: addDays(today, 1) });
}

async function handoff(env: ToolEnv, run: Run, dealId: string) {
  const { ctx } = env;
  const [d] = await ctx.db.select().from(schema.deal).where(eq(schema.deal.id, dealId));
  if (d?.status !== 'won') return;
  const alias = env.turn.aliases.alias('deal', d.id, d.name);
  const today = orgClock(ctx.now(), env.settings.timeZone).date;
  const contacts = await ctx.db
    .select({ first: schema.contact.firstName, last: schema.contact.lastName, primary: schema.dealContact.isPrimary })
    .from(schema.dealContact)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.dealContact.contactId))
    .where(eq(schema.dealContact.dealId, d.id));
  const days = Math.max(0, Math.round(((d.closedAt ?? ctx.now()).getTime() - d.createdAt.getTime()) / DAY));
  await run('create_task', {
    related: alias,
    title: `Handoff checklist for ${d.name}: kickoff call, scope, contacts, invoicing`.slice(0, 120),
    due: addDays(today, 2),
  });
  const people = contacts.map((c) => `${[c.first, c.last].filter(Boolean).join(' ')}${c.primary ? ' (primary)' : ''}`).join(', ') || 'none recorded';
  await run('add_ai_note', {
    related: alias,
    text: `Won summary: ${d.name} closed won on ${d.closeDate ?? today} for ${d.currency} ${d.amount ?? 'no amount'} after ${days} days. Contacts: ${people}. Next: run the handoff checklist.`,
  });
}

async function digest(env: ToolEnv) {
  const { ctx, actor } = env;
  const card = await homeCard(ctx, actor, { summary: false });
  const line =
    card.kind === 'company'
      ? `Pipeline ${card.pipeline.openValue} in ${card.pipeline.openDeals} open deals; ${card.wonThisWeek.deals} won this week; ${card.throughput30Days.leads} leads → ${card.throughput30Days.opportunities} opportunities → ${card.throughput30Days.won} won in 30 days.`
      : card.kind === 'my_team'
        ? `${card.counts.pending} leads waiting, ${card.counts.escalated} escalated, ${card.counts.stalledDeals} stalled deals; weighted forecast ${card.forecast.weightedNow} (a week ago ${card.forecast.weightedLastWeek}).`
        : 'Your week is ready.';
  await ctx.db
    .insert(schema.notification)
    .values({
      recipientUserId: actor.userId,
      eventType: 'copilot_digest',
      title: 'Your weekly Copilot digest',
      body: line,
      linkPath: '/',
      dedupeKey: `copilot_digest:${env.turn.idempotencyPrefix}`,
      emailStatus: 'not_sent',
    })
    .onConflictDoNothing();
}
