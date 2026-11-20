import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useState } from 'react';
import { ApiError, dateOnly, get, money, patch, personName, post } from '../lib/api.ts';
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
  Textarea,
  useAction,
  useToast,
} from '../lib/ui.tsx';
import { DealSummaryPanel, FollowUpDialog, useAiFeature } from './ai.tsx';
import { ActionError, type Column, OwnerDialog, SortableTable, Timeline } from './crm.tsx';

interface Stage {
  id: string;
  name: string;
  kind: 'open' | 'won' | 'lost';
  sortOrder: number;
}
interface DealRow {
  id: string;
  name: string;
  status: string;
  amount: string | null;
  currency: string;
  closeDate: string | null;
  stageId: string;
  stageName: string;
  companyId: string;
  companyName: string;
  ownerName: string;
  rowVersion: number;
  flags: string[];
}
const FLAG: Record<string, string> = { stalled: 'Stalled', past_close_date: 'Overdue', signed_on_stale_version: 'Review signature' };

const dealColumns: Column<DealRow>[] = [
  {
    key: 'name',
    label: 'Deal',
    sortValue: (x) => x.name,
    render: (x) => (
      <>
        <Link to="/deals/$id" params={{ id: x.id }} className="font-medium text-brand hover:underline">
          {x.name}
        </Link>{' '}
        {x.flags.map((f) => (
          <Badge key={f} tone="warn">
            {FLAG[f] ?? f}
          </Badge>
        ))}
      </>
    ),
  },
  { key: 'company', label: 'Company', sortValue: (x) => x.companyName, render: (x) => x.companyName },
  { key: 'stage', label: 'Stage', sortValue: (x) => x.stageName, render: (x) => <Badge tone={statusTone(x.status)}>{x.stageName}</Badge> },
  {
    key: 'amount',
    label: 'Amount',
    sortValue: (x) => (x.amount === null ? null : Number(x.amount)),
    render: (x) => <span className="tabular-nums">{money(x.amount, x.currency)}</span>,
  },
  { key: 'closeDate', label: 'Close date', sortValue: (x) => x.closeDate, render: (x) => dateOnly(x.closeDate) },
  { key: 'owner', label: 'Owner', sortValue: (x) => x.ownerName, render: (x) => x.ownerName },
];
interface DealDetail {
  id: string;
  name: string;
  amount: string | null;
  currency: string;
  closeDate: string | null;
  rowVersion: number;
}

