/**
 * Copilot administration (admin only, permission settings.manage):
 *  - settings: on/off overall and per role, autonomy per auto tool, SLA hours, business calendar, retention, models
 *    per kind, monthly budget, per-user daily turns, focus industries. Stored sparse; the kill switch is `enabled`
 *    (and AI_PROVIDER for the whole AI layer).
 *  - usage: metadata only — never questions, answers or tool payloads.
 */
import type { copilotSettingsInput } from '@crm/shared';
import { and, eq, gte, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { agentAction, agentRun, type CopilotSettings, workAssignment } from '../../db/schema-copilot.ts';
import { type AppContext, requirePerm, schema, type UserActor } from '../../platform/core.ts';
import { monthSpendMicroUsd } from './budget.ts';
import { loadCopilotSettings, modelFor } from './settings.ts';

export async function getCopilotAdmin(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'settings.manage');
  const settings = await loadCopilotSettings(ctx);
  const spent = await monthSpendMicroUsd(ctx);
  return {
    settings,
    provider: ctx.ai.name,
    simulated: ctx.ai.simulated,
    effectiveModels: { main: modelFor(ctx, settings, 'main'), fast: modelFor(ctx, settings, 'fast') },
    budget: {
      monthlyBudgetUsd: settings.monthlyBudgetUsd,
      spentThisMonthUsd: Math.round(spent / 10_000) / 100,
      percentUsed: settings.monthlyBudgetUsd > 0 ? Math.round((spent / (settings.monthlyBudgetUsd * 1_000_000)) * 100) : null,
    },
  };
}

export async function updateCopilotSettings(ctx: AppContext, actor: UserActor, input: z.infer<typeof copilotSettingsInput>) {
  requirePerm(actor, 'settings.manage');
  const [org] = await ctx.db
    .select({ id: schema.organizationSettings.id, copilot: schema.organizationSettings.copilotSettings })
    .from(schema.organizationSettings);
  if (!org) throw new Error('organization settings missing');
  const cur = org.copilot ?? {};
  const next: CopilotSettings = {
    ...cur,
    ...input,
    roles: { ...cur.roles, ...input.roles },
    autonomy: { ...cur.autonomy, ...input.autonomy },
    calendar: { ...cur.calendar, ...input.calendar },
    models: { ...cur.models, ...input.models },
  };
  await ctx.db.update(schema.organizationSettings).set({ copilotSettings: next }).where(eq(schema.organizationSettings.id, org.id));
  await ctx.db.insert(schema.auditLog).values({
    actorType: 'user',
    actorUserId: actor.userId,
    action: 'copilot.settings_updated',
    targetType: 'organization_settings',
    targetId: null,
    changes: input,
  });
  ctx.logger.info({ actorUserId: actor.userId, keys: Object.keys(input) }, 'copilot settings updated');
  return getCopilotAdmin(ctx, actor);
}

const num = (v: unknown) => (v === null || v === undefined ? null : Math.round(Number(v)));

