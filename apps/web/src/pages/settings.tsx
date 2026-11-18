/**
 * Administration screens: organization settings (BR-PLT-012), pipeline stages and win probabilities (BR-CRM-005),
 * lost reasons (BR-CRM-014), teams and managers (BR-PLT-006) and the read-only audit log (BR-PLT-009).
 * Everything shown comes from the API; the server enforces the Admin-only permission on every call.
 */
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useState } from 'react';
import { ApiError, api, dateTime, get, patch, post, put } from '../lib/api.ts';
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  formValues,
  Input,
  PageHeader,
  Query,
  Select,
  Skeleton,
  Table,
  useAction,
} from '../lib/ui.tsx';

const del = <T,>(path: string) => api<T>('DELETE', `/api/v1${path}`);
type Values = Record<string, string | undefined>;

// ───────────────────────── settings page (tabs) ─────────────────────────
const TABS = [
  ['organization', 'Organization'],
  ['pipeline', 'Pipeline'],
  ['lost-reasons', 'Lost reasons'],
  ['teams', 'Teams'],
] as const;
type TabKey = (typeof TABS)[number][0];

export function SettingsPage() {
  const [tab, setTab] = useState<TabKey>('organization');
  return (
    <>
      <PageHeader title="Settings" subtitle="Organization details, sales pipeline, lost reasons and teams. Every change is recorded in the audit log." />
      <div role="tablist" aria-label="Settings sections" className="mb-4 flex flex-wrap gap-1 border-b border-line">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`settings-tab-${key}`}
            aria-selected={tab === key}
            aria-controls="settings-panel"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              tab === key ? 'border-brand text-brand' : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="settings-panel" aria-labelledby={`settings-tab-${tab}`}>
        {tab === 'organization' && <OrganizationSection />}
        {tab === 'pipeline' && <PipelineSection />}
        {tab === 'lost-reasons' && <LostReasonsSection />}
        {tab === 'teams' && <TeamsSection />}
      </div>
    </>
  );
}

// ───────────────────────── organization ─────────────────────────
type Visibility = 'none' | 'view_only';
interface OrgSettings {
  organizationName: string;
  timeZone: string;
  locale: string;
  defaultCurrency: string;
  branding: { primaryColor: string; footerText: string };
  proposalDefaults: { defaultTermMonths: number; defaultValidityDays: number };
  automationSettings: { followUpAfterDays: number; aut001Enabled: boolean; aut002Enabled: boolean };
  salespersonCrossVisibility: { companies: Visibility; contacts: Visibility; deals: Visibility };
  updatedAt: string;
}

function OrganizationSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'organization'], queryFn: () => get<OrgSettings>('/settings/organization') });
  const save = useAction((body: object) => put<OrgSettings & { changed: boolean }>('/settings/organization', body), {
    onDone: () => {
      void qc.invalidateQueries({ queryKey: ['settings', 'organization'] });
      void qc.invalidateQueries({ queryKey: ['me'] });
    },
    success: 'Organization settings saved',
  });
  const visibility = (v: string | undefined): Visibility => (v === 'view_only' ? 'view_only' : 'none');
  const submit = (e: FormEvent<HTMLFormElement>) => {
    const v = formValues(e);
    save.run({
      organizationName: v.organizationName ?? '',
      timeZone: v.timeZone ?? '',
      locale: v.locale ?? '',
      defaultCurrency: (v.defaultCurrency ?? '').toUpperCase(),
      branding: { primaryColor: v.primaryColor ?? '', footerText: v.footerText ?? '' },
      proposalDefaults: { defaultTermMonths: Number(v.defaultTermMonths), defaultValidityDays: Number(v.defaultValidityDays) },
      automationSettings: { followUpAfterDays: Number(v.followUpAfterDays), aut001Enabled: v.aut001Enabled === 'on', aut002Enabled: v.aut002Enabled === 'on' },
      salespersonCrossVisibility: { companies: visibility(v.cvCompanies), contacts: visibility(v.cvContacts), deals: visibility(v.cvDeals) },
    });
  };
  // A rule refusal (for example the currency rule) has no field to attach to, so it is shown above the buttons.
  const ruleError = save.error instanceof ApiError && save.error.errors.length === 0 ? save.error.message : null;
  return (
    <Query q={q} rows={8}>
      {(s) => (
        // Keyed by the saved timestamp so the form shows the stored values again after every save.
        <form key={s.updatedAt} className="space-y-4" onSubmit={submit} aria-label="Organization settings">
          <Card title="Organization">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Organization name" error={save.fieldError('organizationName')}>
                <Input name="organizationName" defaultValue={s.organizationName} required maxLength={120} />
              </Field>
              <Field
                label="Default currency"
                hint="Three-letter code, for example USD. It can only change while no deal or proposal uses another currency."
                error={save.fieldError('defaultCurrency')}
              >
                <Input name="defaultCurrency" defaultValue={s.defaultCurrency} required minLength={3} maxLength={3} className="uppercase" />
              </Field>
              <Field label="Time zone" hint="IANA name, for example America/New_York" error={save.fieldError('timeZone')}>
                <Input name="timeZone" defaultValue={s.timeZone} required />
              </Field>
              <Field label="Locale" hint="For example en-US" error={save.fieldError('locale')}>
                <Input name="locale" defaultValue={s.locale} required />
              </Field>
            </div>
          </Card>
          <Card title="Proposal branding and defaults">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Brand colour" hint="Used on proposals, for example #1f4e79" error={save.fieldError('branding.primaryColor')}>
                <Input name="primaryColor" defaultValue={s.branding.primaryColor} required pattern="#[0-9a-fA-F]{6}" />
              </Field>
              <Field label="Proposal footer text" error={save.fieldError('branding.footerText')}>
                <Input name="footerText" defaultValue={s.branding.footerText} maxLength={300} />
              </Field>
              <Field label="Default contract term (months)" error={save.fieldError('proposalDefaults.defaultTermMonths')}>
                <Input name="defaultTermMonths" type="number" min={1} max={120} step={1} defaultValue={s.proposalDefaults.defaultTermMonths} required />
              </Field>
              <Field label="Default proposal validity (days)" error={save.fieldError('proposalDefaults.defaultValidityDays')}>
                <Input name="defaultValidityDays" type="number" min={1} max={365} step={1} defaultValue={s.proposalDefaults.defaultValidityDays} required />
              </Field>
            </div>
          </Card>
          <Card title="Automation">
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="aut001Enabled" defaultChecked={s.automationSettings.aut001Enabled} />
                Move the deal to the "proposal sent" stage when a proposal is sent
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" name="aut002Enabled" defaultChecked={s.automationSettings.aut002Enabled} />
                Create a follow-up task when a sent proposal has not been viewed
              </label>
              <div className="max-w-xs">
                <Field label="Follow up after (days)" error={save.fieldError('automationSettings.followUpAfterDays')}>
                  <Input name="followUpAfterDays" type="number" min={1} max={90} step={1} defaultValue={s.automationSettings.followUpAfterDays} required />
                </Field>
              </div>
            </div>
          </Card>
          <Card title="What salespeople can see of each other's records">
            <div className="grid gap-3 sm:grid-cols-3">
              {(
                [
                  ['cvCompanies', 'Companies', s.salespersonCrossVisibility.companies],
                  ['cvContacts', 'Contacts', s.salespersonCrossVisibility.contacts],
                  ['cvDeals', 'Deals', s.salespersonCrossVisibility.deals],
                ] as const
              ).map(([name, label, value]) => (
                <Field key={name} label={`Other salespeople's ${label.toLowerCase()}`}>
                  <Select name={name} defaultValue={value}>
                    <option value="none">Hidden</option>
                    <option value="view_only">View only</option>
                  </Select>
                </Field>
              ))}
            </div>
          </Card>
          {ruleError && (
            <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-danger">
              {ruleError}
            </p>
          )}
          <div className="flex items-center justify-end gap-3">
            <span className="text-xs text-muted">Last saved {dateTime(s.updatedAt)}</span>
            <Button type="submit" disabled={save.busy}>
              {save.busy ? 'Saving…' : 'Save settings'}
            </Button>
          </div>
        </form>
      )}
    </Query>
  );
}

// ───────────────────────── pipeline ─────────────────────────
interface Stage {
  id: string;
  name: string;
  kind: 'open' | 'won' | 'lost';
  sortOrder: number;
  probability: number;
  stallThresholdDays: number | null;
  isProposalSentTarget: boolean;
  dealCount: number;
}
const stageBody = (v: Values, closed: boolean) => ({
  name: v.name ?? '',
  ...(closed ? {} : { probability: Number(v.probability), stallThresholdDays: v.stallThresholdDays === undefined ? null : Number(v.stallThresholdDays) }),
});

function PipelineSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'stages'], queryFn: () => get<{ pipeline: { name: string }; stages: Stage[] }>('/admin/pipeline/stages') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'stages'] });
    void qc.invalidateQueries({ queryKey: ['pipeline'] });
  };
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Stage | null>(null);
  const create = useAction((body: object) => post('/admin/pipeline/stages', body), {
    success: 'Stage added',
    onDone: () => {
      setAdding(false);
      refresh();
    },
  });
  const update = useAction((x: { id: string; body: object }) => patch(`/admin/pipeline/stages/${x.id}`, x.body), {
    success: 'Stage saved',
    onDone: () => {
      setEditing(null);
      refresh();
    },
  });
  const reorder = useAction((stageIds: string[]) => put('/admin/pipeline/stage-order', { stageIds }), { success: 'Stage order saved', onDone: refresh });
  const target = useAction((id: string) => post(`/admin/pipeline/stages/${id}/proposal-sent-target`), {
    success: '"Proposal sent" stage changed',
    onDone: refresh,
  });
  const remove = useAction((id: string) => del(`/admin/pipeline/stages/${id}`), { success: 'Stage removed', onDone: refresh });
  const busy = reorder.busy || target.busy || remove.busy;

  return (
    <Query q={q} rows={6}>
      {({ stages }) => {
        const open = stages.filter((s) => s.kind === 'open');
        const move = (index: number, by: -1 | 1) => {
          const ids = open.map((s) => s.id);
          const [id] = ids.splice(index, 1);
          if (id) ids.splice(index + by, 0, id);
          reorder.run(ids);
        };
        return (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted">Win probability feeds the weighted forecast. Closed Won and Closed Lost are fixed and always come last.</p>
              <Button onClick={() => setAdding(true)}>Add stage</Button>
            </div>
            <Table head={['Order', 'Stage', 'Type', 'Win probability', 'Stalls after', 'Deals', 'Proposal sent stage', '']}>
              {stages.map((s) => {
                const i = open.findIndex((o) => o.id === s.id);
                return (
                  <tr key={s.id} data-stage={s.name}>
                    <td className="whitespace-nowrap">
                      {s.kind === 'open' ? (
                        <>
                          <Button variant="ghost" aria-label={`Move ${s.name} up`} disabled={busy || i === 0} onClick={() => move(i, -1)}>
                            ↑
                          </Button>
                          <Button variant="ghost" aria-label={`Move ${s.name} down`} disabled={busy || i === open.length - 1} onClick={() => move(i, 1)}>
                            ↓
                          </Button>
                        </>
                      ) : (
                        <span className="text-xs text-muted">Fixed</span>
                      )}
                    </td>
                    <td className="font-medium">{s.name}</td>
                    <td>
                      <Badge tone={s.kind === 'won' ? 'ok' : s.kind === 'lost' ? 'danger' : 'info'}>
                        {s.kind === 'open' ? 'Open' : s.kind === 'won' ? 'Won' : 'Lost'}
                      </Badge>
                    </td>
                    <td>{s.probability}%</td>
                    <td>{s.stallThresholdDays === null ? '—' : `${s.stallThresholdDays} days`}</td>
                    <td>{s.dealCount}</td>
                    <td>
                      {s.isProposalSentTarget ? (
                        <Badge tone="info">Proposal sent stage</Badge>
                      ) : s.kind === 'open' ? (
                        <Button variant="ghost" aria-label={`Use ${s.name} as the proposal sent stage`} disabled={busy} onClick={() => target.run(s.id)}>
                          Use this stage
                        </Button>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <Button variant="secondary" aria-label={`Edit ${s.name}`} onClick={() => setEditing(s)}>
                        Edit
                      </Button>{' '}
                      {s.kind === 'open' && (
                        <ConfirmButton
                          label={`Remove ${s.name}`}
                          confirm={`Remove the stage "${s.name}"? A stage that holds deals, or that deals have passed through, cannot be removed.`}
                          disabled={busy}
                          onConfirm={() => remove.run(s.id)}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </Table>
            <Dialog open={adding} onClose={() => setAdding(false)} title="Add stage">
              <form className="space-y-3" onSubmit={(e) => create.run(stageBody(formValues(e), false))}>
                <StageFields error={create.fieldError} />
                <p className="text-xs text-muted">The new stage is placed after the last open stage. Use the arrows to move it.</p>
                <FormButtons onCancel={() => setAdding(false)} busy={create.busy} submit="Add stage" />
              </form>
            </Dialog>
            <Dialog open={editing !== null} onClose={() => setEditing(null)} title={`Edit ${editing?.name ?? 'stage'}`}>
              {editing && (
                <form
                  key={editing.id}
                  className="space-y-3"
                  onSubmit={(e) => update.run({ id: editing.id, body: stageBody(formValues(e), editing.kind !== 'open') })}
                >
                  <StageFields stage={editing} error={update.fieldError} />
                  <FormButtons onCancel={() => setEditing(null)} busy={update.busy} submit="Save stage" />
                </form>
              )}
            </Dialog>
          </div>
        );
      }}
    </Query>
  );
}

function StageFields({ stage, error }: { stage?: Stage; error: (name: string) => string | undefined }) {
  const closed = stage !== undefined && stage.kind !== 'open';
  return (
    <>
      <Field label="Stage name" error={error('name')}>
        <Input name="name" defaultValue={stage?.name} required maxLength={60} />
      </Field>
      {closed ? (
        <p className="text-sm text-muted">
          This is the {stage.kind === 'won' ? 'Won' : 'Lost'} stage. It can be renamed, but its type and win probability ({stage.probability}%) are fixed.
        </p>
      ) : (
        <>
          <Field label="Win probability (%)" hint="A whole number from 0 to 100" error={error('probability')}>
            <Input name="probability" type="number" min={0} max={100} step={1} defaultValue={stage?.probability} required />
          </Field>
          <Field
            label="Stall threshold (days)"
            hint="A deal with no activity for this long is flagged. Leave empty for no flag."
            error={error('stallThresholdDays')}
          >
            <Input name="stallThresholdDays" type="number" min={1} max={365} step={1} defaultValue={stage?.stallThresholdDays ?? ''} />
          </Field>
        </>
      )}
    </>
  );
}

function FormButtons({ onCancel, busy, submit }: { onCancel: () => void; busy: boolean; submit: string }) {
  return (
    <div className="flex justify-end gap-2">
      <Button variant="secondary" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" disabled={busy}>
        {submit}
      </Button>
    </div>
  );
}

// ───────────────────────── lost reasons ─────────────────────────
interface LostReason {
  id: string;
  name: string;
  isActive: boolean;
  dealCount: number;
}

function LostReasonsSection() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['admin', 'lost-reasons'], queryFn: () => get<LostReason[]>('/admin/lost-reasons') });
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['admin', 'lost-reasons'] });
    void qc.invalidateQueries({ queryKey: ['pipeline'] });
  };
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<LostReason | null>(null);
  const create = useAction((body: object) => post('/admin/lost-reasons', body), {
    success: 'Lost reason added',
    onDone: () => {
      setAdding(false);
      refresh();
    },
  });
  const rename = useAction((x: { id: string; name: string }) => patch(`/admin/lost-reasons/${x.id}`, { name: x.name }), {
    success: 'Lost reason renamed',
    onDone: () => {
      setRenaming(null);
      refresh();
    },
  });
  const setActive = useAction((x: { id: string; isActive: boolean }) => patch<LostReason>(`/admin/lost-reasons/${x.id}`, { isActive: x.isActive }), {
    onDone: refresh,
    success: 'Lost reason updated',
  });
  const remove = useAction((id: string) => del(`/admin/lost-reasons/${id}`), { success: 'Lost reason removed', onDone: refresh });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">Reasons offered when a deal is closed as lost. A deactivated reason stays on the deals that already use it.</p>
        <Button onClick={() => setAdding(true)}>Add lost reason</Button>
      </div>
      <Query q={q}>
        {(reasons) =>
          reasons.length === 0 ? (
            <EmptyState title="No lost reasons yet" hint="Add at least one so deals can be closed as lost." />
          ) : (
            <Table head={['Reason', 'Status', 'Deals using it', '']}>
              {reasons.map((r) => (
                <tr key={r.id} data-reason={r.name}>
                  <td className="font-medium">{r.name}</td>
                  <td>
                    <Badge tone={r.isActive ? 'ok' : 'neutral'}>{r.isActive ? 'Active' : 'Inactive'}</Badge>
                  </td>
                  <td>{r.dealCount}</td>
                  <td className="whitespace-nowrap text-right">
                    <Button variant="secondary" aria-label={`Rename ${r.name}`} onClick={() => setRenaming(r)}>
                      Rename
                    </Button>{' '}
                    {r.isActive ? (
                      <ConfirmButton
                        variant="secondary"
                        label={`Deactivate ${r.name}`}
                        confirm={`Deactivate "${r.name}"? It will no longer be offered for new lost deals. Deals that already use it keep it.`}
                        disabled={setActive.busy}
                        onConfirm={() => setActive.run({ id: r.id, isActive: false })}
                      />
                    ) : (
                      <Button
                        variant="secondary"
                        aria-label={`Reactivate ${r.name}`}
                        disabled={setActive.busy}
                        onClick={() => setActive.run({ id: r.id, isActive: true })}
                      >
                        Reactivate
                      </Button>
                    )}{' '}
                    {r.dealCount === 0 && (
                      <ConfirmButton
                        label={`Remove ${r.name}`}
                        confirm={`Remove the lost reason "${r.name}"? No deal uses it. This cannot be undone.`}
                        disabled={remove.busy}
                        onConfirm={() => remove.run(r.id)}
                      />
                    )}
                  </td>
                </tr>
              ))}
            </Table>
          )
        }
      </Query>
      <Dialog open={adding} onClose={() => setAdding(false)} title="Add lost reason">
        <form className="space-y-3" onSubmit={(e) => create.run({ name: formValues(e).name ?? '' })}>
          <Field label="Reason" error={create.fieldError('name')}>
            <Input name="name" required maxLength={80} />
          </Field>
          <FormButtons onCancel={() => setAdding(false)} busy={create.busy} submit="Add reason" />
        </form>
      </Dialog>
      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title={`Rename ${renaming?.name ?? 'reason'}`}>
        {renaming && (
          <form key={renaming.id} className="space-y-3" onSubmit={(e) => rename.run({ id: renaming.id, name: formValues(e).name ?? '' })}>
            <Field label="Reason" error={rename.fieldError('name')}>
              <Input name="name" defaultValue={renaming.name} required maxLength={80} />
            </Field>
            <FormButtons onCancel={() => setRenaming(null)} busy={rename.busy} submit="Save name" />
          </form>
        )}
      </Dialog>
    </div>
  );
}

