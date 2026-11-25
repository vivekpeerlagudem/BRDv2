/**
 * AI assistance UI. Every component here follows the same contract (BR-AIA-006/007):
 *   request → labelled suggestion → the user edits, accepts or rejects → only then does anything change.
 * Nothing in this file sends email, shares a proposal or changes a deal; "approve" on an email draft only records the
 * reviewed text and offers to copy it or open the user's own mail program.
 */
import { AI_FEATURES, AI_FOLLOW_UP_SCENARIOS, AI_REWRITE_MODES, type AiFeatureKey } from '@crm/shared';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useState } from 'react';
import { dateTime, get, money, personName, post, put } from '../lib/api.ts';
import { Badge, Button, Card, Dialog, EmptyState, Field, Input, PageHeader, Query, Select, Table, Textarea, useAction, useToast } from '../lib/ui.tsx';

export interface AiStatus {
  enabled: boolean;
  features: Record<AiFeatureKey, boolean>;
  provider: { provider: string; simulated: boolean; configured: boolean; detail: string };
  models: Record<AiFeatureKey, string>;
  myCallsToday: number;
  perUserDailyCalls: number;
}
export interface AiMeta {
  requestId: string;
  provider: string;
  model: string;
  simulated: boolean;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number | null;
}
export const FEATURE_LABEL: Record<string, string> = {
  draft_section: 'Proposal drafting',
  presend_review: 'Pre-send review',
  deal_summary: 'Opportunity summary',
  rewrite_text: 'Rewrite selected text',
  follow_up_email: 'Follow-up email draft',
  weekly_report: 'Weekly client report',
  sales_brief: 'Weekly sales brief',
};
const SCENARIO_LABEL: Record<(typeof AI_FOLLOW_UP_SCENARIOS)[number], string> = {
  initial: 'First follow-up after sending',
  viewed: 'Buyer has opened the proposal',
  revisited: 'Buyer keeps coming back to it',
  not_viewed: 'Proposal not opened yet',
  changes_requested: 'Buyer asked for changes',
  gone_quiet: 'Opportunity has gone quiet',
};
export const MODE_LABEL: Record<(typeof AI_REWRITE_MODES)[number], string> = {
  improve: 'Improve clarity',
  professional: 'More professional',
  concise: 'Make it shorter',
  expand: 'Expand',
  friendly: 'Friendlier tone',
  formal: 'More formal tone',
  simplify: 'Simplify language',
  custom: 'Custom instructions…',
};

export const useAiStatus = () => useQuery({ queryKey: ['ai-status'], queryFn: () => get<AiStatus>('/ai/status'), staleTime: 30_000 });
/** True when the organization switch and this feature's switch are both on. */
export function useAiFeature(feature: AiFeatureKey): boolean {
  const s = useAiStatus();
  return Boolean(s.data?.enabled && s.data.features[feature]);
}
const cost = (micro: number | null | undefined) => (micro === null || micro === undefined ? '—' : `$${(micro / 1_000_000).toFixed(4)}`);

export function AiLabel({ simulated, children = 'AI-generated' }: { simulated?: boolean | undefined; children?: ReactNode }) {
  return (
    <Badge tone="info">
      {children}
      {simulated ? ' (simulator)' : ''}
    </Badge>
  );
}
/** Small provenance line under a suggestion: which provider and model produced it. */
export function AiProvenance({ meta }: { meta: AiMeta | null | undefined }) {
  if (!meta) return null;
  return (
    <p className="mt-1 text-xs text-muted">
      {meta.simulated ? 'Built-in simulator, not a real AI model' : `${meta.provider} · ${meta.model}`} · {meta.inputTokens + meta.outputTokens} tokens ·
      request {meta.requestId.slice(0, 8)}
    </p>
  );
}
export function FigureWarning({ figures, lostPlaceholders = [] }: { figures: string[]; lostPlaceholders?: string[] }) {
  if (figures.length === 0 && lostPlaceholders.length === 0) return null;
  return (
    <div role="alert" className="mt-2 rounded-md bg-amber-50 px-2 py-1.5 text-xs text-warn">
      {figures.length > 0 && <p>Check before using: {figures.join(', ')} does not match any price in the CRM pricing table.</p>}
      {lostPlaceholders.length > 0 && <p>The rewrite removed {lostPlaceholders.join(', ')} — add it back or the buyer will not see that CRM value.</p>}
    </div>
  );
}
function Spinner({ label }: { label: string }) {
  return (
    <p role="status" className="flex items-center gap-2 text-sm text-muted">
      <span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-brand border-t-transparent" />
      {label}
    </p>
  );
}