/** Edit name, amount and expected close date. The rowVersion captured when the dialog opened guards against lost updates. */
function DealEditDialog({ deal, onClose, onDone }: { deal: DealDetail; onClose: () => void; onDone: () => void }) {
  const [base] = useState(deal); // the page re-fetches every 20 s; the form keeps the version the user started from
  const save = useAction(
    (v: Record<string, string | undefined>) =>
      patch(`/deals/${base.id}`, { name: v.name, amount: v.amount ?? null, closeDate: v.closeDate ?? null, rowVersion: base.rowVersion }),
    {
      success: 'Deal updated',
      onDone: () => {
        onDone();
        onClose();
      },
    },
  );
  return (
    <Dialog open onClose={onClose} title="Edit deal">
      <form className="space-y-3" onSubmit={(e) => save.run(formValues(e))}>
        <Field label="Deal name" error={save.fieldError('name')}>
          <Input name="name" required maxLength={255} defaultValue={base.name} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Amount (${base.currency})`} hint="Leave empty if unknown" error={save.fieldError('amount')}>
            <Input name="amount" inputMode="decimal" placeholder="25000.00" defaultValue={base.amount ?? ''} />
          </Field>
          <Field label="Expected close" error={save.fieldError('closeDate')}>
            <Input name="closeDate" type="date" defaultValue={base.closeDate ?? ''} />
          </Field>
        </div>
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

export function DealsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const [layout, setLayout] = useState<'board' | 'list'>('board');
  const [open, setOpen] = useState(false);
  const pipeline = useQuery({ queryKey: ['pipeline'], queryFn: () => get<{ stages: Stage[] }>('/pipeline'), staleTime: 300_000 });
  const deals = useQuery({
    queryKey: ['deals', layout],
    queryFn: () => get<{ items: DealRow[]; total: number }>(`/deals?limit=100${layout === 'board' ? '&status=open' : ''}`),
  });
  // Closed outcomes for the board's read-only Won/Lost columns (kept separate from the active pipeline).
  const closed = useQuery({
    queryKey: ['deals', 'closed'],
    enabled: layout === 'board',
    queryFn: async () => {
      const [won, lost] = await Promise.all([
        get<{ items: DealRow[] }>('/deals?limit=50&status=won'),
        get<{ items: DealRow[] }>('/deals?limit=50&status=lost'),
      ]);
      return { won: won.items, lost: lost.items };
    },
  });
  const companies = useQuery({ queryKey: ['companies', ''], queryFn: () => get<{ items: { id: string; name: string }[] }>('/companies?limit=100') });
  const create = useAction((v: Record<string, string | undefined>) => post<{ id: string }>('/deals', v), {
    success: 'Deal created',
    onDone: (d) => void navigate({ to: '/deals/$id', params: { id: d.id } }),
  });
  const move = useAction((v: { deal: DealRow; stageId: string }) => post(`/deals/${v.deal.id}/stage`, { stageId: v.stageId, rowVersion: v.deal.rowVersion }), {
    onDone: () => {
      toast('Stage updated');
      void qc.invalidateQueries({ queryKey: ['deals'] });
    },
  });
  const openStages = pipeline.data?.stages.filter((s) => s.kind === 'open') ?? [];

  return (
    <>
      <PageHeader
        title="Deals"
        subtitle={deals.data ? `${deals.data.total} ${layout === 'board' ? 'open ' : ''}deals` : undefined}
        actions={
          <>
            <fieldset aria-label="Layout" className="flex rounded-md border border-line bg-white p-0.5">
              {(['board', 'list'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  aria-pressed={layout === l}
                  onClick={() => setLayout(l)}
                  className={`rounded px-3 py-1 text-sm capitalize ${layout === l ? 'bg-brand text-white' : 'text-muted'}`}
                >
                  {l}
                </button>
              ))}
            </fieldset>
            <Button onClick={() => setOpen(true)}>New deal</Button>
          </>
        }
      />
      <Query q={deals} rows={6}>
        {(d) =>
          d.items.length === 0 ? (
            <EmptyState
              title="No deals yet"
              hint="Create a deal for a company to start tracking it through the pipeline."
              action={<Button onClick={() => setOpen(true)}>New deal</Button>}
            />
          ) : layout === 'list' ? (
            <SortableTable label="Deals" columns={dealColumns} rows={d.items} rowKey={(x) => x.id} total={d.total} />
          ) : (
            // Kanban board (BR-CRM-011). Drag a card to another column, or use the stage menu on the card (keyboard).
            <div className="flex gap-3 overflow-x-auto pb-2">
              {openStages.map((s) => {
                const cards = d.items.filter((x) => x.stageId === s.id);
                return (
                  <section
                    key={s.id}
                    aria-label={s.name}
                    className="w-72 shrink-0 rounded-lg border border-line bg-white"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      const deal = d.items.find((x) => x.id === e.dataTransfer.getData('text/deal'));
                      if (deal && deal.stageId !== s.id) move.run({ deal, stageId: s.id });
                    }}
                  >
                    <header className="flex items-center justify-between border-b border-line px-3 py-2">
                      <h2 className="text-sm font-semibold">{s.name}</h2>
                      <span className="text-xs tabular-nums text-muted">
                        {cards.length} · {money(cards.reduce((t, c) => t + Number(c.amount ?? 0), 0))}
                      </span>
                    </header>
                    <ul className="min-h-24 space-y-2 p-2">
                      {cards.map((c) => (
                        <li
                          key={c.id}
                          draggable
                          onDragStart={(e) => e.dataTransfer.setData('text/deal', c.id)}
                          className="cursor-grab rounded-md border border-line bg-surface p-2.5 text-sm active:cursor-grabbing"
                        >
                          <Link to="/deals/$id" params={{ id: c.id }} className="font-medium text-brand hover:underline">
                            {c.name}
                          </Link>
                          <p className="text-xs text-muted">
                            {c.companyName} · {c.ownerName}
                          </p>
                          <p className="mt-1 flex items-center justify-between">
                            <span className="tabular-nums">{money(c.amount, c.currency)}</span>
                            <span className="flex gap-1">
                              {c.flags.map((f) => (
                                <Badge key={f} tone="warn">
                                  {FLAG[f] ?? f}
                                </Badge>
                              ))}
                            </span>
                          </p>
                          <Select
                            aria-label={`Move ${c.name} to stage`}
                            className="mt-2 py-1 text-xs"
                            value={c.stageId}
                            onChange={(e) => move.run({ deal: c, stageId: e.target.value })}
                          >
                            {openStages.map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.name}
                              </option>
                            ))}
                          </Select>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              {/* Closed outcomes — read-only, visually separated from the active pipeline (not drag targets). */}
              <div aria-hidden className="w-px shrink-0 self-stretch bg-line" />
              {(
                [
                  { key: 'won', label: 'Closed Won', head: 'border-green-200 bg-green-50', deals: closed.data?.won ?? [] },
                  { key: 'lost', label: 'Closed Lost', head: 'border-red-200 bg-red-50', deals: closed.data?.lost ?? [] },
                ] as const
              ).map((col) => (
                <section key={col.key} aria-label={col.label} className="w-72 shrink-0 rounded-lg border border-line bg-white">
                  <header className={`flex items-center justify-between rounded-t-lg border-b px-3 py-2 ${col.head}`}>
                    <h2 className="text-sm font-semibold">{col.label}</h2>
                    <span className="text-xs tabular-nums text-muted">
                      {col.deals.length} · {money(col.deals.reduce((t, c) => t + Number(c.amount ?? 0), 0))}
                    </span>
                  </header>
                  <ul className="min-h-24 space-y-2 p-2">
                    {col.deals.length === 0 ? (
                      <li className="px-1 py-6 text-center text-xs text-muted">No {col.key} deals yet</li>
                    ) : (
                      col.deals.map((c) => (
                        <li key={c.id} className="rounded-md border border-line bg-surface p-2.5 text-sm">
                          <Link to="/deals/$id" params={{ id: c.id }} className="font-medium text-brand hover:underline">
                            {c.name}
                          </Link>
                          <p className="text-xs text-muted">
                            {c.companyName} · {c.ownerName}
                          </p>
                          <p className="mt-1 flex items-center justify-between">
                            <span className="tabular-nums">{money(c.amount, c.currency)}</span>
                            <Badge tone={statusTone(c.status)}>{c.status === 'won' ? 'Won' : 'Lost'}</Badge>
                          </p>
                        </li>
                      ))
                    )}
                  </ul>
                </section>
              ))}
            </div>
          )
        }
      </Query>
      <Dialog open={open} onClose={() => setOpen(false)} title="New deal">
        <form className="space-y-3" onSubmit={(e) => create.run(formValues(e))}>
          <Field label="Deal name" error={create.fieldError('name')}>
            <Input name="name" required />
          </Field>
          <Field label="Company" error={create.fieldError('companyId')}>
            <Select name="companyId" required defaultValue="">
              <option value="" disabled>
                Choose a company
              </option>
              {companies.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Amount" error={create.fieldError('amount')}>
              <Input name="amount" inputMode="decimal" placeholder="25000.00" />
            </Field>
            <Field label="Expected close" error={create.fieldError('closeDate')}>
              <Input name="closeDate" type="date" />
            </Field>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.busy}>
              Create deal
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

export function DealPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const qc = useQueryClient();
  const navigate = useNavigate();
  const refresh = () => void qc.invalidateQueries();
  const q = useQuery({ queryKey: ['deal', id], queryFn: () => get<any>(`/deals/${id}`), refetchInterval: 20_000 });
  const pipeline = useQuery({
    queryKey: ['pipeline'],
    queryFn: () => get<{ stages: Stage[]; lostReasons: { id: string; name: string }[] }>('/pipeline'),
    staleTime: 300_000,
  });
  const proposals = useQuery({ queryKey: ['proposals', id], queryFn: () => get<any[]>(`/deals/${id}/proposals`) });
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => get<any[]>('/templates') });
  const tasks = useQuery({ queryKey: ['tasks', id], queryFn: () => get<any[]>(`/tasks?relatedType=deal&relatedId=${id}`) });
  const engagement = useQuery({
    queryKey: ['engagement', id],
    queryFn: () => get<{ views: number; seconds: number; viewers: number }>(`/deals/${id}/engagement`),
  });
  const contacts = useQuery({ queryKey: ['contacts', ''], queryFn: () => get<{ items: any[] }>('/contacts?limit=100') });
  const [dialog, setDialog] = useState<null | 'lost' | 'note' | 'task' | 'call' | 'contact' | 'proposal' | 'followup' | 'edit' | 'owner'>(null);
  const followUp = useAiFeature('follow_up_email');
  const done = (msg: string) => ({
    success: msg,
    onDone: () => {
      setDialog(null);
      refresh();
    },
  });
  const move = useAction((v: { stageId: string; rowVersion: number }) => post(`/deals/${id}/stage`, v), done('Stage updated'));
  const won = useAction(() => post(`/deals/${id}/won`, {}), done('Deal marked Closed Won'));
  const lost = useAction(async (v: Record<string, string | undefined>) => {
    try {
      return await post(`/deals/${id}/lost`, v);
    } catch (e) {
      // An open signature request must be confirmed before it is voided.
      if (e instanceof ApiError && e.code === 'CONFIRMATION_REQUIRED' && window.confirm('An open signature request will be voided. Continue?'))
        return post(`/deals/${id}/lost`, { ...v, confirm: ['OPEN_SIGNATURE_REQUEST_CONFIRM'] });
      throw e;
    }
  }, done('Deal marked Closed Lost'));
  const note = useAction((v: Record<string, string | undefined>) => post('/notes', { ...v, relatedType: 'deal', relatedId: id }), done('Note added'));
  const task = useAction(
    (v: Record<string, string | undefined>) =>
      post('/tasks', { title: v.title, relatedType: 'deal', relatedId: id, dueAt: new Date(v.dueAt ?? Date.now()).toISOString() }),
    done('Task created'),
  );
  const call = useAction(
    (v: Record<string, string | undefined>) =>
      post('/activities', { kind: v.kind, outcome: v.outcome, notes: v.notes, occurredAt: new Date().toISOString(), relatedType: 'deal', relatedId: id }),
    done('Activity logged'),
  );
  const addContact = useAction(
    (v: Record<string, string | undefined>) => post(`/deals/${id}/contacts`, { contactId: v.contactId, roles: v.role ? [v.role] : [] }),
    done('Contact added to deal'),
  );
  const newProposal = useAction(
    (v: Record<string, string | undefined>) =>
      post<{ id: string }>(`/deals/${id}/proposals`, { templateId: v.templateId, signatureRequired: v.mode !== 'accept' }),
    { success: 'Proposal created', onDone: (p) => void navigate({ to: '/proposals/$id', params: { id: p.id } }) },
  );
  const completeTask = useAction((taskId: string) => post(`/tasks/${taskId}/complete`), done('Task completed'));

  return (
    <Query q={q} rows={8}>
      {(d) => {
        const stages = pipeline.data?.stages.filter((s) => s.kind === 'open') ?? [];
        const canEdit = d.permissions.edit;
        return (
          <>
            <PageHeader
              title={d.name}
              subtitle={
                <>
                  <Link to="/companies/$id" params={{ id: d.company.id }} className="text-brand hover:underline">
                    {d.company.name}
                  </Link>{' '}
                  · Owner {d.owner.fullName}
                </>
              }
              actions={
                <>
                  <Badge tone={statusTone(d.status)}>{d.stage.name}</Badge>
                  {d.flags.map((f: any) => (
                    <Badge key={f.kind} tone="warn">
                      {FLAG[f.kind] ?? f.kind}
                    </Badge>
                  ))}
                  {!canEdit && <Badge>View only</Badge>}
                  {canEdit && (
                    <Button variant="secondary" onClick={() => setDialog('edit')}>
                      Edit deal
                    </Button>
                  )}
                  {d.permissions.reassign && (
                    <Button variant="secondary" onClick={() => setDialog('owner')}>
                      Change owner
                    </Button>
                  )}
                  {canEdit && d.status === 'open' && (
                    <>
                      <Select
                        aria-label="Stage"
                        className="w-44"
                        value={d.stageId}
                        onChange={(e) => move.run({ stageId: e.target.value, rowVersion: d.rowVersion })}
                      >
                        {stages.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </Select>
                      <ConfirmButton variant="secondary" label="Mark won" confirm="Mark this deal as Closed Won?" onConfirm={() => won.run(undefined)} />
                      {followUp && (
                        <Button variant="secondary" onClick={() => setDialog('followup')}>
                          Follow-up email…
                        </Button>
                      )}
                      <Button variant="secondary" onClick={() => setDialog('lost')}>
                        Mark lost
                      </Button>
                    </>
                  )}
                </>
              }
            />
            <div className="grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Card
                  title="Proposals"
                  actions={d.permissions.manageProposals && d.status === 'open' && <Button onClick={() => setDialog('proposal')}>New proposal</Button>}
                >
                  <Query q={proposals} rows={2}>
                    {(ps) =>
                      ps.length === 0 ? (
                        <p className="text-sm text-muted">No proposals yet. Create one from a template — it fills in CRM data and pricing.</p>
                      ) : (
                        <ul className="divide-y divide-line text-sm">
                          {ps.map((p) => (
                            <li key={p.id} className="flex items-center justify-between py-2">
                              <Link to="/proposals/$id" params={{ id: p.id }} className="font-medium text-brand hover:underline">
                                {p.title}
                              </Link>
                              <span className="flex items-center gap-2 text-xs text-muted">
                                Valid until {dateOnly(p.validUntil)} <Badge tone={statusTone(p.status)}>{p.status}</Badge>
                              </span>
                            </li>
                          ))}
                        </ul>
                      )
                    }
                  </Query>
                </Card>
                <Card
                  title="Activity timeline"
                  actions={
                    canEdit && (
                      <>
                        <Button variant="secondary" onClick={() => setDialog('note')}>
                          Add note
                        </Button>
                        <Button variant="secondary" onClick={() => setDialog('call')}>
                          Log call / meeting
                        </Button>
                      </>
                    )
                  }
                >
                  <Timeline type="deal" id={id} />
                </Card>
              </div>
              <div className="space-y-4">
                <Card title="Summary">
                  <dl className="space-y-1.5 text-sm">
                    {[
                      ['Amount', money(d.amount, d.currency)],
                      ['Expected close', dateOnly(d.closeDate)],
                      ['Owner', d.owner.fullName],
                      ['Proposal views', engagement.data ? `${engagement.data.views} by ${engagement.data.viewers} viewer(s)` : '—'],
                      ['Time spent reading', engagement.data ? `${Math.round(engagement.data.seconds / 60)} min` : '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between">
                        <dt className="text-muted">{k}</dt>
                        <dd className="font-medium">{v}</dd>
                      </div>
                    ))}
                  </dl>
                  <DealSummaryPanel dealId={id} canEdit={canEdit} />
                </Card>
                <Card
                  title="Stakeholders"
                  actions={
                    canEdit && (
                      <Button variant="secondary" onClick={() => setDialog('contact')}>
                        Add stakeholder
                      </Button>
                    )
                  }
                >
                  {d.contacts.length === 0 ? (
                    <p className="text-sm text-muted">No contacts on this deal. Add one to send a proposal.</p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {d.contacts.map((c: any) => (
                        <li key={c.id}>
                          <span className="font-medium">{personName(c)}</span>
                          <span className="block text-xs text-muted">{c.email}</span>
                          <span className="flex flex-wrap gap-1">
                            {c.roles.map((r: string) => (
                              <Badge key={r} tone={r === 'Forwarded viewer' ? 'info' : 'neutral'}>
                                {r}
                              </Badge>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
                <Card
                  title="Tasks"
                  actions={
                    canEdit && (
                      <Button variant="secondary" onClick={() => setDialog('task')}>
                        Add
                      </Button>
                    )
                  }
                >
                  <Query q={tasks} rows={2}>
                    {(ts) =>
                      ts.filter((t) => t.status === 'open').length === 0 ? (
                        <p className="text-sm text-muted">No open tasks.</p>
                      ) : (
                        <ul className="space-y-2 text-sm">
                          {ts
                            .filter((t) => t.status === 'open')
                            .map((t) => (
                              <li key={t.id} className="flex items-start justify-between gap-2">
                                <span>
                                  {t.title} {t.source === 'automation' && <Badge tone="warn">Automated</Badge>}
                                  <span className="block text-xs text-muted">Due {dateOnly(t.dueAt)}</span>
                                </span>
                                <Button variant="ghost" onClick={() => completeTask.run(t.id)}>
                                  Done
                                </Button>
                              </li>
                            ))}
                        </ul>
                      )
                    }
                  </Query>
                </Card>
              </div>
            </div>

            {dialog === 'edit' && <DealEditDialog deal={d} onClose={() => setDialog(null)} onDone={refresh} />}
            {dialog === 'owner' && (
              <OwnerDialog
                what="deal"
                path={`/deals/${id}/owner`}
                currentOwnerId={d.ownerId}
                scope={d.permissions.reassignScope}
                onClose={() => setDialog(null)}
                onDone={refresh}
              />
            )}
            <Dialog open={dialog === 'lost'} onClose={() => setDialog(null)} title="Mark deal as lost">
              <form className="space-y-3" onSubmit={(e) => lost.run(formValues(e))}>
                <Field label="Lost reason" hint="Required — used in win/loss reporting" error={lost.fieldError('lostReasonId')}>
                  <Select name="lostReasonId" required defaultValue="">
                    <option value="" disabled>
                      Choose a reason
                    </option>
                    {pipeline.data?.lostReasons.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Note">
                  <Textarea name="note" />
                </Field>
                <div className="flex justify-end gap-2">
                  <Button variant="secondary" onClick={() => setDialog(null)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="danger" disabled={lost.busy}>
                    Mark lost
                  </Button>
                </div>
              </form>
            </Dialog>
            <Dialog open={dialog === 'note'} onClose={() => setDialog(null)} title="Add note">
              <form className="space-y-3" onSubmit={(e) => note.run(formValues(e))}>
                <Field label="Note" error={note.fieldError('body')}>
                  <Textarea name="body" required />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" disabled={note.busy}>
                    Save note
                  </Button>
                </div>
              </form>
            </Dialog>
            <Dialog open={dialog === 'call'} onClose={() => setDialog(null)} title="Log call or meeting">
              <form className="space-y-3" onSubmit={(e) => call.run(formValues(e))}>
                <Field label="Type">
                  <Select name="kind">
                    <option value="call">Call</option>
                    <option value="meeting">Meeting</option>
                  </Select>
                </Field>
                <Field label="Outcome">
                  <Input name="outcome" placeholder="e.g. Agreed next steps" />
                </Field>
                <Field label="Notes">
                  <Textarea name="notes" />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" disabled={call.busy}>
                    Log activity
                  </Button>
                </div>
              </form>
            </Dialog>
            <Dialog open={dialog === 'task'} onClose={() => setDialog(null)} title="New task">
              <form className="space-y-3" onSubmit={(e) => task.run(formValues(e))}>
                <Field label="Task" error={task.fieldError('title')}>
                  <Input name="title" required />
                </Field>
                <Field label="Due">
                  <Input name="dueAt" type="datetime-local" required />
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" disabled={task.busy}>
                    Create task
                  </Button>
                </div>
              </form>
            </Dialog>
            {dialog === 'followup' && <FollowUpDialog dealId={id} contacts={d.contacts.filter((c: any) => c.email)} onClose={() => setDialog(null)} />}
            <Dialog open={dialog === 'contact'} onClose={() => setDialog(null)} title="Add stakeholder">
              <form className="space-y-3" onSubmit={(e) => addContact.run(formValues(e))}>
                <Field label="Contact">
                  <Select name="contactId" required defaultValue="">
                    <option value="" disabled>
                      Choose a contact
                    </option>
                    {contacts.data?.items.map((c) => (
                      <option key={c.id} value={c.id}>
                        {personName(c)} {c.email ? `(${c.email})` : ''}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Role">
                  <Select name="role">
                    <option>Decision-maker</option>
                    <option>Signer</option>
                    <option>Influencer</option>
                  </Select>
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" disabled={addContact.busy}>
                    Add to deal
                  </Button>
                </div>
              </form>
            </Dialog>
            <Dialog open={dialog === 'proposal'} onClose={() => setDialog(null)} title="New proposal">
              <form className="space-y-3" onSubmit={(e) => newProposal.run(formValues(e))}>
                <Field label="Template" hint="Only published templates are listed">
                  <Select name="templateId" required defaultValue="">
                    <option value="" disabled>
                      Choose a template
                    </option>
                    {templates.data
                      ?.filter((t) => t.published)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                  </Select>
                </Field>
                <Field label="How will the buyer agree?">
                  <Select name="mode">
                    <option value="sign">E-signature</option>
                    <option value="accept">Accept / decline button (no signature)</option>
                  </Select>
                </Field>
                <div className="flex justify-end">
                  <Button type="submit" disabled={newProposal.busy}>
                    Create proposal
                  </Button>
                </div>
              </form>
            </Dialog>
          </>
        );
      }}
    </Query>
  );
}
