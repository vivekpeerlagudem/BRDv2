import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { type FormEvent, type ReactNode, useMemo, useState } from 'react';
import { ApiError, dateTime, get, money, patch, personName, post } from '../lib/api.ts';
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  Dialog,
  EmptyState,
  Field,
  formValues,
  Input,
  PageHeader,
  Query,
  Select,
  statusTone,
  Table,
  useAction,
} from '../lib/ui.tsx';

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
          <thead className="border-b border-line bg-surface text-xs uppercase tracking-wide text-muted">
            <tr>
              {columns.map((c) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    className="px-3 py-2 font-medium"
                    aria-sort={!c.sortValue ? undefined : active ? (sort?.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  >
                    {c.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggle(c.key)}
                        title={`Sort by ${c.label}`}
                        className={`inline-flex items-center gap-1 uppercase tracking-wide hover:text-ink ${active ? 'text-ink' : ''}`}
                      >
                        {c.label}
                        <span aria-hidden="true" className={active ? '' : 'opacity-30'}>
                          {active && sort?.dir === 'desc' ? '▼' : '▲'}
                        </span>
                      </button>
                    ) : (
                      c.label
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-line [&_td]:px-3 [&_td]:py-2 [&_tr:hover]:bg-surface/60">
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
          ? 'Another contact already uses this email address. Nothing was saved.'
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

function Details({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {rows.map(([k, v]) => (
        <div key={k} className="flex justify-between gap-4">
          <dt className="text-muted">{k}</dt>
          <dd className="text-right font-medium">{v || '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

// ───────────── companies ─────────────
const companyColumns: Column<CompanyRow>[] = [
  {
    key: 'name',
    label: 'Name',
    sortValue: (c) => c.name,
    render: (c) => (
      <Link to="/companies/$id" params={{ id: c.id }} className="font-medium text-brand hover:underline">
        {c.name}
      </Link>
    ),
  },
  { key: 'domain', label: 'Domain', sortValue: (c) => c.domain, render: (c) => c.domain ?? '—' },
  { key: 'industry', label: 'Industry', sortValue: (c) => c.industry, render: (c) => c.industry ?? '—' },
  { key: 'owner', label: 'Owner', sortValue: (c) => c.ownerName, render: (c) => c.ownerName },
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
      <Input className="mb-3 max-w-sm" placeholder="Filter by name or domain" aria-label="Filter companies" value={q} onChange={(e) => setQ(e.target.value)} />
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
          <div className="mt-2 grid gap-4 lg:grid-cols-3">
            <Card title="Details">
              <Details
                rows={[
                  ['Domain', c.domain],
                  ['Industry', c.industry],
                  ['Phone', c.phone],
                  ['Website', c.website],
                  ['Owner', c.owner?.fullName],
                ]}
              />
            </Card>
            <Card title="Deals">
              {c.deals.length === 0 ? (
                <p className="text-sm text-muted">No deals yet.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {c.deals.map((d) => (
                    <li key={d.id} className="flex items-center justify-between py-2">
                      <Link to="/deals/$id" params={{ id: d.id }} className="text-brand hover:underline">
                        {d.name}
                      </Link>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{money(d.amount, d.currency)}</span>
                        <Badge tone={statusTone(d.status)}>{d.status}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Contacts">
              {c.contacts.length === 0 ? (
                <p className="text-sm text-muted">No contacts yet.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {c.contacts.map((p) => (
                    <li key={p.id} className="py-2">
                      <Link to="/contacts/$id" params={{ id: p.id }} className="font-medium text-brand hover:underline">
                        {personName(p)}
                      </Link>{' '}
                      <span className="text-muted">{p.jobTitle ?? ''}</span>
                      <span className="block text-xs text-muted">{p.email}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Timeline" className="lg:col-span-3">
              <Timeline type="company" id={id} />
            </Card>
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
      <Link to="/contacts/$id" params={{ id: c.id }} className="font-medium text-brand hover:underline">
        {personName(c)}
      </Link>
    ),
  },
  { key: 'email', label: 'Email', sortValue: (c) => c.email, render: (c) => c.email ?? '—' },
  { key: 'title', label: 'Title', sortValue: (c) => c.jobTitle, render: (c) => c.jobTitle ?? '—' },
  {
    key: 'company',
    label: 'Company',
    sortValue: (c) => c.companyName,
    render: (c) =>
      c.companyId ? (
        <Link to="/companies/$id" params={{ id: c.companyId }} className="text-brand hover:underline">
          {c.companyName}
        </Link>
      ) : (
        '—'
      ),
  },
  { key: 'owner', label: 'Owner', sortValue: (c) => c.ownerName, render: (c) => c.ownerName },
];

export function ContactsPage() {
  const qc = useQueryClient();
  const { q, setQ, query } = useList<ContactRow>('contacts', '/contacts');
  const companies = useQuery({ queryKey: ['companies', ''], queryFn: () => get<Page<CompanyRow>>(`/companies?limit=${LIST_LIMIT}`) });
  const [open, setOpen] = useState(false);
  const create = useAction((v: Record<string, string | undefined>) => post('/contacts', v), {
    success: 'Contact created',
    onDone: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['contacts'] });
    },
  });
  return (
    <>
      <PageHeader
        title="Contacts"
        subtitle={query.data ? `${query.data.total} contacts you can see` : undefined}
        actions={<Button onClick={() => setOpen(true)}>New contact</Button>}
      />
      <Input className="mb-3 max-w-sm" placeholder="Filter by name or email" aria-label="Filter contacts" value={q} onChange={(e) => setQ(e.target.value)} />
      <Query q={query}>
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState title={q ? 'No contacts match your filter' : 'No contacts yet'} action={<Button onClick={() => setOpen(true)}>New contact</Button>} />
          ) : (
            <SortableTable
              label="Contacts"
              columns={contactColumns}
              rows={d.items}
              rowKey={(c) => c.id}
              total={d.total}
              initialSort={{ key: 'name', dir: 'asc' }}
            />
          )
        }
      </Query>
      <Dialog open={open} onClose={() => setOpen(false)} title="New contact">
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
          <Field label="Company">
            <Select name="companyId" defaultValue="">
              <option value="">No company</option>
              {companies.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <ActionError error={create.error} />
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.busy}>
              Create contact
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
      success: 'Contact updated',
      onDone: () => {
        onDone();
        onClose();
      },
    },
  );
  const options = companies.data?.items ?? [];
  const currentListed = !contact.company || options.some((c) => c.id === contact.company?.id);
  return (
    <Dialog open onClose={onClose} title="Edit contact">
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
            title={personName(c)}
            subtitle={[c.jobTitle, c.company?.name].filter(Boolean).join(' · ') || 'Contact'}
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
          <div className="grid gap-4 lg:grid-cols-3">
            <Card title="Details">
              <Details
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
                        <Link to="/companies/$id" params={{ id: c.company.id }} className="text-brand hover:underline">
                          {c.company.name}
                        </Link>
                      ) : (
                        c.company.name
                      )),
                  ],
                  ['Owner', c.owner?.fullName],
                ]}
              />
            </Card>
            <Card title="Deals" className="lg:col-span-2">
              {c.deals.length === 0 ? (
                <p className="text-sm text-muted">This contact is not on any deal you can see.</p>
              ) : (
                <ul className="divide-y divide-line text-sm">
                  {c.deals.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Link to="/deals/$id" params={{ id: d.id }} className="text-brand hover:underline">
                          {d.name}
                        </Link>
                        {d.isPrimary && <Badge tone="info">Primary</Badge>}
                        {d.roles.map((r) => (
                          <Badge key={r}>{r}</Badge>
                        ))}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="tabular-nums">{money(d.amount, d.currency)}</span>
                        <Badge tone={statusTone(d.status)}>{d.stageName}</Badge>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
            <Card title="Timeline" className="lg:col-span-3">
              <Timeline type="contact" id={id} />
            </Card>
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
            <ol className="space-y-3" aria-label="Timeline">
              {events.map((e) => (
                <li key={e.id} className="border-l-2 border-line pl-3 text-sm">
                  <p className="whitespace-pre-wrap text-ink">{e.summary}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
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
                </li>
              ))}
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
      <PageHeader title="My tasks" subtitle="Open tasks assigned to you, soonest first" />
      <Query q={q}>
        {(tasks) =>
          tasks.length === 0 ? (
            <EmptyState title="You are all caught up" hint="Tasks you create, and follow-ups the system creates for you, appear here." />
          ) : (
            <Table head={['Task', 'Due', 'Source', '']}>
              {tasks.map((t) => {
                const overdue = new Date(t.dueAt) < new Date();
                return (
                  <tr key={t.id}>
                    <td>
                      {t.relatedType === 'deal' ? (
                        <Link to="/deals/$id" params={{ id: t.relatedId }} className="text-brand hover:underline">
                          {t.title}
                        </Link>
                      ) : (
                        t.title
                      )}
                    </td>
                    <td>
                      {dateTime(t.dueAt)} {overdue && <Badge tone="danger">Overdue</Badge>}
                    </td>
                    <td>{t.source === 'automation' ? <Badge tone="warn">Automated</Badge> : 'Manual'}</td>
                    <td className="text-right">
                      <Button variant="secondary" disabled={done.busy} onClick={() => done.run(t.id)}>
                        Complete
                      </Button>
                    </td>
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

export { patch };
