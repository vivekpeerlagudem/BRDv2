import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { MoreHorizontal } from 'lucide-react';
import { type FormEvent, useEffect, useRef, useState } from 'react';
import { ApiError, dateTime, del, get, patch, post } from '../lib/api.ts';
import { useMe } from '../lib/me.ts';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  FieldList,
  formValues,
  Input,
  PageHeader,
  PersonChip,
  Query,
  SearchInput,
  Select,
  statusTone,
  Table,
  Textarea,
  useAction,
} from '../lib/ui.tsx';
import { AssignmentBanner } from './copilot-assignments.tsx';
import { ActionError, type Column, SortableTable } from './crm.tsx';

type LeadStatus = 'new' | 'working' | 'qualified' | 'unqualified' | 'converted';
interface LeadRow {
  id: string;
  name: string;
  companyName: string | null;
  email: string | null;
  phone: string | null;
  jobTitle: string | null;
  source: string;
  status: LeadStatus;
  ownerId: string;
  ownerName: string;
  notes: string | null;
  disqualifyReason: string | null;
  convertedCompanyId: string | null;
  convertedContactId: string | null;
  convertedDealId: string | null;
  createdAt: string;
  rowVersion: number;
}
interface CompanyOption {
  id: string;
  name: string;
}
interface UserRow {
  id: string;
  fullName: string;
  role: string;
  status?: string;
}

const STATUS: Record<LeadStatus, string> = { new: 'New', working: 'Working', qualified: 'Qualified', unqualified: 'Unqualified', converted: 'Converted' };
const STATUS_ORDER: LeadStatus[] = ['new', 'working', 'qualified', 'unqualified', 'converted'];
/** The happy path a lead moves along; "unqualified" is a side exit that can be reopened. */
const STEPS: LeadStatus[] = ['new', 'working', 'qualified', 'converted'];
/** Form values with empty strings dropped, so blank optional fields are treated as "unchanged / not set". */
const clean = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(Object.entries(formValues(e)).filter(([, v]) => v !== undefined && v !== ''));
const normName = (s: string | null | undefined) => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

type DialogState = null | { kind: 'new' } | { kind: 'details' | 'convert' | 'edit' | 'disqualify' | 'reassign' | 'delete'; lead: LeadRow };