// ───────────────────────── teams ─────────────────────────
type RoleKey = 'admin' | 'sales_manager' | 'salesperson';
interface Person {
  userId: string;
  fullName: string;
  email: string;
  role: RoleKey;
  status: string;
}
interface Team {
  id: string;
  name: string;
  members: Person[];
  managers: Person[];
}
interface UserRow {
  id: string;
  fullName: string;
  role: RoleKey;
  status: string;
}
const ROLE_LABEL: Record<RoleKey, string> = { admin: 'Admin', sales_manager: 'Sales Manager', salesperson: 'Salesperson' };

function TeamsSection() {
  const qc = useQueryClient();
  const teams = useQuery({ queryKey: ['admin', 'teams'], queryFn: () => get<Team[]>('/admin/teams') });
  const users = useQuery({ queryKey: ['users'], queryFn: () => get<UserRow[]>('/users') });
  const refresh = () => {
    for (const key of [['admin', 'teams'], ['teams'], ['users']]) void qc.invalidateQueries({ queryKey: key });
  };
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<Team | null>(null);
  const [moving, setMoving] = useState<{ team: Team; userId: string; userName: string; from: string } | null>(null);
  const create = useAction((body: object) => post('/admin/teams', body), {
    success: 'Team created',
    onDone: () => {
      setCreating(false);
      refresh();
    },
  });
  const rename = useAction((x: { id: string; name: string }) => patch(`/admin/teams/${x.id}`, { name: x.name }), {
    success: 'Team renamed',
    onDone: () => {
      setRenaming(null);
      refresh();
    },
  });
  const addMember = useAction(
    (x: { teamId: string; userId: string; move?: boolean }) => post(`/admin/teams/${x.teamId}/members`, { userId: x.userId, move: x.move }),
    {
      success: 'Member added. Their manager can see their records straight away.',
      onDone: () => {
        setMoving(null);
        refresh();
      },
    },
  );
  const removeMember = useAction((x: { teamId: string; userId: string }) => del(`/admin/teams/${x.teamId}/members/${x.userId}`), {
    success: 'Member removed',
    onDone: refresh,
  });
  const addManager = useAction((x: { teamId: string; userId: string }) => post(`/admin/teams/${x.teamId}/managers`, { userId: x.userId }), {
    success: 'Manager assigned',
    onDone: refresh,
  });
  const removeManager = useAction((x: { teamId: string; userId: string }) => del(`/admin/teams/${x.teamId}/managers/${x.userId}`), {
    success: 'Manager removed',
    onDone: refresh,
  });
  const removeTeam = useAction((id: string) => del(`/admin/teams/${id}`), { success: 'Team deleted', onDone: refresh });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">A Sales Manager sees and manages the records of everyone in the teams they manage. Changes apply immediately.</p>
        <Button onClick={() => setCreating(true)}>New team</Button>
      </div>
      <Query q={teams}>
        {(list) => {
          const active = (users.data ?? []).filter((u) => u.status === 'active');
          const teamOf = new Map<string, Team>();
          for (const t of list) for (const m of t.members) teamOf.set(m.userId, t);
          const pickMember = (team: Team, userId: string) => {
            const user = active.find((u) => u.id === userId);
            const current = teamOf.get(userId);
            if (current && current.id !== team.id) setMoving({ team, userId, userName: user?.fullName ?? 'This user', from: current.name });
            else addMember.run({ teamId: team.id, userId });
          };
          return list.length === 0 ? (
            <EmptyState
              title="No teams yet"
              hint="Create a team, add its members and assign a manager."
              action={<Button onClick={() => setCreating(true)}>New team</Button>}
            />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {list.map((t) => (
                <section key={t.id} aria-label={`Team ${t.name}`} className="rounded-lg border border-line bg-white">
                  <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-2.5">
                    <h2 className="mr-auto text-sm font-semibold text-ink">{t.name}</h2>
                    <Button variant="secondary" aria-label={`Rename team ${t.name}`} onClick={() => setRenaming(t)}>
                      Rename
                    </Button>
                    {t.members.length + t.managers.length === 0 && (
                      <ConfirmButton
                        label={`Delete team ${t.name}`}
                        confirm={`Delete the empty team "${t.name}"? This cannot be undone.`}
                        disabled={removeTeam.busy}
                        onConfirm={() => removeTeam.run(t.id)}
                      />
                    )}
                  </header>
                  <div className="space-y-4 p-4">
                    <PeopleList
                      title="Managers"
                      empty="No manager yet — nobody sees this team's records as a manager."
                      people={t.managers}
                      removeLabel={(p) => `Remove ${p.fullName} as manager of ${t.name}`}
                      confirm={(p) => `Remove ${p.fullName} as a manager of "${t.name}"? They immediately lose access to this team's records.`}
                      onRemove={(p) => removeManager.run({ teamId: t.id, userId: p.userId })}
                      busy={removeManager.busy}
                    />
                    <AddPerson
                      label={`Add manager to ${t.name}`}
                      placeholder="Assign a manager…"
                      button="Assign manager"
                      options={active.filter((u) => u.role !== 'salesperson' && !t.managers.some((m) => m.userId === u.id))}
                      busy={addManager.busy}
                      onAdd={(userId) => addManager.run({ teamId: t.id, userId })}
                    />
                    <PeopleList
                      title="Members"
                      empty="No members yet."
                      people={t.members}
                      removeLabel={(p) => `Remove ${p.fullName} from ${t.name}`}
                      confirm={(p) => `Remove ${p.fullName} from "${t.name}"? The team's managers immediately lose access to their records.`}
                      onRemove={(p) => removeMember.run({ teamId: t.id, userId: p.userId })}
                      busy={removeMember.busy}
                    />
                    <AddPerson
                      label={`Add member to ${t.name}`}
                      placeholder="Add a member…"
                      button="Add member"
                      options={active.filter((u) => !t.members.some((m) => m.userId === u.id))}
                      describe={(u) => {
                        const current = teamOf.get(u.id);
                        return current ? ` — currently in ${current.name}` : '';
                      }}
                      busy={addMember.busy}
                      onAdd={(userId) => pickMember(t, userId)}
                    />
                  </div>
                </section>
              ))}
            </div>
          );
        }}
      </Query>
      {users.isError && <ErrorState error={users.error} retry={() => void users.refetch()} />}
      <Dialog open={creating} onClose={() => setCreating(false)} title="New team">
        <form className="space-y-3" onSubmit={(e) => create.run({ name: formValues(e).name ?? '' })}>
          <Field label="Team name" error={create.fieldError('name')}>
            <Input name="name" required maxLength={80} />
          </Field>
          <FormButtons onCancel={() => setCreating(false)} busy={create.busy} submit="Create team" />
        </form>
      </Dialog>
      <Dialog open={renaming !== null} onClose={() => setRenaming(null)} title={`Rename team ${renaming?.name ?? ''}`}>
        {renaming && (
          <form key={renaming.id} className="space-y-3" onSubmit={(e) => rename.run({ id: renaming.id, name: formValues(e).name ?? '' })}>
            <Field label="Team name" error={rename.fieldError('name')}>
              <Input name="name" defaultValue={renaming.name} required maxLength={80} />
            </Field>
            <FormButtons onCancel={() => setRenaming(null)} busy={rename.busy} submit="Save name" />
          </form>
        )}
      </Dialog>
      <Dialog open={moving !== null} onClose={() => setMoving(null)} title="Move to another team?">
        {moving && (
          <>
            <p className="text-sm text-ink">
              {moving.userName} is in team "{moving.from}". A user belongs to one team, so adding them to "{moving.team.name}" moves them. The managers of "
              {moving.from}" lose access to their records.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setMoving(null)}>
                Cancel
              </Button>
              <Button disabled={addMember.busy} onClick={() => addMember.run({ teamId: moving.team.id, userId: moving.userId, move: true })}>
                Move to {moving.team.name}
              </Button>
            </div>
          </>
        )}
      </Dialog>
    </div>
  );
}

