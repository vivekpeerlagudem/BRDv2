/**
 * Reports (BR-RPT-001..010): filterable, permission-scoped figures with CSV export per section.
 * Every number comes from GET /reports/overview; the server applies the user's scope (own / team / organization)
 * and refuses filters outside it, so this page only offers the teams and owners the server says are in scope.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type ReactNode, useEffect, useState } from 'react';
import { ApiError, dateTime, get } from '../lib/api.ts';
import { Badge, Button, Card, EmptyState, Field, Input, PageHeader, Query, Select, statusTone, Table, useAction, useToast } from '../lib/ui.tsx';

interface FilterOptions {
  scope: 'organization' | 'team' | 'own';
  teams: { id: string; name: string }[];
  owners: { id: string; name: string; teamId: string | null }[];
}
interface OpenRow {
  count: number;
  value: string;
  weighted: string;
  noAmount: number;
  notConverted: number;
  createdInPeriod: number;
}
interface Overview {
  scope: FilterOptions['scope'];
  filters: { from: string; to: string; teamId: string | null; ownerId: string | null };
  currency: string;
  timeZone: string;
  generatedAt: string;
  pipelineByStage: (OpenRow & { stageId: string; pipeline: string; stage: string; probability: string })[];
  pipelineByOwner: (OpenRow & { ownerId: string; owner: string })[];
  pipelineTotals: { count: number; value: string; weighted: string; noAmount: number; notConverted: number };
  wonLost: {
    won: number;
    lost: number;
    wonValue: string;
    lostValue: string;
    winRateCount: number | null;
    winRateValue: number | null;
    notConverted: number;
  };
  lostReasons: { reason: string; count: number; value: string; percent: number }[];
  reps: {
    userId: string;
    name: string;
    openDeals: number;
    openValue: string;
    won: number;
    lost: number;
    wonRevenue: string;
    winRate: number | null;
    avgDealSize: string | null;
    avgCycleDays: number | null;
  }[];
  proposals: {
    sent: number;
    versionsSent: number;
    viewed: number;
    won: number;
    viewRate: number | null;
    winRate: number | null;
    medianHoursToFirstView: number | null;
    avgHoursToFirstView: number | null;
    medianDaysToSign: number | null;
    avgDaysToSign: number | null;
    dealsWithFirstProposal: number;
    medianDaysDealToFirstProposal: number | null;
    avgDaysDealToFirstProposal: number | null;
    list: {
      proposalId: string;
      title: string;
      status: string;
      dealId: string;
      dealName: string;
      owner: string;
      firstSentAt: string | null;
      firstViewAt: string | null;
      signedAt: string | null;
      hoursToFirstView: number | null;
      daysToSign: number | null;
    }[];
  };
  activity: { userId: string; name: string; calls: number; meetings: number; notes: number; tasksCompleted: number }[];
  attention: {
    dealId: string;
    name: string;
    owner: string;
    stage: string;
    amount: string | null;
    currency: string;
    reasons: string[];
    daysSinceActivity: number;
    lastProposalStatus: string | null;
  }[];
}

// ───────────── filters ─────────────
interface Filters {
  preset: string;
  from: string;
  to: string;
  teamId: string;
  ownerId: string;
}
const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const PRESETS: { key: string; label: string; range: (today: Date) => [Date, Date] }[] = [
  { key: 'last30', label: 'Last 30 days', range: (t) => [new Date(t.getFullYear(), t.getMonth(), t.getDate() - 29), t] },
  { key: 'last90', label: 'Last 90 days', range: (t) => [new Date(t.getFullYear(), t.getMonth(), t.getDate() - 89), t] },
  { key: 'thisMonth', label: 'This month', range: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), new Date(t.getFullYear(), t.getMonth() + 1, 0)] },
  { key: 'lastMonth', label: 'Last month', range: (t) => [new Date(t.getFullYear(), t.getMonth() - 1, 1), new Date(t.getFullYear(), t.getMonth(), 0)] },
  {
    key: 'thisQuarter',
    label: 'This quarter',
    range: (t) => {
      const q = Math.floor(t.getMonth() / 3) * 3;
      return [new Date(t.getFullYear(), q, 1), new Date(t.getFullYear(), q + 3, 0)];
    },
  },
  {
    key: 'lastQuarter',
    label: 'Last quarter',
    range: (t) => {
      const q = Math.floor(t.getMonth() / 3) * 3 - 3;
      return [new Date(t.getFullYear(), q, 1), new Date(t.getFullYear(), q + 3, 0)];
    },
  },
  { key: 'thisYear', label: 'This year', range: (t) => [new Date(t.getFullYear(), 0, 1), new Date(t.getFullYear(), 11, 31)] },
];
function presetRange(key: string): { from: string; to: string } | null {
  const p = PRESETS.find((x) => x.key === key);
  if (!p) return null;
  const [from, to] = p.range(new Date());
  return { from: day(from), to: day(to) };
}
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;
/** Filters are kept in the address bar, so a filtered report can be bookmarked, reloaded or shared. */
function initialFilters(): Filters {
  const q = new URLSearchParams(window.location.search);
  const from = q.get('from') ?? '';
  const to = q.get('to') ?? '';
  const teamId = UUID.test(q.get('teamId') ?? '') ? (q.get('teamId') as string) : '';
  const ownerId = UUID.test(q.get('ownerId') ?? '') ? (q.get('ownerId') as string) : '';
  if (ISO_DAY.test(from) && ISO_DAY.test(to)) return { preset: 'custom', from, to, teamId, ownerId };
  const preset = PRESETS.some((p) => p.key === q.get('preset')) ? (q.get('preset') as string) : 'last90';
  return { preset, ...(presetRange(preset) as { from: string; to: string }), teamId, ownerId };
}
function queryString(f: Filters): string {
  const q = new URLSearchParams({ from: f.from, to: f.to });
  if (f.teamId) q.set('teamId', f.teamId);
  if (f.ownerId) q.set('ownerId', f.ownerId);
  return q.toString();
}
function rangeError(f: Filters): string | undefined {
  if (!ISO_DAY.test(f.from) || !ISO_DAY.test(f.to)) return 'Choose both a start and an end date';
  if (f.from > f.to) return '"To" must be on or after "From"';
  if (Date.parse(f.to) - Date.parse(f.from) > 5 * 366 * 86_400_000) return 'The date range can be at most 5 years';
  return undefined;
}

