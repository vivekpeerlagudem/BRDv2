import { computeTotals, type Pricing, type PricingLine, type ProposalDocument } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { useEffect, useMemo, useState } from 'react';
import { ApiError, api, dateOnly, dateTime, get, money, personName, post, put } from '../lib/api.ts';
import { useMe } from '../lib/me.ts';
import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  Dialog,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Query,
  Select,
  statusTone,
  Table,
  Textarea,
  useAction,
  useToast,
} from '../lib/ui.tsx';
import { AiLabel, type AiMeta, AiProvenance, FigureWarning, FollowUpDialog, ReviewPanel, RewriteControl, useAiFeature } from './ai.tsx';
import { ProposalAnalytics } from './documents.tsx';

interface Finding {
  code: string;
  severity: 'blocking' | 'warning';
  message: string;
  sectionId?: string;
}
type SentLink = { contactId: string; url: string };
interface DraftResult {
  generationId: string;
  sectionId: string;
  text: string;
  unverifiedFigures: string[];
  meta: AiMeta;
}
interface AiDraft {
  generationId: string;
  text: string;
  edited: string;
  unverifiedFigures?: string[];
  meta?: AiMeta;
  simulated?: boolean | undefined;
}
const newKey = () => `l${Math.random().toString(36).slice(2, 9)}`;
/** A calendar date (YYYY-MM-DD) shown without any time-zone shift. */
const dayLabel = (iso: string | null | undefined) => (iso ? dateOnly(`${iso}T12:00:00`) : 'No validity date');
/** Date → the value format of <input type="datetime-local"> in the user's own time zone. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function ProposalPage() {
  const { id } = useParams({ strict: false }) as { id: string };
  const q = useQuery({ queryKey: ['proposal', id], queryFn: () => get<any>(`/proposals/${id}`), refetchInterval: 15_000 });
  // The sent-links dialog lives here, not in ProposalView: sending changes the version, which remounts the view.
  const [sentLinks, setSentLinks] = useState<SentLink[] | null>(null);
  const toast = useToast();
  return (
    <>
      <Query q={q} rows={8}>
        {(p) => <ProposalView key={`${p.currentVersion.id}:${p.currentVersion.rowVersion}`} p={p} setSentLinks={setSentLinks} />}
      </Query>
      <Dialog open={sentLinks !== null} onClose={() => setSentLinks(null)} title="Proposal sent — share these links">
        <p className="mb-3 text-sm text-muted">
          Each recipient has a personal tracked link. Paste it into your email to them. You are alerted when it is opened or forwarded.
        </p>
        <ul className="space-y-2">
          {sentLinks?.map((l) => (
            <li key={l.contactId} className="flex gap-2">
              <Input readOnly value={l.url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
              <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(l.url).then(() => toast('Link copied'))}>
                Copy
              </Button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}

function ProposalView({ p, setSentLinks }: { p: any; setSentLinks: (links: SentLink[]) => void }) {
  const id: string = p.id;
  const me = useMe();
  const qc = useQueryClient();
  const toast = useToast();
  const refresh = () => qc.invalidateQueries();
  const v = p.currentVersion;
  const isDraft = v.state === 'draft';
  const [doc, setDoc] = useState<ProposalDocument>(v.content);
  const [pricing, setPricing] = useState<Pricing>(v.pricing);
  const [term, setTerm] = useState<number>(v.termMonths);
  // BR-PRP-009: the validity date is saved with the draft. '' = no validity date.
  const [validUntil, setValidUntil] = useState<string>(p.validUntil ?? '');
  const validityError = validUntil && validUntil !== (p.validUntil ?? '') && validUntil < p.today ? 'The validity date must be today or later' : undefined;
  const [dirty, setDirty] = useState(false);
  const [dialog, setDialog] = useState<null | 'send' | 'preview' | 'sign' | 'compare' | 'followup' | 'copy'>(null);
  const [previewHtml, setPreviewHtml] = useState('');
  // AI suggestions waiting for a decision, by section. Restored from the server on reload so none is ever lost or hidden.
  const [aiDrafts, setAiDrafts] = useState<Record<string, AiDraft>>(() =>
    Object.fromEntries(
      (p.pendingAi ?? [])
        .filter((g: any) => g.feature === 'draft_section')
        .map((g: any) => [g.target.sectionId, { generationId: g.id, text: g.output?.text ?? '', edited: g.output?.text ?? '', simulated: g.simulated }]),
    ),
  );
  const pendingRewrites: any[] = (p.pendingAi ?? []).filter((g: any) => g.feature === 'rewrite_text');
  const [selection, setSelection] = useState<{ sectionId: string; start: number; end: number } | null>(null);
  const aiDraft = useAiFeature('draft_section');
  const followUp = useAiFeature('follow_up_email');

  const products = useQuery({ queryKey: ['products'], queryFn: () => get<any[]>('/products'), enabled: isDraft });
  const deal = useQuery({ queryKey: ['deal', p.dealId], queryFn: () => get<any>(`/deals/${p.dealId}`) });
  const check = useQuery({
    queryKey: ['presend', id, v.rowVersion],
    queryFn: () => get<{ findings: Finding[]; blocking: number }>(`/proposals/${id}/presend-check`),
    enabled: isDraft,
  });
  const links = useQuery({ queryKey: ['links', id], queryFn: () => get<any[]>(`/proposals/${id}/links`), refetchInterval: 15_000 });
  const sigs = useQuery({ queryKey: ['sigs', id], queryFn: () => get<any[]>(`/proposals/${id}/signature-requests`), refetchInterval: 10_000 });

  // Live totals use the SAME pricing code as the server (packages/shared); the server result is authoritative.
  const totals = useMemo(() => {
    try {
      return { ok: true as const, value: computeTotals(pricing, term, p.currency) };
    } catch (e) {
      return { ok: false as const, message: e instanceof Error ? e.message : 'Invalid pricing' };
    }
  }, [pricing, term, p.currency]);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const save = useAction(
    () => put(`/proposals/${id}/draft`, { content: doc, pricing, termMonths: term, validUntil: validUntil || null, rowVersion: v.rowVersion }),
    {
      success: 'Draft saved',
      onDone: () => {
        setDirty(false);
        void refresh();
      },
    },
  );
  const confirmCurrency = useAction(() => post(`/proposals/${id}/currency-review/confirm`), {
    success: 'Prices confirmed',
    onDone: () => void refresh(),
  });
  const keep = (r: DraftResult): AiDraft => ({
    generationId: r.generationId,
    text: r.text,
    edited: r.text,
    unverifiedFigures: r.unverifiedFigures,
    meta: r.meta,
    simulated: r.meta?.simulated,
  });
  const draftAi = useAction((sectionId: string) => post<DraftResult>('/ai/draft-section', { proposalId: id, sectionId }), {
    onDone: (r) => {
      setAiDrafts((a) => ({ ...a, [r.sectionId]: keep(r) }));
      void qc.invalidateQueries({ queryKey: ['presend', id] });
      toast('AI draft ready for your review');
    },
  });
  const draftAll = useAction(() => post<{ generations: DraftResult[]; meta: AiMeta }>('/ai/draft-sections', { proposalId: id }), {
    onDone: (r) => {
      setAiDrafts((a) => ({ ...a, ...Object.fromEntries(r.generations.map((g) => [g.sectionId, keep({ ...g, meta: r.meta })])) }));
      void qc.invalidateQueries({ queryKey: ['presend', id] });
      toast(`${r.generations.length} AI draft(s) ready for your review`);
    },
  });
  const decideAi = useAction(
    (x: { sectionId: string; decision: 'accept' | 'reject' }) => {
      const d = aiDrafts[x.sectionId] as AiDraft;
      return post(
        `/ai/generations/${d.generationId}/decision`,
        x.decision === 'accept' && d.edited !== d.text ? { decision: 'accept', editedText: d.edited } : { decision: x.decision },
      );
    },
    {
      // An accepted draft changes the saved version, which reloads this view; a rejected one just disappears.
      onDone: (_r) => void refresh(),
    },
  );
  const discardRewrite = useAction((generationId: string) => post(`/ai/generations/${generationId}/decision`, { decision: 'reject' }), {
    onDone: () => void refresh(),
  });
  const newVersion = useAction(() => post(`/proposals/${id}/versions`), { success: 'New draft version created', onDone: () => void refresh() });
  const voidIt = useAction(() => post(`/proposals/${id}/void`, { reason: 'Withdrawn by sales' }), { success: 'Proposal voided', onDone: () => void refresh() });
  const syncAmount = useAction(() => post(`/proposals/${id}/deal-amount`), {
    success: 'Opportunity amount updated from proposal',
    onDone: () => void refresh(),
  });
  const showPreview = useAction(() => get<{ html: string }>(`/proposals/${id}/preview`), {
    onDone: (r) => {
      setPreviewHtml(r.html);
      setDialog('preview');
    },
  });

  const edit = (fn: () => void) => {
    fn();
    setDirty(true);
  };
  const setSection = (sid: string, body: string) => edit(() => setDoc((d) => ({ ...d, sections: d.sections.map((s) => (s.id === sid ? { ...s, body } : s)) })));
  const setLine = (key: string, patch: Partial<PricingLine>) =>
    edit(() => setPricing((pr) => ({ ...pr, lines: pr.lines.map((l) => (l.lineKey === key ? { ...l, ...patch } : l)) })));
  const addProduct = (productId: string) => {
    const prod = products.data?.find((x) => x.id === productId);
    if (!prod) return;
    edit(() =>
      setPricing((pr) => ({
        ...pr,
        lines: [
          ...pr.lines,
          {
            lineKey: newKey(),
            name: prod.name,
            unit: prod.unit,
            quantity: '1',
            unitPrice: String(Number(prod.unitPrice)),
            taxRatePercent: String(Number(prod.taxRatePercent)),
            billingType: prod.billingType,
            ...(prod.billingPeriod ? { billingPeriod: prod.billingPeriod } : {}),
          },
        ],
      })),
    );
  };
  const locked = new Set<string>(p.lockedSectionIds);
  const findings = check.data?.findings ?? [];
  const canManage = deal.data?.permissions.manageProposals ?? false;
  const emptyDraftable = doc.sections.filter((x) => x.kind === 'text' && x.aiDraftable && !locked.has(x.id) && !x.body.trim() && !aiDrafts[x.id]);
  const openSig = sigs.data?.find((s) => ['pending', 'sent', 'viewed'].includes(s.status));

  return (
    <>
      <PageHeader
        title={p.title}
        subtitle={
          <>
            <Link to="/deals/$id" params={{ id: p.dealId }} className="text-brand hover:underline">
              {p.deal.name}
            </Link>{' '}
            · Version {v.versionNumber} ({v.state})
          </>
        }
        actions={
          <>
            <Badge tone={statusTone(p.status)}>{p.status}</Badge>
            <Button
              variant="secondary"
              disabled={dirty || showPreview.busy}
              title={dirty ? 'Save the draft first' : undefined}
              onClick={() => showPreview.run(undefined)}
            >
              Preview
            </Button>
            {isDraft && canManage && (
              <Button variant="secondary" disabled={!dirty || save.busy || !totals.ok || Boolean(validityError)} onClick={() => save.run(undefined)}>
                {save.busy ? 'Saving…' : 'Save draft'}
              </Button>
            )}
            {isDraft && canManage && (
              <Button
                disabled={dirty || (check.data?.blocking ?? 1) > 0}
                title={dirty ? 'Save the draft first' : (check.data?.blocking ?? 0) > 0 ? 'Fix blocking findings first' : undefined}
                onClick={() => setDialog('send')}
              >
                Send…
              </Button>
            )}
            {!isDraft && canManage && !['signed', 'void'].includes(p.status) && (
              <Button variant="secondary" onClick={() => newVersion.run(undefined)}>
                Create new version
              </Button>
            )}
            {!isDraft && canManage && ['sent', 'viewed', 'accepted'].includes(p.status) && p.signatureRequired && !openSig && (
              <Button onClick={() => setDialog('sign')}>Request signatures…</Button>
            )}
            {isDraft && canManage && aiDraft && emptyDraftable.length > 0 && (
              <Button
                variant="secondary"
                disabled={dirty || draftAll.busy}
                title={dirty ? 'Save the draft first' : undefined}
                onClick={() => draftAll.run(undefined)}
              >
                {draftAll.busy ? 'Drafting…' : `Draft ${emptyDraftable.length} empty section(s) with AI`}
              </Button>
            )}
            {!isDraft && canManage && followUp && ['sent', 'viewed', 'accepted', 'declined'].includes(p.status) && (
              <Button variant="secondary" onClick={() => setDialog('followup')}>
                Draft follow-up email…
              </Button>
            )}
            {p.versions.length > 1 && (
              <Button variant="secondary" onClick={() => setDialog('compare')}>
                Compare versions
              </Button>
            )}
            <Button variant="secondary" disabled={dirty} title={dirty ? 'Save the draft first' : undefined} onClick={() => setDialog('copy')}>
              Copy to another opportunity…
            </Button>
            {canManage && !['signed', 'void'].includes(p.status) && (
              <ConfirmButton
                label="Void"
                confirm="Void this proposal? Buyers will see that it was withdrawn. This cannot be undone."
                onConfirm={() => voidIt.run(undefined)}
              />
            )}
          </>
        }
      />
      {p.currencyReviewFrom && (
        <div role="alert" className="mb-4 flex flex-wrap items-center gap-3 rounded-md bg-amber-50 p-3 text-sm text-warn">
          <span>
            Currency changed — review prices. The prices were copied unchanged from a {p.currencyReviewFrom} proposal; this opportunity uses {p.currency}.
            Sending is blocked until you confirm them.
          </span>
          {isDraft && canManage && (
            <ConfirmButton
              variant="secondary"
              label="Confirm prices"
              disabled={dirty || confirmCurrency.busy}
              confirm={`Confirm that every price on this proposal is correct in ${p.currency}?`}
              onConfirm={() => confirmCurrency.run(undefined)}
            />
          )}
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {doc.sections.map((s) => {
            const isLocked = locked.has(s.id) || !isDraft || !canManage;
            const ai = aiDrafts[s.id];
            return (
              <Card
                key={s.id}
                title={
                  <>
                    {s.title} {locked.has(s.id) && <Badge>Locked by template</Badge>} {s.required && <Badge tone="info">Required</Badge>}
                  </>
                }
                actions={
                  isDraft &&
                  canManage &&
                  s.kind === 'text' &&
                  s.aiDraftable &&
                  !locked.has(s.id) &&
                  aiDraft && (
                    <Button
                      variant="ghost"
                      disabled={draftAi.busy || draftAll.busy || dirty}
                      title={dirty ? 'Save the draft first' : undefined}
                      onClick={() => draftAi.run(s.id)}
                    >
                      {ai ? 'Regenerate' : 'Draft with AI'}
                    </Button>
                  )
                }
              >
                {s.kind !== 'signature' && (
                  <Textarea
                    aria-label={s.title}
                    readOnly={isLocked}
                    value={s.body}
                    onChange={(e) => setSection(s.id, e.target.value)}
                    onSelect={(e) => setSelection({ sectionId: s.id, start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
                    className={isLocked ? 'bg-surface text-muted' : ''}
                    rows={Math.min(12, Math.max(3, s.body.split('\n').length + 1))}
                  />
                )}
                {s.kind === 'signature' && <p className="text-sm text-muted">{s.body} Signature lines are added for each signer.</p>}
                {ai && (
                  <section aria-label={`AI draft for ${s.title}`} className="mt-3 rounded-md border border-brand/30 bg-brand-soft p-3 text-sm">
                    <p className="mb-2">
                      <AiLabel simulated={ai.simulated ?? me.data?.settings.aiSimulated}>AI-generated — not yet part of the proposal</AiLabel>
                    </p>
                    <Textarea
                      aria-label={`AI draft for ${s.title} (editable)`}
                      rows={Math.min(14, Math.max(4, ai.edited.split('\n').length + 1))}
                      value={ai.edited}
                      onChange={(e) => setAiDrafts((a) => ({ ...a, [s.id]: { ...ai, edited: e.target.value } }))}
                    />
                    <FigureWarning figures={ai.unverifiedFigures ?? []} />
                    <AiProvenance meta={ai.meta} />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Button disabled={decideAi.busy || !ai.edited.trim()} onClick={() => decideAi.run({ sectionId: s.id, decision: 'accept' })}>
                        {ai.edited !== ai.text ? 'Accept edited text into section' : 'Accept into section'}
                      </Button>
                      <Button variant="secondary" disabled={decideAi.busy} onClick={() => decideAi.run({ sectionId: s.id, decision: 'reject' })}>
                        Reject
                      </Button>
                    </div>
                  </section>
                )}
                {pendingRewrites
                  .filter((g) => g.target.sectionId === s.id)
                  .map((g) => (
                    <p key={g.id} role="status" className="mt-2 flex flex-wrap items-center gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-warn">
                      An AI rewrite of “{String(g.target.selectedText).slice(0, 60)}” was left undecided and is blocking sending.
                      <Button variant="ghost" disabled={discardRewrite.busy} onClick={() => discardRewrite.run(g.id)}>
                        Discard it
                      </Button>
                    </p>
                  ))}
                {isDraft && canManage && s.kind === 'text' && !locked.has(s.id) && (
                  <RewriteControl
                    proposalId={id}
                    sectionId={s.id}
                    sectionTitle={s.title}
                    savedBody={s.body}
                    selection={selection?.sectionId === s.id ? selection : null}
                    dirty={dirty}
                    onApplied={() => void refresh()}
                  />
                )}
                {s.kind === 'pricing' && (
                  <div className="mt-3">
                    <Table head={['Item', 'Qty', 'Unit price', 'Disc. %', 'Billing', '']}>
                      {pricing.lines.map((l) => (
                        <tr key={l.lineKey}>
                          <td>
                            <Input aria-label="Item name" readOnly={!isDraft} value={l.name} onChange={(e) => setLine(l.lineKey, { name: e.target.value })} />
                          </td>
                          <td className="w-20">
                            <Input
                              aria-label="Quantity"
                              readOnly={!isDraft}
                              inputMode="decimal"
                              value={l.quantity}
                              onChange={(e) => setLine(l.lineKey, { quantity: e.target.value })}
                            />
                          </td>
                          <td className="w-28">
                            <Input
                              aria-label="Unit price"
                              readOnly={!isDraft}
                              inputMode="decimal"
                              value={l.unitPrice}
                              onChange={(e) => setLine(l.lineKey, { unitPrice: e.target.value })}
                            />
                          </td>
                          <td className="w-20">
                            <Input
                              aria-label="Discount percent"
                              readOnly={!isDraft}
                              inputMode="decimal"
                              value={l.discountValue ?? ''}
                              onChange={(e) =>
                                setLine(
                                  l.lineKey,
                                  e.target.value
                                    ? { discountType: 'percent', discountValue: e.target.value }
                                    : { discountType: undefined, discountValue: undefined },
                                )
                              }
                            />
                          </td>
                          <td className="text-xs text-muted">{l.billingType === 'recurring' ? `per ${l.billingPeriod}` : 'one-time'}</td>
                          <td>
                            {isDraft && (
                              <Button
                                variant="ghost"
                                aria-label={`Remove ${l.name}`}
                                onClick={() => edit(() => setPricing((pr) => ({ ...pr, lines: pr.lines.filter((x) => x.lineKey !== l.lineKey) })))}
                              >
                                Remove
                              </Button>
                            )}
                          </td>
                        </tr>
                      ))}
                    </Table>
                    {isDraft && canManage && (
                      <div className="mt-2 flex flex-wrap items-end gap-3">
                        <Field label="Add from catalogue">
                          <Select value="" onChange={(e) => addProduct(e.target.value)}>
                            <option value="">Choose a product…</option>
                            {products.data?.map((x) => (
                              <option key={x.id} value={x.id}>
                                {x.name} — {money(x.unitPrice, p.currency)}
                              </option>
                            ))}
                          </Select>
                        </Field>
                        <Field label="Contract term (months)">
                          <Input
                            className="w-28"
                            type="number"
                            min={1}
                            max={120}
                            value={term}
                            onChange={(e) => edit(() => setTerm(Number(e.target.value) || 1))}
                          />
                        </Field>
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
        <div className="space-y-4">
          <Card title="Validity">
            {isDraft && canManage ? (
              <>
                <Field
                  label="Valid until"
                  error={validityError}
                  hint={
                    validUntil ? 'The proposal expires for the buyer at the end of this day.' : 'No validity date: the proposal does not expire on its own.'
                  }
                >
                  <Input
                    type="date"
                    min={p.today}
                    value={validUntil}
                    aria-invalid={validityError ? true : undefined}
                    onChange={(e) => edit(() => setValidUntil(e.target.value))}
                  />
                </Field>
                {p.defaultValidUntil && (
                  <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted">
                    Organization default: {dayLabel(p.defaultValidUntil)} ({p.defaultValidityDays} days from today)
                    {validUntil !== p.defaultValidUntil && (
                      <Button variant="ghost" onClick={() => edit(() => setValidUntil(p.defaultValidUntil))}>
                        Use default
                      </Button>
                    )}
                  </p>
                )}
              </>
            ) : (
              <p className="text-sm">
                <span className="text-muted">Valid until</span> <span className="font-medium">{dayLabel(p.validUntil)}</span>
                {!isDraft && canManage && !['signed', 'void'].includes(p.status) && (
                  <span className="mt-1 block text-xs text-muted">Sent versions cannot change. Create a new version to change the validity date.</span>
                )}
              </p>
            )}
          </Card>
          <Card title="Totals">
            {totals.ok ? (
              <dl className="space-y-1.5 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted">One-time</dt>
                  <dd className="tabular-nums">{money(totals.value.oneTime.total, p.currency)}</dd>
                </div>
                {totals.value.recurring.map((r) => (
                  <div key={r.period} className="flex justify-between">
                    <dt className="text-muted">Per {r.period}</dt>
                    <dd className="tabular-nums">{money(r.total, p.currency)}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-line pt-1.5 font-semibold">
                  <dt>Contract value ({term} mo.)</dt>
                  <dd className="tabular-nums">{money(totals.value.tcvExclTax, p.currency)}</dd>
                </div>
              </dl>
            ) : (
              <p role="alert" className="text-sm text-danger">
                {totals.message}
              </p>
            )}
            {canManage && p.deal.amount !== null && totals.ok && Number(p.deal.amount) !== Number(v.totals.tcvExclTax) && !dirty && (
              <div className="mt-3 rounded-md bg-amber-50 p-2 text-sm text-warn">
                Opportunity amount is {money(p.deal.amount, p.currency)}.
                <Button variant="ghost" onClick={() => syncAmount.run(undefined)}>
                  Update opportunity to {money(v.totals.tcvExclTax, p.currency)}
                </Button>
              </div>
            )}
          </Card>
          {isDraft && (
            <Card title="Pre-send check">
              {dirty ? (
                <p className="text-sm text-muted">Save the draft to re-run the checks.</p>
              ) : findings.length === 0 ? (
                <p className="text-sm text-ok">No issues found. Ready to send.</p>
              ) : (
                <ul className="space-y-2 text-sm">
                  {findings.map((f, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: findings have no stable id
                    <li key={i} className="flex items-start gap-2">
                      <Badge tone={f.severity === 'blocking' ? 'danger' : 'warn'}>{f.severity === 'blocking' ? 'Must fix' : 'Check'}</Badge>
                      <span>{f.message}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          )}
          {isDraft && <ReviewPanel proposalId={id} dirty={dirty} canManage={canManage} />}
          <ProposalAnalytics links={links.data ?? []} sections={doc.sections} />
          <Card title="Sharing and engagement">
            <Query q={links} rows={2}>
              {(ls) =>
                ls.length === 0 ? (
                  <p className="text-sm text-muted">Not shared yet. Each recipient gets their own tracked link.</p>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {ls.map((l) => (
                      <LinkRow
                        key={l.id}
                        link={l}
                        canManage={canManage}
                        proposalValidUntil={p.validUntil}
                        proposalOpen={!['void', 'expired'].includes(p.status)}
                        onChange={() => void refresh()}
                      />
                    ))}
                  </ul>
                )
              }
            </Query>
          </Card>
          <Card title="Signatures">
            <Query q={sigs} rows={1}>
              {(rs) =>
                rs.length === 0 ? (
                  <p className="text-sm text-muted">
                    {p.signatureRequired ? 'No signature requested yet.' : 'This proposal uses the accept / decline button instead of a signature.'}
                  </p>
                ) : (
                  <ul className="space-y-3 text-sm">
                    {rs.map((r) => (
                      <SignatureRow key={r.id} req={r} canManage={canManage} onChange={() => void refresh()} />
                    ))}
                  </ul>
                )
              }
            </Query>
          </Card>
          <Card title="Versions">
            <ul className="space-y-1.5 text-sm">
              {p.versions.map((x: any) => (
                <li key={x.id} className="flex items-center justify-between">
                  <span>
                    v{x.versionNumber} <Badge tone={statusTone(x.state)}>{x.state}</Badge>
                  </span>
                  {x.sentAt && (
                    <span className="flex gap-2">
                      <a className="text-brand hover:underline" href={`/api/v1/proposals/${id}/versions/${x.id}/pdf`}>
                        PDF
                      </a>
                      <a className="text-brand hover:underline" href={`/api/v1/proposals/${id}/versions/${x.id}/docx`}>
                        DOCX
                      </a>
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      <Dialog open={dialog === 'preview'} onClose={() => setDialog(null)} title="Preview — exactly what the buyer will see" wide>
        {/* Sandboxed frame: no scripts, no same-origin access. Internal previews are never tracked. */}
        <iframe title="Proposal preview" sandbox="" srcDoc={previewHtml} className="h-[65vh] w-full rounded border border-line" />
      </Dialog>
      {dialog === 'send' && (
        <SendDialog
          proposalId={id}
          contacts={deal.data?.contacts ?? []}
          onClose={() => setDialog(null)}
          onSent={(ls) => {
            setSentLinks(ls);
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {dialog === 'followup' && (
        <FollowUpDialog dealId={p.dealId} proposalId={id} contacts={(deal.data?.contacts ?? []).filter((c: any) => c.email)} onClose={() => setDialog(null)} />
      )}
      {dialog === 'sign' && (
        <SignDialog
          proposalId={id}
          contacts={deal.data?.contacts ?? []}
          onClose={() => {
            setDialog(null);
            void refresh();
          }}
        />
      )}
      {dialog === 'compare' && <CompareDialog proposalId={id} versions={p.versions} currency={p.currency} onClose={() => setDialog(null)} />}
      {dialog === 'copy' && <CopyDialog proposal={p} onClose={() => setDialog(null)} />}
    </>
  );
}

function SendDialog({
  proposalId,
  contacts,
  onClose,
  onSent,
}: {
  proposalId: string;
  contacts: any[];
  onClose: () => void;
  onSent: (links: { contactId: string; url: string }[]) => void;
}) {
  const eligible = contacts.filter((c) => c.email);
  const [selected, setSelected] = useState<string[]>(eligible.filter((c) => c.isPrimary).map((c) => c.contactId));
  const [confirmations, setConfirmations] = useState<{ code: string; message: string }[]>([]);
  const send = useAction(
    async (confirm: string[]) => {
      try {
        return await post<{ links: { contactId: string; url: string }[] }>(`/proposals/${proposalId}/send`, { recipientContactIds: selected, confirm });
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CONFIRMATION_REQUIRED') {
          setConfirmations(e.meta.confirmations as { code: string; message: string }[]);
          return null;
        }
        throw e;
      }
    },
    {
      onDone: (r) => {
        if (r) onSent(r.links);
      },
    },
  );
  return (
    <Dialog open onClose={onClose} title="Send proposal">
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">Recipients (people on this opportunity)</legend>
        {eligible.length === 0 && <p className="text-sm text-danger">Add a person with an email address to the opportunity first.</p>}
        {eligible.map((c) => (
          <label key={c.contactId} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes(c.contactId)}
              onChange={(e) => setSelected((s) => (e.target.checked ? [...s, c.contactId] : s.filter((x) => x !== c.contactId)))}
            />
            {personName(c)} <span className="text-muted">{c.email}</span>
          </label>
        ))}
      </fieldset>
      {confirmations.length > 0 && (
        <div role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-warn">
          <p className="font-medium">Please confirm before sending:</p>
          <ul className="list-disc pl-5">
            {confirmations.map((c) => (
              <li key={c.code}>{c.message}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="mt-3 text-xs text-muted">Sending freezes this version: its content and PDF can no longer change.</p>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={send.busy || selected.length === 0} onClick={() => send.run(confirmations.map((c) => c.code))}>
          {send.busy ? 'Sending…' : confirmations.length ? 'Confirm and send' : 'Send'}
        </Button>
      </div>
    </Dialog>
  );
}

function LinkRow({
  link,
  canManage,
  proposalValidUntil,
  proposalOpen,
  onChange,
}: {
  link: any;
  canManage: boolean;
  proposalValidUntil: string | null;
  proposalOpen: boolean;
  onChange: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const copy = useAction(() => post<{ url: string }>(`/share-links/${link.id}/copy`), {
    onDone: (r) => void navigator.clipboard.writeText(r.url).then(() => toast('Link copied')),
  });
  const revoke = useAction(() => post(`/share-links/${link.id}/revoke`), { success: 'Link revoked', onDone: onChange });
  const seconds = link.views.reduce((t: number, x: any) => t + x.activeSeconds, 0);
  return (
    <li aria-label={`Link for ${link.recipientName}, version ${link.versionNumber}`}>
      <p className="flex items-center justify-between">
        <span className="font-medium">{link.recipientName}</span>
        <Badge tone={link.expired ? 'warn' : statusTone(link.status)}>
          v{link.versionNumber} · {link.expired ? 'expired' : link.status}
        </Badge>
      </p>
      <p className="text-xs text-muted">
        {link.views.length
          ? `${link.views.length} view(s), ${Math.round(seconds / 60)} min reading · first opened ${dateTime(link.firstViewedAt)}`
          : 'Not opened yet'}
        {link.downloads.length ? ` · ${link.downloads.length} download(s)` : ''}
      </p>
      {link.status === 'active' && (
        <p className={link.expired ? 'text-xs text-warn' : 'text-xs text-muted'}>
          {link.expiresAt
            ? `${link.expired ? 'Link expired on' : 'Link expires on'} ${dateTime(link.expiresAt)}`
            : 'No link expiry — open until the proposal itself expires'}
        </p>
      )}
      {link.views
        .filter((x: any) => x.forwarded)
        .map((x: any) => (
          <p key={x.startedAt + x.viewerEmail} className="text-xs">
            <Badge tone="info">Forwarded</Badge> {x.viewerName} ({x.viewerEmail})
          </p>
        ))}
      {canManage && link.status === 'active' && (
        <p className="mt-1 flex flex-wrap gap-2">
          {!link.expired && (
            <Button variant="ghost" onClick={() => copy.run(undefined)}>
              Copy link
            </Button>
          )}
          {proposalOpen && (
            <Button variant="ghost" onClick={() => setEditing(true)}>
              {link.expiresAt ? 'Change expiry…' : 'Set expiry…'}
            </Button>
          )}
          <ConfirmButton
            variant="secondary"
            label="Revoke"
            confirm="Revoke this link? The recipient will no longer be able to open the proposal."
            onConfirm={() => revoke.run(undefined)}
          />
        </p>
      )}
      {editing && (
        <LinkExpiryDialog
          link={link}
          proposalValidUntil={proposalValidUntil}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChange();
          }}
        />
      )}
    </li>
  );
}

/** BR-SHR-007: set, change or remove the expiry of ONE link. A date after the proposal's validity date needs a second, explicit confirmation. */
function LinkExpiryDialog({
  link,
  proposalValidUntil,
  onClose,
  onSaved,
}: {
  link: any;
  proposalValidUntil: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState<string>(link.expiresAt && !link.expired ? toLocalInput(new Date(link.expiresAt)) : '');
  const [confirmations, setConfirmations] = useState<{ code: string; message: string }[]>([]);
  const [problem, setProblem] = useState<string | undefined>();
  const save = useAction(
    async (x: { expiresAt: string | null; confirm: string[] }) => {
      try {
        setProblem(undefined);
        return await put<{ id: string }>(`/share-links/${link.id}/expiry`, x);
      } catch (e) {
        if (e instanceof ApiError && e.code === 'CONFIRMATION_REQUIRED') {
          setConfirmations(e.meta.confirmations as { code: string; message: string }[]);
          return null;
        }
        if (e instanceof ApiError && e.code === 'LINK_EXPIRY_IN_PAST') {
          setProblem(e.message);
          return null;
        }
        throw e;
      }
    },
    {
      success: undefined,
      onDone: (r) => {
        if (r) onSaved();
      },
    },
  );
  const parsed = value ? new Date(value) : null;
  const invalid = parsed !== null && Number.isNaN(parsed.getTime());
  const past = parsed !== null && !invalid && parsed.getTime() <= Date.now();
  const error = invalid ? 'Enter a date and time' : past ? 'The link expiry must be in the future' : problem;
  return (
    <Dialog open onClose={onClose} title={`Link expiry — ${link.recipientName}`}>
      <p className="mb-3 text-sm text-muted">
        After this moment {link.recipientName} sees “This link has expired” instead of the proposal. Other recipients' links are not affected.
      </p>
      <Field
        label="Link expires on"
        error={error}
        hint={proposalValidUntil ? `The proposal itself is valid until ${dayLabel(proposalValidUntil)}.` : 'The proposal has no validity date.'}
      >
        <Input
          type="datetime-local"
          min={toLocalInput(new Date())}
          value={value}
          aria-invalid={error ? true : undefined}
          onChange={(e) => {
            setValue(e.target.value);
            setConfirmations([]);
            setProblem(undefined);
          }}
        />
      </Field>
      {confirmations.length > 0 && (
        <div role="alert" className="mt-3 rounded-md bg-amber-50 p-3 text-sm text-warn">
          <p className="font-medium">Please confirm:</p>
          <ul className="list-disc pl-5">
            {confirmations.map((c) => (
              <li key={c.code}>{c.message}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-4 flex flex-wrap justify-end gap-2">
        {link.expiresAt && (
          <Button variant="secondary" disabled={save.busy} onClick={() => save.run({ expiresAt: null, confirm: [] })}>
            Remove expiry
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button
          disabled={save.busy || !parsed || invalid || past}
          onClick={() => parsed && save.run({ expiresAt: parsed.toISOString(), confirm: confirmations.map((c) => c.code) })}
        >
          {save.busy ? 'Saving…' : confirmations.length ? 'Confirm and save' : 'Save expiry'}
        </Button>
      </div>
    </Dialog>
  );
}

/** BR-PRP-010: copy this proposal's current content and pricing into a NEW draft on a deal the user may add proposals to. */
function CopyDialog({ proposal, onClose }: { proposal: any; onClose: () => void }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [search, setSearch] = useState('');
  const [targetId, setTargetId] = useState('');
  const [title, setTitle] = useState('');
  const [copyPricing, setCopyPricing] = useState(true);
  const targets = useQuery({
    queryKey: ['proposal-copy-targets', search],
    queryFn: () =>
      get<{ id: string; name: string; currency: string; companyName: string }[]>(
        `/proposal-copy-targets${search.trim() ? `?q=${encodeURIComponent(search.trim())}` : ''}`,
      ),
    placeholderData: (prev) => prev,
  });
  const target = targets.data?.find((t) => t.id === targetId);
  const hasPrices = proposal.currentVersion.pricing.lines.length > 0;
  const copy = useAction(
    () =>
      post<{ id: string; dealName: string; notices: string[] }>(`/proposals/${proposal.id}/copy`, {
        targetDealId: targetId,
        copyPricing,
        ...(title.trim() ? { title: title.trim() } : {}),
      }),
    {
      onDone: (r) => {
        toast(`Draft proposal created on ${r.dealName}`);
        onClose();
        void navigate({ to: '/proposals/$id', params: { id: r.id } });
      },
    },
  );
  return (
    <Dialog open onClose={onClose} title="Copy to another opportunity">
      <p className="mb-3 text-sm text-muted">
        Creates a new draft proposal on the opportunity you choose, with this proposal's current text and prices. Customer details are filled in from that deal.
        Links, views, signatures and AI suggestions are not copied.
      </p>
      <div className="space-y-3">
        <Field label="Find an opportunity" hint="Open opportunities you can add proposals to.">
          <Input type="search" value={search} placeholder="Type part of the opportunity name" onChange={(e) => setSearch(e.target.value)} />
        </Field>
        <Query q={targets} rows={2}>
          {(ts) =>
            ts.length === 0 ? (
              <EmptyState
                title={search.trim() ? 'No matching opportunities' : 'No opportunities to copy to'}
                hint="Only open opportunities you are allowed to change are listed."
              />
            ) : (
              <Field label="Target opportunity">
                <Select value={target ? targetId : ''} onChange={(e) => setTargetId(e.target.value)}>
                  <option value="">Choose an opportunity…</option>
                  {ts.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} — {t.companyName} ({t.currency}){t.id === proposal.dealId ? ' · this opportunity' : ''}
                    </option>
                  ))}
                </Select>
              </Field>
            )
          }
        </Query>
        <Field
          label="Title of the new proposal (optional)"
          error={copy.fieldError('title')}
          hint="Leave blank to reuse this proposal's title for the chosen deal."
        >
          <Input value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={copyPricing} onChange={(e) => setCopyPricing(e.target.checked)} />
          Copy pricing lines
        </label>
        {target && copyPricing && hasPrices && target.currency !== proposal.currency && (
          <p role="alert" className="rounded-md bg-amber-50 p-3 text-sm text-warn">
            {target.name} uses {target.currency}; this proposal is priced in {proposal.currency}. Prices are copied unchanged and must be reviewed and confirmed
            before the copy can be sent.
          </p>
        )}
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={!target || copy.busy} onClick={() => copy.run(undefined)}>
          {copy.busy ? 'Copying…' : 'Create copy'}
        </Button>
      </div>
    </Dialog>
  );
}

function SignDialog({ proposalId, contacts, onClose }: { proposalId: string; contacts: any[]; onClose: () => void }) {
  const eligible = contacts.filter((c) => c.email);
  const [order, setOrder] = useState<string[]>([]);
  const [mode, setMode] = useState<'sequential' | 'parallel'>('sequential');
  const request = useAction(() => post(`/proposals/${proposalId}/signature-requests`, { signerContactIds: order, signingOrder: mode }), {
    success: 'Signature request created',
    onDone: onClose,
  });
  return (
    <Dialog open onClose={onClose} title="Request signatures">
      <p className="mb-2 text-sm text-muted">Signers must be people on the deal. Tick them in the order they should sign.</p>
      {eligible.map((c) => (
        <label key={c.contactId} className="flex items-center gap-2 py-1 text-sm">
          <input
            type="checkbox"
            checked={order.includes(c.contactId)}
            onChange={(e) => setOrder((o) => (e.target.checked ? [...o, c.contactId] : o.filter((x) => x !== c.contactId)))}
          />
          {order.includes(c.contactId) && <Badge tone="info">{order.indexOf(c.contactId) + 1}</Badge>} {personName(c)}{' '}
          <span className="text-muted">{c.email}</span>
        </label>
      ))}
      <Field label="Signing order">
        <Select value={mode} onChange={(e) => setMode(e.target.value as 'sequential')}>
          <option value="sequential">One after another</option>
          <option value="parallel">All at once</option>
        </Select>
      </Field>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button disabled={order.length === 0 || request.busy} onClick={() => request.run(undefined)}>
          Request signatures
        </Button>
      </div>
    </Dialog>
  );
}

function SignatureRow({ req, canManage, onChange }: { req: any; canManage: boolean; onChange: () => void }) {
  const voidReq = useAction(() => post(`/signature-requests/${req.id}/void`, { reason: 'Voided by sales' }), {
    success: 'Signature request voided',
    onDone: onChange,
  });
  // Simulator only: lets a tester play the signer. A real provider emails signers instead.
  const simulate = useAction(
    (x: { signerId: string; action: 'sign' | 'decline' }) => api('POST', `/dev/esign/${req.providerEnvelopeId}/${x.signerId}/${x.action}`),
    { success: 'Simulated signer action delivered', onDone: onChange },
  );
  const signed = req.signers.filter((s: any) => s.status === 'signed').length;
  return (
    <li>
      <p className="flex items-center justify-between">
        <span className="font-medium">
          Signing {signed} of {req.signers.length}
        </span>
        <Badge tone={statusTone(req.status)}>{req.status}</Badge>
      </p>
      {req.simulated && (
        <p className="my-1 rounded bg-amber-50 px-2 py-1 text-xs text-warn">
          Simulated e-signature provider — not legally valid. A real provider must be connected before live use.
        </p>
      )}
      {req.staleCompletion && (
        <p className="my-1 rounded bg-red-50 px-2 py-1 text-xs text-danger">Signed after this request was voided or superseded — review required.</p>
      )}
      <ul className="mt-1 space-y-1">
        {req.signers.map((s: any) => (
          <li key={s.id} className="flex items-center justify-between text-xs">
            <span>
              {s.signOrder}. {s.name} <Badge tone={statusTone(s.status)}>{s.status}</Badge>
            </span>
            {req.simulated && s.status === 'sent' && req.providerEnvelopeId && (
              <span className="flex gap-1">
                <Button variant="ghost" disabled={simulate.busy} onClick={() => simulate.run({ signerId: s.id, action: 'sign' })}>
                  Simulate sign
                </Button>
                <Button variant="ghost" disabled={simulate.busy} onClick={() => simulate.run({ signerId: s.id, action: 'decline' })}>
                  Simulate decline
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
      {req.signedDocument && (
        <p className="mt-1 flex gap-3 text-xs">
          <a className="text-brand hover:underline" href={`/api/v1/signature-requests/${req.id}/documents/signed-pdf`}>
            Signed PDF
          </a>
          <a className="text-brand hover:underline" href={`/api/v1/signature-requests/${req.id}/documents/certificate`}>
            Completion certificate
          </a>
        </p>
      )}
      {canManage && ['pending', 'sent', 'viewed'].includes(req.status) && (
        <p className="mt-1">
          <ConfirmButton
            variant="secondary"
            label="Void request"
            confirm="Void this signature request? Signers will no longer be able to sign."
            onConfirm={() => voidReq.run(undefined)}
          />
        </p>
      )}
    </li>
  );
}

const PRICING_FIELD_LABELS: Record<string, string> = {
  name: 'Name',
  quantity: 'Quantity',
  unitPrice: 'Unit price',
  discountValue: 'Discount',
  taxRatePercent: 'Tax rate %',
  billingPeriod: 'Billing period',
};

/** BR-PRP-006 / RULE-PRP-12: any two versions — text per section, pricing per line, totals, validity and term. */
function CompareDialog({ proposalId, versions, currency, onClose }: { proposalId: string; versions: any[]; currency: string; onClose: () => void }) {
  const [from, setFrom] = useState<string>(versions[1]?.id ?? '');
  const [to, setTo] = useState<string>(versions[0]?.id ?? '');
  const same = from === to;
  const q = useQuery({
    queryKey: ['compare', proposalId, from, to],
    queryFn: () => get<any>(`/proposals/${proposalId}/compare?from=${from}&to=${to}`),
    enabled: Boolean(from && to && !same),
  });
  const pick = (value: string, set: (v: string) => void, label: string) => (
    <Field label={label}>
      <Select value={value} onChange={(e) => set(e.target.value)}>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            Version {v.versionNumber} ({v.state})
          </option>
        ))}
      </Select>
    </Field>
  );
  const fact = (label: string, a: string, b: string) => (
    <div className="flex flex-wrap justify-between gap-2">
      <dt className="text-muted">{label}</dt>
      <dd className="tabular-nums">
        {a === b ? (
          `${b} (unchanged)`
        ) : (
          <>
            {a} → <span className="font-semibold">{b}</span> <Badge tone="warn">changed</Badge>
          </>
        )}
      </dd>
    </div>
  );
  return (
    <Dialog open onClose={onClose} title="Compare versions" wide>
      <div className="mb-3 grid grid-cols-2 gap-3">
        {pick(from, setFrom, 'From')}
        {pick(to, setTo, 'To')}
      </div>
      {same ? (
        <p className="text-sm text-muted">Choose two different versions to compare.</p>
      ) : (
        <Query q={q} rows={4}>
          {(d) => {
            const changedSections = d.sections.filter((x: any) => x.change !== 'unchanged');
            const nothing =
              changedSections.length === 0 &&
              d.pricing.length === 0 &&
              d.totals.from === d.totals.to &&
              d.validUntil.from === d.validUntil.to &&
              d.termMonths.from === d.termMonths.to;
            return (
              <div className="space-y-4 text-sm">
                {nothing && <p className="text-muted">No differences between these versions.</p>}
                <section aria-label="Summary">
                  <dl className="space-y-1.5">
                    {fact('Contract value', money(d.totals.from, currency), money(d.totals.to, currency))}
                    {fact('Valid until', dayLabel(d.validUntil.from), dayLabel(d.validUntil.to))}
                    {fact('Contract term', `${d.termMonths.from} months`, `${d.termMonths.to} months`)}
                  </dl>
                </section>
                <section aria-label="Pricing changes">
                  <h3 className="mb-1 font-medium">Pricing</h3>
                  {d.pricing.length === 0 ? (
                    <p className="text-muted">No pricing lines changed.</p>
                  ) : (
                    <ul className="space-y-1">
                      {d.pricing.map((x: any) => (
                        <li key={x.lineKey}>
                          <Badge tone={x.change === 'added' ? 'ok' : x.change === 'removed' ? 'danger' : 'warn'}>{x.change}</Badge> {x.name}
                          {x.fields.length > 0 && (
                            <span className="text-muted">
                              {' — '}
                              {x.fields.map((f: any) => `${PRICING_FIELD_LABELS[f.field] ?? f.field}: ${f.from || '—'} → ${f.to || '—'}`).join('; ')}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <section aria-label="Text changes">
                  <h3 className="mb-1 font-medium">Text</h3>
                  {changedSections.length === 0 && <p className="text-muted">No section text changed.</p>}
                  <div className="space-y-3">
                    {changedSections.map((x: any) => (
                      <div key={x.sectionId} className="rounded-md border border-line p-2">
                        <p className="mb-1 font-medium">
                          {x.title} <Badge tone="warn">{x.change}</Badge>
                        </p>
                        <div className="grid gap-2 md:grid-cols-2">
                          <div>
                            <p className="text-xs text-muted">Before</p>
                            <p className="whitespace-pre-wrap rounded bg-red-50 p-2">{x.before || '—'}</p>
                          </div>
                          <div>
                            <p className="text-xs text-muted">After</p>
                            <p className="whitespace-pre-wrap rounded bg-green-50 p-2">{x.after || '—'}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            );
          }}
        </Query>
      )}
    </Dialog>
  );
}
