/**
 * Copilot role home card, shown above the dashboard KPIs: My Day (salesperson), My Team (sales manager) or
 * Company view (admin). The figures are deterministic; the one-line summary is an optional grounded AI line.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Bot } from 'lucide-react';
import type { ReactNode } from 'react';
import { dateTime, get, money } from '../lib/api.ts';

interface Row {
  id: string;
  label?: string;
  title?: string;
  name?: string;
  dealName?: string;
  due?: string;
  overdue?: boolean;
  assignee?: string;
  owner?: string;
  deals?: number;
  kind?: string;
}
type Home = { kind: 'my_day' | 'my_team' | 'company'; title: string; summary: string | null } & Record<string, any>;

function Stat({ label, value, to }: { label: string; value: ReactNode; to?: string }) {
  const body = (
    <>
      <p className="text-xs text-muted">{label}</p>
      <p className="text-base font-semibold text-ink">{value}</p>
    </>
  );
  return to ? (
    <Link to={to} className="rounded-lg border border-line px-3 py-2 hover:border-brand">
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line px-3 py-2">{body}</div>
  );
}
function List({ title, rows, render }: { title: string; rows: Row[]; render: (r: Row) => ReactNode }) {
  if (!rows?.length) return null;
  return (
    <div>
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.06em] text-muted">{title}</p>
      <ul className="space-y-1 text-sm">
        {rows.slice(0, 5).map((r) => (
          <li key={`${r.id}${r.kind ?? ''}`} className="flex items-center justify-between gap-2">
            {render(r)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CopilotHomeCard({ currency }: { currency?: string }) {
  const q = useQuery({ queryKey: ['copilot-home'], queryFn: () => get<Home>('/copilot/home?summary=1'), staleTime: 60_000, retry: false });
  if (!q.data) return null;
  const h = q.data;
  return (
    <section className="mb-4 rounded-lg border border-line bg-white p-4" data-testid="copilot-home">
      <div className="mb-3 flex items-center gap-2">
        <Bot className="size-4 text-brand" aria-hidden />
        <h2 className="text-sm font-semibold">{h.title}</h2>
        {h.summary && <p className="ml-2 truncate text-[13px] text-muted">{h.summary}</p>}
      </div>
      {h.kind === 'my_day' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Leads to accept" value={h.counts.leadsToAccept} to="/leads" />
            <Stat label="Tasks due" value={h.counts.tasksDue} to="/tasks" />
            <Stat label="Deals at risk" value={h.counts.dealsAtRisk} to="/deals" />
            <Stat label="Proposals viewed, no answer" value={h.counts.proposalsViewed} to="/proposals" />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <List
              title="Accept these leads"
              rows={h.leadsToAccept}
              render={(r) => (
                <>
                  <span>{r.label}</span>
                  <span className={r.overdue ? 'text-danger text-xs' : 'text-muted text-xs'}>due {dateTime(r.due)}</span>
                </>
              )}
            />
            <List
              title="Tasks due"
              rows={h.tasksDue}
              render={(r) => (
                <>
                  <span>{r.title}</span>
                  <span className={r.overdue ? 'text-danger text-xs' : 'text-muted text-xs'}>{dateTime(r.due)}</span>
                </>
              )}
            />
          </div>
        </div>
      )}
      {h.kind === 'my_team' && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Stat label="Leads waiting for a rep" value={h.counts.pending} />
            <Stat label="Escalated to you" value={h.counts.escalated} />
            <Stat label="Stalled deals" value={h.counts.stalledDeals} to="/deals" />
            <Stat label="Waiting for your OK" value={h.approvalsWaiting} to="/copilot/approvals" />
          </div>
          <p className="text-[13px] text-muted">
            Weighted forecast {money(h.forecast.weightedNow, currency)} (a week ago {money(h.forecast.weightedLastWeek, currency)})
          </p>
          <List
            title="Stalled deals by rep"
            rows={h.stalledByRep.map((r: Row & { ownerId: string }) => ({ ...r, id: r.ownerId }))}
            render={(r) => (
              <>
                <span>{r.owner}</span>
                <span className="text-xs text-muted">{r.deals}</span>
              </>
            )}
          />
        </div>
      )}
      {h.kind === 'company' && (
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Stat label="Open pipeline" value={money(h.pipeline.openValue, currency)} />
          <Stat label="Won this week" value={`${h.wonThisWeek.deals} · ${money(h.wonThisWeek.value, currency)}`} />
          <Stat
            label="Leads → opportunities → won (30 days)"
            value={`${h.throughput30Days.leads} → ${h.throughput30Days.opportunities} → ${h.throughput30Days.won}`}
          />
          <Stat
            label="Median time to accept"
            value={h.responseTimes30Days.medianMinutesToAccept === null ? '—' : `${h.responseTimes30Days.medianMinutesToAccept} min`}
          />
        </div>
      )}
    </section>
  );
}
