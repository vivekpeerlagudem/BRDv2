/**
 * Weekly reports card on the company page (Weekly Report Agents, part 1): upload the client's estimates sheet,
 * generate the weekly status report, read the AI text, approve it and download the PowerPoint.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, dateTime, get, post } from '../lib/api.ts';
import { useMe } from '../lib/me.ts';
import { Badge, Button, Card, ConfirmButton, Input, useAction } from '../lib/ui.tsx';
import { AiLabel } from './ai.tsx';

interface Estimates {
  import: { id: string; fileName: string; rowCount: number; importedAt: string; importedByName: string | null } | null;
  totals: { items: number; estimateHours: string };
}
interface RunSummary {
  id: string;
  periodLabel: string;
  attempt: number;
  trigger: 'schedule' | 'manual';
  status: 'queued' | 'running' | 'ready' | 'needs_attention' | 'approved' | 'failed';
  health: { level: 'green' | 'amber' | 'red'; reasons: string[] } | null;
  aiFallback: boolean;
  flagCount: number;
  noticeCount: number;
  hasDraft: boolean;
  hasFinal: boolean;
  approvable: boolean;
  failureReason: string | null;
  rowVersion: number;
}
interface RunDetail extends RunSummary {
  narrative: {
    section: string;
    label: string;
    statements: { id: string; text: string; origin: 'ai' | 'fallback'; sources: { id: string; label: string }[] }[];
  }[];
  flags: { code: string; statementId: string | null; message: string }[];
  blockers: { code: string; message: string }[];
  ai: { simulated: boolean; provider: string | null; model: string | null } | null;
}
interface RowError {
  row: number;
  column: string;
  message: string;
}

const STATUS_LABEL: Record<RunSummary['status'], string> = {
  queued: 'Queued',
  running: 'Generating…',
  ready: 'Ready for review',
  needs_attention: 'Needs attention',
  approved: 'Approved',
  failed: 'Failed',
};
const STATUS_TONE: Record<RunSummary['status'], 'neutral' | 'info' | 'ok' | 'warn' | 'danger'> = {
  queued: 'neutral',
  running: 'info',
  ready: 'info',
  needs_attention: 'warn',
  approved: 'ok',
  failed: 'danger',
};
const HEALTH: Record<'green' | 'amber' | 'red', { label: string; tone: 'ok' | 'warn' | 'danger' }> = {
  green: { label: 'On track', tone: 'ok' },
  amber: { label: 'Needs attention', tone: 'warn' },
  red: { label: 'At risk', tone: 'danger' },
};
const FAILURE: Record<string, string> = {
  RUN_AS_USER_INACTIVE: 'The company owner is not an active user',
  COMPANY_NOT_VISIBLE: 'The company owner can no longer see this company',
  NO_ESTIMATES: 'No estimates sheet was found',
  STUCK: 'The run took too long and was stopped',
};
const link = 'cursor-pointer text-[13px] font-medium text-brand hover:underline';

export function WeeklyReportsCard({ companyId, canEdit }: { companyId: string; canEdit: boolean }) {
  const me = useMe();
  const qc = useQueryClient();
  const canView = Boolean(me.data?.permissions['weekly_report.view']);
  const canManage = canEdit && Boolean(me.data?.permissions['weekly_report.manage']);
  const [rowErrors, setRowErrors] = useState<{ title: string; errors: RowError[]; more: number } | null>(null);
  const [open, setOpen] = useState(false);

  const estimates = useQuery({
    queryKey: ['weekly-estimates', companyId],
    queryFn: () => get<Estimates>(`/companies/${companyId}/estimates`),
    enabled: canView,
    retry: false,
  });
  const runs = useQuery({
    queryKey: ['weekly-reports', companyId],
    queryFn: () => get<{ items: RunSummary[] }>(`/weekly-reports?companyId=${companyId}`),
    enabled: canView && estimates.isSuccess,
    // While a report is being generated, check again every 3 seconds.
    refetchInterval: (q) => (q.state.data?.items.some((r) => r.status === 'queued' || r.status === 'running') ? 3000 : false),
  });
  const latest = runs.data?.items[0];
  const detail = useQuery({
    queryKey: ['weekly-report', latest?.id, latest?.status],
    queryFn: () => get<RunDetail>(`/weekly-reports/${latest?.id}`),
    enabled: Boolean(latest) && latest?.status !== 'queued' && latest?.status !== 'running' && latest?.status !== 'failed',
  });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['weekly-estimates', companyId] });
    void qc.invalidateQueries({ queryKey: ['weekly-reports', companyId] });
    void qc.invalidateQueries({ queryKey: ['timeline'] });
  };

  const upload = useAction((v: { fileName: string; text: string }) => post<{ items: number; estimateHours: string }>(`/companies/${companyId}/estimates`, v), {
    success: 'Estimates sheet imported',
    onDone: () => {
      setRowErrors(null);
      refresh();
    },
  });
  const generate = useAction(() => post(`/companies/${companyId}/weekly-reports`), { success: 'Weekly report queued', onDone: refresh });
  const approve = useAction((r: RunSummary) => post(`/weekly-reports/${r.id}/approve`, { rowVersion: r.rowVersion }), {
    success: 'Weekly report approved',
    onDone: refresh,
  });

  // Hidden for people who may not see this company's reports (for example a view-only company).
  if (!canView || estimates.isError) return null;

  const onUpload = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const file = new FormData(form).get('file');
    if (!(file instanceof File) || file.size === 0) return;
    setRowErrors(null);
    try {
      await upload.runAsync({ fileName: file.name, text: await file.text() });
      form.reset();
    } catch (error) {
      if (error instanceof ApiError && error.code === 'ESTIMATES_INVALID') {
        const errors = (error.meta.errors as RowError[] | undefined) ?? [];
        setRowErrors({ title: error.message, errors, more: Math.max(0, Number(error.meta.errorCount ?? errors.length) - errors.length) });
      } else if (error instanceof ApiError) setRowErrors({ title: error.message, errors: [], more: 0 });
    }
  };

  const imp = estimates.data?.import;
  const busy = runs.data?.items.some((r) => r.status === 'queued' || r.status === 'running') ?? false;
  return (
    <Card
      title="Weekly reports"
      actions={
        canManage ? (
          <span className="flex items-center gap-2">
            {!imp && <span className="text-xs text-muted">Upload the estimates sheet first</span>}
            <Button disabled={!imp || busy || generate.busy} onClick={() => generate.run(undefined)}>
              Generate now
            </Button>
          </span>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {/* Estimates sheet */}
        <section aria-label="Estimates sheet" className="space-y-2">
          <h3 className="text-[13px] font-medium text-ink">Estimates sheet</h3>
          {imp ? (
            <p className="text-sm text-muted">
              <span className="font-medium text-ink">{imp.fileName}</span> · {estimates.data?.totals.items} scope items · {estimates.data?.totals.estimateHours}{' '}
              h · imported {dateTime(imp.importedAt)}
              {imp.importedByName ? ` by ${imp.importedByName}` : ''}
            </p>
          ) : (
            <p className="text-sm text-muted">No estimates sheet yet. Upload the client’s scope and estimated hours as a CSV file.</p>
          )}
          {canManage && (
            <form className="flex flex-wrap items-center gap-2" onSubmit={onUpload}>
              <Input type="file" name="file" accept=".csv,text/csv" required aria-label="Estimates CSV file" className="max-w-xs" />
              <Button type="submit" variant="secondary" disabled={upload.busy}>
                Upload estimates CSV
              </Button>
              <span className="text-xs text-muted">Columns: Task and Estimate hours (required), Scope ID, Phase, Status, % Done, Actual hours</span>
            </form>
          )}
          {rowErrors && (
            <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
              <p className="font-medium">{rowErrors.title}</p>
              {rowErrors.errors.length > 0 && (
                <ul className="mt-1 list-inside list-disc">
                  {rowErrors.errors.map((x) => (
                    <li key={`${x.row}-${x.column}`}>
                      Row {x.row}, {x.column}: {x.message}
                    </li>
                  ))}
                </ul>
              )}
              {rowErrors.more > 0 && <p className="mt-1">…and {rowErrors.more} more.</p>}
            </div>
          )}
        </section>

        {/* Latest runs */}
        <section aria-label="Weekly report runs" className="space-y-2">
          <h3 className="text-[13px] font-medium text-ink">Latest reports</h3>
          {!runs.data?.items.length ? (
            <p className="text-sm text-muted">No reports yet. They are generated every Monday morning, or use “Generate now”.</p>
          ) : (
            <ul className="-my-2 divide-y divide-line text-sm">
              {runs.data.items.slice(0, 5).map((r) => {
                const why = !r.approvable
                  ? r.aiFallback
                    ? 'The text is still a placeholder'
                    : r.flagCount
                      ? 'Open points must be fixed first'
                      : 'Not ready to approve'
                  : undefined;
                return (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 py-2.5">
                    <span className="min-w-36 font-medium text-ink">
                      {r.periodLabel}
                      {r.attempt > 1 && <span className="ml-1 text-xs font-normal text-muted">v{r.attempt}</span>}
                    </span>
                    <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    {r.health && <Badge tone={HEALTH[r.health.level].tone}>{HEALTH[r.health.level].label}</Badge>}
                    {r.aiFallback && <Badge tone="warn">AI fallback</Badge>}
                    {r.flagCount > 0 && (
                      <span className="text-xs text-muted">
                        {r.flagCount} {r.flagCount === 1 ? 'open point' : 'open points'}
                      </span>
                    )}
                    {r.status === 'failed' && (
                      <span className="text-xs text-danger">{FAILURE[r.failureReason ?? ''] ?? 'The report could not be generated'}</span>
                    )}
                    <span className="ml-auto flex flex-wrap items-center gap-3">
                      {r.hasDraft && r.status !== 'approved' && (
                        <a className={link} href={`/api/v1/weekly-reports/${r.id}/pptx/draft`}>
                          Download draft
                        </a>
                      )}
                      {r.hasFinal && (
                        <a className={link} href={`/api/v1/weekly-reports/${r.id}/pptx/final`}>
                          Download final
                        </a>
                      )}
                      {canManage && (r.status === 'ready' || r.status === 'needs_attention') && (
                        <span title={why}>
                          <ConfirmButton
                            label="Approve"
                            variant="secondary"
                            disabled={!r.approvable || approve.busy}
                            confirm={`Approve the weekly report for ${r.periodLabel}? The final PowerPoint is created and can then be downloaded and sent.`}
                            onConfirm={() => approve.run(r)}
                          />
                        </span>
                      )}
                      {why && (r.status === 'ready' || r.status === 'needs_attention') && <span className="text-xs text-muted">{why}</span>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Narrative of the latest report (read-only in part 1) */}
        {detail.data && detail.data.narrative.length > 0 && (
          <section aria-label="Report text" className="space-y-2">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
              className="flex cursor-pointer items-center gap-2 text-[13px] font-medium text-ink"
            >
              <span aria-hidden>{open ? '▾' : '▸'}</span>
              Report text · {detail.data.periodLabel}
              {detail.data.aiFallback ? <Badge tone="warn">Placeholders</Badge> : <AiLabel simulated={detail.data.ai?.simulated} />}
            </button>
            {open && (
              <div className="space-y-3 rounded-md border border-line bg-surface/60 p-3">
                {detail.data.flags.length > 0 && (
                  <ul className="list-inside list-disc text-[13px] text-amber-900">
                    {detail.data.flags.map((f) => (
                      <li key={`${f.code}-${f.statementId ?? ''}`}>{f.message}</li>
                    ))}
                  </ul>
                )}
                {detail.data.narrative.map((s) => (
                  <div key={s.section}>
                    <p className="text-xs font-medium text-muted">{s.label}</p>
                    {s.statements.length === 0 ? (
                      <p className="text-sm text-muted">—</p>
                    ) : (
                      <ul className="mt-1 space-y-1.5 text-sm">
                        {s.statements.map((st) => (
                          <li key={st.id}>
                            <span className={st.origin === 'fallback' ? 'text-amber-900' : 'text-ink'}>{st.text}</span>
                            {st.sources.length > 0 && <span className="block text-xs text-muted">Based on: {st.sources.map((x) => x.label).join(' · ')}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </div>
    </Card>
  );
}
