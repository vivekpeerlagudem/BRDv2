/**
 * Weekly sales brief (admins only): the list, the brief page where an admin reviews the figures, the findings and
 * the AI analysis, edits, regenerates, approves and downloads the PowerPoint and Excel, the dashboard card and the
 * settings section.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { TrendingUp } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { ApiError, dateTime, get, patch, post, put } from '../lib/api.ts';
import { useMe } from '../lib/me.ts';
import { Badge, Button, Card, ConfirmButton, Dialog, EmptyState, Field, Input, PageHeader, Query, Select, Table, Textarea, useAction } from '../lib/ui.tsx';
import { AiLabel } from './ai.tsx';
import { STATUS_LABEL, STATUS_TONE } from './weekly-reports.tsx';

type Status = keyof typeof STATUS_LABEL;
interface Metric {
  id: string;
  label: string;
  unit: 'count' | 'money' | 'percent' | 'days' | 'money_per_day';
  value: string | null;
  lastWeek: string | null;
  changePct: string | null;
  mtd?: string | null;
  qtd?: string | null;
  detail?: string;
}
interface Summary {
  id: string;
  periodLabel: string;
  attempt: number;
  trigger: 'schedule' | 'manual';
  status: Status;
  currency: string | null;
  kpis: Metric[];
  signalCount: number;
  highSignals: number;
  headline: string | null;
  aiFallback: boolean;
  flagCount: number;
  warningCount: number;
  hasDraft: boolean;
  hasFinal: boolean;
  failureReason: string | null;
  approvedAt: string | null;
  updatedAt: string;
  rowVersion: number;
}
interface Evidence {
  id: string;
  label: string;
  link: string | null;
}
interface Statement {
  id: string;
  text: string;
  origin: 'ai' | 'fallback' | 'user';
  kind: string | null;
  signalIds: string[];
  sources: Evidence[];
}
interface Flag {
  code: string;
  statementId: string | null;
  message: string;
}
interface Detail extends Summary {
  asOf: string;
  timeZone: string;
  runAsName: string | null;
  approvedByName: string | null;
  metrics: Metric[];
  funnel: { metricId: string; label: string; value: number; stepPct: string | null }[];
  signals: { id: string; kind: string; severity: 'high' | 'medium' | 'low'; title: string; evidence: Evidence[] }[];
  narrative: { section: string; label: string; statements: Statement[] }[];
  blockers: Flag[];
  warnings: Flag[];
  flags: Flag[];
  editable: boolean;
  allowedSources: { id: string; label: string }[];
  sheet: { status: 'disabled' | 'pending' | 'published' | 'failed'; mode: string; enabled: boolean };
  ai: { simulated: boolean; promptVersion: string } | null;
  permissions: { canManage: boolean; canApprove: boolean };
}

const busy = (s: string) => s === 'queued' || s === 'running';
const link = 'text-brand hover:underline';
const FAILURE: Record<string, string> = {
  NO_ACTIVE_ADMIN: 'There is no active administrator for the brief to run for.',
  STUCK: 'The run took too long and was stopped.',
  NO_SNAPSHOT: 'The stored brief data is missing.',
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Same wording as the slides: "Pipeline and attention as of 23 Nov 2026" (organization time zone). */
function asOfLabel(iso: string, timeZone: string) {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(iso))
    .split('-')
    .map(Number) as [number, number, number];
  return `Pipeline and attention as of ${d} ${MONTHS[m - 1]} ${y}`;
}
const VELOCITY_NOTE = 'Sales velocity uses quarter-to-date averages';
const SEVERITY = { high: 'danger', medium: 'warn', low: 'neutral' } as const;
const KIND: Record<string, string> = {
  trend: 'Trend',
  bottleneck: 'Bottleneck',
  risk: 'Risk',
  opportunity: 'Opportunity',
  concentration: 'Concentration',
  team: 'Team',
};
const SHEET: Record<string, string> = {
  disabled: 'Excel download only (Google Sheets publishing is switched off)',
  pending: 'Waiting to be written to the Google Sheet',
  published: 'Written to the Google Sheet',
  failed: 'Could not be written to the Google Sheet (the Excel download is not affected)',
};
const grouped = (v: string) => {
  const [whole = '0', cents = ''] = v.split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${cents && !/^0+$/.test(cents) ? `.${cents}` : ''}`;
};
function show(m: Pick<Metric, 'unit' | 'value'> | undefined, currency: string | null): string {
  if (!m || m.value === null) return '—';
  if (m.unit === 'money') return `${currency ?? ''} ${grouped(m.value)}`.trim();
  if (m.unit === 'money_per_day') return `${currency ?? ''} ${grouped(m.value)} / day`.trim();
  if (m.unit === 'percent') return `${m.value}%`;
  if (m.unit === 'days') return `${m.value} days`;
  return m.value;
}
function change(m: Metric | undefined): string {
  if (!m || m.value === null || m.lastWeek === null) return '';
  if (m.changePct === null) return Number(m.value) === Number(m.lastWeek) ? 'No change vs last week' : 'Up from 0 last week';
  const n = Number(m.changePct);
  return n === 0 ? 'No change vs last week' : `${n > 0 ? '▲' : '▼'} ${m.changePct.replace('-', '')}% vs last week`;
}
const TILES: [string, string][] = [
  ['S-01', 'New leads'],
  ['S-05', 'New opportunities'],
  ['S-08', 'Revenue won'],
  ['S-10', 'Win rate'],
  ['S-11', 'Open pipeline'],
];

function Chips({ items }: { items: Evidence[] }) {
  if (!items.length) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-1">
      {items.map((e) =>
        e.link ? (
          <a key={e.id} href={e.link} className="rounded bg-surface px-1.5 py-0.5 text-xs text-brand hover:underline">
            {e.label}
          </a>
        ) : (
          <span key={e.id} className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">
            {e.label}
          </span>
        ),
      )}
    </p>
  );
}

// ───────────────────────── list ─────────────────────────
export function SalesBriefsPage() {
  const qc = useQueryClient();
  const list = useQuery({
    queryKey: ['sales-briefs'],
    queryFn: () => get<{ items: Summary[] }>('/sales-briefs'),
    refetchInterval: (query) => (query.state.data?.items.some((r) => busy(r.status)) ? 3000 : 30_000),
  });
  const generate = useAction(() => post('/sales-briefs'), {
    success: 'Generating the sales brief',
    onDone: () => void qc.invalidateQueries({ queryKey: ['sales-briefs'] }),
  });
  const working = list.data?.items.some((r) => busy(r.status)) ?? false;
  return (
    <>
      <PageHeader
        title="Sales brief"
        subtitle="One weekly brief for leadership: overall sales, throughput, findings and recommended actions"
        icon={<TrendingUp className="size-5 text-brand" aria-hidden />}
        actions={
          <Button disabled={working || generate.busy} onClick={() => generate.run(undefined)}>
            Generate now
          </Button>
        }
      />
      {generate.error instanceof ApiError && (
        <p role="alert" className="mb-3 text-sm text-danger">
          {generate.error.message}
        </p>
      )}
      <Query q={list} rows={5}>
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState title="No sales brief yet" hint="A brief is generated every week on the day set in Settings → Sales brief, or click Generate now." />
          ) : (
            <Table head={['Week', 'Status', 'Revenue won', 'Win rate', 'Open pipeline', 'Findings', 'Updated']}>
              {d.items.map((r) => {
                const kpi = (id: string) => r.kpis.find((k) => k.id === id);
                return (
                  <tr key={r.id}>
                    <td>
                      <Link to="/sales-brief/$id" params={{ id: r.id }} className="font-medium text-ink hover:text-brand hover:underline">
                        {r.periodLabel}
                      </Link>
                      {r.attempt > 1 && <span className="ml-1 text-xs text-muted">v{r.attempt}</span>}
                    </td>
                    <td>
                      <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge> {r.aiFallback && <Badge tone="warn">AI fallback</Badge>}
                    </td>
                    <td className="tabular-nums">{show(kpi('S-08'), r.currency)}</td>
                    <td className="tabular-nums">{show(kpi('S-10'), r.currency)}</td>
                    <td className="tabular-nums">{show(kpi('S-11'), r.currency)}</td>
                    <td className="text-muted">{r.signalCount ? `${r.signalCount}${r.highSignals ? ` · ${r.highSignals} high` : ''}` : '—'}</td>
                    <td className="text-muted">{dateTime(r.updatedAt)}</td>
                  </tr>
                );
              })}
            </Table>
          )
        }
      </Query>
    </>
  );
}

// ───────────────────────── brief page ─────────────────────────
export function SalesBriefPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['sales-brief', id],
    queryFn: () => get<Detail>(`/sales-briefs/${id}`),
    refetchInterval: (query) => (query.state.data && (busy(query.state.data.status) || query.state.data.sheet.status === 'pending') ? 3000 : false),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['sales-brief', id] });
    void qc.invalidateQueries({ queryKey: ['sales-briefs'] });
  };
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [adding, setAdding] = useState<{ section: string; text: string; sources: string[] } | null>(null);
  const [approving, setApproving] = useState(false);
  const [checked, setChecked] = useState(false);
  const save = useAction((body: Record<string, unknown>) => patch(`/sales-briefs/${id}/narrative`, body), {
    success: 'Brief text saved',
    onDone: () => {
      setEditing(null);
      setAdding(null);
      refresh();
    },
  });
  const regenerate = useAction(() => post(`/sales-briefs/${id}/regenerate`), { success: 'Regenerating the analysis', onDone: refresh });
  const approve = useAction((body: Record<string, unknown>) => post(`/sales-briefs/${id}/approve`, body), {
    success: 'Sales brief approved',
    onDone: () => {
      setApproving(false);
      refresh();
    },
  });

  return (
    <Query q={q}>
      {(r) => {
        const metric = (mid: string) => r.metrics.find((m) => m.id === mid);
        const kind = r.hasFinal ? 'final' : 'draft';
        const top = Math.max(1, ...r.funnel.map((f) => f.value));
        return (
          <>
            <PageHeader
              icon={<TrendingUp className="size-5 text-brand" aria-hidden />}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  Weekly sales brief <span className="font-normal text-muted">· {r.periodLabel}</span>
                </span>
              }
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  <span>
                    Version {r.attempt} · {r.trigger === 'schedule' ? 'weekly schedule' : 'generated by hand'}
                    {r.runAsName ? ` · runs for ${r.runAsName}` : ''}
                  </span>
                  {r.aiFallback ? <Badge tone="warn">AI fallback</Badge> : r.ai && <AiLabel simulated={r.ai.simulated}>AI analysis</AiLabel>}
                  <Badge>Internal</Badge>
                </span>
              }
              actions={
                <>
                  {(r.hasDraft || r.hasFinal) && (
                    <>
                      <a className={`text-[13px] font-medium ${link}`} href={`/api/v1/sales-briefs/${r.id}/pptx/${kind}`}>
                        Download PowerPoint
                      </a>
                      <a className={`text-[13px] font-medium ${link}`} href={`/api/v1/sales-briefs/${r.id}/xlsx/${kind}`}>
                        Download Excel
                      </a>
                    </>
                  )}
                  {r.editable && (
                    <ConfirmButton
                      label="Regenerate"
                      variant="secondary"
                      disabled={regenerate.busy}
                      confirm="Regenerate the analysis with AI? All current text, including your edits, is replaced. The figures and findings stay the same."
                      onConfirm={() => regenerate.run(undefined)}
                    />
                  )}
                  {r.permissions.canManage && (r.status === 'ready' || r.status === 'needs_attention') && (
                    <Button
                      disabled={!r.permissions.canApprove}
                      title={r.permissions.canApprove ? undefined : 'Fix the open points first'}
                      onClick={() => {
                        setChecked(false);
                        setApproving(true);
                      }}
                    >
                      Approve
                    </Button>
                  )}
                </>
              }
            />

            {busy(r.status) && (
              <p role="status" className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
                The brief is being generated. This page refreshes by itself.
              </p>
            )}
            {r.status === 'failed' && (
              <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {FAILURE[r.failureReason ?? ''] ?? 'The brief could not be generated.'}
              </p>
            )}
            {r.status === 'approved' && (
              <p className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                Approved{r.approvedByName ? ` by ${r.approvedByName}` : ''} on {dateTime(r.approvedAt)}. The final PowerPoint and Excel are ready to download.
              </p>
            )}

            {r.metrics.length > 0 && (
              <div className="space-y-4">
                <section aria-label="Key figures" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
                  {TILES.map(([mid, label]) => (
                    <div key={mid} className="rounded-lg border border-line bg-white p-3">
                      <p className="text-xs font-medium text-muted">{label}</p>
                      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{show(metric(mid), r.currency)}</p>
                      <p className="text-xs text-muted">{mid === 'S-11' ? (metric(mid)?.detail ?? '') : change(metric(mid))}</p>
                    </div>
                  ))}
                </section>
                <p className="text-xs text-muted">
                  {asOfLabel(r.asOf, r.timeZone)} · {VELOCITY_NOTE}
                </p>

                {(r.blockers.length > 0 || r.warnings.length > 0) && (
                  <Card title="Points to review">
                    <ul className="space-y-1.5 text-sm">
                      {r.blockers.map((f) => (
                        <li key={`b-${f.code}-${f.statementId ?? ''}`} className="flex gap-2">
                          <Badge tone="danger">Must fix</Badge>
                          <span>{f.message}</span>
                        </li>
                      ))}
                      {r.warnings.map((f) => (
                        <li key={`w-${f.code}-${f.statementId ?? ''}`} className="flex gap-2">
                          <Badge tone="warn">Check</Badge>
                          <span>{f.message}</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <div className="grid gap-4 xl:grid-cols-[1fr_24rem]">
                  <div className="space-y-4">
                    {r.narrative.map((s) => (
                      <Card
                        key={s.section}
                        title={s.label}
                        actions={
                          r.editable ? (
                            <Button variant="ghost" onClick={() => setAdding({ section: s.section, text: '', sources: [] })}>
                              Add sentence
                            </Button>
                          ) : undefined
                        }
                      >
                        {s.statements.length === 0 && adding?.section !== s.section && <p className="text-sm text-muted">Nothing here.</p>}
                        <ul className="space-y-3">
                          {s.statements.map((st) => (
                            <li key={st.id} className={st.origin === 'fallback' ? 'rounded-md border border-amber-200 bg-amber-50 p-2' : ''}>
                              {editing?.id === st.id ? (
                                <form
                                  className="space-y-2"
                                  onSubmit={(e) => {
                                    e.preventDefault();
                                    save.run({ statements: [{ id: st.id, text: editing.text }], rowVersion: r.rowVersion });
                                  }}
                                >
                                  <Textarea
                                    aria-label={`Edit sentence in ${s.label}`}
                                    rows={3}
                                    value={editing.text}
                                    maxLength={600}
                                    onChange={(e) => setEditing({ id: st.id, text: e.target.value })}
                                  />
                                  <div className="flex gap-2">
                                    <Button type="submit" disabled={save.busy || !editing.text.trim()}>
                                      Save
                                    </Button>
                                    <Button variant="secondary" onClick={() => setEditing(null)}>
                                      Cancel
                                    </Button>
                                  </div>
                                </form>
                              ) : (
                                <>
                                  <p className="text-sm text-ink">
                                    {st.kind && <Badge>{KIND[st.kind] ?? st.kind}</Badge>} {st.text} {st.origin === 'user' && <Badge>Edited</Badge>}
                                    {st.origin === 'fallback' && <Badge tone="warn">Placeholder</Badge>}
                                  </p>
                                  <Chips items={st.sources} />
                                  {r.flags
                                    .filter((f) => f.statementId === st.id)
                                    .map((f) => (
                                      <p key={f.code} className="mt-1 text-xs text-danger">
                                        {f.message}
                                      </p>
                                    ))}
                                  {r.editable && (
                                    <p className="mt-1 flex gap-3 text-[13px]">
                                      <button
                                        type="button"
                                        className={`cursor-pointer ${link}`}
                                        onClick={() => setEditing({ id: st.id, text: st.origin === 'fallback' ? '' : st.text })}
                                      >
                                        {st.origin === 'fallback' ? 'Write this sentence' : 'Edit'}
                                      </button>
                                      <button
                                        type="button"
                                        className="cursor-pointer text-muted hover:text-danger hover:underline"
                                        disabled={save.busy}
                                        onClick={() => save.run({ removed: [st.id], rowVersion: r.rowVersion })}
                                      >
                                        Remove
                                      </button>
                                    </p>
                                  )}
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                        {adding?.section === s.section && (
                          <form
                            className="mt-3 space-y-2 rounded-md border border-dashed border-line-strong p-3"
                            onSubmit={(e) => {
                              e.preventDefault();
                              save.run({ added: [{ section: s.section, text: adding.text, sources: adding.sources }], rowVersion: r.rowVersion });
                            }}
                          >
                            <Textarea
                              aria-label={`New sentence for ${s.label}`}
                              rows={3}
                              maxLength={600}
                              placeholder="Write a sentence for leadership"
                              value={adding.text}
                              onChange={(e) => setAdding({ ...adding, text: e.target.value })}
                            />
                            <label className="block text-xs text-muted">
                              Evidence (optional — hold Ctrl to choose several)
                              <select
                                multiple
                                size={5}
                                aria-label="Evidence for the new sentence"
                                className="mt-1 block w-full rounded border border-line bg-white p-1 text-[13px] text-ink"
                                value={adding.sources}
                                onChange={(e) => setAdding({ ...adding, sources: [...e.target.selectedOptions].map((o) => o.value) })}
                              >
                                {r.allowedSources.map((src) => (
                                  <option key={src.id} value={src.id}>
                                    {src.label}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <div className="flex gap-2">
                              <Button type="submit" disabled={save.busy || !adding.text.trim()}>
                                Add sentence
                              </Button>
                              <Button variant="secondary" onClick={() => setAdding(null)}>
                                Cancel
                              </Button>
                            </div>
                          </form>
                        )}
                      </Card>
                    ))}
                    {save.error instanceof ApiError && (
                      <p role="alert" className="text-sm text-danger">
                        {save.error.message}
                      </p>
                    )}
                  </div>

                  <div className="space-y-4">
                    <Card title="Throughput funnel">
                      <ul className="space-y-2 text-sm" aria-label="Throughput funnel">
                        {r.funnel.map((f) => (
                          <li key={f.metricId}>
                            <div className="flex justify-between">
                              <span className="text-ink">{f.label}</span>
                              <span className="tabular-nums text-ink">
                                {f.value}
                                {f.stepPct !== null && Number(f.stepPct) <= 100 && <span className="ml-1 text-xs text-muted">({f.stepPct}%)</span>}
                              </span>
                            </div>
                            <div className="mt-1 h-2 rounded bg-surface">
                              <div className="h-2 rounded bg-brand" style={{ width: `${Math.max(2, (f.value / top) * 100)}%` }} />
                            </div>
                          </li>
                        ))}
                      </ul>
                      <p className="mt-2 text-xs text-muted">Percent = share of the step before (not shown where reps also open opportunities directly).</p>
                    </Card>
                    <Card title="Findings (computed by code)">
                      {r.signals.length === 0 ? (
                        <p className="text-sm text-muted">Nothing notable this week.</p>
                      ) : (
                        <ul className="space-y-3 text-sm" aria-label="Findings">
                          {r.signals.map((s) => (
                            <li key={s.id}>
                              <p className="text-ink">
                                <Badge tone={SEVERITY[s.severity]}>{s.severity}</Badge> <Badge>{KIND[s.kind] ?? s.kind}</Badge> {s.title}
                              </p>
                              <Chips items={s.evidence} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </Card>
                    <Card title="More figures">
                      <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-sm">
                        {r.metrics
                          .filter((m) => !TILES.some(([mid]) => mid === m.id))
                          .map((m) => (
                            <div key={m.id} className="contents">
                              <dt className="text-muted">{m.label}</dt>
                              <dd className="text-right tabular-nums text-ink">{show(m, r.currency)}</dd>
                            </div>
                          ))}
                      </dl>
                    </Card>
                    <Card title="Spreadsheet">
                      <p className="text-sm text-muted">{SHEET[r.sheet.status]}</p>
                    </Card>
                    <Card title="About this analysis">
                      <p className="text-[13px] leading-relaxed text-muted">
                        {r.aiFallback
                          ? 'AI text could not be used for this brief, so the sentences are placeholders for a person to write.'
                          : r.ai
                            ? `${r.ai.simulated ? 'Built-in simulator, not a real AI model' : 'AI model'} · prompt ${r.ai.promptVersion}.`
                            : 'Written by a person.'}{' '}
                        Every number and every finding is computed by the CRM and equals the Reports page; AI only explains them and suggests actions.
                      </p>
                    </Card>
                  </div>
                </div>
              </div>
            )}

            <Dialog open={approving} onClose={() => setApproving(false)} title="Approve sales brief">
              <div className="space-y-3">
                <p className="text-sm text-ink">
                  Approve the sales brief for {r.periodLabel}? The final PowerPoint and Excel are created. An approved brief can no longer be changed.
                </p>
                {r.warnings.length > 0 && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-[13px] text-amber-900">
                    <ul className="mb-2 list-inside list-disc">
                      {r.warnings.map((w) => (
                        <li key={`${w.code}-${w.statementId ?? ''}`}>{w.message}</li>
                      ))}
                    </ul>
                    <label className="flex items-center gap-2 font-medium">
                      <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} /> I checked the flagged figures
                    </label>
                  </div>
                )}
                {approve.error instanceof ApiError && (
                  <p role="alert" className="text-sm text-danger">
                    {approve.error.message}
                  </p>
                )}
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setApproving(false)}>
                    Cancel
                  </Button>
                  <Button
                    disabled={approve.busy || (r.warnings.length > 0 && !checked)}
                    onClick={() => approve.run({ rowVersion: r.rowVersion, ...(r.warnings.length ? { acknowledgeWarnings: true } : {}) })}
                  >
                    Approve brief
                  </Button>
                </div>
              </div>
            </Dialog>
          </>
        );
      }}
    </Query>
  );
}

// ───────────────────────── dashboard card (admins) ─────────────────────────
export function LatestSalesBriefCard() {
  const me = useMe();
  const allowed = Boolean(me.data?.permissions['sales_brief.view']);
  const q = useQuery({ queryKey: ['sales-briefs', 'latest'], queryFn: () => get<{ items: Summary[] }>('/sales-briefs?limit=1'), enabled: allowed });
  if (!allowed) return null;
  const b = q.data?.items[0];
  return (
    <Card
      title="Latest sales brief"
      className="mb-4"
      actions={
        <Link to="/sales-brief" className={`text-[13px] font-medium ${link}`}>
          All briefs
        </Link>
      }
    >
      {!b ? (
        <p className="text-sm text-muted">No sales brief yet. It is generated every week, or use “Generate now” on the Sales brief page.</p>
      ) : (
        <div className="space-y-2 text-sm">
          <p>
            <Link to="/sales-brief/$id" params={{ id: b.id }} className={`font-medium ${link}`}>
              {b.periodLabel}
            </Link>{' '}
            <Badge tone={STATUS_TONE[b.status]}>{STATUS_LABEL[b.status]}</Badge>
            {b.highSignals > 0 && <span className="ml-2 text-xs text-danger">{b.highSignals} high-priority finding(s)</span>}
          </p>
          {b.headline && <p className="text-ink">{b.headline}</p>}
          <p className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
            {TILES.map(([mid, label]) => (
              <span key={mid}>
                {label}:{' '}
                <span className="font-medium tabular-nums text-ink">
                  {show(
                    b.kpis.find((k) => k.id === mid),
                    b.currency,
                  )}
                </span>
              </span>
            ))}
          </p>
        </div>
      )}
    </Card>
  );
}

// ───────────────────────── settings section ─────────────────────────
interface BriefSettings {
  enabled: boolean;
  runWeekday: number;
  runTime: string;
  ownerUserId: string | null;
  timeZone: string;
  admins: { userId: string; name: string }[];
  sheet: { mode: string; configured: boolean; detail: string };
}
const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

export function SalesBriefSettingsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['sales-brief-settings'], queryFn: () => get<BriefSettings>('/admin/sales-brief-settings') });
  const save = useAction((v: Record<string, unknown>) => put('/admin/sales-brief-settings', v), {
    success: 'Sales brief settings saved',
    onDone: () => void qc.invalidateQueries({ queryKey: ['sales-brief-settings'] }),
  });
  return (
    <Query q={q}>
      {(s) => (
        <Card title="Weekly sales brief">
          <form
            className="max-w-xl space-y-3"
            onSubmit={(e: FormEvent<HTMLFormElement>) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              save.run({
                enabled: f.get('enabled') === 'on',
                runWeekday: Number(f.get('runWeekday')),
                runTime: String(f.get('runTime')),
                ownerUserId: String(f.get('ownerUserId') ?? '') || null,
              });
            }}
          >
            <p className="text-sm text-muted">
              Once a week a company-wide sales brief is drafted for leadership, covering the previous Monday to Sunday. Only administrators can see it. An
              administrator reviews and approves it; nothing is sent to anyone.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="enabled" defaultChecked={s.enabled} /> Generate the sales brief automatically
            </label>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Day" error={save.fieldError('runWeekday')}>
                <Select name="runWeekday" defaultValue={String(s.runWeekday)}>
                  {WEEKDAYS.map((d, i) => (
                    <option key={d} value={i + 1}>
                      {d}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Time" hint={`Organization time zone: ${s.timeZone}`} error={save.fieldError('runTime')}>
                <Input name="runTime" type="time" required defaultValue={s.runTime} />
              </Field>
            </div>
            <Field label="Runs for" hint="The AI analysis is requested on behalf of this administrator.">
              <Select name="ownerUserId" defaultValue={s.ownerUserId ?? ''}>
                <option value="">The longest-standing active administrator</option>
                {s.admins.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.name}
                  </option>
                ))}
              </Select>
            </Field>
            <p className="text-sm text-muted">
              Spreadsheet: <span className="font-medium text-ink">{s.sheet.mode === 'google' ? 'Excel download and Google Sheets' : 'Excel download'}</span> —{' '}
              {s.sheet.detail}
            </p>
            <div className="flex justify-end">
              <Button type="submit" disabled={save.busy}>
                Save sales brief settings
              </Button>
            </div>
          </form>
        </Card>
      )}
    </Query>
  );
}
