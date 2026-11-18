import type { ProposalDocument } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { dateTime, get, money, patch, post, put } from '../lib/api.ts';
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

const PLACEHOLDERS = ['company.name', 'contact.first_name', 'contact.full_name', 'deal.name', 'owner.full_name', 'organization.name', 'proposal.valid_until'];

export function AdminUsersPage() {
  const qc = useQueryClient();
  const me = useMe();
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<any[]>('/users') });
  const teams = useQuery({ queryKey: ['teams'], queryFn: () => get<{ id: string; name: string }[]>('/teams') });
  const [open, setOpen] = useState(false);
  const [deactivating, setDeactivating] = useState<any>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['users'] });
  const create = useAction((v: Record<string, string | undefined>) => post('/users', v), {
    success: 'User created',
    onDone: () => {
      setOpen(false);
      refresh();
    },
  });
  const update = useAction((x: { id: string; body: object }) => patch(`/users/${x.id}`, x.body), { success: 'User updated', onDone: refresh });
  const deactivate = useAction((x: { id: string; to: string }) => post(`/users/${x.id}/deactivate`, { reassignToUserId: x.to }), {
    success: 'User deactivated and records reassigned',
    onDone: () => {
      setDeactivating(null);
      refresh();
    },
  });
  return (
    <>
      <PageHeader
        title="Users and roles"
        subtitle="Accounts are created by an Admin — there is no public sign-up"
        actions={<Button onClick={() => setOpen(true)}>New user</Button>}
      />
      <Query q={users}>
        {(us) => (
          <Table head={['Name', 'Email', 'Role', 'Team', 'Can manage content', 'Status', '']}>
            {us.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.fullName}</td>
                <td>{u.email}</td>
                <td>
                  <Select
                    aria-label={`Role of ${u.fullName}`}
                    className="w-40"
                    value={u.role}
                    disabled={u.id === me.data?.user.id || u.status !== 'active'}
                    onChange={(e) => update.run({ id: u.id, body: { role: e.target.value } })}
                  >
                    <option value="admin">Admin</option>
                    <option value="sales_manager">Sales Manager</option>
                    <option value="salesperson">Salesperson</option>
                  </Select>
                </td>
                <td>{u.teamName ?? '—'}</td>
                <td>
                  {u.role === 'sales_manager' ? (
                    <input
                      type="checkbox"
                      aria-label={`${u.fullName} can manage templates and catalogue`}
                      checked={u.canManageContent}
                      onChange={(e) => update.run({ id: u.id, body: { canManageContent: e.target.checked } })}
                    />
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  <Badge tone={statusTone(u.status)}>{u.status}</Badge>
                </td>
                <td className="text-right">
                  {u.status === 'active' && u.id !== me.data?.user.id && (
                    <Button variant="secondary" onClick={() => setDeactivating(u)}>
                      Deactivate
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Query>
      <Dialog open={open} onClose={() => setOpen(false)} title="New user">
        <form className="space-y-3" onSubmit={(e) => create.run(formValues(e))}>
          <Field label="Full name" error={create.fieldError('fullName')}>
            <Input name="fullName" required />
          </Field>
          <Field label="Email" error={create.fieldError('email')}>
            <Input name="email" type="email" required />
          </Field>
          <Field label="Role">
            <Select name="role" defaultValue="salesperson">
              <option value="salesperson">Salesperson</option>
              <option value="sales_manager">Sales Manager</option>
              <option value="admin">Admin</option>
            </Select>
          </Field>
          <Field label="Team">
            <Select name="teamId" defaultValue="">
              <option value="">No team</option>
              {teams.data?.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Initial password" hint="At least 12 characters. Share it securely; the user should change it." error={create.fieldError('password')}>
            <Input name="password" type="password" minLength={12} required autoComplete="new-password" />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.busy}>
              Create user
            </Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={deactivating !== null} onClose={() => setDeactivating(null)} title={`Deactivate ${deactivating?.fullName ?? ''}`}>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            const v = formValues(e);
            if (v.to) deactivate.run({ id: deactivating.id, to: v.to });
          }}
        >
          <p className="text-sm text-muted">Their deals, companies, contacts and open tasks move to another user, and they are signed out immediately.</p>
          <Field label="Reassign records to">
            <Select name="to" required defaultValue="">
              <option value="" disabled>
                Choose a user
              </option>
              {users.data
                ?.filter((u) => u.status === 'active' && u.id !== deactivating?.id)
                .map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
            </Select>
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeactivating(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="danger" disabled={deactivate.busy}>
              Deactivate
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function TemplatesPage() {
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['templates'], queryFn: () => get<any[]>('/templates') });
  const [open, setOpen] = useState(false);
  const create = useAction((v: Record<string, string | undefined>) => post<{ id: string }>('/templates', v), {
    success: 'Template created',
    onDone: (t) => void navigate({ to: '/templates/$id', params: { id: t.id } }),
  });
  return (
    <>
      <PageHeader
        title="Proposal templates"
        subtitle="Templates are versioned; proposals keep the version they were created from"
        actions={<Button onClick={() => setOpen(true)}>New template</Button>}
      />
      <Query q={q}>
        {(ts) =>
          ts.length === 0 ? (
            <EmptyState title="No templates yet" action={<Button onClick={() => setOpen(true)}>New template</Button>} />
          ) : (
            <Table head={['Template', 'Description', 'Status', 'Updated']}>
              {ts.map((t) => (
                <tr key={t.id}>
                  <td>
                    <Link to="/templates/$id" params={{ id: t.id }} className="font-medium text-brand hover:underline">
                      {t.name}
                    </Link>
                  </td>
                  <td>{t.description ?? '—'}</td>
                  <td>
                    <Badge tone={t.published ? 'ok' : 'neutral'}>{t.published ? 'Published' : 'Draft only'}</Badge>
                  </td>
                  <td>{dateTime(t.updatedAt)}</td>
                </tr>
              ))}
            </Table>
          )
        }
      </Query>
      <Dialog open={open} onClose={() => setOpen(false)} title="New template">
        <form className="space-y-3" onSubmit={(e) => create.run(formValues(e))}>
          <Field label="Name" error={create.fieldError('name')}>
            <Input name="name" required />
          </Field>
          <Field label="Description">
            <Input name="description" />
          </Field>
          <div className="flex justify-end">
            <Button type="submit" disabled={create.busy}>
              Create template
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function TemplateEditorPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const q = useQuery({ queryKey: ['template', id], queryFn: () => get<any>(`/templates/${id}`) });
  return <Query q={q}>{(t) => <TemplateEditor key={(t.draft ?? t.published)?.id} t={t} />}</Query>;
}

function TemplateEditor({ t }: { t: any }) {
  const me = useMe();
  const qc = useQueryClient();
  const isAdmin = me.data?.user.role === 'admin';
  const [doc, setDoc] = useState<ProposalDocument>((t.draft ?? t.published).content);
  const refresh = () => void qc.invalidateQueries();
  const save = useAction(() => put(`/templates/${t.id}/draft`, { content: doc }), { success: 'Template draft saved', onDone: refresh });
  const publish = useAction(
    async () => {
      await put(`/templates/${t.id}/draft`, { content: doc });
      return post(`/templates/${t.id}/publish`);
    },
    { success: 'Template published as a new version', onDone: refresh },
  );
  const setSection = (i: number, patchValue: Partial<ProposalDocument['sections'][number]>) =>
    setDoc((d) => ({ ...d, sections: d.sections.map((s, j) => (j === i ? { ...s, ...patchValue } : s)) }));
  return (
    <>
      <PageHeader
        title={t.name}
        subtitle={`${t.draft ? 'Editing draft' : 'Published'} · ${t.versions.length} version(s)`}
        actions={
          <>
            <Button variant="secondary" disabled={save.busy} onClick={() => save.run(undefined)}>
              Save draft
            </Button>
            <ConfirmButton
              variant="secondary"
              label="Publish"
              confirm="Publish this template? New proposals will use it; existing proposals keep their version."
              onConfirm={() => publish.run(undefined)}
            />
          </>
        }
      />
      <p className="mb-3 text-sm text-muted">
        Placeholders are filled from CRM data:{' '}
        {PLACEHOLDERS.map((p) => (
          <code key={p} className="mr-1 rounded bg-white px-1 text-xs">{`{{${p}}}`}</code>
        ))}
      </p>
      <div className="space-y-4">
        {doc.sections.map((s, i) => (
          <Card
            key={s.id}
            title={<Input aria-label="Section title" className="w-72" value={s.title} onChange={(e) => setSection(i, { title: e.target.value })} />}
            actions={
              <Button variant="ghost" onClick={() => setDoc((d) => ({ ...d, sections: d.sections.filter((_, j) => j !== i) }))}>
                Remove
              </Button>
            }
          >
            {s.kind === 'text' ? (
              <Textarea aria-label={`${s.title} content`} rows={5} value={s.body} onChange={(e) => setSection(i, { body: e.target.value })} />
            ) : (
              <p className="text-sm text-muted">{s.kind === 'pricing' ? 'The pricing table is inserted here.' : 'Signature lines are inserted here.'}</p>
            )}
            <div className="mt-2 flex flex-wrap gap-4 text-sm">
              <label className="flex items-center gap-1.5" title={isAdmin ? undefined : 'Only an Admin can lock sections'}>
                <input type="checkbox" checked={s.locked} disabled={!isAdmin} onChange={(e) => setSection(i, { locked: e.target.checked })} /> Locked
                (salespeople cannot edit)
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={s.required} onChange={(e) => setSection(i, { required: e.target.checked })} /> Required
              </label>
              <label className="flex items-center gap-1.5">
                <input type="checkbox" checked={s.aiDraftable} onChange={(e) => setSection(i, { aiDraftable: e.target.checked })} /> AI may draft
              </label>
            </div>
          </Card>
        ))}
        <Button
          variant="secondary"
          onClick={() =>
            setDoc((d) => ({
              ...d,
              sections: [
                ...d.sections,
                {
                  id: `s${Math.random().toString(36).slice(2, 9)}`,
                  title: 'New section',
                  locked: false,
                  required: false,
                  aiDraftable: true,
                  kind: 'text',
                  body: '',
                },
              ],
            }))
          }
        >
          Add text section
        </Button>
      </div>
    </>
  );
}

export function CatalogPage() {
  const qc = useQueryClient();
  const me = useMe();
  const q = useQuery({ queryKey: ['products'], queryFn: () => get<any[]>('/products') });
  const [open, setOpen] = useState(false);
  const [recurring, setRecurring] = useState(false);
  const create = useAction((v: Record<string, string | undefined>) => post('/products', v), {
    success: 'Product added',
    onDone: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ['products'] });
    },
  });
  return (
    <>
      <PageHeader
        title="Product catalogue"
        subtitle="Items salespeople add to proposal pricing tables"
        actions={<Button onClick={() => setOpen(true)}>New product</Button>}
      />
      <Query q={q}>
        {(ps) =>
          ps.length === 0 ? (
            <EmptyState title="No products yet" action={<Button onClick={() => setOpen(true)}>New product</Button>} />
          ) : (
            <Table head={['Product', 'Unit', 'Unit price', 'Billing', 'Tax %']}>
              {ps.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.unit}</td>
                  <td className="tabular-nums">{money(p.unitPrice, me.data?.settings.currency)}</td>
                  <td>{p.billingType === 'recurring' ? `Recurring / ${p.billingPeriod}` : 'One-time'}</td>
                  <td className="tabular-nums">{Number(p.taxRatePercent)}</td>
                </tr>
              ))}
            </Table>
          )
        }
      </Query>
      <Dialog open={open} onClose={() => setOpen(false)} title="New product">
        <form className="space-y-3" onSubmit={(e) => create.run(formValues(e))}>
          <Field label="Name" error={create.fieldError('name')}>
            <Input name="name" required />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unit" error={create.fieldError('unit')}>
              <Input name="unit" placeholder="seat, hour, project" required />
            </Field>
            <Field label="Unit price" error={create.fieldError('unitPrice')}>
              <Input name="unitPrice" inputMode="decimal" required />
            </Field>
          </div>
          <Field label="Billing">
            <Select name="billingType" onChange={(e) => setRecurring(e.target.value === 'recurring')}>
              <option value="one_time">One-time</option>
              <option value="recurring">Recurring</option>
            </Select>
          </Field>
          {recurring && (
            <Field label="Billing period" error={create.fieldError('billingPeriod')}>
              <Select name="billingPeriod">
                <option value="month">Monthly</option>
                <option value="quarter">Quarterly</option>
                <option value="year">Yearly</option>
              </Select>
            </Field>
          )}
          <div className="flex justify-end">
            <Button type="submit" disabled={create.busy}>
              Add product
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function LeadsPage() {
  const me = useMe();
  const q = useQuery({ queryKey: ['leads'], queryFn: () => get<any[]>('/leads'), refetchInterval: 20_000 });
  const key = me.data?.settings.leadFormKey;
  const formUrl = key ? `${location.protocol}//proposals.${location.host}/f?form=${key}` : '';
  return (
    <>
      <PageHeader title="Leads" subtitle="Website form submissions create contacts, companies and deals and assign them round-robin" />
      {key && (
        <Card title="Your lead form" className="mb-4">
          <p className="text-sm text-muted">Hosted form page (embed it on your website in an iframe):</p>
          <Input readOnly value={formUrl} aria-label="Lead form URL" onFocus={(e) => e.currentTarget.select()} />
        </Card>
      )}
      <Query q={q}>
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
                    ) : l.spamVerdict === 'clean' ? (
                      'Contact only'
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
    </>
  );
}