function PeopleList({
  title,
  empty,
  people,
  removeLabel,
  confirm,
  onRemove,
  busy,
}: {
  title: string;
  empty: string;
  people: Person[];
  removeLabel: (p: Person) => string;
  confirm: (p: Person) => string;
  onRemove: (p: Person) => void;
  busy: boolean;
}) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">{title}</h3>
      {people.length === 0 ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.userId} className="flex items-center justify-between gap-2 py-1.5 text-sm">
              <span>
                <span className="font-medium text-ink">{p.fullName}</span> <span className="text-muted">· {ROLE_LABEL[p.role]}</span>{' '}
                {p.status !== 'active' && <Badge tone="danger">{p.status}</Badge>}
              </span>
              <ConfirmButton variant="secondary" label={removeLabel(p)} confirm={confirm(p)} disabled={busy} onConfirm={() => onRemove(p)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AddPerson({
  label,
  placeholder,
  button,
  options,
  describe,
  busy,
  onAdd,
}: {
  label: string;
  placeholder: string;
  button: string;
  options: UserRow[];
  describe?: (u: UserRow) => string;
  busy: boolean;
  onAdd: (userId: string) => void;
}) {
  const [value, setValue] = useState('');
  return (
    <div className="flex items-center gap-2">
      <Select aria-label={label} value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">{options.length ? placeholder : 'Nobody else to add'}</option>
        {options.map((u) => (
          <option key={u.id} value={u.id}>
            {u.fullName} ({ROLE_LABEL[u.role]}){describe?.(u) ?? ''}
          </option>
        ))}
      </Select>
      <Button
        variant="secondary"
        className="shrink-0"
        disabled={busy || value === ''}
        onClick={() => {
          onAdd(value);
          setValue('');
        }}
      >
        {button}
      </Button>
    </div>
  );
}

// ───────────────────────── audit log ─────────────────────────
interface AuditItem {
  id: string;
  seq: number;
  occurredAt: string;
  actorType: string;
  actorName: string;
  action: string;
  targetType: string | null;
  targetId: string | null;
  targetName: string | null;
  outcome: string;
  summary: string[];
}
interface AuditPage {
  items: AuditItem[];
  nextCursor: number | null;
}
interface AuditFilters {
  from?: string;
  to?: string;
  actorUserId?: string;
  action?: string;
  targetType?: string;
}
const words = (s: string) => s.replace(/[_.]/g, ' ');
const PAGE_SIZE = 50;

export function AuditLogPage() {
  const [filters, setFilters] = useState<AuditFilters>({});
  const [formKey, setFormKey] = useState(0);
  const [invalid, setInvalid] = useState<string | null>(null);
  const options = useQuery({
    queryKey: ['audit-log', 'filters'],
    queryFn: () => get<{ targetTypes: string[]; actors: { userId: string; fullName: string }[] }>('/audit-log/filters'),
  });
  const log = useInfiniteQuery({
    queryKey: ['audit-log', filters],
    initialPageParam: null as number | null,
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams({ limit: String(PAGE_SIZE) });
      for (const [k, v] of Object.entries(filters)) if (v) params.set(k, v);
      if (pageParam) params.set('before', String(pageParam));
      return get<AuditPage>(`/audit-log?${params.toString()}`);
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const apply = (e: FormEvent<HTMLFormElement>) => {
    const v = formValues(e);
    // Date inputs are calendar days in the viewer's time zone: from the start of the first day to the end of the last.
    const from = v.from ? new Date(`${v.from}T00:00:00`) : undefined;
    const to = v.to ? new Date(`${v.to}T23:59:59.999`) : undefined;
    if (from && to && from > to) {
      setInvalid('The "from" date must not be after the "to" date.');
      return;
    }
    setInvalid(null);
    setFilters({ from: from?.toISOString(), to: to?.toISOString(), actorUserId: v.actorUserId, action: v.action, targetType: v.targetType });
  };
  const items = log.data?.pages.flatMap((p) => p.items) ?? [];
  const filtered = Object.values(filters).some(Boolean);

  return (
    <>
      <PageHeader title="Audit log" subtitle="Who changed what, and when. Newest first. Entries cannot be edited or deleted." />
      <form key={formKey} onSubmit={apply} aria-label="Audit log filters" className="mb-4 rounded-lg border border-line bg-white p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Field label="From date">
            <Input name="from" type="date" />
          </Field>
          <Field label="To date" error={invalid ?? undefined}>
            <Input name="to" type="date" />
          </Field>
          <Field label="Person">
            <Select name="actorUserId" defaultValue="">
              <option value="">Anyone</option>
              {options.data?.actors.map((a) => (
                <option key={a.userId} value={a.userId}>
                  {a.fullName}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Action starts with" hint="For example team. or pipeline.stage">
            <Input name="action" maxLength={80} pattern="[A-Za-z0-9_.\-]*" title="Letters, digits, dots, dashes or underscores" />
          </Field>
          <Field label="Record type">
            <Select name="targetType" defaultValue="">
              <option value="">Any</option>
              {options.data?.targetTypes.map((t) => (
                <option key={t} value={t}>
                  {words(t)}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={!filtered}
            onClick={() => {
              setInvalid(null);
              setFilters({});
              setFormKey((k) => k + 1);
            }}
          >
            Clear filters
          </Button>
          <Button type="submit">Apply filters</Button>
        </div>
      </form>
      {log.isPending ? (
        <Skeleton rows={8} />
      ) : log.isError ? (
        <ErrorState error={log.error} retry={() => void log.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title={filtered ? 'No entries match these filters' : 'Nothing has been recorded yet'}
          hint={filtered ? 'Widen the date range or clear the filters.' : undefined}
        />
      ) : (
        <>
          <Table head={['When', 'Who', 'Action', 'Record', 'Changes']}>
            {items.map((i) => (
              <tr key={i.id} className="align-top">
                <td className="whitespace-nowrap">{dateTime(i.occurredAt)}</td>
                <td>
                  {i.actorName}
                  {i.actorType !== 'user' && <span className="text-muted"> ({i.actorType})</span>}
                </td>
                <td>
                  <code className="text-xs">{i.action}</code> {i.outcome !== 'success' && <Badge tone="danger">{i.outcome}</Badge>}
                </td>
                <td>
                  {i.targetType ? (
                    <>
                      <span className="text-muted">{words(i.targetType)}</span>
                      {i.targetName && <span className="block font-medium text-ink">{i.targetName}</span>}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td>
                  {i.summary.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <ul className="space-y-0.5">
                      {i.summary.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <div className="mt-3 flex items-center justify-between gap-3 text-sm text-muted">
            <span>
              Showing {items.length} {items.length === 1 ? 'entry' : 'entries'}
              {log.hasNextPage ? '' : ' — end of the log'}
            </span>
            {log.hasNextPage && (
              <Button variant="secondary" disabled={log.isFetchingNextPage} onClick={() => void log.fetchNextPage()}>
                {log.isFetchingNextPage ? 'Loading…' : 'Load older entries'}
              </Button>
            )}
          </div>
        </>
      )}
    </>
  );
}
