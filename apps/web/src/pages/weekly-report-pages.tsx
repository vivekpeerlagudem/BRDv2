/**
 * Weekly reports: the list of all reports the user may see, and the report page where a person reviews the
 * figures, edits the AI-drafted text, regenerates it, approves and downloads the PowerPoint.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from '@tanstack/react-router';
import { Presentation } from 'lucide-react';
import { useState } from 'react';
import { ApiError, dateTime, get, patch, post } from '../lib/api.ts';
import { Avatar, Badge, Button, Card, ConfirmButton, Dialog, EmptyState, PageHeader, Query, SearchInput, Table, Textarea, useAction } from '../lib/ui.tsx';
import { AiLabel } from './ai.tsx';
import { FAILURE, HEALTH, type RunSummary, STATUS_LABEL, STATUS_TONE } from './weekly-reports.tsx';

interface ListRow extends RunSummary {
  companyId: string;
  companyName: string;
  warningCount: number;
  updatedAt: string;
}
interface Statement {
  id: string;
  text: string;
  origin: 'ai' | 'fallback' | 'user';
  sources: { id: string; label: string; link: string | null }[];
}
interface Flag {
  code: string;
  statementId: string | null;
  message: string;
  level?: 'warning';
}
interface Detail extends ListRow {
  timeZone: string;
  approvedAt: string | null;
  approvedByName: string | null;
  metrics: { id: string; label: string; value: string | null; unit: 'count' | 'hours' | 'percent'; delta?: string | null; internal?: boolean }[];
  phases: { phase: string; items: number; estimateHours: string; doneHours: string; pct: string }[];
  narrative: { section: 'summary' | 'completed' | 'nextWeek' | 'risks'; label: string; statements: Statement[] }[];
  flags: Flag[];
  blockers: Flag[];
  warnings: Flag[];
  editable: boolean;
  allowedSources: { id: string; label: string }[];
  ai: { provider: string | null; model: string | null; simulated: boolean; promptVersion: string; status: string } | null;
  permissions: { canManage: boolean; canApprove: boolean };
}

const TABS: [status: string, label: string][] = [
  ['', 'All'],
  ['needs_attention', 'Needs attention'],
  ['ready', 'Ready'],
  ['approved', 'Approved'],
  ['failed', 'Failed'],
];
const HEALTH_REASON: Record<string, string> = {
  OVERDUE_TASKS: 'Some tasks on scope items are overdue',
  OVER_ESTIMATE: 'Completed work took more hours than estimated',
  NO_PROGRESS_TWO_WEEKS: 'No scope items were completed in the last two weeks',
  NO_ITEMS_DONE_THIS_WEEK: 'No scope items were completed this week',
};
const link = 'text-brand hover:underline';
const busy = (s: string) => s === 'queued' || s === 'running';

export function WeeklyReportsPage() {
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const list = useQuery({
    queryKey: ['weekly-reports-all', status, q],
    queryFn: () => get<{ items: ListRow[] }>(`/weekly-reports?${status ? `status=${status}&` : ''}${q ? `q=${encodeURIComponent(q)}` : ''}`),
    refetchInterval: (query) => (query.state.data?.items.some((r) => busy(r.status)) ? 3000 : 30_000),
  });
  return (
    <>
      <PageHeader
        title="Weekly reports"
        subtitle="AI-drafted client status reports, reviewed before sending"
        icon={<Presentation className="size-5 text-brand" aria-hidden />}
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Report status" className="flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface p-0.5">
          {TABS.map(([key, label]) => (
            <button
              key={key || 'all'}
              type="button"
              role="tab"
              aria-selected={status === key}
              onClick={() => setStatus(key)}
              className={`cursor-pointer rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors ${
                status === key ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <SearchInput
          aria-label="Search by client"
          placeholder="Search by client"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full max-w-xs"
        />
      </div>
      <Query q={list} rows={6}>
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState
              title={q || status ? 'No reports match' : 'No weekly reports yet'}
              hint={q || status ? 'Try another status or client.' : 'Open a company, upload its estimates CSV in “Weekly reports”, then click Generate now.'}
            />
          ) : (
            <Table head={['Client', 'Week', 'Status', 'Health', 'Flags', 'Updated']}>
              {d.items.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      to="/weekly-reports/$id"
                      params={{ id: r.id }}
                      className="inline-flex items-center gap-2 font-medium text-ink hover:text-brand hover:underline"
                    >
                      <Avatar name={r.companyName} shape="square" />
                      {r.companyName}
                    </Link>
                  </td>
                  <td>
                    {r.periodLabel}
                    {r.attempt > 1 && <span className="ml-1 text-xs text-muted">v{r.attempt}</span>}
                  </td>
                  <td>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  </td>
                  <td>{r.health ? <Badge tone={HEALTH[r.health.level].tone}>{HEALTH[r.health.level].label}</Badge> : '—'}</td>
                  <td className="text-muted">
                    {r.flagCount + r.warningCount === 0
                      ? '—'
                      : [r.flagCount ? `${r.flagCount} to fix` : '', r.warningCount ? `${r.warningCount} to check` : ''].filter(Boolean).join(' · ')}
                  </td>
                  <td className="text-muted">{dateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </Table>
          )
        }
      </Query>
    </>
  );
}

function Tile({ label, value, delta, unit }: { label: string; value: string; delta?: string | null | undefined; unit: string }) {
  const n = delta === null || delta === undefined ? null : Number(delta);
  return (
    <div className="rounded-lg border border-line bg-white p-3">
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</p>
      {n !== null && (
        <p className="text-xs text-muted">
          {n === 0 ? 'No change vs last week' : `${n > 0 ? '▲' : '▼'} ${String(delta).replace(/^-/, '')}${unit} vs last week`}
        </p>
      )}
    </div>
  );
}

export function WeeklyReportPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['weekly-report-page', id],
    queryFn: () => get<Detail>(`/weekly-reports/${id}`),
    refetchInterval: (query) => (query.state.data && busy(query.state.data.status) ? 3000 : false),
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['weekly-report-page', id] });
    void qc.invalidateQueries({ queryKey: ['weekly-reports-all'] });
    void qc.invalidateQueries({ queryKey: ['weekly-reports'] });
  };
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [adding, setAdding] = useState<{ section: string; text: string; sources: string[] } | null>(null);
  const [approving, setApproving] = useState(false);
  const [checked, setChecked] = useState(false);

  const save = useAction((body: Record<string, unknown>) => patch(`/weekly-reports/${id}/narrative`, body), {
    success: 'Report text saved',
    onDone: () => {
      setEditing(null);
      setAdding(null);
      refresh();
    },
  });
  const regenerate = useAction(() => post(`/weekly-reports/${id}/regenerate`), { success: 'Regenerating the report text', onDone: refresh });
  const approve = useAction((body: Record<string, unknown>) => post(`/weekly-reports/${id}/approve`, body), {
    success: 'Weekly report approved',
    onDone: () => {
      setApproving(false);
      refresh();
    },
  });

  return (
    <Query q={q}>
      {(r) => {
        const metric = (mid: string) => r.metrics.find((m) => m.id === mid);
        const value = (mid: string, suffix = '') => (metric(mid)?.value ?? '—') + (metric(mid)?.value ? suffix : '');
        const working = busy(r.status);
        const notices = r.flags.filter(
          (f) => !r.blockers.some((b) => b === f || (b.code === f.code && b.statementId === f.statementId)) && f.level !== 'warning',
        );
        return (
          <>
            <PageHeader
              icon={<Avatar name={r.companyName} shape="square" size="lg" />}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  <Link to="/companies/$id" params={{ id: r.companyId }} className="hover:text-brand hover:underline">
                    {r.companyName}
                  </Link>
                  <span className="font-normal text-muted">· {r.periodLabel}</span>
                </span>
              }
              subtitle={
                <span className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                  {r.health && <Badge tone={HEALTH[r.health.level].tone}>{HEALTH[r.health.level].label}</Badge>}
                  <span>
                    Version {r.attempt} · {r.trigger === 'schedule' ? 'weekly schedule' : 'generated by hand'}
                  </span>
                  {r.aiFallback ? <Badge tone="warn">AI fallback</Badge> : r.ai && <AiLabel simulated={r.ai.simulated} />}
                </span>
              }
              actions={
                <>
                  {r.hasDraft && r.status !== 'approved' && (
                    <a className={`text-[13px] font-medium ${link}`} href={`/api/v1/weekly-reports/${r.id}/pptx/draft`}>
                      Download draft
                    </a>
                  )}
                  {r.hasFinal && (
                    <a className={`text-[13px] font-medium ${link}`} href={`/api/v1/weekly-reports/${r.id}/pptx/final`}>
                      Download final
                    </a>
                  )}
                  {r.editable && (
                    <ConfirmButton
                      label="Regenerate"
                      variant="secondary"
                      disabled={regenerate.busy}
                      confirm="Regenerate the report text with AI? All current text, including your edits, is replaced. The figures stay the same."
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

            {working && (
              <p role="status" className="mb-4 rounded-md border border-line bg-surface px-3 py-2 text-sm text-muted">
                The report is being generated. This page refreshes by itself.
              </p>
            )}
            {r.status === 'failed' && (
              <p role="alert" className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                {FAILURE[r.failureReason ?? ''] ?? 'The report could not be generated.'}
              </p>
            )}
            {r.status === 'approved' && (
              <p className="mb-4 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
                Approved{r.approvedByName ? ` by ${r.approvedByName}` : ''} on {dateTime(r.approvedAt)}. Download the final PowerPoint and send it to the
                client.
              </p>
            )}

            {r.metrics.length > 0 && (
              <div className="space-y-4">
                {r.health && r.health.reasons.length > 0 && (
                  <p className="text-sm text-muted">Health: {r.health.reasons.map((x) => HEALTH_REASON[x] ?? x).join('. ')}.</p>
                )}
                <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <Tile label="Complete by estimate" value={value('E-05', '%')} delta={metric('E-05')?.delta} unit=" pts" />
                  <Tile label="Completed this week" value={value('E-06')} delta={metric('E-06')?.delta} unit="" />
                  <Tile label="Remaining hours" value={value('E-07', ' h')} unit="" />
                  <Tile label="In progress" value={value('E-08')} unit="" />
                  <Tile label="Items completed" value={value('E-03')} delta={metric('E-03')?.delta} unit="" />
                  <Tile label="Calls and meetings" value={value('A-01')} unit="" />
                </div>

                {(r.blockers.length > 0 || r.warnings.length > 0 || notices.length > 0) && (
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
                      {notices.map((f) => (
                        <li key={`n-${f.code}-${f.statementId ?? ''}`} className="flex gap-2">
                          <Badge>Note</Badge>
                          <span className="text-muted">{f.message} (internal, not shown to the client)</span>
                        </li>
                      ))}
                    </ul>
                  </Card>
                )}

                <div className="grid gap-4 xl:grid-cols-[1fr_22rem]">
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
                          {s.statements.map((st) => {
                            const flagged = r.flags.filter((f) => f.statementId === st.id);
                            return (
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
                                      {st.text} {st.origin === 'user' && <Badge>Edited</Badge>}
                                      {st.origin === 'fallback' && <Badge tone="warn">Placeholder</Badge>}
                                    </p>
                                    {st.sources.length > 0 && (
                                      <p className="mt-1 flex flex-wrap gap-1">
                                        {st.sources.map((src) =>
                                          src.link ? (
                                            <a key={src.id} href={src.link} className="rounded bg-surface px-1.5 py-0.5 text-xs text-brand hover:underline">
                                              {src.label}
                                            </a>
                                          ) : (
                                            <span key={src.id} className="rounded bg-surface px-1.5 py-0.5 text-xs text-muted">
                                              {src.label}
                                            </span>
                                          ),
                                        )}
                                      </p>
                                    )}
                                    {flagged.map((f) => (
                                      <p key={f.code} className={`mt-1 text-xs ${f.level === 'warning' ? 'text-amber-800' : 'text-danger'}`}>
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
                            );
                          })}
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
                              placeholder="Write a sentence for the client"
                              value={adding.text}
                              onChange={(e) => setAdding({ ...adding, text: e.target.value })}
                            />
                            <label className="block text-xs text-muted">
                              Based on (optional — hold Ctrl to choose several)
                              <select
                                multiple
                                size={5}
                                aria-label="Sources for the new sentence"
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
                    <Card title="Scope progress">
                      <table className="w-full text-left text-[13px]">
                        <thead className="text-xs text-muted">
                          <tr>
                            <th className="pb-1 font-medium">Phase</th>
                            <th className="pb-1 text-right font-medium">Items</th>
                            <th className="pb-1 text-right font-medium">Est. h</th>
                            <th className="pb-1 text-right font-medium">Done h</th>
                            <th className="pb-1 text-right font-medium">%</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {r.phases.map((p) => (
                            <tr key={p.phase}>
                              <td className="py-1.5">{p.phase}</td>
                              <td className="py-1.5 text-right tabular-nums">{p.items}</td>
                              <td className="py-1.5 text-right tabular-nums">{p.estimateHours}</td>
                              <td className="py-1.5 text-right tabular-nums">{p.doneHours}</td>
                              <td className="py-1.5 text-right tabular-nums">{p.pct}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Card>
                    <Card title="About this text">
                      <p className="text-[13px] text-muted">
                        {r.aiFallback
                          ? 'AI text could not be used for this report, so the sentences are placeholders for a person to write.'
                          : r.ai
                            ? `${r.ai.simulated ? 'Built-in simulator, not a real AI model' : `${r.ai.provider} · ${r.ai.model}`} · prompt ${r.ai.promptVersion}. Every number comes from the CRM and the estimates sheet, never from the AI.`
                            : 'Written by a person.'}
                      </p>
                    </Card>
                  </div>
                </div>
              </div>
            )}

            <Dialog open={approving} onClose={() => setApproving(false)} title="Approve weekly report">
              <div className="space-y-3">
                <p className="text-sm text-ink">
                  Approve the report for {r.companyName}, {r.periodLabel}? The final PowerPoint is created and can then be downloaded and sent. An approved
                  report can no longer be changed.
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
                    Approve report
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
