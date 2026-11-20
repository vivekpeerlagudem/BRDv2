/**
 * Phase 2 — Papermark-style document sharing & analytics, built on the existing tracking tables
 * (share_link, view_session incl. per-section seconds, viewer_identity, download_event). No new tracking is added.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Clock, Download, Eye, FileText, Forward, Send, Users } from 'lucide-react';
import { useState } from 'react';
import { dateOnly, dateTime, get, money } from '../lib/api.ts';
import { Avatar, Badge, Card, EmptyState, PageHeader, PersonChip, Query, recordLink, SearchInput, statusTone } from '../lib/ui.tsx';
import { type Column, SortableTable } from './crm.tsx';

// ───────────── shared helpers ─────────────
/** "4 min", "1 h 12 min", "35 s". */
export function duration(seconds: number) {
  if (!seconds) return '0 s';
  if (seconds < 60) return `${seconds} s`;
  const m = Math.round(seconds / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}
/** Compact relative time for "last viewed" columns. */
export function ago(iso: string | null | undefined) {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 30 * 86_400) return `${Math.floor(s / 86_400)} d ago`;
  return dateOnly(iso);
}
function Stat({ icon: Icon, label, value, hint }: { icon: typeof Eye; label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-line bg-white px-3.5 py-3">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted">
        <Icon className="size-3.5" aria-hidden />
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</p>
      {hint && <p className="text-xs font-medium text-muted">{hint}</p>}
    </div>
  );
}

// ───────────── documents dashboard ─────────────
interface ProposalRow {
  id: string;
  title: string;
  status: string;
  validUntil: string | null;
  updatedAt: string;
  currency: string;
  dealId: string;
  dealName: string;
  companyId: string;
  companyName: string;
  ownerName: string;
  value: string | null;
  sentAt: string | null;
  views: number;
  viewers: number;
  seconds: number;
  downloads: number;
  lastViewedAt: string | null;
}
const STATUS_TABS: [string, string][] = [
  ['', 'All'],
  ['draft', 'Draft'],
  ['sent', 'Sent'],
  ['viewed', 'Viewed'],
  ['accepted', 'Accepted'],
  ['signed', 'Signed'],
  ['declined', 'Declined'],
];

const proposalColumns: Column<ProposalRow>[] = [
  {
    key: 'title',
    label: 'Proposal',
    sortValue: (p) => p.title,
    render: (p) => (
      <Link to="/proposals/$id" params={{ id: p.id }} className={recordLink}>
        <FileText className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="truncate">{p.title}</span>
      </Link>
    ),
  },
  {
    key: 'company',
    label: 'Company · opportunity',
    sortValue: (p) => p.companyName,
    render: (p) => (
      <span className="flex min-w-0 items-center gap-2">
        <Avatar name={p.companyName} shape="square" />
        <span className="min-w-0">
          <span className="block truncate text-ink">{p.companyName}</span>
          <Link to="/deals/$id" params={{ id: p.dealId }} className="block truncate text-xs text-muted hover:text-brand">
            {p.dealName}
          </Link>
        </span>
      </span>
    ),
  },
  { key: 'status', label: 'Status', sortValue: (p) => p.status, render: (p) => <Badge tone={statusTone(p.status)}>{p.status}</Badge> },
  {
    key: 'value',
    label: 'Value',
    sortValue: (p) => (p.value === null ? null : Number(p.value)),
    render: (p) => <span className="tabular-nums">{p.value === null ? '—' : money(p.value, p.currency)}</span>,
  },
  { key: 'views', label: 'Views', sortValue: (p) => p.views, render: (p) => <span className="tabular-nums">{p.views || '—'}</span> },
  { key: 'viewers', label: 'Viewers', sortValue: (p) => p.viewers, render: (p) => <span className="tabular-nums">{p.viewers || '—'}</span> },
  {
    key: 'time',
    label: 'Reading time',
    sortValue: (p) => p.seconds,
    render: (p) => <span className="tabular-nums">{p.seconds ? duration(p.seconds) : '—'}</span>,
  },
  {
    key: 'lastViewed',
    label: 'Last viewed',
    sortValue: (p) => p.lastViewedAt,
    render: (p) => (p.lastViewedAt ? <span title={dateTime(p.lastViewedAt)}>{ago(p.lastViewedAt)}</span> : <span className="text-faint">Not opened</span>),
  },
  { key: 'owner', label: 'Owner', sortValue: (p) => p.ownerName, render: (p) => <PersonChip name={p.ownerName} /> },
];