export async function copilotUsage(ctx: AppContext, actor: UserActor, days = 30) {
  requirePerm(actor, 'settings.manage');
  const since = new Date(ctx.now().getTime() - days * 86_400_000);
  const runs = await ctx.db
    .select({ kind: agentRun.kind, role: agentRun.principalRole, status: agentRun.status, n: sql<number>`count(*)::int` })
    .from(agentRun)
    .where(gte(agentRun.startedAt, since))
    .groupBy(agentRun.kind, agentRun.principalRole, agentRun.status)
    .orderBy(agentRun.kind, agentRun.principalRole);
  const [quality] = await ctx.db
    .select({
      runs: sql<number>`count(*)::int`,
      groundingFailures: sql<number>`coalesce(sum(${agentRun.groundingFailures}),0)::int`,
      injectionFlags: sql<number>`coalesce(sum(${agentRun.injectionFlags}),0)::int`,
      taintedRuns: sql<number>`count(*) filter (where ${agentRun.tainted})::int`,
      p50LatencyMs: sql<string | null>`percentile_cont(0.5) within group (order by ${agentRun.latencyMs}) filter (where ${agentRun.kind} = 'chat')`,
      p90LatencyMs: sql<string | null>`percentile_cont(0.9) within group (order by ${agentRun.latencyMs}) filter (where ${agentRun.kind} = 'chat')`,
      p50FirstWordsMs: sql<string | null>`percentile_cont(0.5) within group (order by ${agentRun.firstTokenMs}) filter (where ${agentRun.kind} = 'chat')`,
      p90FirstWordsMs: sql<string | null>`percentile_cont(0.9) within group (order by ${agentRun.firstTokenMs}) filter (where ${agentRun.kind} = 'chat')`,
    })
    .from(agentRun)
    .where(gte(agentRun.startedAt, since));
  const cost = await ctx.db
    .select({
      feature: schema.aiUsage.feature,
      calls: sql<number>`count(*)::int`,
      inputTokens: sql<number>`coalesce(sum(${schema.aiUsage.inputTokens}),0)::int`,
      outputTokens: sql<number>`coalesce(sum(${schema.aiUsage.outputTokens}),0)::int`,
      costUsd: sql<string>`round(coalesce(sum(${schema.aiUsage.costMicroUsd}),0) / 1000000.0, 4)::text`,
    })
    .from(schema.aiUsage)
    .where(gte(schema.aiUsage.occurredAt, since))
    .groupBy(schema.aiUsage.feature)
    .orderBy(schema.aiUsage.feature);
  const [acts] = await ctx.db
    .select({
      auto: sql<number>`count(*) filter (where ${agentAction.tier} = 'auto' and ${agentAction.status} in ('executed','undone'))::int`,
      undone: sql<number>`count(*) filter (where ${agentAction.status} = 'undone')::int`,
      cards: sql<number>`count(*) filter (where ${agentAction.tier} = 'approval')::int`,
      approved: sql<number>`count(*) filter (where ${agentAction.status} = 'approved')::int`,
      rejected: sql<number>`count(*) filter (where ${agentAction.status} = 'rejected')::int`,
      expired: sql<number>`count(*) filter (where ${agentAction.status} = 'expired')::int`,
      failed: sql<number>`count(*) filter (where ${agentAction.status} = 'failed')::int`,
    })
    .from(agentAction)
    .where(gte(agentAction.createdAt, since));
  const decided = (acts?.approved ?? 0) + (acts?.rejected ?? 0);
  const [sla] = await ctx.db
    .select({
      assigned: sql<number>`count(*)::int`,
      accepted: sql<number>`count(${workAssignment.acceptedAt})::int`,
      withinSla: sql<number>`count(*) filter (where ${workAssignment.acceptedWithinSla})::int`,
      escalated: sql<number>`count(*) filter (where ${workAssignment.escalationLevel} > 0)::int`,
      medianBusinessMinutesToAccept: sql<string | null>`percentile_cont(0.5) within group (order by ${workAssignment.businessMinutesToAccept})`,
    })
    .from(workAssignment)
    .where(and(gte(workAssignment.assignedAt, since), sql`${workAssignment.status} <> 'superseded'`));
  return {
    periodDays: days,
    runs,
    quality: {
      runs: quality?.runs ?? 0,
      groundingFailures: quality?.groundingFailures ?? 0,
      injectionFlags: quality?.injectionFlags ?? 0,
      taintedRuns: quality?.taintedRuns ?? 0,
      latencyMs: { p50: num(quality?.p50LatencyMs), p90: num(quality?.p90LatencyMs) },
      firstWordsMs: { p50: num(quality?.p50FirstWordsMs), p90: num(quality?.p90FirstWordsMs) },
    },
    costByFeature: cost,
    actions: {
      ...acts,
      undoRatePercent: acts?.auto ? Math.round((acts.undone / acts.auto) * 100) : null,
      approvalRatePercent: decided ? Math.round(((acts?.approved ?? 0) / decided) * 100) : null,
    },
    sla: {
      assigned: sla?.assigned ?? 0,
      accepted: sla?.accepted ?? 0,
      acceptedWithinSlaPercent: sla?.accepted ? Math.round((sla.withinSla / sla.accepted) * 100) : null,
      escalated: sla?.escalated ?? 0,
      medianBusinessMinutesToAccept: num(sla?.medianBusinessMinutesToAccept),
    },
  };
}
