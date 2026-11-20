/**
 * Data import (BR-MIG-001/003/004/005) — Admin only. CSV files only, one record type per file.
 * Step by step: Upload → Map columns → Review (validation and duplicates; nothing is saved yet) → Result,
 * plus the history of imports with Undo. Every number on this page comes from the API.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { api, dateTime, get, post, put } from '../lib/api.ts';
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Query,
  Select,
  Skeleton,
  Table,
  useAction,
} from '../lib/ui.tsx';

const del = <T,>(path: string) => api<T>('DELETE', `/api/v1${path}`);

type Entity = 'companies' | 'contacts' | 'deals';
type BatchStatus = 'uploaded' | 'validated' | 'committed' | 'failed' | 'partially_undone' | 'undone';
type RowStatus = 'pending' | 'valid' | 'invalid' | 'duplicate';
interface Counts {
  total?: number;
  valid?: number;
  invalid?: number;
  duplicate?: number;
  duplicateCreatable?: number;
  warnings?: number;
  created?: number;
  skipped?: number;
}
interface FieldDef {
  key: string;
  label: string;
  required: boolean;
  hint: string | null;
}
interface UndoItem {
  recordType: 'company' | 'contact' | 'deal';
  recordId: string;
  label: string;
  outcome: 'removed' | 'kept_modified' | 'kept_referenced' | 'already_gone';
  detail: string | null;
}
interface BatchSummary {
  id: string;
  entityType: Entity;
  fileName: string;
  rowCount: number;
  status: BatchStatus;
  counts: Counts;
  failureReason: string | null;
  createdAt: string;
  committedAt: string | null;
  undoneAt: string | null;
  createdByName?: string | null;
}
interface Batch extends BatchSummary {
  headers: string[];
  mapping: (string | null)[] | null;
  suggestedMapping: (string | null)[];
  fields: FieldDef[];
  duplicateStrategy: 'skip' | 'create' | null;
  undoReport: { removed: number; kept: number; items: UndoItem[] } | null;
  sampleRows?: string[][];
  limits: { maxFileBytes: number; maxRows: number; maxColumns: number };
}
interface CellError {
  field: string | null;
  column: string | null;
  message: string;
}
interface ImportRow {
  id: string;
  rowNumber: number;
  status: RowStatus;
  outcome: 'pending' | 'created' | 'skipped';
  rawData: string[];
  errors: CellError[];
  warnings: CellError[];
  duplicate: { kind: 'existing' | 'in_file'; matchedOn: string; existingLabel?: string; firstRowNumber?: number; canCreate: boolean } | null;
}
interface UndoPreview {
  willRemove: number;
  willKeep: number;
  alreadyGone: number;
  items: UndoItem[];
}

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const ENTITY: Record<Entity, { label: string; one: string; many: string }> = {
  companies: { label: 'Companies', one: 'company', many: 'companies' },
  contacts: { label: 'People', one: 'person', many: 'people' },
  deals: { label: 'Opportunities', one: 'opportunity', many: 'opportunities' },
};
const STATUS: Record<BatchStatus, { label: string; tone: 'neutral' | 'info' | 'ok' | 'warn' | 'danger' }> = {
  uploaded: { label: 'Uploaded — not imported', tone: 'neutral' },
  validated: { label: 'Checked — not imported', tone: 'info' },
  committed: { label: 'Imported', tone: 'ok' },
  failed: { label: 'Failed — nothing imported', tone: 'danger' },
  partially_undone: { label: 'Partly undone', tone: 'warn' },
  undone: { label: 'Undone', tone: 'neutral' },
};
const n = (count: number | undefined, one: string, many = `${one}s`) => `${count ?? 0} ${count === 1 ? one : many}`;
const records = (count: number | undefined, entity: Entity) => n(count, ENTITY[entity].one, ENTITY[entity].many);

export function ImportPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="Import data"
        subtitle="Bring companies, people or opportunities in from a CSV file. Nothing is saved until you have reviewed the check results and confirmed. An import can be undone."
        actions={
          openId ? (
            <Button variant="secondary" onClick={() => setOpenId(null)}>
              Back to all imports
            </Button>
          ) : undefined
        }
      />
      {openId ? (
        <ImportFlow id={openId} onClose={() => setOpenId(null)} />
      ) : (
        <div className="space-y-4">
          <UploadCard onUploaded={setOpenId} />
          <History onOpen={setOpenId} />
        </div>
      )}
    </>
  );
}

// ───────────────────────── stepper ─────────────────────────
const STEPS = ['Upload', 'Map columns', 'Review', 'Result'] as const;
function Stepper({ current }: { current: number }) {
  return (
    <ol aria-label="Import steps" className="mb-4 flex flex-wrap gap-2 text-sm">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === current ? 'step' : undefined}
          className={`flex items-center gap-2 rounded-full border px-3 py-1 ${
            i === current
              ? 'border-brand bg-brand-soft font-medium text-brand'
              : i < current
                ? 'border-line bg-white text-ink'
                : 'border-line bg-surface text-muted'
          }`}
        >
          <span aria-hidden="true">{i < current ? '✓' : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  );
}

// ───────────────────────── step 1: upload ─────────────────────────
function UploadCard({ onUploaded }: { onUploaded: (id: string) => void }) {
  const qc = useQueryClient();
  const [problem, setProblem] = useState<string | null>(null);
  const upload = useAction((input: { entityType: string; fileName: string; text: string }) => post<Batch>('/imports', input), {
    success: 'File uploaded. Nothing has been imported yet.',
    onDone: (b) => {
      void qc.invalidateQueries({ queryKey: ['imports'] });
      onUploaded(b.id);
    },
  });
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    const file = data.get('file');
    setProblem(null);
    if (!(file instanceof File) || file.size === 0) return setProblem('Choose a CSV file.');
    if (!/\.csv$/i.test(file.name)) return setProblem('Only .csv files can be imported. Save an Excel sheet as CSV first.');
    if (file.size > MAX_FILE_BYTES) return setProblem('The file is larger than 2 MB. Split it into smaller files.');
    upload.run({ entityType: String(data.get('entityType')), fileName: file.name, text: await file.text() });
  }
  const serverProblem = upload.fieldError('fileName') ?? upload.fieldError('text') ?? upload.fieldError('entityType');
  return (
    <Card title="Start a new import">
      <Stepper current={0} />
      <form onSubmit={(e) => void submit(e)} className="grid max-w-2xl gap-3 sm:grid-cols-2">
        <Field label="What does the file contain?">
          <Select name="entityType" defaultValue="companies">
            <option value="companies">Companies</option>
            <option value="contacts">People</option>
            <option value="deals">Opportunities</option>
          </Select>
        </Field>
        <Field label="CSV file" error={problem ?? serverProblem} hint="CSV only (UTF-8), first row is the header. Up to 2 MB and 2,000 rows per file.">
          <Input type="file" name="file" accept=".csv,text/csv" required />
        </Field>
        <div className="sm:col-span-2">
          <p className="mb-3 text-xs text-muted">
            Import companies first: people and opportunities refer to a company by its name or domain, and the company must already exist. Excel files and
            direct imports from other CRMs are not supported yet.
          </p>
          <Button type="submit" disabled={upload.busy}>
            {upload.busy ? 'Uploading…' : 'Upload and continue'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ───────────────────────── flow for one import ─────────────────────────
function ImportFlow({ id, onClose }: { id: string; onClose: () => void }) {
  const q = useQuery({ queryKey: ['import', id], queryFn: () => get<Batch>(`/imports/${id}`) });
  const [remap, setRemap] = useState(false);
  return (
    <Query q={q}>
      {(batch) => {
        const done = batch.status === 'committed' || batch.status === 'undone' || batch.status === 'partially_undone';
        const mappingStep = !done && (remap || batch.status === 'uploaded' || !batch.mapping);
        const step = done ? 3 : mappingStep ? 1 : 2;
        return (
          <div className="space-y-4">
            <Card>
              <Stepper current={step} />
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                <span className="font-medium text-ink">{batch.fileName}</span>
                <span className="text-muted">
                  {ENTITY[batch.entityType].label} · {n(batch.rowCount, 'row')}
                </span>
                <Badge tone={STATUS[batch.status].tone}>{STATUS[batch.status].label}</Badge>
              </div>
            </Card>
            {step === 1 && <MappingStep batch={batch} onDone={() => setRemap(false)} />}
            {step === 2 && <ReviewStep batch={batch} onRemap={() => setRemap(true)} onDiscarded={onClose} />}
            {step === 3 && <ResultStep batch={batch} />}
          </div>
        );
      }}
    </Query>
  );
}

// ───────────────────────── step 2: map columns ─────────────────────────
function MappingStep({ batch, onDone }: { batch: Batch; onDone: () => void }) {
  const qc = useQueryClient();
  const [mapping, setMapping] = useState<(string | null)[]>(() => batch.mapping ?? batch.suggestedMapping);
  const save = useAction(
    async (m: (string | null)[]) => {
      await put<Batch>(`/imports/${batch.id}/mapping`, { mapping: m });
      return post<Batch>(`/imports/${batch.id}/preview`);
    },
    {
      onDone: (b) => {
        qc.setQueryData(['import', batch.id], (old: Batch | undefined) => ({ ...old, ...b }));
        void qc.invalidateQueries({ queryKey: ['import-rows', batch.id] });
        void qc.invalidateQueries({ queryKey: ['imports'] });
        onDone();
      },
    },
  );
  const used = mapping.filter((m): m is string => m !== null);
  const twice = batch.fields.filter((f) => used.filter((k) => k === f.key).length > 1);
  const missing = batch.fields.filter((f) => f.required && !used.includes(f.key));
  const contactKey = batch.entityType !== 'contacts' || ['firstName', 'lastName', 'email'].some((k) => used.includes(k));
  const problems = [
    ...missing.map((f) => `Choose the column that holds "${f.label}" (required).`),
    ...twice.map((f) => `"${f.label}" is chosen for more than one column.`),
    ...(contactKey ? [] : ['Choose a column for at least one of: First name, Last name, Email.']),
  ];
  return (
    <Card title="Map columns" actions={<span className="text-xs text-muted">Suggestions are based on the column names — check them.</span>}>
      <Table head={['Column in your file', 'Example values', 'Import as']}>
        {batch.headers.map((header, i) => {
          const name = header || `Column ${i + 1}`;
          const field = batch.fields.find((f) => f.key === mapping[i]);
          const samples = (batch.sampleRows ?? []).map((r) => r[i] ?? '').filter((v) => v.trim() !== '');
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional and never reordered
            <tr key={i}>
              <td className="font-medium text-ink">{name}</td>
              <td className="max-w-xs truncate text-muted">{samples.slice(0, 3).join(' · ') || '—'}</td>
              <td>
                <Select
                  aria-label={`Import column "${name}" as`}
                  value={mapping[i] ?? ''}
                  onChange={(e) => setMapping(mapping.map((m, j) => (j === i ? e.target.value || null : m)))}
                >
                  <option value="">Do not import</option>
                  {batch.fields.map((f) => (
                    <option key={f.key} value={f.key}>
                      {f.label}
                      {f.required ? ' (required)' : ''}
                    </option>
                  ))}
                </Select>
                {field?.hint && <span className="mt-1 block text-xs text-muted">{field.hint}</span>}
              </td>
            </tr>
          );
        })}
      </Table>
      {problems.length > 0 && (
        <ul role="alert" className="mt-3 list-disc pl-5 text-sm text-danger">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center gap-3">
        <Button disabled={problems.length > 0 || save.busy} onClick={() => save.run(mapping)}>
          {save.busy ? 'Checking every row…' : 'Save mapping and check the file'}
        </Button>
        <span className="text-xs text-muted">Checking does not save anything to the CRM.</span>
      </div>
    </Card>
  );
}

// ───────────────────────── rows table (review + result) ─────────────────────────
const ROW_TONE: Record<RowStatus, 'neutral' | 'ok' | 'warn' | 'danger'> = { pending: 'neutral', valid: 'ok', duplicate: 'warn', invalid: 'danger' };
const ROW_LABEL: Record<RowStatus, string> = { pending: 'Not checked', valid: 'Valid', duplicate: 'Duplicate', invalid: 'Invalid' };
const PAGE = 50;

function RowsTable({ batch, showOutcome }: { batch: Batch; showOutcome?: boolean }) {
  const [status, setStatus] = useState<'' | RowStatus>(batch.counts.invalid ? 'invalid' : '');
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ['import-rows', batch.id, status, offset],
    queryFn: () => get<{ total: number; items: ImportRow[] }>(`/imports/${batch.id}/rows?limit=${PAGE}&offset=${offset}${status ? `&status=${status}` : ''}`),
  });
  const columns = batch.headers.map((h, i) => ({ i, name: h || `Column ${i + 1}` })).filter((c) => batch.mapping?.[c.i]);
  return (
    <div>
      <div className="mb-3 max-w-xs">
        <Field label="Show rows">
          <Select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as '' | RowStatus);
              setOffset(0);
            }}
          >
            <option value="">All rows ({batch.counts.total ?? batch.rowCount})</option>
            <option value="invalid">Invalid ({batch.counts.invalid ?? 0})</option>
            <option value="duplicate">Duplicates ({batch.counts.duplicate ?? 0})</option>
            <option value="valid">Valid ({batch.counts.valid ?? 0})</option>
          </Select>
        </Field>
      </div>
      <Query q={q}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="No rows in this group" />
          ) : (
            <>
              <Table head={['Row', 'Check result', 'Details', ...(showOutcome ? ['Outcome'] : []), ...columns.map((c) => c.name)]}>
                {data.items.map((r) => (
                  <tr key={r.id} data-row={r.rowNumber}>
                    <td>{r.rowNumber}</td>
                    <td>
                      <Badge tone={ROW_TONE[r.status]}>{ROW_LABEL[r.status]}</Badge>
                    </td>
                    <td className="min-w-64">
                      {r.errors.map((e) => (
                        <p key={`${e.field}${e.message}`} className="text-danger">
                          {e.column ? `${e.column}: ` : ''}
                          {e.message}
                        </p>
                      ))}
                      {r.duplicate && (
                        <p className="text-warn">
                          {r.duplicate.kind === 'existing'
                            ? `Already in the CRM: "${r.duplicate.existingLabel}" (same ${r.duplicate.matchedOn}).`
                            : `Same ${r.duplicate.matchedOn} as row ${r.duplicate.firstRowNumber} of this file.`}{' '}
                          {r.duplicate.canCreate ? 'Can be created anyway.' : 'Cannot be created twice.'}
                        </p>
                      )}
                      {r.warnings.map((w) => (
                        <p key={`${w.field}${w.message}`} className="text-muted">
                          Note: {w.message}
                        </p>
                      ))}
                      {r.errors.length === 0 && !r.duplicate && r.warnings.length === 0 && <span className="text-muted">—</span>}
                    </td>
                    {showOutcome && <td>{r.outcome === 'created' ? <Badge tone="ok">Created</Badge> : <Badge>Not imported</Badge>}</td>}
                    {columns.map((c) => (
                      <td key={c.i} className="max-w-48 truncate">
                        {r.rawData[c.i] ?? ''}
                      </td>
                    ))}
                  </tr>
                ))}
              </Table>
              <div className="mt-2 flex items-center gap-2 text-xs text-muted">
                <span>
                  Rows {offset + 1}–{offset + data.items.length} of {data.total}. Row numbers are the row numbers of your file (the header is row 1).
                </span>
                <Button variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>
                  Previous
                </Button>
                <Button variant="ghost" disabled={offset + PAGE >= data.total} onClick={() => setOffset(offset + PAGE)}>
                  Next
                </Button>
              </div>
            </>
          )
        }
      </Query>
    </div>
  );
}

function CountTiles({ items }: { items: { label: string; value: number | undefined; tone: string }[] }) {
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {items.map((t) => (
        <div key={t.label} className="rounded-md border border-line bg-surface px-3 py-2">
          <dt className="text-xs text-muted">{t.label}</dt>
          <dd className={`text-xl font-semibold ${t.tone}`}>{t.value ?? 0}</dd>
        </div>
      ))}
    </dl>
  );
}

// ───────────────────────── step 3: review ─────────────────────────
function ReviewStep({ batch, onRemap, onDiscarded }: { batch: Batch; onRemap: () => void; onDiscarded: () => void }) {
  const qc = useQueryClient();
  const [strategy, setStrategy] = useState<'skip' | 'create'>('skip');
  const [confirming, setConfirming] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['import', batch.id] });
    void qc.invalidateQueries({ queryKey: ['import-rows', batch.id] });
    void qc.invalidateQueries({ queryKey: ['imports'] });
  };
  const recheck = useAction(() => post<Batch>(`/imports/${batch.id}/preview`), { success: 'The file was checked again.', onDone: refresh });
  const commit = useAction((s: 'skip' | 'create') => post<Batch>(`/imports/${batch.id}/commit`, { duplicateStrategy: s }), {
    success: 'Import finished.',
    onDone: refresh,
  });
  const discard = useAction(() => del(`/imports/${batch.id}`), {
    success: 'Import discarded. Nothing was imported.',
    onDone: () => {
      void qc.invalidateQueries({ queryKey: ['imports'] });
      onDiscarded();
    },
  });
  const c = batch.counts;
  const creatable = c.duplicateCreatable ?? 0;
  const willCreate = (c.valid ?? 0) + (strategy === 'create' ? creatable : 0);
  const willSkipDuplicates = (c.duplicate ?? 0) - (strategy === 'create' ? creatable : 0);
  const failed = batch.status === 'failed';
  return (
    <>
      {failed && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-danger">
          <p className="font-medium">The import failed and nothing was imported.</p>
          <p className="mt-1">Reason: {batch.failureReason ?? 'unknown'}</p>
          <p className="mt-1">Check the file again before retrying.</p>
        </div>
      )}
      {commit.error && !failed && <ErrorState error={commit.error} />}
      <Card
        title="Review — nothing has been saved yet"
        actions={
          <>
            <Button variant="secondary" onClick={onRemap}>
              Change mapping
            </Button>
            <Button variant="secondary" disabled={recheck.busy} onClick={() => recheck.run(undefined)}>
              {recheck.busy ? 'Checking…' : 'Check again'}
            </Button>
          </>
        }
      >
        <CountTiles
          items={[
            { label: 'Rows in file', value: c.total, tone: 'text-ink' },
            { label: 'Valid', value: c.valid, tone: 'text-ok' },
            { label: 'Invalid — will not be imported', value: c.invalid, tone: 'text-danger' },
            { label: 'Duplicates', value: c.duplicate, tone: 'text-warn' },
          ]}
        />
        {(c.invalid ?? 0) + (c.duplicate ?? 0) + (c.warnings ?? 0) > 0 && (
          <p className="mt-3 text-sm">
            <a className="font-medium text-brand underline" href={`/api/v1/imports/${batch.id}/error-report`} download>
              Download the error report (CSV)
            </a>{' '}
            <span className="text-muted">— your original rows with the problem found in each. Fix the file and upload it again to import those rows.</span>
          </p>
        )}
      </Card>

      <Card title="Rows">
        <RowsTable batch={batch} />
      </Card>

      {!failed && (
        <Card title="Import">
          {(c.duplicate ?? 0) > 0 && (
            <fieldset className="mb-4 text-sm">
              <legend className="mb-1 font-medium text-ink">What should happen with the {n(c.duplicate, 'duplicate')}?</legend>
              <label className="flex items-start gap-2 py-1">
                <input type="radio" name="strategy" checked={strategy === 'skip'} onChange={() => setStrategy('skip')} className="mt-1" />
                <span>Skip duplicates (recommended)</span>
              </label>
              <label className="flex items-start gap-2 py-1">
                <input
                  type="radio"
                  name="strategy"
                  checked={strategy === 'create'}
                  disabled={creatable === 0}
                  onChange={() => setStrategy('create')}
                  className="mt-1"
                />
                <span>
                  Create duplicates anyway
                  <span className="block text-xs text-muted">
                    {creatable === 0
                      ? 'Not possible for these rows: two records cannot share the same email or company domain.'
                      : `Applies to ${creatable} of ${c.duplicate}. Rows that match on email or company domain are always skipped.`}
                  </span>
                </span>
              </label>
            </fieldset>
          )}
          <p className="text-sm text-ink" data-testid="import-summary">
            {records(willCreate, batch.entityType)} will be created. {n(c.invalid, 'invalid row')} and {n(willSkipDuplicates, 'duplicate')} will not be
            imported.
          </p>
          <p className="mt-1 text-xs text-muted">
            Either every record is created or, if anything goes wrong, none is. Owners come from the owner column; rows without a known owner are assigned to
            you.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button disabled={willCreate === 0 || commit.busy} onClick={() => setConfirming(true)}>
              {commit.busy ? 'Importing…' : `Import ${records(willCreate, batch.entityType)}`}
            </Button>
            <ConfirmButton
              label="Discard this import"
              variant="secondary"
              confirm="Discard this uploaded file? Nothing has been imported, so no CRM record is affected."
              onConfirm={() => discard.run(undefined)}
            />
          </div>
          <Dialog open={confirming} onClose={() => setConfirming(false)} title="Confirm import">
            <p className="text-sm text-ink">
              Create {records(willCreate, batch.entityType)} from {batch.fileName}? {n(c.invalid, 'invalid row')} and {n(willSkipDuplicates, 'duplicate')} will
              be left out. You can undo the import afterwards.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setConfirming(false);
                  commit.run(strategy);
                }}
              >
                Yes, import
              </Button>
            </div>
          </Dialog>
        </Card>
      )}
      {failed && (
        <ConfirmButton
          label="Discard this import"
          variant="secondary"
          confirm="Discard this uploaded file? Nothing has been imported, so no CRM record is affected."
          onConfirm={() => discard.run(undefined)}
        />
      )}
    </>
  );
}

// ───────────────────────── step 4: result + undo ─────────────────────────
const UNDO_LABEL: Record<UndoItem['outcome'], { label: string; tone: 'ok' | 'warn' | 'neutral' }> = {
  removed: { label: 'Removed', tone: 'ok' },
  kept_modified: { label: 'Kept — changed since import', tone: 'warn' },
  kept_referenced: { label: 'Kept — in use', tone: 'warn' },
  already_gone: { label: 'Already removed', tone: 'neutral' },
};
function UndoItems({ items, future }: { items: UndoItem[]; future?: boolean }) {
  return (
    <Table head={['Record', future ? 'What will happen' : 'What happened', 'Why']}>
      {items.map((i) => (
        <tr key={i.recordId}>
          <td className="font-medium text-ink">{i.label}</td>
          <td>
            <Badge tone={UNDO_LABEL[i.outcome].tone}>{future && i.outcome === 'removed' ? 'Will be removed' : UNDO_LABEL[i.outcome].label}</Badge>
          </td>
          <td className="text-muted">{i.detail ?? (i.outcome === 'removed' ? 'Unchanged since the import' : '—')}</td>
        </tr>
      ))}
    </Table>
  );
}

function UndoButton({ batch }: { batch: BatchSummary }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const preview = useQuery({
    queryKey: ['import-undo-preview', batch.id],
    queryFn: () => get<UndoPreview>(`/imports/${batch.id}/undo-preview`),
    enabled: open,
    gcTime: 0,
  });
  const undo = useAction(() => post<Batch>(`/imports/${batch.id}/undo`), {
    onDone: (b) => {
      setOpen(false);
      qc.setQueryData(['import', batch.id], (old: Batch | undefined) => (old ? { ...old, ...b } : undefined));
      void qc.invalidateQueries({ queryKey: ['import', batch.id] });
      void qc.invalidateQueries({ queryKey: ['imports'] });
    },
    success: 'Undo finished. See the report for what was removed and what was kept.',
  });
  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)} aria-label={`Undo import ${batch.fileName}`}>
        Undo import
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Undo import of ${batch.fileName}`} wide>
        {preview.isPending ? (
          <Skeleton rows={3} />
        ) : preview.isError ? (
          <ErrorState error={preview.error} retry={() => void preview.refetch()} />
        ) : (
          <>
            <p className="text-sm text-ink" data-testid="undo-summary">
              {records(preview.data.willRemove, batch.entityType)} will be permanently removed. {records(preview.data.willKeep, batch.entityType)} will be kept.
            </p>
            <p className="mb-3 mt-1 text-xs text-muted">
              Only records created by this import are touched. A record is kept when it was edited after the import or when something was added to it since (for
              example an opportunity, person, task or note). Removal cannot be reversed.
            </p>
            {preview.data.items.length > 0 && <UndoItems items={preview.data.items} future />}
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="danger" disabled={undo.busy || preview.data.willRemove === 0} onClick={() => undo.run(undefined)}>
                {undo.busy ? 'Undoing…' : `Remove ${records(preview.data.willRemove, batch.entityType)}`}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </>
  );
}

function ResultStep({ batch }: { batch: Batch }) {
  const c = batch.counts;
  const canUndo = batch.status === 'committed' || batch.status === 'partially_undone';
  return (
    <>
      <Card title="Result" actions={canUndo ? <UndoButton batch={batch} /> : undefined}>
        <p className="mb-3 text-sm text-ink" data-testid="import-result">
          {records(c.created, batch.entityType)} created on {dateTime(batch.committedAt)}. {n(c.skipped, 'row')} not imported ({c.invalid ?? 0} invalid,{' '}
          {(c.skipped ?? 0) - (c.invalid ?? 0)} duplicate
          {batch.duplicateStrategy === 'create' ? '; duplicates were created where allowed' : ''}).
        </p>
        <CountTiles
          items={[
            { label: 'Rows in file', value: c.total, tone: 'text-ink' },
            { label: 'Created', value: c.created, tone: 'text-ok' },
            { label: 'Invalid — not imported', value: c.invalid, tone: 'text-danger' },
            { label: 'Duplicates found', value: c.duplicate, tone: 'text-warn' },
          ]}
        />
      </Card>
      {batch.undoReport && (
        <Card title={`Undo report — ${dateTime(batch.undoneAt)}`}>
          <p className="mb-3 text-sm text-ink" data-testid="undo-result">
            {records(batch.undoReport.removed, batch.entityType)} removed, {batch.undoReport.kept} kept.
            {batch.undoReport.kept > 0 && ' Kept records stay in the CRM; you can archive them by hand, or run Undo again once nothing uses them.'}
          </p>
          <UndoItems items={batch.undoReport.items} />
        </Card>
      )}
      <Card title="Rows">
        <RowsTable batch={batch} showOutcome />
      </Card>
    </>
  );
}

// ───────────────────────── history ─────────────────────────
function History({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ['imports'], queryFn: () => get<{ items: BatchSummary[] }>('/imports') });
  return (
    <Card title="Import history">
      <Query q={q}>
        {(data) =>
          data.items.length === 0 ? (
            <EmptyState title="No imports yet" hint="Upload a CSV file above to start." />
          ) : (
            <Table head={['File', 'Type', 'Status', 'Rows', 'Created', 'Uploaded', 'By', 'Actions']}>
              {data.items.map((b) => {
                const committed = b.status === 'committed' || b.status === 'partially_undone' || b.status === 'undone';
                return (
                  <tr key={b.id}>
                    <td className="font-medium text-ink">{b.fileName}</td>
                    <td>{ENTITY[b.entityType].label}</td>
                    <td>
                      <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>
                      {b.failureReason && <span className="mt-1 block max-w-xs text-xs text-danger">{b.failureReason}</span>}
                    </td>
                    <td>{b.rowCount}</td>
                    <td>{committed ? (b.counts.created ?? 0) : '—'}</td>
                    <td>{dateTime(b.createdAt)}</td>
                    <td>{b.createdByName ?? '—'}</td>
                    <td>
                      <div className="flex flex-wrap gap-2">
                        <Button variant="secondary" onClick={() => onOpen(b.id)} aria-label={`${committed ? 'View' : 'Continue'} import ${b.fileName}`}>
                          {committed ? 'View' : 'Continue'}
                        </Button>
                        {(b.status === 'committed' || b.status === 'partially_undone') && <UndoButton batch={b} />}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </Table>
          )
        }
      </Query>
    </Card>
  );
}
