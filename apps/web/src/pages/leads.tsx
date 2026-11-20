import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { type FormEvent, useState } from 'react';
import { ApiError, dateTime, del, get, patch, post } from '../lib/api.ts';
import { useMe } from '../lib/me.ts';
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
  Textarea,
  useAction,
} from '../lib/ui.tsx';
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
interface UserRow {
  userId: string;
  fullName: string;
  role: string;
  status?: string;
}

const STATUS: Record<LeadStatus, string> = { new: 'New', working: 'Working', qualified: 'Qualified', unqualified: 'Unqualified', converted: 'Converted' };
/** Form values with empty strings dropped, so blank optional fields are treated as "unchanged / not set". */
const clean = (e: FormEvent<HTMLFormElement>) => Object.fromEntries(Object.entries(formValues(e)).filter(([, v]) => v !== undefined && v !== ''));

export function LeadsPage() {
  const me = useMe();
  const qc = useQueryClient();
  const canManage = Boolean(me.data?.permissions['lead.manage']);
  const canReassign = me.data?.user.role !== 'salesperson';
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const [dialog, setDialog] = useState<null | { kind: 'new' } | { kind: 'convert' | 'edit' | 'disqualify'; lead: LeadRow }>(null);

  const leads = useQuery({
    queryKey: ['leads', status, q],
    queryFn: () => get<{ items: LeadRow[]; total: number }>(`/leads?limit=100${status ? `&status=${status}` : ''}${q ? `&q=${encodeURIComponent(q)}` : ''}`),
  });
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<UserRow[]>('/users') });
  const companies = useQuery({ queryKey: ['companies', ''], queryFn: () => get<{ items: { id: string; name: string }[] }>('/companies?limit=100') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['leads'] });
    setDialog(null);
  };

  const qualify = useAction((id: string) => post(`/leads/${id}/qualify`), { success: 'Lead qualified', onDone: refresh });
  const remove = useAction((id: string) => del(`/leads/${id}`), { success: 'Lead deleted', onDone: refresh });

  const actions = (x: LeadRow) => {
    if (!canManage) return null;
    if (x.status === 'converted')
      return x.convertedDealId ? (
        <Link to="/deals/$id" params={{ id: x.convertedDealId }} className="text-sm text-brand hover:underline">
          Open deal
        </Link>
      ) : (
        <span className="text-xs text-muted">Converted</span>
      );
    return (
      <div className="flex flex-wrap justify-end gap-1">
        {x.status !== 'qualified' && (
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => qualify.run(x.id)}>
            Qualify
          </Button>
        )}
        <Button className="px-2 py-1 text-xs" onClick={() => setDialog({ kind: 'convert', lead: x })}>
          Convert
        </Button>
        <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setDialog({ kind: 'edit', lead: x })}>
          Edit
        </Button>
        {x.status !== 'unqualified' && (
          <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setDialog({ kind: 'disqualify', lead: x })}>
            Disqualify
          </Button>
        )}
        <ConfirmButton label="Delete" confirm="Delete this lead? This cannot be undone." onConfirm={() => remove.run(x.id)} />
      </div>
    );
  };

  const columns: Column<LeadRow>[] = [
    {
      key: 'name',
      label: 'Lead',
      sortValue: (x) => x.name,
      render: (x) => (
        <div>
          <p className="font-medium">{x.name}</p>
          <p className="text-xs text-muted">
            {x.email || '—'}
            {x.jobTitle ? ` · ${x.jobTitle}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'company', label: 'Company', sortValue: (x) => x.companyName ?? '', render: (x) => x.companyName || '—' },
    { key: 'status', label: 'Status', sortValue: (x) => x.status, render: (x) => <Badge tone={statusTone(x.status)}>{STATUS[x.status]}</Badge> },
    { key: 'owner', label: 'Owner', sortValue: (x) => x.ownerName, render: (x) => x.ownerName },
    { key: 'created', label: 'Added', sortValue: (x) => x.createdAt, render: (x) => dateTime(x.createdAt) },
    { key: 'actions', label: '', render: actions },
  ];

  return (
    <>
      <PageHeader
        title="Leads"
        subtitle="Capture, qualify and convert prospects into companies, contacts and deals"
        actions={canManage ? <Button onClick={() => setDialog({ kind: 'new' })}>New lead</Button> : undefined}
      />
      <div className="mb-3 flex flex-wrap gap-2">
        <Input aria-label="Search leads" placeholder="Search name, email or company" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
        <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option>
          {(Object.keys(STATUS) as LeadStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS[s]}
            </option>
          ))}
        </Select>
      </div>
      <Query q={leads} rows={6}>
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState
              title="No leads"
              hint="Create a lead manually, or they arrive from the website form below."
              action={canManage ? <Button onClick={() => setDialog({ kind: 'new' })}>New lead</Button> : undefined}
            />
          ) : (
            <SortableTable label="Leads" columns={columns} rows={d.items} rowKey={(x) => x.id} total={d.total} />
          )
        }
      </Query>

      <LeadInbox />

      {dialog?.kind === 'new' && <NewLeadDialog users={users.data ?? []} canReassign={canReassign} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'convert' && (
        <ConvertDialog lead={dialog.lead} companies={companies.data?.items ?? []} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog?.kind === 'edit' && <EditLeadDialog lead={dialog.lead} onClose={() => setDialog(null)} onDone={refresh} />}
      {dialog?.kind === 'disqualify' && <DisqualifyDialog lead={dialog.lead} onClose={() => setDialog(null)} onDone={refresh} />}
    </>
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
                    <option key={u.userId} value={u.userId}>
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
            A lead or contact with this email already exists.
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

function ConvertDialog({
  lead,
  companies,
  onClose,
  onDone,
}: {
  lead: LeadRow;
  companies: { id: string; name: string }[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [createDeal, setCreateDeal] = useState(true);
  const convert = useAction((v: Record<string, unknown>) => post<{ dealId: string | null }>(`/leads/${lead.id}/convert`, v), {
    success: 'Lead converted',
    onDone,
  });
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = formValues(e);
    convert.run({ companyId: f.companyId || undefined, createDeal, dealName: f.dealName || undefined, amount: f.amount || undefined });
  };
  return (
    <Dialog open onClose={onClose} title={`Convert ${lead.name}`}>
      <form className="space-y-3" onSubmit={submit}>
        <p className="text-sm text-muted">
          Creates a contact{lead.companyName || companies.length ? ', company' : ''} and (optionally) a deal, then marks the lead converted.
        </p>
        <Field label="Company" hint={lead.companyName ? `Leave as “create” to make “${lead.companyName}”` : 'Pick an existing company, or leave blank'}>
          <Select name="companyId" defaultValue="">
            <option value="">{lead.companyName ? `Create “${lead.companyName}”` : 'No company'}</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={createDeal} onChange={(e) => setCreateDeal(e.target.checked)} /> Create a deal
        </label>
        {createDeal && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Deal name">
              <Input name="dealName" defaultValue={lead.name} />
            </Field>
            <Field label="Amount">
              <Input name="amount" inputMode="decimal" placeholder="25000.00" />
            </Field>
          </div>
        )}
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
            <Table head={['Received', 'Name', 'Email', 'Company', 'Result', 'Deal']}>
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
                        Open deal
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
