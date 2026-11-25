import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import {
  ArrowDown,
  ArrowRightLeft,
  ArrowUp,
  CalendarDays,
  Check,
  ChevronsUpDown,
  Circle,
  Eye,
  FileText,
  type LucideIcon,
  Pencil,
  PenLine,
  Phone,
  Plus,
  StickyNote,
  Trophy,
  UserCog,
  Zap,
} from 'lucide-react';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { ApiError, dateTime, get, money, patch, personName, post } from '../lib/api.ts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  ConfirmButton,
  Dialog,
  EmptyState,
  Field,
  FieldList,
  formValues,
  Input,
  PageHeader,
  PersonChip,
  Query,
  recordLink,
  SearchInput,
  Select,
  statusTone,
  useAction,
} from '../lib/ui.tsx';
import { WeeklyReportsCard } from './weekly-reports.tsx';

type Page<T> = { items: T[]; total: number };
interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  ownerName: string;
}
interface ContactRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  jobTitle: string | null;
  phone: string | null;
  companyId: string | null;
  companyName: string | null;
  ownerName: string;
}
interface RecordPermissions {
  edit: boolean;
  reassign?: boolean;
  /** User ids a manager may hand the record to; null = any active user. */
  reassignScope?: string[] | null;
}
interface CompanyDetail {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  phone: string | null;
  website: string | null;
  ownerId: string;
  archivedAt: string | null;
  rowVersion: number;
  owner: { id: string; fullName: string } | undefined;
  contacts: { id: string; firstName: string | null; lastName: string | null; email: string | null; jobTitle: string | null }[];
  deals: { id: string; name: string; status: string; amount: string | null; currency: string }[];
  permissions: RecordPermissions;
}
interface ContactDetail {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  companyId: string | null;
  ownerId: string;
  archivedAt: string | null;
  rowVersion: number;
  owner: { id: string; fullName: string } | undefined;
  company: { id: string; name: string; canOpen: boolean } | null;
  deals: { id: string; name: string; status: string; amount: string | null; currency: string; stageName: string; roles: string[]; isPrimary: boolean }[];
  permissions: RecordPermissions;
}
interface UserRow {
  id: string;
  fullName: string;
  role: string;
  status: string;
}

const LIST_LIMIT = 100;

/** Search box + list state shared by the list pages. */
function useList<T>(key: string, path: string) {
  const [q, setQ] = useState('');
  const query = useQuery({ queryKey: [key, q], queryFn: () => get<Page<T>>(`${path}?limit=${LIST_LIMIT}${q ? `&q=${encodeURIComponent(q)}` : ''}`) });
  return { q, setQ, query };
}

/** Every text field of a form, trimmed. Blank fields are kept as '' so an edit can clear a value (PATCH: '' = clear). */
function formTexts(e: FormEvent<HTMLFormElement>): Record<string, string> {
  e.preventDefault();
  const out: Record<string, string> = {};
  for (const [k, v] of new FormData(e.currentTarget).entries()) if (typeof v === 'string') out[k] = v.trim();
  return out;
}

// ───────────── sortable tables (BR-CRM-011 list views) ─────────────
export interface Column<T> {
  key: string;
  label: string;
  render: (row: T) => ReactNode;
  /** Value used for sorting; omit for a column that cannot be sorted. Empty values always sort last. */
  sortValue?: (row: T) => string | number | null | undefined;
}
type SortState = { key: string; dir: 'asc' | 'desc' };

/**
 * List table with click-to-sort column headers. The list endpoints have no sort parameter, so the rows already
 * loaded in the browser are sorted here; `total` tells the user when more rows exist than were loaded.
 */
