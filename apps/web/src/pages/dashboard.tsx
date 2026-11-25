import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { get, money } from '../lib/api.ts';
import { useMe } from '../lib/me.ts';
import { Badge, Card, EmptyState, PageHeader, Query, Table } from '../lib/ui.tsx';
import { LatestSalesBriefCard } from './sales-brief-pages.tsx';

interface Dashboard {
  scope: string;
  periodDays: number;
  kpis: { openPipelineValue: string; weightedForecast: string; wonRevenue: string; winRate: number | null; dealsWon: number; dealsLost: number };
  pipeline: { stageId: string; stage: string; count: number; value: string; weighted: string }[];
  lostReasons: { reason: string; count: number }[];
  reps: {
    userId: string;
    name: string;
    openDeals: number;
    won: number;
    lost: number;
    wonRevenue: string;
    winRate: number | null;
    avgCycleDays: number | null;
  }[];
  proposals: { sent: number; viewRate: number | null; winRate: number | null; hoursToFirstView: number | null };
  attention: { dealId: string; name: string; reason: string }[];
  activity: { tasksCompleted: number; callsAndMeetingsLogged: number };
}
const pct = (v: number | null) => (v === null ? '—' : `${v}%`);
const REASON: Record<string, string> = {
  stalled: 'No recent activity',
  past_close_date: 'Past close date',
  unviewed_proposal: 'Proposal not viewed',
  signed_on_stale_version: 'Signed on old version',
};

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-ink">{value}</p>
      {hint && <p className="text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function DashboardPage() {
  const me = useMe();
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => get<Dashboard>('/reports/dashboard?days=90') });
  const cur = me.data?.settings.currency;
  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle={
          q.data
            ? `${q.data.scope === 'organization' ? 'Whole organization' : q.data.scope === 'team' ? 'Your team' : 'Your own performance'} · last ${q.data.periodDays} days`
            : undefined
        }
      />
      <LatestSalesBriefCard />
      <Query q={q} rows={6}>
        {(d) => {
          const max = Math.max(1, ...d.pipeline.map((p) => Number(p.value)));
          return (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Kpi label="Open pipeline" value={money(d.kpis.openPipelineValue, cur)} />
                <Kpi label="Weighted forecast" value={money(d.kpis.weightedForecast, cur)} hint="Value × stage probability" />
                <Kpi label="Won revenue" value={money(d.kpis.wonRevenue, cur)} hint={`${d.kpis.dealsWon} won · ${d.kpis.dealsLost} lost`} />
                <Kpi label="Win rate" value={pct(d.kpis.winRate)} hint="Won ÷ (won + lost)" />
              </div>
              <div className="grid gap-4 lg:grid-cols-3">
                <Card title="Pipeline by stage" className="lg:col-span-2">
                  <ul className="space-y-2">
                    {d.pipeline.map((p) => (
                      <li key={p.stageId} className="grid grid-cols-[9rem_1fr_7rem] items-center gap-3 text-sm">
                        <span className="truncate">{p.stage}</span>
                        <span className="h-3 rounded bg-surface" role="img" aria-label={`${p.stage}: ${money(p.value, cur)}`}>
                          <span className="block h-3 rounded bg-brand" style={{ width: `${(Number(p.value) / max) * 100}%` }} />
                        </span>
                        <span className="text-right tabular-nums text-muted">
                          {money(p.value, cur)} · {p.count}
                        </span>
                      </li>
                    ))}
                  </ul>
                </Card>
                <Card title="Proposals">
                  <dl className="space-y-2 text-sm">
                    {[
                      ['Sent', String(d.proposals.sent)],
                      ['View rate', pct(d.proposals.viewRate)],
                      ['Win rate', pct(d.proposals.winRate)],
                      ['Avg. time to first view', d.proposals.hoursToFirstView === null ? '—' : `${d.proposals.hoursToFirstView} h`],
                      ['Tasks completed', String(d.activity.tasksCompleted)],
                      ['Calls & meetings logged', String(d.activity.callsAndMeetingsLogged)],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <dt className="text-muted">{k}</dt>
                        <dd className="font-medium tabular-nums">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </Card>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <Card title="Opportunities needing attention">
                  {d.attention.length === 0 ? (
                    <EmptyState title="Nothing needs attention" hint="Stalled, overdue and unviewed-proposal opportunities appear here." />
                  ) : (
                    <ul className="divide-y divide-line text-sm">
                      {d.attention.map((a) => (
                        <li key={a.dealId + a.reason} className="flex items-center justify-between py-2">
                          <Link to="/deals/$id" params={{ id: a.dealId }} className="text-brand hover:underline">
                            {a.name}
                          </Link>
                          <Badge tone="warn">{REASON[a.reason] ?? a.reason}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="Performance by salesperson">
                  <Table head={['Name', 'Open', 'Won', 'Win rate', 'Won revenue', 'Avg. cycle']}>
                    {d.reps.map((r) => (
                      <tr key={r.userId}>
                        <td>{r.name}</td>
                        <td className="tabular-nums">{r.openDeals}</td>
                        <td className="tabular-nums">{r.won}</td>
                        <td className="tabular-nums">{pct(r.winRate)}</td>
                        <td className="tabular-nums">{money(r.wonRevenue, cur)}</td>
                        <td className="tabular-nums">{r.avgCycleDays === null ? '—' : `${r.avgCycleDays} d`}</td>
                      </tr>
                    ))}
                  </Table>
                </Card>
              </div>
            </div>
          );
        }}
      </Query>
    </>
  );
}