// ───────────────────────── Deal summary (BR-AIA-003) ─────────────────────────
interface SummaryResult {
  generationId: string;
  facts: any;
  summary: { overview: string; currentStatus: string; keyPoints: string[]; risks: string[]; nextSteps: string[]; openQuestions: string[] };
  sources: Record<string, number>;
  meta: AiMeta;
}
const Bullets = ({ title, items, ai }: { title: string; items: string[]; ai?: boolean }) =>
  items.length === 0 ? null : (
    <div>
      <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-muted">
        {title} {ai && <span className="font-normal normal-case">— AI interpretation</span>}
      </p>
      <ul className="list-disc pl-5">
        {items.map((x) => (
          <li key={x}>{x}</li>
        ))}
      </ul>
    </div>
  );

export function DealSummaryPanel({ dealId, canEdit }: { dealId: string; canEdit: boolean }) {
  const qc = useQueryClient();
  const enabled = useAiFeature('deal_summary');
  const [result, setResult] = useState<SummaryResult | null>(null);
  const generate = useAction(() => post<SummaryResult>(`/deals/${dealId}/ai-summary`), { onDone: setResult });
  const decide = useAction((decision: 'accept' | 'reject') => post(`/ai/generations/${result?.generationId}/decision`, { decision }), {
    onDone: () => {
      setResult(null);
      void qc.invalidateQueries();
    },
  });
  if (!enabled) return null;
  const f = result?.facts;
  return (
    <div className="mt-3 border-t border-line pt-3">
      {!result && !generate.busy && (
        <Button variant="secondary" onClick={() => generate.run(undefined)}>
          Summarise this opportunity with AI
        </Button>
      )}
      {generate.busy && <Spinner label="Reading the opportunity record and writing a summary…" />}
      {result && (
        <section aria-label="AI opportunity summary" className="space-y-3 text-sm">
          <div className="rounded-md border border-line bg-surface p-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Recorded in the CRM (facts)</p>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-1">
              <dt className="text-muted">Stage</dt>
              <dd>
                {f.deal.stage} · {f.deal.daysInCurrentStage} day(s)
              </dd>
              <dt className="text-muted">Amount</dt>
              <dd>{money(f.deal.amount, f.deal.currency)}</dd>
              <dt className="text-muted">Proposals</dt>
              <dd>{(f.proposals ?? []).map((p: any) => `${p.title} (${p.status})`).join('; ') || 'None'}</dd>
              <dt className="text-muted">Buyer engagement</dt>
              <dd>
                {(f.buyerEngagement?.recipients ?? []).map((r: any) => `${r.recipientName}: ${r.viewCount} view(s)`).join('; ') || 'No proposal shared yet'}
              </dd>
              <dt className="text-muted">Open tasks</dt>
              <dd>{(f.openTasks ?? []).length}</dd>
            </dl>
          </div>
          <div className="rounded-md border border-brand/30 bg-brand-soft p-3">
            <p className="mb-1">
              <AiLabel simulated={result.meta.simulated}>AI-generated summary</AiLabel>
            </p>
            <p>{result.summary.overview}</p>
            <p className="mt-1">{result.summary.currentStatus}</p>
            <Bullets title="Key points" items={result.summary.keyPoints} />
            <Bullets title="Risks and blockers" items={result.summary.risks} ai />
            <Bullets title="Recommended next steps" items={result.summary.nextSteps} ai />
            <Bullets title="Open questions" items={result.summary.openQuestions} ai />
            <p className="mt-2 text-xs text-muted">
              Based on {result.sources.notes} note(s), {result.sources.callsAndMeetings} call/meeting log(s), {result.sources.proposals} proposal(s) and{' '}
              {result.sources.tasks} open task(s) that you can see.
              {result.sources.omittedTexts ? ` ${result.sources.omittedTexts} older item(s) were left out.` : ''}
            </p>
            <AiProvenance meta={result.meta} />
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <Button disabled={decide.busy} onClick={() => decide.run('accept')}>
                Save as note
              </Button>
            )}
            <Button variant="secondary" disabled={generate.busy || decide.busy} onClick={() => generate.run(undefined)}>
              Regenerate
            </Button>
            <Button variant="ghost" disabled={decide.busy} onClick={() => decide.run('reject')}>
              Dismiss
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

// ───────────────────────── Follow-up email (BR-AIA-005) ─────────────────────────
interface FollowUpResult {
  generationId: string;
  subject: string;
  body: string;
  recipient: { contactId: string; name: string; email: string | null };
  unverifiedFigures: string[];
  meta: AiMeta;
}
export function FollowUpDialog({ dealId, proposalId, contacts, onClose }: { dealId: string; proposalId?: string; contacts: any[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [contactId, setContactId] = useState<string>(contacts.find((c) => c.isPrimary)?.contactId ?? contacts[0]?.contactId ?? '');
  const [scenario, setScenario] = useState<(typeof AI_FOLLOW_UP_SCENARIOS)[number]>('initial');
  const [instructions, setInstructions] = useState('');
  const [draft, setDraft] = useState<FollowUpResult | null>(null);
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [approved, setApproved] = useState(false);
  const reject = (generationId: string) => post(`/ai/generations/${generationId}/decision`, { decision: 'reject' }).catch(() => undefined);
  const generate = useAction(
    async () => {
      if (draft && !approved) await reject(draft.generationId); // regenerating discards the previous unanswered draft
      return post<FollowUpResult>('/ai/follow-up-email', {
        dealId,
        ...(proposalId ? { proposalId } : {}),
        contactId,
        scenario,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      });
    },
    {
      onDone: (r) => {
        setDraft(r);
        setSubject(r.subject);
        setBody(r.body);
        setApproved(false);
      },
    },
  );
  const approve = useAction(() => post(`/ai/generations/${draft?.generationId}/decision`, { decision: 'accept', editedSubject: subject, editedText: body }), {
    success: 'Draft approved. Nothing was sent — copy it into your email.',
    onDone: () => {
      setApproved(true);
      void qc.invalidateQueries({ queryKey: ['timeline'] });
    },
  });
  const close = () => {
    if (draft && !approved) void reject(draft.generationId);
    onClose();
  };
  const mailto = draft?.recipient.email
    ? `mailto:${encodeURIComponent(draft.recipient.email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    : null;
  return (
    <Dialog open onClose={close} title="Draft a follow-up email" wide>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label="To">
          <Select value={contactId} disabled={approved} onChange={(e) => setContactId(e.target.value)}>
            {contacts.length === 0 && <option value="">No person on this opportunity</option>}
            {contacts.map((c) => (
              <option key={c.contactId} value={c.contactId}>
                {personName(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Situation">
          <Select value={scenario} disabled={approved} onChange={(e) => setScenario(e.target.value as typeof scenario)}>
            {AI_FOLLOW_UP_SCENARIOS.map((s) => (
              <option key={s} value={s}>
                {SCENARIO_LABEL[s]}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="mt-3">
        <Field label="Your instructions (optional)" hint="For example: mention the workshop next week, keep it to three sentences.">
          <Input value={instructions} maxLength={500} disabled={approved} onChange={(e) => setInstructions(e.target.value)} />
        </Field>
      </div>
      {!draft && (
        <div className="mt-4 flex items-center justify-end gap-3">
          {generate.busy && <Spinner label="Writing a draft…" />}
          <Button disabled={!contactId || generate.busy} onClick={() => generate.run(undefined)}>
            Generate draft
          </Button>
        </div>
      )}
      {draft && (
        <section aria-label="Email draft" className="mt-4 space-y-3 rounded-md border border-brand/30 bg-brand-soft p-3">
          <p className="flex flex-wrap items-center gap-2 text-sm">
            <AiLabel simulated={draft.meta.simulated}>{approved ? 'AI-assisted draft — approved by you' : 'AI-generated draft — not sent'}</AiLabel>
            <span className="text-muted">
              To {draft.recipient.name}
              {draft.recipient.email ? ` <${draft.recipient.email}>` : ' (no email address on record)'}
            </span>
          </p>
          <Field label="Subject">
            <Input value={subject} readOnly={approved} maxLength={300} onChange={(e) => setSubject(e.target.value)} />
          </Field>
          <Field label="Message">
            <Textarea rows={10} value={body} readOnly={approved} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <FigureWarning figures={draft.unverifiedFigures} />
          <AiProvenance meta={draft.meta} />
          {!approved ? (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {generate.busy && <Spinner label="Writing a new draft…" />}
              <Button variant="ghost" onClick={close}>
                Discard
              </Button>
              <Button variant="secondary" disabled={generate.busy} onClick={() => generate.run(undefined)}>
                Regenerate
              </Button>
              <Button disabled={approve.busy || !subject.trim() || !body.trim()} onClick={() => approve.run(undefined)}>
                Approve draft
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-end gap-2">
              <p className="mr-auto text-xs text-muted">The CRM does not send email. Send it yourself from your mail program.</p>
              <Button variant="secondary" onClick={() => void navigator.clipboard.writeText(`${subject}\n\n${body}`).then(() => toast('Draft copied'))}>
                Copy text
              </Button>
              {mailto && (
                <a className="rounded-md border border-line bg-white px-3 py-1.5 text-sm font-medium hover:bg-surface" href={mailto}>
                  Open in my email app
                </a>
              )}
              <Button onClick={onClose}>Done</Button>
            </div>
          )}
        </section>
      )}
    </Dialog>
  );
}

// ───────────────────────── Pre-send review (BR-AIA-002) ─────────────────────────
interface ReviewFinding {
  id: string;
  source: 'rule' | 'ai';
  severity: 'blocking' | 'warning';
  category: string;
  description: string;
  evidence: string | null;
  sectionTitle: string | null;
  suggestion: string | null;
  status: 'open' | 'acknowledged' | 'dismissed';
}
interface Review {
  reviewId: string;
  createdAt: string;
  aiStatus: 'completed' | 'disabled' | 'failed';
  stale: boolean;
  findings: ReviewFinding[];
  blocking: number;
  meta?: AiMeta | null;
}
const CATEGORY_LABEL: Record<string, string> = {
  company_name_mismatch: 'Company name',
  contact_name_mismatch: 'Person name',
  amount_mismatch: 'Amount',
  pricing_inconsistency: 'Pricing',
  product_reference: 'Product reference',
  date_conflict: 'Dates',
  unsupported_claim: 'Unsupported claim',
  contradiction: 'Contradiction',
  placeholder_unresolved: 'Missing CRM value',
  required_section_empty: 'Required section',
  validity_date_past: 'Validity date',
  ai_content_pending: 'AI suggestion pending',
  pricing_deal_amount_mismatch: 'Opportunity amount',
  discount_limit_exceeded: 'Discount limit',
};

export function ReviewPanel({ proposalId, dirty, canManage }: { proposalId: string; dirty: boolean; canManage: boolean }) {
  const qc = useQueryClient();
  const aiOn = useAiFeature('presend_review');
  const q = useQuery({ queryKey: ['ai-review', proposalId], queryFn: () => get<Review | null>(`/proposals/${proposalId}/ai-review`) });
  const [meta, setMeta] = useState<AiMeta | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ['ai-review', proposalId] });
  const run = useAction(() => post<Review>('/ai/review', { proposalId }), {
    onDone: (r) => {
      setMeta(r.meta ?? null);
      refresh();
    },
  });
  const decide = useAction(
    (x: { id: string; decision: 'acknowledged' | 'dismissed' }) => post(`/ai/reviews/${q.data?.reviewId}/findings/${x.id}/decision`, { decision: x.decision }),
    { onDone: refresh },
  );
  const review = q.data;
  const open = review?.findings.filter((f) => f.status === 'open') ?? [];
  const handled = (review?.findings.length ?? 0) - open.length;
  return (
    <Card
      title="Proposal review"
      actions={
        canManage && (
          <Button variant="secondary" disabled={dirty || run.busy} title={dirty ? 'Save the draft first' : undefined} onClick={() => run.run(undefined)}>
            {run.busy ? 'Reviewing…' : review ? 'Review again' : aiOn ? 'Review with AI' : 'Run review'}
          </Button>
        )
      }
    >
      {run.busy && <Spinner label="Checking names, figures, dates and claims…" />}
      {!run.busy && !review && (
        <p className="text-sm text-muted">
          Checks the saved draft against CRM data{aiOn ? ' and asks AI to look for wrong names, mismatched figures, unsupported claims and contradictions' : ''}
          . You decide what to do with each finding.
        </p>
      )}
      {!run.busy && review && (
        <div className="space-y-2 text-sm">
          {review.stale && (
            <p role="status" className="rounded-md bg-amber-50 px-2 py-1.5 text-warn">
              The draft changed after this review. Review again to see current findings.
            </p>
          )}
          {review.aiStatus === 'disabled' && <p className="text-xs text-muted">AI review is turned off — only the rule checks ran.</p>}
          {review.aiStatus === 'failed' && (
            <p role="alert" className="rounded-md bg-amber-50 px-2 py-1.5 text-xs text-warn">
              The AI review could not be completed. Rule checks are shown; you can try again.
            </p>
          )}
          {review.findings.length === 0 && <p className="text-ok">No issues found.</p>}
          <ul className="space-y-2">
            {open.map((f) => (
              <li key={f.id} className="rounded-md border border-line p-2">
                <p className="flex flex-wrap items-center gap-1.5">
                  <Badge tone={f.severity === 'blocking' ? 'danger' : 'warn'}>{f.severity === 'blocking' ? 'Must fix' : 'Check'}</Badge>
                  {f.source === 'ai' ? <AiLabel simulated={meta?.simulated}>AI finding</AiLabel> : <Badge>Rule</Badge>}
                  <span className="font-medium">{CATEGORY_LABEL[f.category] ?? f.category}</span>
                  {f.sectionTitle && <span className="text-xs text-muted">in “{f.sectionTitle}”</span>}
                </p>
                <p className="mt-1">{f.description}</p>
                {f.evidence && <blockquote className="mt-1 border-l-2 border-line pl-2 text-xs italic text-muted">“{f.evidence}”</blockquote>}
                {f.suggestion && <p className="mt-1 text-xs">Suggested: {f.suggestion}</p>}
                {canManage && f.severity !== 'blocking' && !review.stale && (
                  <p className="mt-1.5 flex gap-2">
                    <Button variant="secondary" disabled={decide.busy} onClick={() => decide.run({ id: f.id, decision: 'acknowledged' })}>
                      I’ll fix it
                    </Button>
                    <Button variant="ghost" disabled={decide.busy} onClick={() => decide.run({ id: f.id, decision: 'dismissed' })}>
                      Not an issue
                    </Button>
                  </p>
                )}
              </li>
            ))}
          </ul>
          {handled > 0 && <p className="text-xs text-muted">{handled} finding(s) reviewed by you.</p>}
          <p className="text-xs text-muted">Reviewed {dateTime(review.createdAt)}. AI findings are suggestions and never change the proposal or its prices.</p>
          <AiProvenance meta={meta} />
        </div>
      )}
    </Card>
  );
}

// ───────────────────────── Rewrite selected text (BR-AIA-004) ─────────────────────────
interface RewriteResult {
  generationId: string;
  original: string;
  replacement: string;
  lostPlaceholders: string[];
  unverifiedFigures: string[];
  meta: AiMeta;
}
/**
 * Shown under a section editor when the user has selected text. `savedBody` is the section text as last saved: the
 * server only rewrites a selection that matches the saved draft, so unsaved edits must be saved first.
 */
export function RewriteControl({
  proposalId,
  sectionId,
  sectionTitle,
  savedBody,
  selection,
  dirty,
  onApplied,
}: {
  proposalId: string;
  sectionId: string;
  sectionTitle: string;
  savedBody: string;
  selection: { start: number; end: number } | null;
  dirty: boolean;
  onApplied: () => void;
}) {
  const enabled = useAiFeature('rewrite_text');
  const [mode, setMode] = useState<(typeof AI_REWRITE_MODES)[number]>('improve');
  const [instructions, setInstructions] = useState('');
  const [target, setTarget] = useState<{ start: number; text: string } | null>(null);
  const [result, setResult] = useState<RewriteResult | null>(null);
  const [edited, setEdited] = useState('');
  const selected = selection && selection.end - selection.start >= 3 ? savedBody.slice(selection.start, selection.end) : '';
  const decideCall = (generationId: string, body: object) => post(`/ai/generations/${generationId}/decision`, body);
  const rewrite = useAction(
    async (t: { start: number; text: string }) => {
      if (result) await decideCall(result.generationId, { decision: 'reject' }).catch(() => undefined);
      return post<RewriteResult>('/ai/rewrite', {
        proposalId,
        sectionId,
        selectionStart: t.start,
        selectedText: t.text,
        mode,
        ...(instructions.trim() ? { instructions: instructions.trim() } : {}),
      });
    },
    {
      onDone: (r) => {
        setResult(r);
        setEdited(r.replacement);
      },
    },
  );
  const decide = useAction(
    (decision: 'accept' | 'reject') => decideCall(result?.generationId ?? '', decision === 'accept' ? { decision, editedText: edited } : { decision }),
    {
      onDone: () => {
        setResult(null);
        setTarget(null);
        onApplied();
      },
    },
  );
  if (!enabled) return null;
  const start = () => {
    if (!selection) return;
    const t = { start: selection.start, text: selected };
    setTarget(t);
    rewrite.run(t);
  };
  return (
    <div className="mt-2 text-sm">
      {!result && (
        <div className="flex flex-wrap items-end gap-2">
          <Field label={`Rewrite selected text in ${sectionTitle}`}>
            <Select className="w-52" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              {AI_REWRITE_MODES.map((m) => (
                <option key={m} value={m}>
                  {MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          {mode === 'custom' && (
            <Field label="Instructions">
              <Input
                className="w-64"
                value={instructions}
                maxLength={500}
                placeholder="e.g. emphasise the pilot"
                onChange={(e) => setInstructions(e.target.value)}
              />
            </Field>
          )}
          <Button
            variant="secondary"
            disabled={!selected || dirty || rewrite.busy || (mode === 'custom' && !instructions.trim())}
            title={dirty ? 'Save the draft first' : !selected ? 'Select some text in this section first' : undefined}
            onClick={start}
          >
            {rewrite.busy ? 'Rewriting…' : 'Rewrite selection'}
          </Button>
          <span className="pb-1.5 text-xs text-muted">
            {selected ? `${selected.length} characters selected` : 'Select text above to rewrite just that part.'}
          </span>
        </div>
      )}
      {result && target && (
        <section aria-label={`AI rewrite for ${sectionTitle}`} className="rounded-md border border-brand/30 bg-brand-soft p-3">
          <p className="mb-2">
            <AiLabel simulated={result.meta.simulated}>AI-generated rewrite — not yet part of the proposal</AiLabel>
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Selected text</p>
              <p className="whitespace-pre-wrap rounded bg-white p-2">{result.original}</p>
            </div>
            <div>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Proposed replacement (you can edit it)</p>
              <Textarea
                aria-label="Proposed replacement"
                rows={Math.min(10, Math.max(3, edited.split('\n').length + 1))}
                value={edited}
                onChange={(e) => setEdited(e.target.value)}
              />
            </div>
          </div>
          <FigureWarning figures={result.unverifiedFigures} lostPlaceholders={result.lostPlaceholders} />
          <AiProvenance meta={result.meta} />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button disabled={decide.busy || !edited.trim()} onClick={() => decide.run('accept')}>
              Replace selection
            </Button>
            <Button variant="secondary" disabled={rewrite.busy || decide.busy} onClick={() => rewrite.run(target)}>
              {rewrite.busy ? 'Rewriting…' : 'Try again'}
            </Button>
            <Button variant="ghost" disabled={decide.busy} onClick={() => decide.run('reject')}>
              Keep original
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}

// ───────────────────────── AI activity (own history) ─────────────────────────
const OUTCOME: Record<string, [string, 'ok' | 'warn' | 'danger' | 'neutral']> = {
  success: ['Completed', 'ok'],
  error: ['Provider error', 'danger'],
  invalid_output: ['Unusable answer', 'danger'],
  refused: ['Declined by AI', 'warn'],
  blocked_disabled: ['Blocked: AI off', 'neutral'],
  blocked_budget: ['Blocked: limit reached', 'warn'],
  blocked_rate: ['Blocked: too fast', 'warn'],
};
const DECISION: Record<string, string> = {
  pending: 'Waiting for your review',
  accepted: 'Accepted',
  edited_accepted: 'Edited, then accepted',
  rejected: 'Rejected',
  discarded: 'Replaced by a newer suggestion',
  failed: 'Failed',
};
function UsageTable({ rows, showUser }: { rows: any[]; showUser?: boolean }) {
  return (
    <Table head={['When', ...(showUser ? ['User'] : []), 'Feature', 'Result', ...(showUser ? [] : ['Your decision']), 'Model', 'Tokens', 'Est. cost']}>
      {rows.map((u) => {
        const [label, tone] = OUTCOME[u.outcome] ?? [u.outcome, 'neutral'];
        return (
          <tr key={u.id}>
            <td>{dateTime(u.occurredAt)}</td>
            {showUser && <td>{u.userName ?? '—'}</td>}
            <td>{FEATURE_LABEL[u.feature] ?? u.feature}</td>
            <td>
              <Badge tone={tone}>{label}</Badge>
              {u.attempts > 1 && <span className="ml-1 text-xs text-muted">{u.attempts} attempts</span>}
            </td>
            {!showUser && <td>{u.decision ? (DECISION[u.decision] ?? u.decision) : '—'}</td>}
            <td>{u.simulated ? 'Simulator' : u.model}</td>
            <td className="tabular-nums">{u.inputTokens + u.outputTokens}</td>
            <td className="tabular-nums">{cost(u.costMicroUsd)}</td>
          </tr>
        );
      })}
    </Table>
  );
}

export function AiActivityPage() {
  const status = useAiStatus();
  const q = useQuery({ queryKey: ['ai-usage-mine'], queryFn: () => get<any[]>('/ai/usage/mine') });
  return (
    <>
      <PageHeader title="AI activity" subtitle="Every AI request you made and what you decided to do with the result" />
      <Query q={status} rows={2}>
        {(s) => (
          <Card title="AI assistance" className="mb-4">
            <p className="text-sm">
              <Badge tone={s.enabled ? 'ok' : 'neutral'}>{s.enabled ? 'On' : 'Turned off by your administrator'}</Badge>{' '}
              {s.provider.simulated ? (
                <span>Running on the built-in simulator: results are template text, not real AI output.</span>
              ) : (
                <span>
                  Provider: {s.provider.provider}
                  {s.provider.configured ? '' : ' — not configured, requests will fail'}
                </span>
              )}
            </p>
            <p className="mt-1 text-sm text-muted">
              {s.myCallsToday} of {s.perUserDailyCalls} requests used today. AI suggestions are never applied, sent or shared until you accept them.
            </p>
          </Card>
        )}
      </Query>
      <Query q={q}>
        {(rows) =>
          rows.length === 0 ? (
            <EmptyState title="No AI requests yet" hint="Try “Draft with AI” on a proposal or “Summarise this opportunity with AI” on a deal." />
          ) : (
            <UsageTable rows={rows} />
          )
        }
      </Query>
    </>
  );
}

// ───────────────────────── Admin: settings and organization usage (BR-AIA-008) ─────────────────────────
interface AdminSettings {
  settings: { enabled: boolean; perUserDailyCalls: number; monthlyBudgetUsd: number; features: Record<AiFeatureKey, boolean> };
  provider: AiStatus['provider'];
  prompts: { feature: AiFeatureKey; version: string; model: string; effort: string }[];
}
function SettingsForm({ data }: { data: AdminSettings }) {
  const qc = useQueryClient();
  const [s, setS] = useState(data.settings);
  useEffect(() => setS(data.settings), [data.settings]);
  const save = useAction(() => put('/ai/settings', s), { success: 'AI settings saved', onDone: () => void qc.invalidateQueries() });
  return (
    <Card title="Settings" className="mb-4">
      <form
        className="space-y-3 text-sm"
        onSubmit={(e) => {
          e.preventDefault();
          save.run(undefined);
        }}
      >
        <label className="flex items-center gap-2 font-medium">
          <input type="checkbox" checked={s.enabled} onChange={(e) => setS({ ...s, enabled: e.target.checked })} /> AI features are on for the organization
        </label>
        <fieldset disabled={!s.enabled} className="grid gap-1.5 sm:grid-cols-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Features</legend>
          {AI_FEATURES.map((f) => (
            <label key={f} className="flex items-center gap-2">
              <input type="checkbox" checked={s.features[f]} onChange={(e) => setS({ ...s, features: { ...s.features, [f]: e.target.checked } })} />{' '}
              {FEATURE_LABEL[f]}
            </label>
          ))}
        </fieldset>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Requests per user per day" error={save.fieldError('perUserDailyCalls')}>
            <Input type="number" min={1} max={1000} value={s.perUserDailyCalls} onChange={(e) => setS({ ...s, perUserDailyCalls: Number(e.target.value) })} />
          </Field>
          <Field label="Monthly budget (USD, estimated cost)" error={save.fieldError('monthlyBudgetUsd')}>
            <Input
              type="number"
              min={0}
              max={100000}
              step="1"
              value={s.monthlyBudgetUsd}
              onChange={(e) => setS({ ...s, monthlyBudgetUsd: Number(e.target.value) })}
            />
          </Field>
        </div>
        <p className="text-xs text-muted">Turning AI off takes effect immediately and is enforced by the server. Rule-based proposal checks keep working.</p>
        <div className="flex justify-end">
          <Button type="submit" disabled={save.busy}>
            Save settings
          </Button>
        </div>
      </form>
    </Card>
  );
}

export function AiSettingsPage() {
  const settings = useQuery({ queryKey: ['ai-settings'], queryFn: () => get<AdminSettings>('/ai/settings') });
  const usage = useQuery({ queryKey: ['ai-usage'], queryFn: () => get<any>('/ai/usage') });
  return (
    <>
      <PageHeader title="AI settings and usage" subtitle="Control which AI features your team can use, and see how they are used" />
      <Query q={settings}>
        {(d) => (
          <>
            <Card title="Provider" className="mb-4">
              <p className="text-sm">
                <Badge tone={d.provider.simulated ? 'warn' : d.provider.configured ? 'ok' : 'danger'}>
                  {d.provider.simulated ? 'Simulator' : d.provider.configured ? 'Configured' : 'Not configured'}
                </Badge>{' '}
                <span className="font-medium">{d.provider.provider}</span> — {d.provider.detail}
              </p>
              <p className="mt-1 text-xs text-muted">
                The provider and its API key are set in the server environment, never in this screen or in the database.
              </p>
              <div className="mt-3">
                <Table head={['Feature', 'Prompt version', 'Model when a real provider is used', 'Effort']}>
                  {d.prompts.map((p) => (
                    <tr key={p.feature}>
                      <td>{FEATURE_LABEL[p.feature]}</td>
                      <td>{p.version}</td>
                      <td>{p.model}</td>
                      <td>{p.effort}</td>
                    </tr>
                  ))}
                </Table>
              </div>
            </Card>
            <SettingsForm data={d} />
          </>
        )}
      </Query>
      <Query q={usage}>
        {(u) => (
          <>
            <Card title="This month" className="mb-4">
              <p className="mb-3 text-sm">
                Estimated cost <span className="font-semibold tabular-nums">{cost(u.monthCostMicroUsd)}</span> of a ${u.monthlyBudgetUsd} budget. Simulator
                requests have no cost.
              </p>
              {u.byFeature.length === 0 ? (
                <p className="text-sm text-muted">No AI requests this month.</p>
              ) : (
                <Table head={['Feature', 'Requests', 'Completed', 'Failed', 'Blocked', 'Tokens', 'Est. cost']}>
                  {u.byFeature.map((f: any) => (
                    <tr key={f.feature}>
                      <td>{FEATURE_LABEL[f.feature] ?? f.feature}</td>
                      <td className="tabular-nums">{f.calls}</td>
                      <td className="tabular-nums">{f.succeeded}</td>
                      <td className="tabular-nums">{f.failed}</td>
                      <td className="tabular-nums">{f.blocked}</td>
                      <td className="tabular-nums">{f.inputTokens + f.outputTokens}</td>
                      <td className="tabular-nums">{cost(f.costMicroUsd)}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
            {u.byUser.length > 0 && (
              <Card title="By user" className="mb-4">
                <Table head={['User', 'Requests', 'Completed', 'Failed', 'Blocked', 'Est. cost']}>
                  {u.byUser.map((r: any) => (
                    <tr key={r.userId ?? 'none'}>
                      <td>{r.fullName ?? '—'}</td>
                      <td className="tabular-nums">{r.calls}</td>
                      <td className="tabular-nums">{r.succeeded}</td>
                      <td className="tabular-nums">{r.failed}</td>
                      <td className="tabular-nums">{r.blocked}</td>
                      <td className="tabular-nums">{cost(r.costMicroUsd)}</td>
                    </tr>
                  ))}
                </Table>
              </Card>
            )}
            <Card title="Recent requests">
              {u.recent.length === 0 ? <p className="text-sm text-muted">Nothing yet.</p> : <UsageTable rows={u.recent} showUser />}
            </Card>
          </>
        )}
      </Query>
    </>
  );
}
