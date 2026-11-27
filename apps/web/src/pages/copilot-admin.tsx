/**
 * Admin > Copilot: settings (kill switch, roles, autonomy per auto tool, SLA hours, business calendar, retention,
 * models, budget) and usage (counts, costs, rates, latency, SLA KPIs — never chat content).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { get, patch } from '../lib/api.ts';
import { Button, Card, Field, Input, PageHeader, Query, Table, useAction } from '../lib/ui.tsx';

interface Settings {
  enabled: boolean;
  roles: Record<'admin' | 'sales_manager' | 'salesperson', boolean>;
  autonomy: Record<'create_task' | 'add_ai_note' | 'set_lead_score', boolean>;
  acceptSlaHours: number;
  escalationSlaHours: number;
  calendar: { workdays: number[]; start: string; end: string; holidays: string[] };
  retentionDays: number;
  models: { main: string | null; fast: string | null };
  monthlyBudgetUsd: number;
  perUserDailyTurns: number;
}
interface Admin {
  settings: Settings;
  provider: string;
  simulated: boolean;
  effectiveModels: { main: string; fast: string };
  budget: { monthlyBudgetUsd: number; spentThisMonthUsd: number; percentUsed: number | null };
}
interface Usage {
  periodDays: number;
  runs: { kind: string; role: string; status: string; n: number }[];
  quality: {
    runs: number;
    groundingFailures: number;
    injectionFlags: number;
    taintedRuns: number;
    latencyMs: { p50: number | null; p90: number | null };
    firstWordsMs: { p50: number | null; p90: number | null };
  };
  costByFeature: { feature: string; calls: number; inputTokens: number; outputTokens: number; costUsd: string }[];
  actions: {
    auto: number;
    undone: number;
    cards: number;
    approved: number;
    rejected: number;
    expired: number;
    undoRatePercent: number | null;
    approvalRatePercent: number | null;
  };
  sla: { assigned: number; accepted: number; acceptedWithinSlaPercent: number | null; escalated: number; medianBusinessMinutesToAccept: number | null };
}

const ROLE_LABEL = { admin: 'Admins', sales_manager: 'Sales managers', salesperson: 'Salespeople' } as const;
const TOOL_LABEL = { create_task: 'Create follow-up tasks', add_ai_note: 'Add AI-generated notes', set_lead_score: 'Score leads' } as const;
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const cell = 'px-3 py-2 text-sm';

function SettingsForm({ a }: { a: Admin }) {
  const qc = useQueryClient();
  const [s, setS] = useState<Settings>(a.settings);
  const [holidays, setHolidays] = useState(a.settings.calendar.holidays.join(', '));
  const save = useAction((body: unknown) => patch('/admin/copilot/settings', body), {
    success: 'Copilot settings saved',
    onDone: () => void qc.invalidateQueries({ queryKey: ['copilot-admin'] }),
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.run({
      enabled: s.enabled,
      roles: s.roles,
      autonomy: s.autonomy,
      acceptSlaHours: s.acceptSlaHours,
      escalationSlaHours: s.escalationSlaHours,
      calendar: { ...s.calendar, holidays: holidays.split(/[,\s]+/).filter(Boolean) },
      retentionDays: s.retentionDays,
      models: { main: s.models.main || null, fast: s.models.fast || null },
      monthlyBudgetUsd: s.monthlyBudgetUsd,
      perUserDailyTurns: s.perUserDailyTurns,
    });
  };
  const check = (label: string, value: boolean, set: (v: boolean) => void) => (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );
  const n = (v: string) => (v === '' ? 0 : Number(v));
  return (
    <form onSubmit={submit} className="grid gap-4 lg:grid-cols-2">
      <Card title="Switches">
        <div className="space-y-2">
          {check('Copilot on for the organization (kill switch)', s.enabled, (v) => setS({ ...s, enabled: v }))}
          {(Object.keys(ROLE_LABEL) as (keyof typeof ROLE_LABEL)[]).map((r) =>
            check(`On for ${ROLE_LABEL[r]}`, s.roles[r], (v) => setS({ ...s, roles: { ...s.roles, [r]: v } })),
          )}
          <p className="pt-2 text-xs text-muted">Automatic changes (with Undo). When off, the Copilot asks for approval instead.</p>
          {(Object.keys(TOOL_LABEL) as (keyof typeof TOOL_LABEL)[]).map((t) =>
            check(TOOL_LABEL[t], s.autonomy[t], (v) => setS({ ...s, autonomy: { ...s.autonomy, [t]: v } })),
          )}
        </div>
      </Card>
      <Card title="Lead response times">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Accept within (business hours)">
            <Input type="number" min={1} max={72} value={s.acceptSlaHours} onChange={(e) => setS({ ...s, acceptSlaHours: n(e.target.value) })} />
          </Field>
          <Field label="Then escalate after (business hours)">
            <Input type="number" min={1} max={72} value={s.escalationSlaHours} onChange={(e) => setS({ ...s, escalationSlaHours: n(e.target.value) })} />
          </Field>
          <Field label="Working day starts">
            <Input value={s.calendar.start} onChange={(e) => setS({ ...s, calendar: { ...s.calendar, start: e.target.value } })} />
          </Field>
          <Field label="Working day ends">
            <Input value={s.calendar.end} onChange={(e) => setS({ ...s, calendar: { ...s.calendar, end: e.target.value } })} />
          </Field>
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {DAYS.map((d, i) =>
            check(d, s.calendar.workdays.includes(i + 1), (v) =>
              setS({
                ...s,
                calendar: { ...s.calendar, workdays: v ? [...s.calendar.workdays, i + 1].sort() : s.calendar.workdays.filter((w) => w !== i + 1) },
              }),
            ),
          )}
        </div>
        <div className="mt-3">
          <Field label="Holidays (YYYY-MM-DD, comma separated)">
            <Input value={holidays} onChange={(e) => setHolidays(e.target.value)} />
          </Field>
        </div>
      </Card>
      <Card title="Models, budget and retention">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Main model" hint={`In use: ${a.effectiveModels.main}`}>
            <Input value={s.models.main ?? ''} onChange={(e) => setS({ ...s, models: { ...s.models, main: e.target.value } })} />
          </Field>
          <Field label="Fast model" hint={`In use: ${a.effectiveModels.fast}`}>
            <Input value={s.models.fast ?? ''} onChange={(e) => setS({ ...s, models: { ...s.models, fast: e.target.value } })} />
          </Field>
          <Field
            label="Monthly AI budget (USD, 0 = no cap)"
            hint={`Used this month: USD ${a.budget.spentThisMonthUsd}${a.budget.percentUsed !== null ? ` (${a.budget.percentUsed}%)` : ''}`}
          >
            <Input type="number" min={0} value={s.monthlyBudgetUsd} onChange={(e) => setS({ ...s, monthlyBudgetUsd: n(e.target.value) })} />
          </Field>
          <Field label="Questions per user per day">
            <Input type="number" min={1} value={s.perUserDailyTurns} onChange={(e) => setS({ ...s, perUserDailyTurns: n(e.target.value) })} />
          </Field>
          <Field label="Keep conversations (days)">
            <Input type="number" min={1} max={365} value={s.retentionDays} onChange={(e) => setS({ ...s, retentionDays: n(e.target.value) })} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted">
          AI provider: {a.provider}
          {a.simulated ? ' (simulated: no real AI calls)' : ''}. The API key is set on the server only.
        </p>
      </Card>
      <div className="flex items-end justify-end lg:col-span-2">
        <Button type="submit" disabled={save.busy}>
          Save Copilot settings
        </Button>
      </div>
    </form>
  );
}

function UsagePanel({ u }: { u: Usage }) {
  const ms = (v: number | null) => (v === null ? '—' : `${(v / 1000).toFixed(1)} s`);
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={`Quality (last ${u.periodDays} days)`}>
        <Table head={['Runs', 'Grounding failures', 'Injection flags', 'First words p50 / p90', 'Answer p50 / p90']}>
          <tr>
            <td className={cell}>{u.quality.runs}</td>
            <td className={cell}>{u.quality.groundingFailures}</td>
            <td className={cell}>{u.quality.injectionFlags}</td>
            <td className={cell}>
              {ms(u.quality.firstWordsMs.p50)} / {ms(u.quality.firstWordsMs.p90)}
            </td>
            <td className={cell}>
              {ms(u.quality.latencyMs.p50)} / {ms(u.quality.latencyMs.p90)}
            </td>
          </tr>
        </Table>
      </Card>
      <Card title="Changes and response times">
        <Table head={['Auto changes', 'Undo rate', 'Cards', 'Approval rate', 'Accepted in time', 'Median to accept']}>
          <tr>
            <td className={cell}>{u.actions.auto}</td>
            <td className={cell}>{u.actions.undoRatePercent ?? '—'}%</td>
            <td className={cell}>{u.actions.cards}</td>
            <td className={cell}>{u.actions.approvalRatePercent ?? '—'}%</td>
            <td className={cell}>{u.sla.acceptedWithinSlaPercent ?? '—'}%</td>
            <td className={cell}>{u.sla.medianBusinessMinutesToAccept === null ? '—' : `${u.sla.medianBusinessMinutesToAccept} min`}</td>
          </tr>
        </Table>
      </Card>
      <Card title="Runs by kind and role">
        <Table head={['Kind', 'Role', 'Status', 'Runs']}>
          {u.runs.map((r) => (
            <tr key={`${r.kind}${r.role}${r.status}`} className="border-b border-line last:border-0">
              <td className={cell}>{r.kind}</td>
              <td className={cell}>{r.role}</td>
              <td className={cell}>{r.status}</td>
              <td className={cell}>{r.n}</td>
            </tr>
          ))}
        </Table>
      </Card>
      <Card title="AI cost by feature">
        <Table head={['Feature', 'Calls', 'Tokens in / out', 'Cost (USD)']}>
          {u.costByFeature.map((c) => (
            <tr key={c.feature} className="border-b border-line last:border-0">
              <td className={cell}>{c.feature}</td>
              <td className={cell}>{c.calls}</td>
              <td className={cell}>
                {c.inputTokens} / {c.outputTokens}
              </td>
              <td className={cell}>{c.costUsd}</td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}

export function CopilotAdminPage() {
  const a = useQuery({ queryKey: ['copilot-admin'], queryFn: () => get<Admin>('/admin/copilot/settings') });
  const u = useQuery({ queryKey: ['copilot-admin', 'usage'], queryFn: () => get<Usage>('/admin/copilot/usage?days=30') });
  return (
    <div className="space-y-6">
      <PageHeader
        title="Copilot"
        subtitle="Switches, response-time rules, models and budget, and how the Copilot is used (no chat content)."
        icon={<Bot className="size-5" />}
      />
      <Query q={a}>{(d) => <SettingsForm a={d} />}</Query>
      <Query q={u}>{(d) => <UsagePanel u={d} />}</Query>
    </div>
  );
}