// ───────────── formatting ─────────────
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const unit = (v: number | null, suffix: string) => (v === null ? '—' : `${v} ${suffix}`);
const REASONS: Record<string, string> = { stalled: 'Stalled', overdue: 'Past expected close date', unviewed_proposal: 'Proposal not viewed' };
const SCOPE_TEXT: Record<FilterOptions['scope'], string> = { organization: 'Whole organization', team: 'Your team', own: 'Your own performance' };

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink" data-testid={`kpi-${label.toLowerCase().replaceAll(' ', '-')}`}>
        {value}
      </p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}
const Num = ({ children }: { children: ReactNode }) => <td className="tabular-nums">{children}</td>;

export function ReportsPage() {
  const toast = useToast();
  const [f, setF] = useState<Filters>(initialFilters);
  const options = useQuery({ queryKey: ['report-filters'], queryFn: () => get<FilterOptions>('/reports/filters') });
  const invalid = rangeError(f);
  const qs = queryString(f);
  const q = useQuery({ queryKey: ['report-overview', qs], queryFn: () => get<Overview>(`/reports/overview?${qs}`), enabled: !invalid, retry: false });

  useEffect(() => {
    if (!invalid) window.history.replaceState(window.history.state, '', `${window.location.pathname}?${qs}`);
  }, [qs, invalid]);

  const exporter = useAction(async (section: string) => {
    const res = await fetch(`/api/v1/reports/export/${section}.csv?${qs}`, { credentials: 'same-origin' });
    if (!res.ok) {
      const problem = (await res.json().catch(() => null)) as { title?: string; code?: string } | null;
      throw new ApiError(res.status, problem?.code ?? 'UNKNOWN', problem?.title ?? `Export failed (${res.status})`);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${section}-${f.from}-to-${f.to}.csv`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    toast('CSV downloaded');
  });
  const exportButton = (section: string, label: string) => (
    <Button variant="secondary" disabled={exporter.busy || Boolean(invalid)} aria-label={`Export ${label} as CSV`} onClick={() => exporter.run(section)}>
      Export CSV
    </Button>
  );

  const teams = options.data?.teams ?? [];
  const owners = (options.data?.owners ?? []).filter((o) => !f.teamId || o.teamId === f.teamId);
  const cur = q.data?.currency ?? 'USD';
  const cash = (v: string | null) =>
    v === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 2 }).format(Number(v));

  return (
    <>
      <PageHeader
        title="Reports"
        subtitle={
          q.data
            ? `${SCOPE_TEXT[q.data.scope]} · ${q.data.filters.from} to ${q.data.filters.to} (${q.data.timeZone}) · as of ${dateTime(q.data.generatedAt)}`
            : options.data
              ? SCOPE_TEXT[options.data.scope]
              : undefined
        }
      />
      <Card title="Filters" className="mb-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" onSubmit={(e) => e.preventDefault()} aria-label="Report filters">
          <Field label="Period">
            <Select
              aria-label="Period"
              value={f.preset}
              onChange={(e) => {
                const preset = e.target.value;
                setF((p) => ({ ...p, preset, ...(presetRange(preset) ?? {}) }));
              }}
            >
              {PRESETS.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
              <option value="custom">Custom range</option>
            </Select>
          </Field>
          <Field label="From">
            <Input type="date" value={f.from} max={f.to || undefined} onChange={(e) => setF((p) => ({ ...p, preset: 'custom', from: e.target.value }))} />
          </Field>
          <Field label="To" error={invalid}>
            <Input type="date" value={f.to} min={f.from || undefined} onChange={(e) => setF((p) => ({ ...p, preset: 'custom', to: e.target.value }))} />
          </Field>
          {teams.length > 0 && (
            <Field label="Team">
              <Select
                aria-label="Team"
                value={f.teamId}
                onChange={(e) => {
                  const teamId = e.target.value;
                  const stillThere = (options.data?.owners ?? []).some((o) => o.id === f.ownerId && (!teamId || o.teamId === teamId));
                  setF((p) => ({ ...p, teamId, ownerId: stillThere ? p.ownerId : '' }));
                }}
              >
                <option value="">All teams in your scope</option>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {(options.data?.owners.length ?? 0) > 1 && (
            <Field label="Owner">
              <Select aria-label="Owner" value={f.ownerId} onChange={(e) => setF((p) => ({ ...p, ownerId: e.target.value }))}>
                <option value="">Everyone in your scope</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </form>
        {options.data?.scope === 'own' && <p className="mt-3 text-xs text-muted">You see your own opportunities, proposals and activity.</p>}
      </Card>

      {invalid ? (
        <EmptyState title="Choose a valid date range" hint={invalid} />
      ) : (
        <Query q={q} rows={8}>
          {(d) => (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Open pipeline" value={cash(d.pipelineTotals.value)} hint={`${d.pipelineTotals.count} open opportunities (now)`} />
                <Kpi label="Weighted pipeline" value={cash(d.pipelineTotals.weighted)} hint="Value × stage probability" />
                <Kpi label="Won revenue" value={cash(d.wonLost.wonValue)} hint={`${d.wonLost.won} won · ${d.wonLost.lost} lost in period`} />
                <Kpi label="Win rate" value={pct(d.wonLost.winRateCount)} hint={`By value: ${pct(d.wonLost.winRateValue)}`} />
              </div>
              {d.pipelineTotals.notConverted + d.wonLost.notConverted > 0 && (
                <p role="status" className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-warn">
                  {d.pipelineTotals.notConverted + d.wonLost.notConverted} opportunities are in another currency with no exchange rate and are left out of value
                  totals.
                </p>
              )}

              <Card title="Pipeline by stage" actions={exportButton('pipeline-by-stage', 'pipeline by stage')}>
                <Table head={['Pipeline', 'Stage', 'Probability', 'Open opportunities', 'Value', 'Weighted value', 'No amount', 'Created in period']}>
                  {d.pipelineByStage.map((r) => (
                    <tr key={r.stageId}>
                      <td>{r.pipeline}</td>
                      <td>{r.stage}</td>
                      <Num>{Number(r.probability)}%</Num>
                      <Num>{r.count}</Num>
                      <Num>{cash(r.value)}</Num>
                      <Num>{cash(r.weighted)}</Num>
                      <Num>{r.noAmount}</Num>
                      <Num>{r.createdInPeriod}</Num>
                    </tr>
                  ))}
                </Table>
                <p className="mt-2 text-xs text-muted">
                  Open opportunities as they are now. “Created in period” counts those created inside the selected dates.
                </p>
              </Card>

              <Card title="Pipeline by owner" actions={exportButton('pipeline-by-owner', 'pipeline by owner')}>
                {d.pipelineByOwner.length === 0 ? (
                  <EmptyState title="No open opportunities" hint="Open opportunities in your scope appear here." />
                ) : (
                  <Table head={['Owner', 'Open opportunities', 'Value', 'Weighted value', 'No amount']}>
                    {d.pipelineByOwner.map((r) => (
                      <tr key={r.ownerId}>
                        <td>{r.owner}</td>
                        <Num>{r.count}</Num>
                        <Num>{cash(r.value)}</Num>
                        <Num>{cash(r.weighted)}</Num>
                        <Num>{r.noAmount}</Num>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>

              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Won and lost" actions={exportButton('won-lost', 'won and lost')}>
                  <Table head={['Outcome', 'Opportunities', 'Value']}>
                    <tr>
                      <td>Won</td>
                      <Num>{d.wonLost.won}</Num>
                      <Num>{cash(d.wonLost.wonValue)}</Num>
                    </tr>
                    <tr>
                      <td>Lost</td>
                      <Num>{d.wonLost.lost}</Num>
                      <Num>{cash(d.wonLost.lostValue)}</Num>
                    </tr>
                    <tr>
                      <td>Win rate</td>
                      <Num>{pct(d.wonLost.winRateCount)}</Num>
                      <Num>{pct(d.wonLost.winRateValue)}</Num>
                    </tr>
                  </Table>
                </Card>
                <Card title="Lost reasons" actions={exportButton('lost-reasons', 'lost reasons')}>
                  {d.lostReasons.length === 0 ? (
                    <EmptyState title="No lost opportunities in this period" />
                  ) : (
                    <Table head={['Reason', 'Opportunities', 'Value', 'Share']}>
                      {d.lostReasons.map((r) => (
                        <tr key={r.reason}>
                          <td>{r.reason}</td>
                          <Num>{r.count}</Num>
                          <Num>{cash(r.value)}</Num>
                          <Num>{r.percent}%</Num>
                        </tr>
                      ))}
                    </Table>
                  )}
                </Card>
              </div>

              <Card title="Rep performance" actions={exportButton('rep-performance', 'rep performance')}>
                {d.reps.length === 0 ? (
                  <EmptyState
                    title="No opportunities for this selection"
                    hint="Reps with open opportunities, or opportunities closed in the period, appear here."
                  />
                ) : (
                  <Table head={['Rep', 'Open opportunities', 'Open value', 'Won', 'Lost', 'Won revenue', 'Win rate', 'Avg. opportunity size', 'Avg. cycle']}>
                    {d.reps.map((r) => (
                      <tr key={r.userId}>
                        <td>{r.name}</td>
                        <Num>{r.openDeals}</Num>
                        <Num>{cash(r.openValue)}</Num>
                        <Num>{r.won}</Num>
                        <Num>{r.lost}</Num>
                        <Num>{cash(r.wonRevenue)}</Num>
                        <Num>{pct(r.winRate)}</Num>
                        <Num>{cash(r.avgDealSize)}</Num>
                        <Num>{unit(r.avgCycleDays, 'days')}</Num>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>

              <Card title="Proposal metrics" actions={exportButton('proposal-metrics', 'proposal metrics')}>
                <Table head={['Metric', 'Value', 'Detail']}>
                  {(
                    [
                      ['Proposals sent', String(d.proposals.sent), `${d.proposals.versionsSent} version(s) sent in the period`],
                      ['View rate', pct(d.proposals.viewRate), `${d.proposals.viewed} of ${d.proposals.sent} viewed by a buyer`],
                      ['Time to first view', unit(d.proposals.medianHoursToFirstView, 'h'), `Median · average ${unit(d.proposals.avgHoursToFirstView, 'h')}`],
                      ['Time to sign', unit(d.proposals.medianDaysToSign, 'days'), `Median · average ${unit(d.proposals.avgDaysToSign, 'days')}`],
                      ['Proposal win rate', pct(d.proposals.winRate), `${d.proposals.won} of ${d.proposals.sent} signed or accepted`],
                      [
                        'Opportunity creation to first proposal',
                        unit(d.proposals.medianDaysDealToFirstProposal, 'days'),
                        `Median · average ${unit(d.proposals.avgDaysDealToFirstProposal, 'days')} · ${d.proposals.dealsWithFirstProposal} opportunities`,
                      ],
                    ] as const
                  ).map(([k, v, detail]) => (
                    <tr key={k}>
                      <td>{k}</td>
                      <Num>{v}</Num>
                      <td className="text-muted">{detail}</td>
                    </tr>
                  ))}
                </Table>
              </Card>

              <Card title="Proposals first sent in the period" actions={exportButton('proposals', 'proposals')}>
                {d.proposals.list.length === 0 ? (
                  <EmptyState title="No proposals were first sent in this period" />
                ) : (
                  <Table head={['Proposal', 'Opportunity', 'Owner', 'Status', 'First sent', 'First viewed', 'To first view', 'To sign']}>
                    {d.proposals.list.map((p) => (
                      <tr key={p.proposalId}>
                        <td>
                          <Link to="/proposals/$id" params={{ id: p.proposalId }} className="text-brand hover:underline">
                            {p.title}
                          </Link>
                        </td>
                        <td>
                          <Link to="/deals/$id" params={{ id: p.dealId }} className="text-brand hover:underline">
                            {p.dealName}
                          </Link>
                        </td>
                        <td>{p.owner}</td>
                        <td>
                          <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                        </td>
                        <td>{dateTime(p.firstSentAt)}</td>
                        <td>{dateTime(p.firstViewAt)}</td>
                        <Num>{unit(p.hoursToFirstView, 'h')}</Num>
                        <Num>{unit(p.daysToSign, 'days')}</Num>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>

              <Card title="Activity per rep" actions={exportButton('activity', 'activity per rep')}>
                {d.activity.length === 0 ? (
                  <EmptyState title="No activity logged in this period" hint="Calls, meetings, notes and completed tasks are counted by their date." />
                ) : (
                  <Table head={['Rep', 'Calls', 'Meetings', 'Notes', 'Tasks completed']}>
                    {d.activity.map((r) => (
                      <tr key={r.userId}>
                        <td>{r.name}</td>
                        <Num>{r.calls}</Num>
                        <Num>{r.meetings}</Num>
                        <Num>{r.notes}</Num>
                        <Num>{r.tasksCompleted}</Num>
                      </tr>
                    ))}
                  </Table>
                )}
              </Card>

              <Card title="Opportunities needing attention" actions={exportButton('attention', 'opportunities needing attention')}>
                {d.attention.length === 0 ? (
                  <EmptyState
                    title="Nothing needs attention"
                    hint="Stalled opportunities, opportunities past their expected close date and unviewed proposals appear here."
                  />
                ) : (
                  <Table head={['Opportunity', 'Owner', 'Stage', 'Amount', 'Why', 'Days since activity', 'Last proposal']}>
                    {d.attention.map((a) => (
                      <tr key={a.dealId}>
                        <td>
                          <Link to="/deals/$id" params={{ id: a.dealId }} className="text-brand hover:underline">
                            {a.name}
                          </Link>
                        </td>
                        <td>{a.owner}</td>
                        <td>{a.stage}</td>
                        <Num>
                          {a.amount === null
                            ? '—'
                            : new Intl.NumberFormat('en-US', { style: 'currency', currency: a.currency, minimumFractionDigits: 2 }).format(Number(a.amount))}
                        </Num>
                        <td>
                          <span className="flex flex-wrap gap-1">
                            {a.reasons.map((r) => (
                              <Badge key={r} tone="warn">
                                {REASONS[r] ?? r}
                              </Badge>
                            ))}
                          </span>
                        </td>
                        <Num>{a.daysSinceActivity}</Num>
                        <td>{a.lastProposalStatus ? <Badge tone={statusTone(a.lastProposalStatus)}>{a.lastProposalStatus}</Badge> : '—'}</td>
                      </tr>
                    ))}
                  </Table>
                )}
                <p className="mt-2 text-xs text-muted">A current list of open opportunities — it does not depend on the selected dates.</p>
              </Card>

              <details className="rounded-lg border border-line bg-white p-4 text-sm">
                <summary className="cursor-pointer font-semibold text-ink">How metrics are calculated</summary>
                <ul className="mt-3 list-disc space-y-1 pl-5 text-muted">
                  <li>Periods are whole days in the organization time zone ({d.timeZone}), start and end dates included.</li>
                  <li>Won and lost opportunities are counted by the date they were closed. Win rate = won ÷ (won + lost), by count and by value.</li>
                  <li>
                    Open pipeline is the current open opportunities; weighted value = amount × stage probability. Opportunities without an amount add nothing.
                  </li>
                  <li>Average opportunity size = won value ÷ won deals. Average cycle = days from opportunity creation to close, won opportunities only.</li>
                  <li>Proposal figures cover proposals whose first version was sent in the period. A view counts once a buyer actually reads the proposal.</li>
                  <li>Time to sign runs from sending the signed version to the completed signature. Proposal win rate = signed or accepted ÷ sent.</li>
                  <li>Activity counts logged calls and meetings, notes written and tasks completed, by their own date.</li>
                  <li>
                    Needing attention = stalled, past the expected close date, or a sent proposal nobody has viewed within the follow-up time. Values are in{' '}
                    {d.currency}.
                  </li>
                </ul>
              </details>
            </div>
          )}
        </Query>
      )}
    </>
  );
}
