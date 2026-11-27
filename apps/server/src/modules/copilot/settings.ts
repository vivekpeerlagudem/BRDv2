/**
 * Copilot admin settings: stored sparse in organization_settings.copilot_settings and filled with defaults here.
 * The Copilot is ON by default for every role; an admin can switch it off overall, per role, or per auto tool.
 */
import type { CopilotRole, CopilotSettings } from '../../db/schema-copilot.ts';
import { type AppContext, schema } from '../../platform/core.ts';

export interface ResolvedCopilotSettings {
  enabled: boolean;
  roles: Record<CopilotRole, boolean>;
  autonomy: Record<'create_task' | 'add_ai_note' | 'set_lead_score', boolean>;
  acceptSlaHours: number;
  escalationSlaHours: number;
  calendar: { workdays: number[]; start: string; end: string; holidays: string[] };
  retentionDays: number;
  models: { main: string | null; fast: string | null };
  monthlyBudgetUsd: number;
  perUserDailyTurns: number;
  budgetAlertMonth: string | null;
}

export function resolveCopilotSettings(raw: CopilotSettings | null | undefined): ResolvedCopilotSettings {
  const r = raw ?? {};
  return {
    enabled: r.enabled ?? true,
    roles: { admin: r.roles?.admin ?? true, sales_manager: r.roles?.sales_manager ?? true, salesperson: r.roles?.salesperson ?? true },
    autonomy: {
      create_task: r.autonomy?.create_task ?? true,
      add_ai_note: r.autonomy?.add_ai_note ?? true,
      set_lead_score: r.autonomy?.set_lead_score ?? true,
    },
    acceptSlaHours: r.acceptSlaHours ?? 4,
    escalationSlaHours: r.escalationSlaHours ?? 4,
    calendar: {
      workdays: r.calendar?.workdays ?? [1, 2, 3, 4, 5],
      start: r.calendar?.start ?? '09:00',
      end: r.calendar?.end ?? '18:00',
      holidays: r.calendar?.holidays ?? [],
    },
    retentionDays: r.retentionDays ?? 30,
    models: { main: r.models?.main ?? null, fast: r.models?.fast ?? null },
    monthlyBudgetUsd: r.monthlyBudgetUsd ?? 250,
    perUserDailyTurns: r.perUserDailyTurns ?? 200,
    budgetAlertMonth: r.budgetAlertMonth ?? null,
  };
}

export async function loadCopilotSettings(
  ctx: AppContext,
): Promise<ResolvedCopilotSettings & { timeZone: string; organizationName: string; currency: string }> {
  const [row] = await ctx.db
    .select({
      copilot: schema.organizationSettings.copilotSettings,
      timeZone: schema.organizationSettings.timeZone,
      organizationName: schema.organizationSettings.organizationName,
      currency: schema.organizationSettings.defaultCurrency,
    })
    .from(schema.organizationSettings);
  return {
    ...resolveCopilotSettings(row?.copilot),
    timeZone: row?.timeZone ?? 'UTC',
    organizationName: row?.organizationName ?? 'the company',
    currency: row?.currency ?? 'USD',
  };
}

/** Model for a kind of work: the admin setting, then the environment, then a sensible default for the provider. */
export function modelFor(ctx: AppContext, settings: ResolvedCopilotSettings, kind: 'main' | 'fast' | 'judge'): string {
  const provider = ctx.ai.name;
  if (provider === 'fake') return 'mock-deterministic-1';
  const fromEnv = kind === 'main' ? ctx.config.AI_MODEL_MAIN : kind === 'fast' ? ctx.config.AI_MODEL_FAST : ctx.config.AI_MODEL_JUDGE;
  const fromSettings = kind === 'judge' ? null : settings.models[kind];
  const fallback =
    provider === 'anthropic' ? (kind === 'main' ? 'claude-sonnet-5-5' : kind === 'fast' ? 'claude-haiku-5-5' : 'claude-opus-5-5') : ctx.config.AI_MODEL_MAIN;
  return fromSettings || fromEnv || fallback || 'unknown-model';
}