export function LeadsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const canManage = Boolean(me.data?.permissions['lead.manage']);
  const canReassign = me.data?.user.role !== 'salesperson';
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<DialogState>(null);

  // One list for the counts and the tabs; filtering by status happens here, so every tab shows its count.
  const leads = useQuery({
    queryKey: ['leads', q],
    queryFn: () => get<{ items: LeadRow[]; total: number }>(`/leads?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<UserRow[]>('/users'), enabled: canReassign });
  const companies = useQuery({ queryKey: ['companies', ''], queryFn: () => get<{ items: CompanyOption[] }>('/companies?limit=100') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['leads'] });
    setDialog(null);
  };

  const qualify = useAction((id: string) => post(`/leads/${id}/qualify`), { success: 'Lead qualified', onDone: refresh });
  const setLeadStatus = useAction(
    (x: { lead: LeadRow; status: 'new' | 'working' }) => patch(`/leads/${x.lead.id}`, { status: x.status, rowVersion: x.lead.rowVersion }),
    {
      success: 'Lead updated',
      onDone: refresh,
    },
  );
  const remove = useAction((id: string) => del(`/leads/${id}`), { success: 'Lead deleted', onDone: refresh });
  const busy = qualify.busy || setLeadStatus.busy;

  /** The single next step for a lead, as a button. */
  const nextStep = (x: LeadRow) => {
    switch (x.status) {
      case 'new':
        return { label: 'Start working', run: () => setLeadStatus.run({ lead: x, status: 'working' }) };
      case 'working':
        return { label: 'Qualify', run: () => qualify.run(x.id) };
      case 'qualified':
        return { label: 'Convert…', run: () => setDialog({ kind: 'convert', lead: x }) };
      case 'unqualified':
        return { label: 'Reopen', run: () => setLeadStatus.run({ lead: x, status: 'new' }) };
      default:
        return null;
    }
  };

  const actions = (x: LeadRow) => {
    if (x.status === 'converted') return <ConvertedLinks lead={x} />;
    if (!canManage) return null;
    const step = nextStep(x);
    return (
      <div className="flex items-center justify-end gap-1.5">
        {step && (
          <Button variant={x.status === 'qualified' ? 'primary' : 'secondary'} className="h-7 px-2.5 text-[13px]" disabled={busy} onClick={step.run}>
            {step.label}
          </Button>
        )}
        <RowMenu
          label={`More actions for ${x.name}`}
          items={[
            { label: 'View details', run: () => setDialog({ kind: 'details', lead: x }) },
            { label: 'Edit', run: () => setDialog({ kind: 'edit', lead: x }) },
            // Skip ahead: a new or working lead can be converted directly (qualified leads have it as their main button).
            ...(x.status === 'new' || x.status === 'working' ? [{ label: 'Convert…', run: () => setDialog({ kind: 'convert', lead: x }) }] : []),
            ...(canReassign ? [{ label: 'Reassign…', run: () => setDialog({ kind: 'reassign', lead: x }) }] : []),
            ...(x.status !== 'unqualified' ? [{ label: 'Disqualify…', run: () => setDialog({ kind: 'disqualify', lead: x }) }] : []),
            { label: 'Delete', danger: true, run: () => setDialog({ kind: 'delete', lead: x }) },
          ]}
        />
      </div>
    );
  };

  const columns: Column<LeadRow>[] = [
    {
      key: 'name',
      label: 'Lead',
      sortValue: (x) => x.name,
      render: (x) => (
        <button type="button" className="flex min-w-0 cursor-pointer items-center gap-2.5 text-left" onClick={() => setDialog({ kind: 'details', lead: x })}>
          <Avatar name={x.name} size="md" />
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink hover:text-brand hover:underline">{x.name}</span>
            <span className="block truncate text-xs text-muted">
              {x.email || x.phone || '—'}
              {x.jobTitle ? ` · ${x.jobTitle}` : ''}
            </span>
          </span>
        </button>
      ),
    },
    {
      key: 'company',
      label: 'Company',
      sortValue: (x) => x.companyName ?? '',
      render: (x) =>
        x.companyName ? (
          <span className="inline-flex items-center gap-2">
            <Avatar name={x.companyName} shape="square" />
            <span className="truncate">{x.companyName}</span>
          </span>
        ) : (
          '—'
        ),
    },
    { key: 'source', label: 'Source', sortValue: (x) => x.source, render: (x) => <span className="capitalize text-muted">{x.source || 'manual'}</span> },
    {
      key: 'status',
      label: 'Status',
      sortValue: (x) => STATUS_ORDER.indexOf(x.status),
      render: (x) => <Badge tone={statusTone(x.status)}>{STATUS[x.status]}</Badge>,
    },
    { key: 'owner', label: 'Owner', sortValue: (x) => x.ownerName, render: (x) => <PersonChip name={x.ownerName} /> },
    { key: 'created', label: 'Added', sortValue: (x) => x.createdAt, render: (x) => dateTime(x.createdAt) },
    { key: 'actions', label: '', render: actions },
  ];

  const all = leads.data?.items ?? [];
  const count = (s: LeadStatus | '') => (s ? all.filter((x) => x.status === s).length : all.length);
  const visible = status ? all.filter((x) => x.status === status) : all;
  const deleting = dialog?.kind === 'delete' ? dialog.lead : null;

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Capture prospects, work and qualify them, then convert them into a company, person and opportunity"
        actions={canManage ? <Button onClick={() => setDialog({ kind: 'new' })}>New lead</Button> : undefined}
      />
      {me.data && <AssignmentBanner userId={me.data.user.id} />}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="Lead status" className="flex flex-wrap gap-0.5 rounded-lg border border-line bg-surface p-0.5">
          {(['', ...STATUS_ORDER] as const).map((s) => (
            <button
              key={s || 'all'}
              type="button"
              role="tab"
              aria-selected={status === s}
              onClick={() => setStatus(s)}
              className={`flex cursor-pointer items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors ${
                status === s ? 'bg-white text-ink shadow-xs' : 'text-muted hover:text-ink'
              }`}
            >
              {s ? STATUS[s] : 'All'}
              <span className="rounded bg-black/[0.05] px-1.5 text-xs tabular-nums text-muted">{count(s)}</span>
            </button>
          ))}
        </div>
        <SearchInput
          aria-label="Search leads"
          placeholder="Search name, email or company"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="w-full max-w-xs"
        />
      </div>
      <Query q={leads} rows={6}>
        {() =>
          visible.length === 0 ? (
            <EmptyState
              title={q || status ? 'No leads match' : 'No leads yet'}
              hint={q || status ? 'Try another status or search.' : 'Create a lead manually, or they arrive from your website form below.'}
              action={canManage && !q && !status ? <Button onClick={() => setDialog({ kind: 'new' })}>New lead</Button> : undefined}
            />
          ) : (
            <SortableTable label="Leads" columns={columns} rows={visible} rowKey={(x) => x.id} total={visible.length} />
          )
        }
      </Query>

      <LeadInbox />

      {dialog?.kind === 'new' && <NewLeadDialog users={users.data ?? []} canReassign={canReassign} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'details' && (
        <LeadDetailsDialog
          lead={all.find((x) => x.id === dialog.lead.id) ?? dialog.lead}
          step={canManage ? nextStep(all.find((x) => x.id === dialog.lead.id) ?? dialog.lead) : null}
          busy={busy}
          onEdit={canManage && dialog.lead.status !== 'converted' ? () => setDialog({ kind: 'edit', lead: dialog.lead }) : undefined}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'convert' && (
        <ConvertDialog lead={dialog.lead} companies={companies.data?.items ?? []} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog?.kind === 'edit' && <EditLeadDialog lead={dialog.lead} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'disqualify' && <DisqualifyDialog lead={dialog.lead} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'reassign' && <ReassignDialog lead={dialog.lead} users={users.data ?? []} onClose={() => setDialog(null)} onDone={refresh} />}
      {deleting && (
        <Dialog open onClose={() => setDialog(null)} title="Please confirm">
          <p className="text-sm text-ink">Delete the lead {deleting.name}? This cannot be undone.</p>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button variant="danger" disabled={remove.busy} onClick={() => remove.run(deleting.id)}>
              Delete
            </Button>
          </div>
        </Dialog>
      )}
    </>
  );
}

/** Links to what a converted lead became. */
function ConvertedLinks({ lead }: { lead: LeadRow }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1 text-[13px]">
      {lead.convertedDealId && (
        <Link to="/deals/$id" params={{ id: lead.convertedDealId }} className="font-medium text-brand hover:underline">
          Open opportunity
        </Link>
      )}
      {lead.convertedContactId && (
        <Link to="/contacts/$id" params={{ id: lead.convertedContactId }} className="text-brand hover:underline">
          Person
        </Link>
      )}
      {lead.convertedCompanyId && (
        <Link to="/companies/$id" params={{ id: lead.convertedCompanyId }} className="text-brand hover:underline">
          Company
        </Link>
      )}
    </div>
  );
}

/** Small "⋯" menu for secondary row actions; closes on outside click and Escape. */
function RowMenu({ label, items }: { label: string; items: { label: string; run: () => void; danger?: boolean }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex size-7 cursor-pointer items-center justify-center rounded text-muted transition-colors hover:bg-surface hover:text-ink"
      >
        <MoreHorizontal className="size-4" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-30 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-pop">
          {items.map((i) => (
            <button
              key={i.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                i.run();
              }}
              className={`block w-full cursor-pointer px-3 py-1.5 text-left text-sm hover:bg-surface ${i.danger ? 'text-danger' : 'text-ink'}`}
            >
              {i.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Read view of a lead: where it is in the process, its details and notes, and the next step. */
function LeadDetailsDialog({
  lead,
  step,
  busy,
  onEdit,
  onClose,
}: {
  lead: LeadRow;
  step: { label: string; run: () => void } | null;
  busy: boolean;
  onEdit?: () => void;
  onClose: () => void;
}) {
  const at = STEPS.indexOf(lead.status);
  return (
    <Dialog open onClose={onClose} title={lead.name}>
      <div className="space-y-4">
        <ol aria-label="Lead progress" className="flex items-center gap-1">
          {STEPS.map((s, i) => {
            const done = at >= 0 && i < at;
            const current = s === lead.status;
            return (
              <li key={s} className="flex flex-1 items-center gap-1">
                <span
                  aria-current={current ? 'step' : undefined}
                  className={`flex-1 rounded-md px-2 py-1 text-center text-xs font-medium ${
                    current ? 'bg-brand text-white' : done ? 'bg-brand-soft text-brand-dark' : 'bg-surface text-muted'
                  }`}
                >
                  {STATUS[s]}
                </span>
              </li>
            );
          })}
        </ol>
        {lead.status === 'unqualified' && (
          <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
            <strong className="font-semibold">Disqualified.</strong> {lead.disqualifyReason ?? ''}
          </p>
        )}
        <FieldList
          rows={[
            ['Company', lead.companyName],
            [
              'Email',
              lead.email ? (
                <a key="e" href={`mailto:${lead.email}`} className="text-brand hover:underline">
                  {lead.email}
                </a>
              ) : null,
            ],
            ['Phone', lead.phone],
            ['Job title', lead.jobTitle],
            [
              'Source',
              <span key="s" className="capitalize">
                {lead.source || 'manual'}
              </span>,
            ],
            ['Owner', <PersonChip key="o" name={lead.ownerName} />],
            ['Added', dateTime(lead.createdAt)],
          ]}
        />
        <div>
          <p className="mb-1 text-[13px] font-medium text-ink">Notes</p>
          <p className="whitespace-pre-wrap rounded-md bg-surface px-3 py-2 text-sm text-ink">
            {lead.notes || <span className="text-muted">No notes yet.</span>}
          </p>
        </div>
        {lead.status === 'converted' && (
          <div className="rounded-md border border-green-200 bg-green-50 px-3 py-2">
            <p className="mb-1 text-[13px] font-medium text-green-800">Converted</p>
            <ConvertedLinks lead={lead} />
          </div>
        )}
        <div className="flex justify-end gap-2 border-t border-line pt-3">
          {onEdit && (
            <Button variant="secondary" onClick={onEdit}>
              Edit
            </Button>
          )}
          {step && (
            <Button disabled={busy} onClick={step.run}>
              {step.label}
            </Button>
          )}
        </div>
      </div>
    </Dialog>
  );
}

function ReassignDialog({ lead, users, onClose, onDone }: { lead: LeadRow; users: UserRow[]; onClose: () => void; onDone: () => void }) {
  const assign = useAction((ownerId: string) => post(`/leads/${lead.id}/assign`, { ownerId }), { success: 'Lead reassigned', onDone });
  return (
    <Dialog open onClose={onClose} title={`Reassign ${lead.name}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          assign.run(String(formValues(e).ownerId ?? ''));
        }}
      >
        <Field label="New owner">
          <Select name="ownerId" defaultValue={lead.ownerId} required>
            {users
              .filter((u) => u.status !== 'deactivated')
              .map((u) => (
                <option key={u.id} value={u.id}>
                  {u.fullName}
                </option>
              ))}
          </Select>
        </Field>
        <ActionError error={assign.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={assign.busy}>
            Reassign
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function NewLeadDialog({ users, canReassign, onClose, onDone }: { users: UserRow[]; canReassign: boolean; onClose: () => void; onDone: () => void }) {
  const [vals, setVals] = useState<Record<string, unknown>>({});
  const create = useAction((v: Record<string, unknown>) => post('/leads', v), { success: 'Lead created', onDone });
  const duplicate = create.error instanceof ApiError && create.error.code === 'CONFIRMATION_REQUIRED';
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const v = clean(e);
    setVals(v);
    create.run(v);
  };
  return (
    <Dialog open onClose={onClose} title="New lead">
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Name" error={create.fieldError('name')}>
          <Input name="name" required placeholder="Jordan Avery" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company" error={create.fieldError('companyName')}>
            <Input name="companyName" placeholder="Acme Ltd" />
          </Field>
          <Field label="Email" error={create.fieldError('email')}>
            <Input name="email" type="email" placeholder="jordan@acme.com" />
          </Field>
          <Field label="Phone" error={create.fieldError('phone')}>
            <Input name="phone" />
          </Field>
          <Field label="Job title" error={create.fieldError('jobTitle')}>
            <Input name="jobTitle" />
          </Field>
          <Field label="Source" error={create.fieldError('source')}>
            <Input name="source" placeholder="referral, event, cold call…" />
          </Field>
          {canReassign && (
            <Field label="Assign to">
              <Select name="ownerId" defaultValue="">
                <option value="">Me</option>
                {users
                  .filter((u) => u.status !== 'deactivated')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.fullName}
                    </option>
                  ))}
              </Select>
            </Field>
          )}
        </div>
        <Field label="Notes" error={create.fieldError('notes')}>
          <Textarea name="notes" rows={3} />
        </Field>
        {duplicate ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-warn">
            A lead or person with this email already exists.
            <Button
              type="button"
              variant="secondary"
              className="ml-2 px-2 py-1 text-xs"
              onClick={() => create.run({ ...vals, confirm: ['DUPLICATE_SUSPECTED'] })}
            >
              Create anyway
            </Button>
          </div>
        ) : (
          <ActionError error={create.error} />
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={create.busy}>
            Create lead
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function EditLeadDialog({ lead, onClose, onDone }: { lead: LeadRow; onClose: () => void; onDone: () => void }) {
  const save = useAction((v: Record<string, unknown>) => patch(`/leads/${lead.id}`, { ...v, rowVersion: lead.rowVersion }), {
    success: 'Lead updated',
    onDone,
  });
  return (
    <Dialog open onClose={onClose} title={`Edit ${lead.name}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          save.run(clean(e));
        }}
      >
        <Field label="Name" error={save.fieldError('name')}>
          <Input name="name" required defaultValue={lead.name} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company" error={save.fieldError('companyName')}>
            <Input name="companyName" defaultValue={lead.companyName ?? ''} />
          </Field>
          <Field label="Email" error={save.fieldError('email')}>
            <Input name="email" type="email" defaultValue={lead.email ?? ''} />
          </Field>
          <Field label="Phone" error={save.fieldError('phone')}>
            <Input name="phone" defaultValue={lead.phone ?? ''} />
          </Field>
          <Field label="Job title" error={save.fieldError('jobTitle')}>
            <Input name="jobTitle" defaultValue={lead.jobTitle ?? ''} />
          </Field>
          <Field label="Source" error={save.fieldError('source')}>
            <Input name="source" defaultValue={lead.source} />
          </Field>
        </div>
        <Field label="Notes" error={save.fieldError('notes')}>
          <Textarea name="notes" rows={3} defaultValue={lead.notes ?? ''} />
        </Field>
        <ActionError error={save.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
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

function DisqualifyDialog({ lead, onClose, onDone }: { lead: LeadRow; onClose: () => void; onDone: () => void }) {
  const dq = useAction((v: Record<string, unknown>) => post(`/leads/${lead.id}/disqualify`, v), { success: 'Lead disqualified', onDone });
  return (
    <Dialog open onClose={onClose} title={`Disqualify ${lead.name}`}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          dq.run(formValues(e));
        }}
      >
        <Field label="Reason" hint="Recorded for win/loss reporting" error={dq.fieldError('reason')}>
          <Textarea name="reason" required rows={3} placeholder="Budget too small, no authority, not a fit…" />
        </Field>
        <ActionError error={dq.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="danger" disabled={dq.busy}>
            Disqualify
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

function ConvertDialog({ lead, companies, onClose, onDone }: { lead: LeadRow; companies: CompanyOption[]; onClose: () => void; onDone: () => void }) {
  // Suggest the existing company with the lead's company name, so converting never duplicates a company.
  const match = lead.companyName ? companies.find((c) => normName(c.name) === normName(lead.companyName)) : undefined;
  const [companyId, setCompanyId] = useState(match?.id ?? '');
  const [createDeal, setCreateDeal] = useState(true);
  const picked = companies.find((c) => c.id === companyId);
  const convert = useAction((v: Record<string, unknown>) => post<{ dealId: string | null }>(`/leads/${lead.id}/convert`, v), {
    success: 'Lead converted',
    onDone,
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = formValues(e);
    convert.run({ companyId: companyId || undefined, createDeal, dealName: f.dealName || undefined, amount: f.amount || undefined });
  };
  const companyOutcome = picked ? `Link to ${picked.name}` : lead.companyName ? `Create company “${lead.companyName}”` : 'No company';
  return (
    <Dialog open onClose={onClose} title={`Convert ${lead.name}`}>
      <form className="space-y-3" onSubmit={submit}>
        <Field label="Company" hint={match && companyId === match.id ? `“${lead.companyName}” already exists, so the person is linked to it.` : undefined}>
          <Select aria-label="Company" value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">{lead.companyName ? `Create “${lead.companyName}”` : 'No company'}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} /> Create an opportunity
        </label>
        {createDeal && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Opportunity name">
              <Input name="dealName" defaultValue={lead.companyName ? `${lead.companyName} — ${lead.name}` : lead.name} />
            </Field>
            <Field label="Amount" error={convert.fieldError('amount')}>
              <Input name="amount" inputMode="decimal" placeholder="25000.00" />
            </Field>
          </div>
        )}
        <div className="rounded-md bg-surface px-3 py-2 text-[13px] text-ink">
          <p className="mb-1 font-medium">This will</p>
          <ul className="list-inside list-disc space-y-0.5 text-muted">
            <li>Create the person {lead.name}, or reuse the one with the same email</li>
            <li>{companyOutcome}</li>
            {createDeal && <li>Create an opportunity for this company</li>}
            <li>Mark this lead Converted</li>
          </ul>
        </div>
        <ActionError error={convert.error} />
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={convert.busy}>
            Convert lead
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/** Inbound web-form submissions (round-robin auto-assigned), shown read-only beneath the managed leads. */
function LeadInbox() {
  const me = useMe();
  const key = me.data?.settings.leadFormKey;
  const inbox = useQuery({
    queryKey: ['leads', 'inbox'],
    queryFn: () => get<{ id: string; receivedAt: string; payload: Record<string, string>; spamVerdict: string; dealId: string | null }[]>('/leads/inbox'),
  });
  const formUrl = key ? `${location.protocol}//proposals.${location.host}/f?form=${key}` : '';
  return (
    <div className="mt-8">
      <h2 className="mb-2 text-sm font-semibold text-muted">Inbound web-form submissions</h2>
      {key && (
        <Card title="Your lead form" className="mb-3">
          <p className="text-sm text-muted">Embed this hosted form on your website (in an iframe):</p>
          <Input readOnly value={formUrl} aria-label="Lead form URL" onFocus={(e) => e.currentTarget.select()} />
        </Card>
      )}
      <Query q={inbox}>
        {(ls) =>
          ls.length === 0 ? (
            <EmptyState title="No submissions yet" hint="Submissions from the hosted form appear here within seconds." />
          ) : (
            <Table head={['Received', 'Name', 'Email', 'Company', 'Result', 'Opportunity']}>
              {ls.map((l) => (
                <tr key={l.id}>
                  <td>{dateTime(l.receivedAt)}</td>
                  <td>{[l.payload.firstName, l.payload.lastName].filter(Boolean).join(' ') || '—'}</td>
                  <td>{l.payload.email}</td>
                  <td>{l.payload.company ?? '—'}</td>
                  <td>
                    <Badge tone={l.spamVerdict === 'clean' ? 'ok' : 'danger'}>{l.spamVerdict === 'clean' ? 'Accepted' : 'Rejected as spam'}</Badge>
                  </td>
                  <td>
                    {l.dealId ? (
                      <Link to="/deals/$id" params={{ id: l.dealId }} className="text-brand hover:underline">
                        Open opportunity
                      </Link>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )
        }
      </Query>
    </div>
  );
}