export function ProposalsPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['proposals-all', status, q],
    queryFn: () =>
      get<{ items: ProposalRow[]; total: number }>(`/proposals?limit=100${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
    refetchInterval: 30_000,
  });
  // KPIs reflect the unfiltered set so the tabs never change the headline numbers.
  const all = useQuery({ queryKey: ['proposals-all', '', ''], queryFn: () => get<{ items: ProposalRow[]; total: number }>('/proposals?limit=100') });
  const items = all.data?.items ?? [];
  const shared = items.filter((p) => p.sentAt);
  const opened = shared.filter((p) => p.views > 0);
  const won = items.filter((p) => ['accepted', 'signed'].includes(p.status));
  return (
    <>
      <PageHeader title="Proposals" subtitle="Every proposal you can see, with how buyers engaged with it" />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={FileText} label="Proposals" value={String(all.data?.total ?? '—')} hint={`${items.filter((p) => p.status === 'draft').length} in draft`} />
        <Stat icon={Send} label="Shared" value={String(shared.length)} hint="sent to at least one buyer" />
        <Stat
          icon={Eye}
          label="Open rate"
          value={shared.length ? `${Math.round((opened.length / shared.length) * 100)}%` : '—'}
          hint={`${opened.length} of ${shared.length} opened`}
        />
        <Stat icon={Clock} label="Reading time" value={duration(items.reduce((t, p) => t + p.seconds, 0))} hint={`${won.length} accepted or signed`} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div role="tablist" aria-label="Filter by status" className="flex flex-wrap gap-1 rounded-lg border border-line bg-surface p-0.5">
          {STATUS_TABS.map(([v, l]) => (
            <button
              key={v || 'all'}
              type="button"
              role="tab"
              aria-selected={status === v}
              onClick={() => setStatus(v)}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors ${
                status === v ? 'bg-white text-ink shadow-xs ring-1 ring-line' : 'text-muted hover:text-ink'
              }`}
            >
              {l}
            </button>
          ))}
        </div>
        <SearchInput
          className="w-full max-w-xs"
          placeholder="Search proposal, opportunity or company"
          aria-label="Search proposals"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
      </div>
      <Query q={list} rows={6}>
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState
              title={status || q ? 'No proposals match' : 'No proposals yet'}
              hint="Create a proposal from an opportunity — it is generated from a published template and shared through tracked links."
            />
          ) : (
            <SortableTable label="Proposals" columns={proposalColumns} rows={d.items} rowKey={(p) => p.id} total={d.total} />
          )
        }
      </Query>
    </>
  );
}

// ───────────── per-proposal analytics panel ─────────────
interface LinkView {
  shareLinkId: string;
  viewerName: string;
  viewerEmail: string;
  forwarded: boolean;
  startedAt: string;
  activeSeconds: number;
  isReopen: boolean;
  sectionSeconds: Record<string, number>;
}
interface LinkData {
  id: string;
  recipientName: string;
  views: LinkView[];
  downloads: { occurredAt: string; format: string }[];
}

/** Engagement for one proposal: KPIs, time per section and a visitor list (Papermark-style), from GET /proposals/:id/links. */
export function ProposalAnalytics({ links, sections }: { links: LinkData[]; sections: { id: string; title?: string }[] }) {
  const views = links.flatMap((l) => l.views.map((v) => ({ ...v, recipient: l.recipientName })));
  if (views.length === 0) return null;
  const seconds = views.reduce((t, v) => t + v.activeSeconds, 0);
  const downloads = links.reduce((t, l) => t + l.downloads.length, 0);

  // Visitors: one row per viewer email.
  const byViewer = new Map<string, { name: string; email: string; forwarded: boolean; views: number; seconds: number; last: string }>();
  for (const v of views) {
    const cur = byViewer.get(v.viewerEmail) ?? { name: v.viewerName, email: v.viewerEmail, forwarded: v.forwarded, views: 0, seconds: 0, last: v.startedAt };
    cur.views += 1;
    cur.seconds += v.activeSeconds;
    if (v.startedAt > cur.last) cur.last = v.startedAt;
    byViewer.set(v.viewerEmail, cur);
  }
  const visitors = [...byViewer.values()].sort((a, b) => b.last.localeCompare(a.last));

  // Time per section, in document order.
  const perSection = new Map<string, number>();
  for (const v of views) for (const [sid, s] of Object.entries(v.sectionSeconds ?? {})) perSection.set(sid, (perSection.get(sid) ?? 0) + s);
  const sectionRows = sections
    .map((s) => ({ id: s.id, title: s.title || s.id, seconds: perSection.get(s.id) ?? 0 }))
    .filter((r) => r.seconds > 0 || perSection.size > 0);
  const maxSection = Math.max(1, ...sectionRows.map((r) => r.seconds));
  const readSections = sectionRows.filter((r) => r.seconds > 0).length;

  return (
    <Card title="Engagement analytics">
      <div className="grid grid-cols-2 gap-2">
        <Stat icon={Eye} label="Views" value={String(views.length)} hint={`${views.filter((v) => v.isReopen).length} return visits`} />
        <Stat icon={Users} label="Viewers" value={String(visitors.length)} hint={`${visitors.filter((v) => v.forwarded).length} forwarded`} />
        <Stat icon={Clock} label="Reading time" value={duration(seconds)} hint={`${duration(Math.round(seconds / views.length))} per view`} />
        <Stat
          icon={Download}
          label="Downloads"
          value={String(downloads)}
          hint={sectionRows.length ? `${readSections}/${sectionRows.length} sections read` : undefined}
        />
      </div>

      {perSection.size > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Time per section</p>
          <ul className="space-y-1.5" aria-label="Time per section">
            {sectionRows.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 text-[13px]">
                <span className="truncate text-ink">{r.title}</span>
                <span className="tabular-nums text-xs text-muted">{duration(r.seconds)}</span>
                <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-surface">
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.round((r.seconds / maxSection) * 100)}%` }} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Visitors</p>
        <ul className="-my-1.5 divide-y divide-line" aria-label="Visitors">
          {visitors.map((v) => (
            <li key={v.email} className="flex items-center gap-2.5 py-2">
              <Avatar name={v.name} size="md" />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-[13px] font-medium text-ink">
                  {v.name}
                  {v.forwarded && (
                    <Badge tone="info">
                      <Forward className="mr-0.5 size-3" aria-hidden />
                      Forwarded
                    </Badge>
                  )}
                </p>
                <p className="truncate text-xs text-muted">{v.email}</p>
              </div>
              <div className="shrink-0 text-right text-xs tabular-nums text-muted">
                <p>
                  {v.views} view{v.views === 1 ? '' : 's'} · {duration(v.seconds)}
                </p>
                <p title={dateTime(v.last)}>{ago(v.last)}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