export function SortableTable<T>({
  label,
  columns,
  rows,
  rowKey,
  initialSort,
  total,
}: {
  label: string;
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  initialSort?: SortState;
  total?: number;
}) {
  const [sort, setSort] = useState<SortState | null>(initialSort ?? null);
  const sorted = useMemo(() => {
    const col = sort && columns.find((c) => c.key === sort.key);
    if (!sort || !col?.sortValue) return rows;
    const value = col.sortValue;
    const empty = (v: unknown) => v === null || v === undefined || v === '';
    return [...rows].sort((a, b) => {
      const x = value(a);
      const y = value(b);
      if (empty(x) || empty(y)) return empty(x) === empty(y) ? 0 : empty(x) ? 1 : -1;
      const cmp =
        typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true, sensitivity: 'base' });
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [rows, sort, columns]);
  const toggle = (key: string) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full text-left text-sm" aria-label={label}>
          <thead className="border-b border-line bg-surface text-sm text-muted">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                const Icon = !active ? ChevronsUpDown : sort?.dir === 'desc' ? ArrowDown : ArrowUp;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className="h-9 whitespace-nowrap px-3 font-semibold"
                    aria-sort={!c.sortValue ? undefined : active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        title={`Sort by ${c.label}`}
                        className={`group inline-flex cursor-pointer items-center gap-1 rounded font-semibold transition-colors hover:text-ink ${active ? 'text-ink' : ''}`}
                      >
                        {c.label}
                        <Icon aria-hidden className={`size-3.5 ${active ? '' : 'opacity-0 group-hover:opacity-60'}`} />
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line [&_td]:h-9 [&_td]:px-3 [&_td]:py-1 [&_tr]:transition-colors [&_tr:hover]:bg-brand-soft/60">
            {sorted.map((row) => (
              <tr key={rowKey(row)}>
                {columns.map((c) => (
                  <td key={c.key}>{c.render(row)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total !== undefined && total > rows.length && (
        <p className="mt-2 text-xs text-muted">
          Showing the first {rows.length} of {total}. Sorting applies to the rows shown — use the filter to narrow the list.
        </p>
      )}
    </>
  );
}

// ───────────── shared edit pieces ─────────────
/** Inline explanation of a failed save: conflicts and duplicates get a plain-language message. */
export function ActionError({ error, onNavigate }: { error: unknown; onNavigate?: () => void }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  if (e && e.errors.length > 0) return null; // field-level messages are shown next to the inputs
  const existingId = e?.code === 'DUPLICATE_SUSPECTED' && typeof e.meta.existingId === 'string' ? e.meta.existingId : null;
  const message =
    e?.code === 'CONCURRENT_MODIFICATION'
      ? 'Someone else changed this record while you were editing. Close this dialog to see the latest values, then try again.'
      : e?.code === 'DUPLICATE_SUSPECTED'
        ? 'Possible duplicate: another company already uses this domain. Nothing was saved.'
        : e?.code === 'CONTACT_EMAIL_TAKEN'
          ? 'Another person already uses this email address. Nothing was saved.'
          : error instanceof Error
            ? error.message
            : 'Something went wrong.';
  return (
    <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
      {message}{' '}
      {existingId && (
        <Link to="/companies/$id" params={{ id: existingId }} onClick={onNavigate} className="font-medium underline">
          Open the existing company
        </Link>
      )}
    </p>
  );
}

/** Choose a new owner (BR-CRM-004). The server decides who may reassign and to whom; this only lists valid choices. */
export function OwnerDialog({
  what,
  path,
  currentOwnerId,
  scope,
  onClose,
  onDone,
}: {
  what: 'company' | 'deal';
  path: string;
  currentOwnerId: string;
  scope: string[] | null | undefined;
  onClose: () => void;
  onDone: () => void;
}) {
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<UserRow[]>('/users') });
  const save = useAction((ownerId: string) => post(path, { ownerId }), {
    success: 'Owner changed',
    onDone: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title={`Change ${what} owner`}>
      <Query q={users} rows={2}>
        {(all) => {
          // /users returns one row per team membership; keep each active user once.
          const seen = new Set<string>();
          const candidates = all.filter(
            (u) => u.status === 'active' && u.id !== currentOwnerId && (!scope || scope.includes(u.id)) && !seen.has(u.id) && seen.add(u.id),
          );
          return candidates.length === 0 ? (
            <p className="text-sm text-muted">There is no other active user you can assign this {what} to.</p>
          ) : (
            <form
              className="space-y-3"
              onSubmit={(e) => {
                const v = formValues(e);
                if (v.ownerId) save.run(v.ownerId);
              }}
            >
              <Field label="New owner" hint={scope ? 'You can reassign within the teams you manage.' : undefined}>
                <Select name="ownerId" required defaultValue="">
                  <option value="" disabled>
                    Choose a user
                  </option>
                  {candidates.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
                </Select>
              </Field>
              <ActionError error={save.error} />
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" disabled={save.busy}>
                  Change owner
                </Button>
              </div>
            </form>
          );
        }}
      </Query>
    </Dialog>
  );
}

/** Related-record count shown in a card header (kept out of the heading so the card title stays stable). */
const CountPill = ({ n }: { n: number }) => <span className="rounded bg-surface px-1.5 text-xs font-medium tabular-nums text-muted ring-1 ring-line">{n}</span>;

// ───────────── companies ─────────────
const companyColumns: Column<CompanyRow>[] = [
  {
    key: 'name',
    label: 'Name',
    sortValue: (c) => c.name,
    render: (c) => (
      <Link to="/companies/$id" params={{ id: c.id }} className={recordLink}>
        <Avatar name={c.name} shape="square" />
        <span className="truncate">{c.name}</span>
      </Link>
    ),
  },
  { key: 'domain', label: 'Domain', sortValue: (c) => c.domain, render: (c) => (c.domain ? <span className="text-muted">{c.domain}</span> : '—') },
  { key: 'industry', label: 'Industry', sortValue: (c) => c.industry, render: (c) => (c.industry ? <Badge>{c.industry}</Badge> : '—') },
  { key: 'owner', label: 'Owner', sortValue: (c) => c.ownerName, render: (c) => <PersonChip name={c.ownerName} /> },
];

export function CompaniesPage() {
  const qc = useQueryClient();
  const { q, setQ, query } = useList<CompanyRow>('companies', '/companies');
  const [open, setOpen] = useState(false);
  const create = useAction((v: Record<string, string | undefined>) => post('/companies', v), {
    success: 'Company created',
    onDone: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['companies'] });
    },
  });
  return (
    <>
      <PageHeader
        title="Companies"
        subtitle={query.data ? `${query.data.total} companies you can see` : undefined}
        actions={<Button onClick={() => setOpen(true)}>New company</Button>}
      />
      <SearchInput
        className="mb-3 max-w-sm"
        placeholder="Filter by name or domain"
        aria-label="Filter companies"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Query q={query}>
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState
              title={q ? 'No companies match your filter' : 'No companies yet'}
              hint="Companies are the organizations you sell to."
              action={<Button onClick={() => setOpen(true)}>New company</Button>}
            />
          ) : (
            <SortableTable
              label="Companies"
              columns={companyColumns}
              rows={d.items}
              rowKey={(c) => c.id}
              total={d.total}
              initialSort={{ key: 'name', dir: 'asc' }}
            />
          )
        }
      </Query>
      <Dialog open={open} onClose={() => setOpen(false)} title="New company">
        <form className="space-y-3" onSubmit={(e) => create.run(formValues(e))}>
          <Field label="Name" error={create.fieldError('name')}>
            <Input name="name" required maxLength={255} />
          </Field>
          <Field label="Domain" hint="For example acme.com — used to detect duplicates" error={create.fieldError('domain')}>
            <Input name="domain" />
          </Field>
          <Field label="Industry">
            <Input name="industry" />
          </Field>
          <ActionError error={create.error} onNavigate={() => setOpen(false)} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.busy}>
              Create company
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function CompanyEditDialog({ company, onClose, onDone }: { company: CompanyDetail; onClose: () => void; onDone: () => void }) {
  // rowVersion is sent for optimistic concurrency; the server checks it as soon as the request contract carries it.
  const save = useAction((v: Record<string, string>) => patch(`/companies/${company.id}`, { ...v, rowVersion: company.rowVersion }), {
    success: 'Company updated',
    onDone: () => {
      onDone();
      onClose();
    },
  });
  return (
    <Dialog open onClose={onClose} title="Edit company">
      <form className="space-y-3" onSubmit={(e) => save.run(formTexts(e))}>
        <Field label="Name" error={save.fieldError('name')}>
          <Input name="name" required maxLength={255} defaultValue={company.name} />
        </Field>
        <Field label="Domain" hint="For example acme.com — used to detect duplicates" error={save.fieldError('domain')}>
          <Input name="domain" maxLength={253} defaultValue={company.domain ?? ''} />
        </Field>
        <Field label="Industry" error={save.fieldError('industry')}>
          <Input name="industry" maxLength={120} defaultValue={company.industry ?? ''} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" error={save.fieldError('phone')}>
            <Input name="phone" type="tel" maxLength={32} defaultValue={company.phone ?? ''} />
          </Field>
          <Field label="Website" error={save.fieldError('website')}>
            <Input name="website" maxLength={2048} defaultValue={company.website ?? ''} />
          </Field>
        </div>
        <ActionError error={save.error} onNavigate={onClose} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function CompanyPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['company', id], queryFn: () => get<CompanyDetail>(`/companies/${id}`) });
  const [dialog, setDialog] = useState<null | 'edit' | 'owner'>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['company', id] });
    void qc.invalidateQueries({ queryKey: ['companies'] });
    void qc.invalidateQueries({ queryKey: ['timeline', 'company', id] });
  };
  const archive = useAction(() => post(`/companies/${id}/archive`), {
    success: 'Company archived',
    onDone: () => {
      refresh();
      void navigate({ to: '/companies' });
    },
  });
  return (
    <Query q={q}>
      {(c) => (
        <>
          <PageHeader
            icon={<Avatar name={c.name} shape="square" size="lg" />}
            title={c.name}
            subtitle={[c.domain, c.industry].filter(Boolean).join(' · ') || 'Company'}
            actions={
              <>
                {c.archivedAt && <Badge tone="warn">Archived</Badge>}
                {!c.permissions.edit && !c.archivedAt && <Badge>View only</Badge>}
                {c.permissions.edit && (
                  <Button variant="secondary" onClick={() => setDialog('edit')}>
                    Edit
                  </Button>
                )}
                {c.permissions.reassign && (
                  <Button variant="secondary" onClick={() => setDialog('owner')}>
                    Change owner
                  </Button>
                )}
                {c.permissions.edit && (
                  <ConfirmButton
                    label="Archive"
                    confirm={`Archive ${c.name}? It disappears from lists, search and pickers. Its history is kept.`}
                    disabled={archive.busy}
                    onConfirm={() => archive.run(undefined)}
                  />
                )}
              </>
            }
          />
          <ActionError error={archive.error} />
          {/* Record layout: fields panel on the left, related records + activity on the right. */}
          <div className="mt-2 grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <Card title="Details" className="lg:sticky lg:top-5">
              <FieldList
                rows={[
                  ['Domain', c.domain],
                  ['Industry', c.industry],
                  ['Phone', c.phone],
                  [
                    'Website',
                    c.website ? (
                      <a
                        key="website"
                        href={/^https?:\/\//.test(c.website) ? c.website : `https://${c.website}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand hover:underline"
                      >
                        {c.website}
                      </a>
                    ) : null,
                  ],
                  ['Owner', c.owner?.fullName ? <PersonChip key="owner" name={c.owner.fullName} /> : null],
                ]}
              />
            </Card>
            <div className="min-w-0 space-y-4">
              <div className="grid gap-4 xl:grid-cols-2">
                <Card title="Opportunities" actions={<CountPill n={c.deals.length} />}>
                  {c.deals.length === 0 ? (
                    <p className="text-[13px] text-muted">No opportunities yet.</p>
                  ) : (
                    <ul className="-my-2 divide-y divide-line text-sm">
                      {c.deals.map((d) => (
                        <li key={d.id} className="flex items-center justify-between gap-3 py-2">
                          <Link to="/deals/$id" params={{ id: d.id }} className={recordLink}>
                            <span className="truncate">{d.name}</span>
                          </Link>
                          <span className="flex shrink-0 items-center gap-2">
                            <span className="tabular-nums text-muted">{money(d.amount, d.currency)}</span>
                            <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card title="People" actions={<CountPill n={c.contacts.length} />}>
                  {c.contacts.length === 0 ? (
                    <p className="text-[13px] text-muted">No people yet.</p>
                  ) : (
                    <ul className="-my-2 divide-y divide-line text-sm">
                      {c.contacts.map((p) => (
                        <li key={p.id} className="flex items-center gap-2.5 py-2">
                          <Avatar name={personName(p)} size="md" />
                          <div className="min-w-0">
                            <Link to="/contacts/$id" params={{ id: p.id }} className={recordLink}>
                              <span className="truncate">{personName(p)}</span>
                            </Link>
                            <p className="truncate text-xs text-muted">{[p.jobTitle, p.email].filter(Boolean).join(' · ')}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>
              <WeeklyReportsCard companyId={id} canEdit={c.permissions.edit && !c.archivedAt} />
              <Card title="Timeline">
                <Timeline type="company" id={id} />
              </Card>
            </div>
          </div>
          {dialog === 'edit' && <CompanyEditDialog company={c} onClose={() => setDialog(null)} onDone={refresh} />}
          {dialog === 'owner' && (
            <OwnerDialog
              what="company"
              path={`/companies/${id}/owner`}
              currentOwnerId={c.ownerId}
              scope={c.permissions.reassignScope}
              onClose={() => setDialog(null)}
              onDone={refresh}
            />
          )}
        </>
      )}
    </Query>
  );
}

// ───────────── contacts ─────────────
const contactColumns: Column<ContactRow>[] = [
  {
    key: 'name',
    label: 'Name',
    sortValue: (c) => [c.lastName, c.firstName].filter(Boolean).join(' ') || c.email,
    render: (c) => (
      <Link to="/contacts/$id" params={{ id: c.id }} className={recordLink}>
        <Avatar name={personName(c)} />
        <span className="truncate">{personName(c)}</span>
      </Link>
    ),
  },
  { key: 'email', label: 'Email', sortValue: (c) => c.email, render: (c) => (c.email ? <span className="text-muted">{c.email}</span> : '—') },
  { key: 'title', label: 'Title', sortValue: (c) => c.jobTitle, render: (c) => c.jobTitle ?? '—' },
  {
    key: 'company',
    label: 'Company',
    sortValue: (c) => c.companyName,
    render: (c) =>
      c.companyId ? (
        <Link to="/companies/$id" params={{ id: c.companyId }} className={recordLink}>
          <Avatar name={c.companyName ?? '?'} shape="square" />
          <span className="truncate">{c.companyName}</span>
        </Link>
      ) : (
        '—'
      ),
  },
  { key: 'owner', label: 'Owner', sortValue: (c) => c.ownerName, render: (c) => <PersonChip name={c.ownerName} /> },
];

type CompanyChoice = { linked: CompanyRow | null; name: string; domain: string; industry: string };
const NO_COMPANY: CompanyChoice = { linked: null, name: '', domain: '', industry: '' };
const norm = (s: string | null | undefined) =>
  (s ?? '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '');

/**
 * Company for a new person: type to find and link an existing company, or enter a new one's name, domain and
 * industry — it is created together with the person, so the company is never entered twice.
 */
function CompanyField({ companies, value, onChange }: { companies: CompanyRow[]; value: CompanyChoice; onChange: (v: CompanyChoice) => void }) {
  const typed = value.name.trim().toLowerCase();
  const exact = typed ? companies.find((c) => c.name.trim().toLowerCase() === typed) : undefined;
  const matches = typed && !value.linked ? companies.filter((c) => c.name.toLowerCase().includes(typed) && c !== exact).slice(0, 5) : [];
  const domainOwner = !value.linked && norm(value.domain) ? companies.find((c) => norm(c.domain) === norm(value.domain)) : undefined;

  if (value.linked)
    return (
      <Field label="Company">
        <div className="flex h-8 items-center justify-between gap-2 rounded border border-line bg-surface px-2.5 text-sm">
          <span className="flex min-w-0 items-center gap-2">
            <Avatar name={value.linked.name} shape="square" />
            <span className="truncate font-medium">{value.linked.name}</span>
            <span className="truncate text-xs text-muted">{[value.linked.domain, value.linked.industry].filter(Boolean).join(' · ')}</span>
          </span>
          <button type="button" className="shrink-0 cursor-pointer text-[13px] font-medium text-brand hover:underline" onClick={() => onChange(NO_COMPANY)}>
            Change
          </button>
        </div>
        <span className="mt-1 block text-xs text-muted">Linked to an existing company.</span>
      </Field>
    );

  return (
    <div className="space-y-3">
      <Field label="Company" hint={typed ? undefined : 'Type to find an existing company, or enter a new one.'}>
        <Input
          aria-label="Company"
          autoComplete="off"
          placeholder="Company name"
          value={value.name}
          onChange={(e) => onChange({ ...value, name: e.target.value })}
        />
      </Field>
      {(exact || matches.length > 0) && (
        <ul aria-label="Matching companies" className="-mt-1.5 overflow-hidden rounded-md border border-line">
          {[...(exact ? [exact] : []), ...matches].map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onChange({ ...NO_COMPANY, linked: c, name: c.name })}
                className="flex w-full cursor-pointer items-center gap-2 border-b border-line px-2.5 py-1.5 text-left text-sm last:border-0 hover:bg-brand-soft/60"
              >
                <Avatar name={c.name} shape="square" />
                <span className="font-medium">{c.name}</span>
                <span className="truncate text-xs text-muted">{c.domain ?? ''}</span>
                <span className="ml-auto text-xs font-medium text-brand">{c === exact ? 'Use existing' : 'Link'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {typed && !exact && (
        <div className="space-y-3 rounded-md border border-dashed border-line-strong p-3">
          <p className="text-xs font-medium text-muted">New company — created and linked to this person</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Company domain">
              <Input placeholder="example.com" value={value.domain} onChange={(e) => onChange({ ...value, domain: e.target.value })} />
            </Field>
            <Field label="Industry">
              <Input value={value.industry} onChange={(e) => onChange({ ...value, industry: e.target.value })} />
            </Field>
          </div>
          {domainOwner && (
            <p role="alert" className="flex items-center justify-between gap-3 text-[13px] text-amber-900">
              <span>
                <strong className="font-semibold">{domainOwner.name}</strong> already uses {norm(value.domain)}.
              </span>
              <Button variant="secondary" onClick={() => onChange({ ...NO_COMPANY, linked: domainOwner, name: domainOwner.name })}>
                Link {domainOwner.name}
              </Button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function ContactsPage() {
  const qc = useQueryClient();
  const { q, setQ, query } = useList<ContactRow>('contacts', '/contacts');
  const companies = useQuery({ queryKey: ['companies', ''], queryFn: () => get<Page<CompanyRow>>(`/companies?limit=${LIST_LIMIT}`) });
  const [open, setOpen] = useState(false);
  const [co, setCo] = useState<CompanyChoice>(NO_COMPANY);
  const close = () => {
    setOpen(false);
    setCo(NO_COMPANY);
  };
  const create = useAction(
    (v: Record<string, string | undefined>) =>
      post('/contacts', {
        ...v,
        // Link the chosen company, or create the typed one together with the person (one request, one transaction).
        ...(co.linked ? { companyId: co.linked.id } : co.name.trim() ? { newCompany: { name: co.name, domain: co.domain, industry: co.industry } } : {}),
      }),
    {
      success: co.linked || !co.name.trim() ? 'Person created' : 'Person and company created',
      onDone: () => {
        close();
        void qc.invalidateQueries({ queryKey: ['contacts'] });
        void qc.invalidateQueries({ queryKey: ['companies'] });
      },
    },
  );
  // The server refuses a new company whose domain is already taken; offer that company instead.
  const dupId = create.error instanceof ApiError && create.error.code === 'DUPLICATE_SUSPECTED' ? String(create.error.meta.existingId ?? '') : '';
  const dup = dupId ? companies.data?.items.find((c) => c.id === dupId) : undefined;
  return (
    <>
      <PageHeader
        title="People"
        subtitle={query.data ? `${query.data.total} people you can see` : undefined}
        actions={<Button onClick={() => setOpen(true)}>New person</Button>}
      />
      <SearchInput
        className="mb-3 max-w-sm"
        placeholder="Filter by name or email"
        aria-label="Filter people"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <Query q={query}>
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState title={q ? 'No people match your filter' : 'No people yet'} action={<Button onClick={() => setOpen(true)}>New person</Button>} />
          ) : (
            <SortableTable
              label="People"
              columns={contactColumns}
              rows={d.items}
              rowKey={(c) => c.id}
              total={d.total}
              initialSort={{ key: 'name', dir: 'asc' }}
            />
          )
        }
      </Query>
      <Dialog open={open} onClose={close} title="New person">
        <form className="space-y-3" onSubmit={(e) => create.run(formValues(e))}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="First name" error={create.fieldError('firstName')}>
              <Input name="firstName" />
            </Field>
            <Field label="Last name">
              <Input name="lastName" />
            </Field>
          </div>
          <Field label="Email" error={create.fieldError('email')}>
            <Input name="email" type="email" />
          </Field>
          <Field label="Job title">
            <Input name="jobTitle" />
          </Field>
          <CompanyField companies={companies.data?.items ?? []} value={co} onChange={setCo} />
          {dup ? (
            <div
              role="alert"
              className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-900"
            >
              <span>
                <strong className="font-semibold">{dup.name}</strong> already uses this domain.
              </span>
              <Button variant="secondary" onClick={() => setCo({ ...NO_COMPANY, linked: dup, name: dup.name })}>
                Link {dup.name}
              </Button>
            </div>
          ) : (
            <ActionError error={create.error} />
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.busy}>
              Create person
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function ContactEditDialog({ contact, onClose, onDone }: { contact: ContactDetail; onClose: () => void; onDone: () => void }) {
  const companies = useQuery({ queryKey: ['companies', ''], queryFn: () => get<Page<CompanyRow>>(`/companies?limit=${LIST_LIMIT}`) });
  const [emailError, setEmailError] = useState<string>();
  const save = useAction(
    (v: Record<string, string>) => {
      const { email, companyId, ...rest } = v;
      return patch(`/contacts/${contact.id}`, {
        ...rest,
        ...(email ? { email } : {}),
        // Leave the company untouched when the current one could not be offered in the picker.
        ...(companyId === KEEP ? {} : { companyId: companyId || null }),
        rowVersion: contact.rowVersion, // checked by the server as soon as the request contract carries it
      });
    },
    {
      success: 'Person updated',
      onDone: () => {
        onDone();
        onClose();
      },
    },
  );
  const options = companies.data?.items ?? [];
  const currentListed = !contact.company || options.some((c) => c.id === contact.company?.id);
  return (
    <Dialog open onClose={onClose} title="Edit person">
      <form
        className="space-y-3"
        onSubmit={(e) => {
          const v = formTexts(e);
          if (!v.firstName && !v.lastName && !v.email) return setEmailError('Provide a name or an email');
          // The API cannot clear an email address yet; say so instead of silently keeping the old one.
          if (!v.email && contact.email) return setEmailError('An email address cannot be removed here. Enter the new address instead.');
          setEmailError(undefined);
          save.run(v);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" error={save.fieldError('firstName')}>
            <Input name="firstName" maxLength={120} defaultValue={contact.firstName ?? ''} />
          </Field>
          <Field label="Last name" error={save.fieldError('lastName')}>
            <Input name="lastName" maxLength={120} defaultValue={contact.lastName ?? ''} />
          </Field>
        </div>
        <Field label="Email" error={emailError ?? save.fieldError('email')}>
          <Input name="email" type="email" maxLength={254} defaultValue={contact.email ?? ''} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Phone" error={save.fieldError('phone')}>
            <Input name="phone" type="tel" maxLength={32} defaultValue={contact.phone ?? ''} />
          </Field>
          <Field label="Job title" error={save.fieldError('jobTitle')}>
            <Input name="jobTitle" maxLength={120} defaultValue={contact.jobTitle ?? ''} />
          </Field>
        </div>
        <Field label="Company" error={save.fieldError('companyId')}>
          <Select name="companyId" defaultValue={contact.company ? (currentListed ? contact.company.id : KEEP) : ''} key={String(currentListed)}>
            <option value="">No company</option>
            {!currentListed && contact.company && <option value={KEEP}>{contact.company.name}</option>}
            {options.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <ActionError error={save.error} />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={save.busy}>
            Save changes
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
const KEEP = '__keep__';

export function ContactPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['contact', id], queryFn: () => get<ContactDetail>(`/contacts/${id}`) });
  const [editing, setEditing] = useState(false);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['contact', id] });
    void qc.invalidateQueries({ queryKey: ['contacts'] });
    void qc.invalidateQueries({ queryKey: ['timeline', 'contact', id] });
  };
  return (
    <Query q={q}>
      {(c) => (
        <>
          <PageHeader
            icon={<Avatar name={personName(c)} size="lg" />}
            title={personName(c)}
            subtitle={[c.jobTitle, c.company?.name].filter(Boolean).join(' · ') || 'Person'}
            actions={
              <>
                {c.archivedAt && <Badge tone="warn">Archived</Badge>}
                {!c.permissions.edit && !c.archivedAt && <Badge>View only</Badge>}
                {c.permissions.edit && (
                  <Button variant="secondary" onClick={() => setEditing(true)}>
                    Edit
                  </Button>
                )}
              </>
            }
          />
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
            <Card title="Details" className="lg:sticky lg:top-5">
              <FieldList
                rows={[
                  [
                    'Email',
                    c.email && (
                      <a href={`mailto:${c.email}`} className="text-brand hover:underline">
                        {c.email}
                      </a>
                    ),
                  ],
                  ['Phone', c.phone],
                  ['Job title', c.jobTitle],
                  [
                    'Company',
                    c.company &&
                      (c.company.canOpen ? (
                        <Link to="/companies/$id" params={{ id: c.company.id }} className={recordLink}>
                          <Avatar name={c.company.name} shape="square" />
                          <span className="truncate">{c.company.name}</span>
                        </Link>
                      ) : (
                        c.company.name
                      )),
                  ],
                  ['Owner', c.owner?.fullName ? <PersonChip key="owner" name={c.owner.fullName} /> : null],
                ]}
              />
            </Card>
            <div className="min-w-0 space-y-4">
              <Card title="Opportunities" actions={<CountPill n={c.deals.length} />}>
                {c.deals.length === 0 ? (
                  <p className="text-[13px] text-muted">This person is not on any opportunity you can see.</p>
                ) : (
                  <ul className="-my-2 divide-y divide-line text-sm">
                    {c.deals.map((d) => (
                      <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Link to="/deals/$id" params={{ id: d.id }} className={recordLink}>
                            {d.name}
                          </Link>
                          {d.isPrimary && <Badge tone="info">Primary</Badge>}
                          {d.roles.map((r) => (
                            <Badge key={r}>{r}</Badge>
                          ))}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums text-muted">{money(d.amount, d.currency)}</span>
                          <Badge tone={statusTone(d.status)}>{d.stageName}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              <Card title="Timeline">
                <Timeline type="contact" id={id} />
              </Card>
            </div>
          </div>
          {editing && <ContactEditDialog contact={c} onClose={() => setEditing(false)} onDone={refresh} />}
        </>
      )}
    </Query>
  );
}

// ───────────── timeline ─────────────
const ACTOR_TONE = { user: 'neutral', buyer: 'info', system: 'warn', ai: 'info' } as const;
const TIMELINE_FILTERS: [string, string][] = [
  ['note', 'Notes'],
  ['call_log', 'Calls'],
  ['meeting_log', 'Meetings'],
  ['stage_changed', 'Stage changes'],
  ['owner_changed', 'Owner changes'],
  ['deal_updated,company_updated,contact_updated,company_archived', 'Record edits'],
  ['proposal_version_sent', 'Proposals sent'],
  ['proposal_viewed', 'Proposal views'],
  ['signature_completed', 'Signatures'],
  ['automation_applied', 'Automated actions'],
];
/** Icon + tint for a timeline event, by event type (Twenty-style activity rail). */
function eventStyle(type: string, automated: boolean): { icon: LucideIcon; tint: string } {
  if (automated) return { icon: Zap, tint: 'bg-amber-50 text-amber-700' };
  const t = type ?? '';
  if (t === 'note') return { icon: StickyNote, tint: 'bg-yellow-50 text-yellow-700' };
  if (t === 'call_log') return { icon: Phone, tint: 'bg-sky-50 text-sky-700' };
  if (t === 'meeting_log') return { icon: CalendarDays, tint: 'bg-violet-50 text-violet-700' };
  if (t === 'stage_changed') return { icon: ArrowRightLeft, tint: 'bg-info-soft text-info-ink' };
  if (t.includes('won')) return { icon: Trophy, tint: 'bg-green-50 text-green-700' };
  if (t === 'owner_changed') return { icon: UserCog, tint: 'bg-slate-100 text-slate-600' };
  if (t.startsWith('signature')) return { icon: PenLine, tint: 'bg-brand-soft text-brand' };
  if (t === 'proposal_viewed') return { icon: Eye, tint: 'bg-brand-soft text-brand' };
  if (t.startsWith('proposal')) return { icon: FileText, tint: 'bg-brand-soft text-brand' };
  if (t.endsWith('_created')) return { icon: Plus, tint: 'bg-green-50 text-green-700' };
  if (t.endsWith('_updated') || t.endsWith('_archived')) return { icon: Pencil, tint: 'bg-slate-100 text-slate-600' };
  if (t.includes('task')) return { icon: Check, tint: 'bg-green-50 text-green-700' };
  return { icon: Circle, tint: 'bg-slate-100 text-slate-500' };
}

/** BR-TIM-001..004: one chronological history with a type filter; every event shows who did it and when. */
export function Timeline({ type, id }: { type: 'deal' | 'company' | 'contact'; id: string }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState('');
  const q = useQuery({
    queryKey: ['timeline', type, id, filter],
    queryFn: () =>
      get<any[]>(
        `/timeline/${type}/${id}${
          filter
            ? `?${filter
                .split(',')
                .map((t) => `type=${t}`)
                .join('&')}`
            : ''
        }`,
      ),
    refetchInterval: 20_000,
  });
  const reverse = useAction((execId: string) => post(`/automation/executions/${execId}/reverse`), {
    success: 'Automated change reversed',
    onDone: () => void qc.invalidateQueries(),
  });
  return (
    <>
      <Select aria-label="Filter timeline by type" className="mb-3 max-w-xs" value={filter} onChange={(e) => setFilter(e.target.value)}>
        <option value="">All activity</option>
        {TIMELINE_FILTERS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </Select>
      <Query q={q}>
        {(events) =>
          events.length === 0 ? (
            <p className="text-sm text-muted">No activity yet.</p>
          ) : (
            <ol className="relative" aria-label="Timeline">
              {events.map((e, i) => {
                const { icon: Icon, tint } = eventStyle(e.eventType, e.isAutomated);
                return (
                  <li key={e.id} className="relative flex gap-3 pb-4 text-sm last:pb-0">
                    {i < events.length - 1 && <span aria-hidden className="absolute bottom-0 left-[13px] top-7 w-px bg-line" />}
                    <span aria-hidden className={`relative z-10 flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-white ${tint}`}>
                      <Icon className="size-3.5" />
                    </span>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className="whitespace-pre-wrap text-ink">{e.summary}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Badge tone={ACTOR_TONE[e.actorType as keyof typeof ACTOR_TONE]}>{e.actorType === 'user' ? e.actorName : e.actorType}</Badge>
                        {e.isAutomated && <Badge tone="warn">Automated</Badge>}
                        <time dateTime={e.occurredAt}>{dateTime(e.occurredAt)}</time>
                        {e.isAutomated && e.automationExecutionId && (
                          <ConfirmButton
                            variant="secondary"
                            label="Reverse"
                            confirm="Reverse this automated change? The record returns to its previous values."
                            onConfirm={() => reverse.run(e.automationExecutionId)}
                          />
                        )}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ol>
          )
        }
      </Query>
    </>
  );
}

export function TasksPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tasks', 'mine'], queryFn: () => get<any[]>('/tasks') });
  const done = useAction((taskId: string) => post(`/tasks/${taskId}/complete`), {
    success: 'Task completed',
    onDone: () => void qc.invalidateQueries({ queryKey: ['tasks'] }),
  });
  return (
    <>
      <PageHeader title="Tasks" subtitle="Open tasks assigned to you, soonest first" />
      <Query q={q}>
        {(tasks) =>
          tasks.length === 0 ? (
            <EmptyState title="You are all caught up" hint="Tasks you create, and follow-ups the system creates for you, appear here." />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-white" aria-label="My open tasks">
              {tasks.map((t) => {
                const overdue = new Date(t.dueAt) < new Date();
                return (
                  <li key={t.id} className="group flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-surface/70">
                    <button
                      type="button"
                      aria-label={`Complete ${t.title}`}
                      title="Mark complete"
                      disabled={done.busy}
                      onClick={() => done.run(t.id)}
                      className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong text-transparent transition-colors hover:border-brand hover:bg-brand-soft hover:text-brand disabled:opacity-50"
                    >
                      <Check className="size-3" aria-hidden />
                    </button>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">
                        {t.relatedType === 'deal' ? (
                          <Link to="/deals/$id" params={{ id: t.relatedId }} className={recordLink}>
                            {t.title}
                          </Link>
                        ) : (
                          t.title
                        )}
                      </p>
                      {t.description && <p className="truncate text-xs text-muted">{t.description}</p>}
                    </div>
                    {t.source === 'automation' && <Badge tone="warn">Automated</Badge>}
                    <span className={`flex shrink-0 items-center gap-1 text-xs tabular-nums ${overdue ? 'font-medium text-danger' : 'text-muted'}`}>
                      <CalendarDays className="size-3.5" aria-hidden />
                      {dateTime(t.dueAt)}
                    </span>
                    {overdue && <Badge tone="danger">Overdue</Badge>}
                  </li>
                );
              })}
            </ul>
          )
        }
      </Query>
    </>
  );
}

export { patch };
