/**
 * Copilot gate and budgets. Checked before a run starts and again before EVERY model call:
 *   switched on for the organization and the role → per-user turns per minute and per day → organization monthly AI
 *   budget (all AI features together, USD). Reaching 80 % of the monthly budget notifies the admins once per month.
 * A refusal here never touches CRM data: the rest of the CRM keeps working without AI.
 */
import { and, eq, gte, sql } from 'drizzle-orm';
import { agentRun, type CopilotSettings } from '../../db/schema-copilot.ts';
import { type AppContext, schema, type UserActor } from '../../platform/core.ts';
import { DomainError } from '../../platform/errors/domain-error.ts';
import type { CopilotFeature } from '../../platform/ports.ts';
import { estimateCostMicroUsd } from '../ai/engine.ts';
import type { ResolvedCopilotSettings } from './settings.ts';

const { aiUsage, appUserProfile, notification, organizationSettings } = schema;
export interface Tokens {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
}

/** Estimated cost in millionths of a dollar: the built-in price table, then AI_PRICES (JSON env). Unknown model → null. */
export function costMicroUsd(ctx: AppContext, model: string, t: Tokens): number | null {
  const builtIn = estimateCostMicroUsd(model, t);
  if (builtIn !== null) return builtIn;
  if (!ctx.config.AI_PRICES) return ctx.ai.simulated ? 0 : null;
  try {
    const table = JSON.parse(ctx.config.AI_PRICES) as Record<string, { input: number; output: number; cacheRead?: number }>;
    const p = table[model];
    if (!p) return null;
    return Math.round(t.inputTokens * p.input + t.outputTokens * p.output + t.cacheReadTokens * (p.cacheRead ?? p.input * 0.1));
  } catch {
    return null;
  }
}

export const monthStart = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
/** Organization AI spend this month in micro-dollars, all features (existing AI features and the Copilot). */
export async function monthSpendMicroUsd(ctx: AppContext): Promise<number> {
  const [row] = await ctx.db
    .select({ cost: sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)::bigint` })
    .from(aiUsage)
    .where(gte(aiUsage.occurredAt, monthStart(ctx.now())));
  return Number(row?.cost ?? 0);
}

const quota = (title: string, scope: 'user' | 'organization') => new DomainError('AI_QUOTA_EXCEEDED', 429, title, { meta: { scope } });

/** Throws when the organization's monthly AI budget is used up. Called before every model call. */
export async function assertBudget(ctx: AppContext, settings: ResolvedCopilotSettings): Promise<void> {
  if (settings.monthlyBudgetUsd <= 0) return; // 0 = no cap
  const spent = await monthSpendMicroUsd(ctx);
  const cap = settings.monthlyBudgetUsd * 1_000_000;
  if (spent >= cap)
    throw quota("Your organization has reached this month's AI budget. The Copilot is paused; the rest of the CRM works as usual.", 'organization');
  if (spent >= cap * 0.8) await alertBudgetOnce(ctx, settings, Math.floor((spent / cap) * 100));
}

/** One in-app notification per month to every active admin when 80 % of the budget is used. */
async function alertBudgetOnce(ctx: AppContext, settings: ResolvedCopilotSettings, percent: number): Promise<void> {
  const month = ctx.now().toISOString().slice(0, 7);
  if (settings.budgetAlertMonth === month) return;
  settings.budgetAlertMonth = month;
  const [org] = await ctx.db.select({ id: organizationSettings.id, copilot: organizationSettings.copilotSettings }).from(organizationSettings);
  if (!org || org.copilot.budgetAlertMonth === month) return;
  await ctx.db
    .update(organizationSettings)
    .set({ copilotSettings: { ...org.copilot, budgetAlertMonth: month } satisfies CopilotSettings })
    .where(eq(organizationSettings.id, org.id));
  const admins = await ctx.db
    .select({ id: appUserProfile.userId })
    .from(appUserProfile)
    .where(and(eq(appUserProfile.role, 'admin'), eq(appUserProfile.status, 'active')));
  if (!admins.length) return;
  await ctx.db
    .insert(notification)
    .values(
      admins.map((a) => ({
        recipientUserId: a.id,
        eventType: 'copilot.budget_alert',
        title: `AI budget: ${percent}% used this month`,
        body: `The organization has used ${percent}% of its monthly AI budget of USD ${settings.monthlyBudgetUsd}. At 100% the Copilot pauses until next month.`,
        linkPath: '/admin/copilot',
        dedupeKey: `copilot.budget:${month}:${a.id}`,
        emailStatus: 'not_sent',
      })),
    )
    .onConflictDoNothing();
}

/** Gate for starting a run on behalf of `actor`. Chat turns are also rate limited per user. */
export async function assertCopilotAllowed(ctx: AppContext, actor: UserActor, settings: ResolvedCopilotSettings, feature: CopilotFeature): Promise<void> {
  if (!settings.enabled || !settings.roles[actor.role])
    throw new DomainError('AI_DISABLED', 403, settings.enabled ? 'The Copilot is turned off for your role' : 'The Copilot is turned off for your organization');
  if (feature === 'copilot_chat') {
    const now = ctx.now();
    const turnsSince = async (since: Date) => {
      const [row] = await ctx.db
        .select({ n: sql<number>`count(*)::int` })
        .from(agentRun)
        .where(and(eq(agentRun.principalUserId, actor.userId), eq(agentRun.kind, 'chat'), gte(agentRun.startedAt, since)));
      return row?.n ?? 0;
    };
    if ((await turnsSince(new Date(now.getTime() - 60_000))) >= ctx.config.AI_RATE_PER_MINUTE)
      throw new DomainError('AI_RATE_LIMITED', 429, 'Too many questions in a short time. Please wait a minute.', {
        meta: { scope: 'user', retryAfterSeconds: 60 },
      });
    if ((await turnsSince(new Date(now.toISOString().slice(0, 10)))) >= settings.perUserDailyTurns)
      throw quota("You have reached today's Copilot limit", 'user');
  }
  await assertBudget(ctx, settings);
}
