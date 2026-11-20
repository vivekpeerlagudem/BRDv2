/**
 * proposals module — templates, product catalogue, proposal drafting, pricing, versions, sending, rendering
 * (BR-TPL-001..008, BR-PRC-001..007, BR-PRP-001..010). This module OWNS the proposal status machine (SM-02):
 * sharing and esign change proposal status only through applyProposalEvent().
 */
import {
  buildSnapshot,
  canonicalJson,
  diffDocuments,
  diffPricing,
  type Finding,
  missingPlaceholders,
  type PlaceholderValues,
  presendChecks,
  renderDocx,
  renderHtml,
  type Snapshot,
  unknownPlaceholders,
} from '@crm/proposal';
import {
  computeTotals,
  type Pricing,
  PricingError,
  type ProposalDocument,
  type productInput,
  type proposalDraftInput,
  type proposalSendInput,
} from '@crm/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { storageKeys } from '../platform/adapters.ts';
import {
  type AppContext,
  conflict,
  forbidden,
  loadDealFor,
  lockRow,
  notFound,
  ownerScope,
  requireConfirmations,
  requirePerm,
  rule,
  schema,
  sha256Hex,
  type Tx,
  type Uow,
  type UserActor,
  unitOfWork,
} from '../platform/core.ts';
import { nextProposalStatus, type ProposalEvent } from './domain.ts';

const {
  proposalTemplate,
  templateVersion,
  product,
  proposal,
  proposalVersion,
  deal,
  company,
  contact,
  dealContact,
  appUserProfile,
  organizationSettings,
  fileObject,
  aiGeneration,
  shareLink,
  viewSession,
  downloadEvent,
} = schema;

/** OD-39 working assumption: maximum discount per role; exceeding it is a warning, not a block (BR-PRC-007). */
/** Only AI suggestions that would change proposal text count as "pending AI content" (BR-AIA-007); email drafts and summaries do not. */
const PROPOSAL_TEXT_FEATURES = ['draft_section', 'rewrite_text'];
const DISCOUNT_LIMIT: Record<UserActor['role'], number> = { admin: 100, sales_manager: 30, salesperson: 15 };
const EMPTY_PRICING: Pricing = { lines: [] };

// ───────────── templates & content (BR-TPL-*) ─────────────
const STARTER: ProposalDocument = {
  schemaVersion: 1,
  sections: [
    {
      id: 'intro',
      title: 'Introduction',
      locked: false,
      required: true,
      aiDraftable: true,
      kind: 'text',
      body: 'Dear {{contact.first_name}},\n\nThank you for considering {{organization.name}}. This proposal for {{company.name}} outlines our recommended approach.',
    },
    { id: 'scope', title: 'Scope of work', locked: false, required: true, aiDraftable: true, kind: 'text', body: '' },
    {
      id: 'pricing',
      title: 'Investment',
      locked: false,
      required: false,
      aiDraftable: false,
      kind: 'pricing',
      body: 'The following pricing applies to this proposal.',
    },
    {
      id: 'terms',
      title: 'Terms',
      locked: true,
      required: true,
      aiDraftable: false,
      kind: 'text',
      body: 'This proposal is valid until {{proposal.valid_until}}. Work begins on signature.',
    },
    {
      id: 'sign',
      title: 'Acceptance',
      locked: true,
      required: false,
      aiDraftable: false,
      kind: 'signature',
      body: 'Signed for and on behalf of {{company.name}}:',
    },
  ],
};

export async function listTemplates(ctx: AppContext, _actor: UserActor) {
  return ctx.db
    .select({
      id: proposalTemplate.id,
      name: proposalTemplate.name,
      description: proposalTemplate.description,
      published: sql<boolean>`${proposalTemplate.currentPublishedVersionId} is not null`,
      updatedAt: proposalTemplate.updatedAt,
    })
    .from(proposalTemplate)
    .where(isNull(proposalTemplate.archivedAt))
    .orderBy(asc(proposalTemplate.name));
}

export async function createTemplate(ctx: AppContext, actor: UserActor, input: { name: string; description?: string }) {
  requirePerm(actor, 'content.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const [t] = await u.tx
      .insert(proposalTemplate)
      .values({ ...input, createdBy: actor.userId })
      .returning();
    await u.tx
      .insert(templateVersion)
      .values({ templateId: t!.id, versionNumber: 1, state: 'draft', schemaVersion: 1, content: STARTER, createdBy: actor.userId });
    await u.audit('template.created', { type: 'template', id: t!.id });
    return t!;
  });
}

export async function getTemplate(ctx: AppContext, _actor: UserActor, id: string) {
  const [t] = await ctx.db.select().from(proposalTemplate).where(eq(proposalTemplate.id, id));
  if (!t) throw notFound('Template');
  const versions = await ctx.db.select().from(templateVersion).where(eq(templateVersion.templateId, id)).orderBy(desc(templateVersion.versionNumber));
  return {
    ...t,
    draft: versions.find((v) => v.state === 'draft') ?? null,
    published: versions.find((v) => v.id === t.currentPublishedVersionId) ?? null,
    versions: versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, state: v.state, publishedAt: v.publishedAt })),
  };
}

export async function saveTemplateDraft(ctx: AppContext, actor: UserActor, id: string, content: ProposalDocument) {
  requirePerm(actor, 'content.manage');
  const unknown = unknownPlaceholders(content);
  if (unknown.length) throw rule('TEMPLATE_PLACEHOLDER_UNKNOWN', `Unknown placeholders: ${unknown.join(', ')}`, { unknown });
  return unitOfWork(ctx, actor, async (u) => {
    const versions = await u.tx.select().from(templateVersion).where(eq(templateVersion.templateId, id)).orderBy(desc(templateVersion.versionNumber));
    if (!versions.length) throw notFound('Template');
    const draft = versions.find((v) => v.state === 'draft');
    const base = (draft ?? versions[0]!).content as ProposalDocument;
    // R8: only an Admin may change which sections are locked (PERM-096).
    if (actor.role !== 'admin') {
      const before = new Map(base.sections.map((s) => [s.id, s.locked]));
      if (content.sections.some((s) => (before.get(s.id) ?? false) !== s.locked))
        throw forbidden('SECTION_LOCKED', 'Only an Admin can lock or unlock template sections');
    }
    if (draft) await u.tx.update(templateVersion).set({ content, updatedAt: ctx.now(), updatedBy: actor.userId }).where(eq(templateVersion.id, draft.id));
    else
      await u.tx
        .insert(templateVersion)
        .values({ templateId: id, versionNumber: versions[0]!.versionNumber + 1, state: 'draft', schemaVersion: 1, content, createdBy: actor.userId });
    return { id };
  });
}

/** Publishing freezes the draft as an immutable version; proposals pin the version they were created from (BR-TPL-004). */
export async function publishTemplate(ctx: AppContext, actor: UserActor, id: string) {
  requirePerm(actor, 'content.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const [draft] = await u.tx
      .select()
      .from(templateVersion)
      .where(and(eq(templateVersion.templateId, id), eq(templateVersion.state, 'draft')));
    if (!draft) throw rule('TEMPLATE_NOT_PUBLISHED', 'There is no draft to publish');
    await u.tx.update(templateVersion).set({ state: 'published', publishedAt: ctx.now() }).where(eq(templateVersion.id, draft.id));
    await u.tx.update(proposalTemplate).set({ currentPublishedVersionId: draft.id, updatedAt: ctx.now() }).where(eq(proposalTemplate.id, id));
    await u.audit('template.published', { type: 'template', id }, { versionNumber: draft.versionNumber });
    return { versionId: draft.id, versionNumber: draft.versionNumber };
  });
}

export async function listProducts(ctx: AppContext) {
  return ctx.db.select().from(product).where(isNull(product.archivedAt)).orderBy(asc(product.name));
}
export async function createProduct(ctx: AppContext, actor: UserActor, input: z.infer<typeof productInput>) {
  requirePerm(actor, 'content.manage');
  const [row] = await ctx.db
    .insert(product)
    .values({ ...input, createdBy: actor.userId })
    .returning();
  return row!;
}

// ───────────── placeholder values from CRM data (BR-PRP-002) ─────────────
async function placeholderValues(
  tx: Tx | AppContext['db'],
  p: { dealId: string; title: string; validUntil: string | null; id: string },
  versionNumber: number,
): Promise<{ values: PlaceholderValues; org: typeof organizationSettings.$inferSelect; dealRow: typeof deal.$inferSelect }> {
  const [d] = await tx.select().from(deal).where(eq(deal.id, p.dealId));
  const [co] = await tx.select().from(company).where(eq(company.id, d!.companyId));
  const [owner] = await tx.select().from(appUserProfile).where(eq(appUserProfile.userId, d!.ownerId));
  const [org] = await tx.select().from(organizationSettings);
  const [primary] = await tx
    .select({ c: contact })
    .from(dealContact)
    .innerJoin(contact, eq(contact.id, dealContact.contactId))
    .where(eq(dealContact.dealId, d!.id))
    .orderBy(desc(dealContact.isPrimary), asc(dealContact.createdAt))
    .limit(1); // OD-65
  const c = primary?.c;
  const values: PlaceholderValues = {
    'deal.name': d!.name,
    'deal.amount': d!.amount ? `${d!.currency} ${d!.amount}` : null,
    'deal.close_date': d!.closeDate,
    'company.name': co!.name,
    'company.domain': co!.domain,
    'company.industry': co!.industry,
    'contact.first_name': c?.firstName,
    'contact.last_name': c?.lastName,
    'contact.full_name': [c?.firstName, c?.lastName].filter(Boolean).join(' ') || null,
    'contact.email': c?.email,
    'contact.job_title': c?.jobTitle,
    'owner.full_name': owner!.fullName,
    'owner.email': owner!.email,
    'organization.name': org!.organizationName,
    'proposal.title': p.title,
    'proposal.valid_until': p.validUntil,
    'proposal.number': `P-${p.id.slice(-6).toUpperCase()}-v${versionNumber}`,
  };
  return { values, org: org!, dealRow: d! };
}

// ───────────── proposals ─────────────
async function loadProposal(tx: Tx | AppContext['db'], actor: UserActor, id: string, access: 'read' | 'write') {
  const [p] = await tx.select().from(proposal).where(eq(proposal.id, id));
  if (!p) throw notFound('Proposal');
  const d = await loadDealFor(tx, actor, p.dealId, access, access === 'write' ? 'proposal.manage' : undefined).catch((e) => {
    throw e.code === 'NOT_FOUND' ? notFound('Proposal') : e;
  });
  return { p, d };
}

export async function createProposal(
  ctx: AppContext,
  actor: UserActor,
  dealId: string,
  input: { templateId: string; title?: string; signatureRequired: boolean },
) {
  return unitOfWork(ctx, actor, async (u) => {
    const d = await loadDealFor(u.tx, actor, dealId, 'write', 'proposal.manage');
    if (d.status !== 'open') throw rule('DEAL_CLOSED', 'Proposals can be created only for open deals');
    const [t] = await u.tx.select().from(proposalTemplate).where(eq(proposalTemplate.id, input.templateId));
    if (!t?.currentPublishedVersionId) throw rule('TEMPLATE_NOT_PUBLISHED', 'This template has no published version');
    const [tv] = await u.tx.select().from(templateVersion).where(eq(templateVersion.id, t.currentPublishedVersionId));
    const [org] = await u.tx.select().from(organizationSettings);
    const validUntil = new Date(ctx.now().getTime() + org!.proposalDefaults.defaultValidityDays * 86_400_000).toISOString().slice(0, 10);
    const [p] = await u.tx
      .insert(proposal)
      .values({
        dealId,
        title: input.title ?? `${t.name} — ${d.name}`,
        templateVersionId: tv!.id,
        currency: d.currency,
        signatureRequired: input.signatureRequired,
        validUntil,
        createdBy: actor.userId,
      })
      .returning();
    const content = tv!.content as ProposalDocument;
    const { values } = await placeholderValues(u.tx, p!, 1);
    const termMonths = org!.proposalDefaults.defaultTermMonths;
    const [v] = await u.tx
      .insert(proposalVersion)
      .values({
        proposalId: p!.id,
        versionNumber: 1,
        schemaVersion: 1,
        content,
        pricing: EMPTY_PRICING,
        termMonths,
        totals: computeTotals(EMPTY_PRICING, termMonths, d.currency),
        missingPlaceholders: missingPlaceholders(content, values),
        createdBy: actor.userId,
      })
      .returning();
    await u.tx.update(proposal).set({ currentVersionId: v!.id }).where(eq(proposal.id, p!.id));
    await u.audit('proposal.created', { type: 'proposal', id: p!.id });
    await u.timeline({
      eventType: 'proposal_created',
      source: { type: 'proposal', id: p!.id },
      summary: `Proposal "${p!.title}" created`,
      anchors: [
        { type: 'deal', id: dealId },
        { type: 'company', id: d.companyId },
      ],
    });
    return { id: p!.id };
  });
}

export async function listProposals(ctx: AppContext, actor: UserActor, dealId: string) {
  await loadDealFor(ctx.db, actor, dealId, 'read');
  return ctx.db
    .select({ id: proposal.id, title: proposal.title, status: proposal.status, validUntil: proposal.validUntil, updatedAt: proposal.updatedAt })
    .from(proposal)
    .where(eq(proposal.dealId, dealId))
    .orderBy(desc(proposal.createdAt));
}

type ProposalListStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'signed' | 'declined' | 'expired' | 'void';
/**
 * Documents dashboard (Papermark-style): every proposal the actor can see — scoped through deal ownership exactly like
 * the deals list (ADR-076) — with its deal, company, owner, contract value and aggregated buyer engagement taken from
 * the existing tracking tables (counted view sessions, distinct viewers, active reading time, downloads).
 */
export async function listAllProposals(ctx: AppContext, actor: UserActor, page: { q?: string; status?: ProposalListStatus; limit: number; offset: number }) {
  const term = page.q?.trim().replace(/[%_]/g, (c) => `\${c}`);
  const where = and(
    ownerScope(actor, deal.ownerId, 'deals'),
    page.status ? eq(proposal.status, page.status) : undefined,
    term ? sql`(${proposal.title} ilike ${`%${term}%`} or ${company.name} ilike ${`%${term}%`} or ${deal.name} ilike ${`%${term}%`})` : undefined,
  );
  const engagedLinks = sql`select id from ${shareLink} where ${shareLink.proposalId} = ${proposal.id}`;
  const items = await ctx.db
    .select({
      id: proposal.id,
      title: proposal.title,
      status: proposal.status,
      validUntil: proposal.validUntil,
      updatedAt: proposal.updatedAt,
      currency: proposal.currency,
      dealId: deal.id,
      dealName: deal.name,
      companyId: company.id,
      companyName: company.name,
      ownerName: appUserProfile.fullName,
      value: sql<
        string | null
      >`(select ${proposalVersion.totals}->>'tcvExclTax' from ${proposalVersion} where ${proposalVersion.id} = ${proposal.currentVersionId})`,
      sentAt: sql<string | null>`(select ${proposalVersion.sentAt} from ${proposalVersion} where ${proposalVersion.id} = ${proposal.lastSentVersionId})`,
      views: sql<number>`(select count(*)::int from ${viewSession} where ${viewSession.counted} and ${viewSession.shareLinkId} in (${engagedLinks}))`,
      viewers: sql<number>`(select count(distinct ${viewSession.viewerIdentityId})::int from ${viewSession} where ${viewSession.counted} and ${viewSession.shareLinkId} in (${engagedLinks}))`,
      seconds: sql<number>`(select coalesce(sum(${viewSession.activeSeconds}), 0)::int from ${viewSession} where ${viewSession.shareLinkId} in (${engagedLinks}))`,
      downloads: sql<number>`(select count(*)::int from ${downloadEvent} where ${downloadEvent.shareLinkId} in (${engagedLinks}))`,
      lastViewedAt: sql<string | null>`(select max(${shareLink.lastViewedAt}) from ${shareLink} where ${shareLink.proposalId} = ${proposal.id})`,
    })
    .from(proposal)
    .innerJoin(deal, eq(deal.id, proposal.dealId))
    .innerJoin(company, eq(company.id, deal.companyId))
    .innerJoin(appUserProfile, eq(appUserProfile.userId, deal.ownerId))
    .where(where)
    .orderBy(desc(proposal.updatedAt))
    .limit(page.limit)
    .offset(page.offset);
  const [count] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(proposal)
    .innerJoin(deal, eq(deal.id, proposal.dealId))
    .innerJoin(company, eq(company.id, deal.companyId))
    .where(where);
  return { items, total: count?.n ?? 0 };
}

export async function getProposal(ctx: AppContext, actor: UserActor, id: string) {
  const { p, d } = await loadProposal(ctx.db, actor, id, 'read');
  const versions = await ctx.db.select().from(proposalVersion).where(eq(proposalVersion.proposalId, id)).orderBy(desc(proposalVersion.versionNumber));
  const current = versions.find((v) => v.id === p.currentVersionId)!;
  const [tv] = await ctx.db.select().from(templateVersion).where(eq(templateVersion.id, p.templateVersionId));
  const lockedSectionIds = (tv!.content as ProposalDocument).sections.filter((s) => s.locked).map((s) => s.id);
  const pendingAi = await ctx.db
    .select({ id: aiGeneration.id, feature: aiGeneration.feature, target: aiGeneration.target, output: aiGeneration.output, simulated: aiGeneration.simulated })
    .from(aiGeneration)
    .where(and(eq(aiGeneration.status, 'pending'), inArray(aiGeneration.feature, PROPOSAL_TEXT_FEATURES), sql`${aiGeneration.target}->>'proposalId' = ${id}`));
  const [org] = await ctx.db.select({ defaults: organizationSettings.proposalDefaults }).from(organizationSettings);
  const defaultValidityDays = org?.defaults.defaultValidityDays ?? null;
  const { frozenSnapshot: _f, ...currentLean } = current;
  return {
    ...p,
    /** BR-PRP-009: what the "Valid until" field offers as the organization default (today + default validity days). */
    defaultValidityDays,
    defaultValidUntil: defaultValidityDays === null ? null : isoDay(new Date(ctx.now().getTime() + defaultValidityDays * 86_400_000)),
    today: isoDay(ctx.now()),
    deal: { id: d.id, name: d.name, amount: d.amount, status: d.status },
    currentVersion: currentLean,
    lockedSectionIds,
    pendingAi,
    versions: versions.map((v) => ({ id: v.id, versionNumber: v.versionNumber, state: v.state, sentAt: v.sentAt, pdfSha256: v.pdfSha256 })),
  };
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

function assertLockedUnchanged(template: ProposalDocument, next: ProposalDocument): void {
  const incoming = new Map(next.sections.map((s) => [s.id, s]));
  for (const s of template.sections.filter((x) => x.locked)) {
    const n = incoming.get(s.id);
    // R8: a locked section is read-only inside every proposal for every role, Admin included.
    if (!n || n.body !== s.body || n.title !== s.title || n.kind !== s.kind)
      throw forbidden('SECTION_LOCKED', `Section "${s.title}" is locked by the template`);
  }
}

export async function saveDraft(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof proposalDraftInput>) {
  return unitOfWork(ctx, actor, async (u) => {
    const { p, d } = await loadProposal(u.tx, actor, id, 'write');
    const [v] = await u.tx
      .select()
      .from(proposalVersion)
      .where(and(eq(proposalVersion.proposalId, id), eq(proposalVersion.state, 'draft')));
    if (!v) throw conflict('VERSION_IMMUTABLE', 'There is no draft version. Create a new version to make changes.');
    if (v.rowVersion !== input.rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This proposal was changed elsewhere. Reload and try again.');
    const [tv] = await u.tx.select().from(templateVersion).where(eq(templateVersion.id, p.templateVersionId));
    assertLockedUnchanged(tv!.content as ProposalDocument, input.content);
    let totals: ReturnType<typeof computeTotals>;
    try {
      totals = computeTotals(input.pricing, input.termMonths, d.currency);
    } catch (e) {
      if (e instanceof PricingError) throw rule(e.code, e.message);
      throw e;
    }
    const validUntil = input.validUntil === undefined ? p.validUntil : input.validUntil;
    // BR-PRP-009 / RULE-PRP-13: a newly chosen validity date must be today or later (blank = no expiry).
    if (validUntil && validUntil !== p.validUntil && validUntil < isoDay(ctx.now()))
      throw rule('VALIDITY_DATE_PAST', 'The validity date must be today or later', { field: 'validUntil' });
    const { values } = await placeholderValues(u.tx, { ...p, validUntil }, v.versionNumber);
    const [updated] = await u.tx
      .update(proposalVersion)
      .set({
        content: input.content,
        pricing: input.pricing,
        termMonths: input.termMonths,
        totals,
        missingPlaceholders: missingPlaceholders(input.content, values),
        updatedAt: ctx.now(),
        updatedBy: actor.userId,
        rowVersion: sql`${proposalVersion.rowVersion} + 1`,
      })
      .where(eq(proposalVersion.id, v.id))
      .returning();
    await u.tx.update(proposal).set({ validUntil, updatedAt: ctx.now() }).where(eq(proposal.id, id));
    if (validUntil !== p.validUntil) await u.audit('proposal.validity_changed', { type: 'proposal', id }, { from: p.validUntil, to: validUntil });
    return {
      validUntil,
      rowVersion: updated!.rowVersion,
      totals,
      missingPlaceholders: updated!.missingPlaceholders,
      dealAmountDiffers: d.amount !== null && Number(d.amount) !== Number(totals.tcvExclTax),
    };
  });
}

/** The package's deterministic findings plus the one that needs database state (RULE-PRP-14, set by a copy across currencies). */
export type RuleFinding = Omit<Finding, 'code'> & { code: Finding['code'] | 'CURRENCY_REVIEW_REQUIRED' };

async function findingsFor(
  ctx: AppContext,
  tx: Tx | AppContext['db'],
  actor: UserActor,
  p: typeof proposal.$inferSelect,
  v: typeof proposalVersion.$inferSelect,
): Promise<{ findings: RuleFinding[]; values: PlaceholderValues; org: typeof organizationSettings.$inferSelect; dealRow: typeof deal.$inferSelect }> {
  const { values, org, dealRow } = await placeholderValues(tx, p, v.versionNumber);
  const pending = await tx
    .select({ target: aiGeneration.target })
    .from(aiGeneration)
    .where(
      and(eq(aiGeneration.status, 'pending'), inArray(aiGeneration.feature, PROPOSAL_TEXT_FEATURES), sql`${aiGeneration.target}->>'proposalId' = ${p.id}`),
    );
  const findings: RuleFinding[] = presendChecks({
    doc: v.content as ProposalDocument,
    values,
    totals: v.totals as ReturnType<typeof computeTotals>,
    dealAmount: dealRow.amount,
    validUntil: p.validUntil,
    today: ctx.now().toISOString().slice(0, 10),
    pendingAiSections: pending.map((x) => (x.target as { sectionId: string }).sectionId),
    maxDiscountPercent: DISCOUNT_LIMIT[actor.role],
  });
  // RULE-PRP-14: prices copied from a proposal in another currency block sending until the user confirms them.
  if (p.currencyReviewFrom)
    findings.push({
      code: 'CURRENCY_REVIEW_REQUIRED',
      severity: 'blocking',
      origin: 'deterministic',
      message: `Prices were copied from a ${p.currencyReviewFrom} proposal; this deal uses ${p.currency}. Review the prices and confirm them.`,
    });
  return { findings, values, org, dealRow };
}

/** Everything the AI-assisted review needs, loaded with the same authorization and rule checks as the normal pre-send check. */
export async function reviewInputs(ctx: AppContext, actor: UserActor, id: string) {
  const { p } = await loadProposal(ctx.db, actor, id, 'write');
  const [v] = await ctx.db.select().from(proposalVersion).where(eq(proposalVersion.id, p.currentVersionId!));
  const { findings, values } = await findingsFor(ctx, ctx.db, actor, p, v!);
  // The AI review lists these as authoritative rule findings. Its suggestion table is keyed by the package's codes, so
  // CURRENCY_REVIEW_REQUIRED is passed through with its message and no extra suggestion text.
  return { proposal: p, version: v!, ruleFindings: findings as Finding[], values };
}

/** BR-AIA-002: deterministic checks are authoritative and run even when AI is off (OD-55). */
export async function presend(ctx: AppContext, actor: UserActor, id: string) {
  const { p } = await loadProposal(ctx.db, actor, id, 'read');
  const [v] = await ctx.db.select().from(proposalVersion).where(eq(proposalVersion.id, p.currentVersionId!));
  const { findings } = await findingsFor(ctx, ctx.db, actor, p, v!);
  return { findings, blocking: findings.filter((f) => f.severity === 'blocking').length };
}

export async function previewHtml(ctx: AppContext, actor: UserActor, id: string, versionId?: string): Promise<string> {
  const { p } = await loadProposal(ctx.db, actor, id, 'read');
  const [v] = await ctx.db
    .select()
    .from(proposalVersion)
    .where(and(eq(proposalVersion.id, versionId ?? p.currentVersionId!), eq(proposalVersion.proposalId, id)));
  if (!v) throw notFound('Version');
  if (v.frozenSnapshot) return renderHtml(v.frozenSnapshot as Snapshot); // sent versions render from the frozen snapshot only
  return renderHtml(await snapshotOf(ctx, ctx.db, p, v, []));
}

async function snapshotOf(
  _ctx: AppContext,
  tx: Tx | AppContext['db'],
  p: typeof proposal.$inferSelect,
  v: typeof proposalVersion.$inferSelect,
  signers: string[],
): Promise<Snapshot> {
  const { values, org } = await placeholderValues(tx, p, v.versionNumber);
  return buildSnapshot({
    doc: v.content as ProposalDocument,
    values,
    pricing: v.pricing as Pricing,
    totals: v.totals as ReturnType<typeof computeTotals>,
    meta: {
      title: p.title,
      number: values['proposal.number'] ?? '',
      versionNumber: v.versionNumber,
      organizationName: org.organizationName,
      primaryColor: org.branding.primaryColor,
      footerText: org.branding.footerText,
      validUntil: p.validUntil,
      currency: p.currency,
      signers,
    },
  });
}

export interface SendPorts {
  /** sharing: creates one tracked link per recipient; returns the one-time URLs. */
  createLinks(
    u: Uow,
    args: { proposalId: string; versionId: string; dealId: string; contacts: { id: string; name: string; email: string }[]; expiresAt?: Date },
  ): Promise<{ contactId: string; url: string }[]>;
  /** esign: voids an open signature request of the deal (OD-21). Returns true if one was voided. */
  voidOpenSignature(u: Uow, dealId: string, reason: string): Promise<boolean>;
  hasOpenSignature(tx: Tx, dealId: string): Promise<boolean>;
}

/**
 * Send = freeze + render + share (RULE-PRP-08/09). Rendering happens before the transaction (no locks held while
 * the PDF is produced); the transaction then re-checks that the draft did not change and commits everything at once.
 */
export async function sendProposal(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof proposalSendInput>, ports: SendPorts) {
  const pre = await loadProposal(ctx.db, actor, id, 'write');
  const [draft] = await ctx.db
    .select()
    .from(proposalVersion)
    .where(and(eq(proposalVersion.proposalId, id), eq(proposalVersion.state, 'draft')));
  if (!draft || nextProposalStatus(pre.p.status, 'version_sent') === null)
    throw conflict('PROPOSAL_NOT_SENDABLE', 'This proposal has no draft version to send');
  if (pre.d.status !== 'open') throw conflict('PROPOSAL_NOT_SENDABLE', 'The deal is closed', { reasons: ['DEAL_CLOSED'] });
  const { findings } = await findingsFor(ctx, ctx.db, actor, pre.p, draft);
  const blocking = findings.filter((f) => f.severity === 'blocking');
  if (blocking.length)
    throw conflict('PROPOSAL_NOT_SENDABLE', 'Fix the blocking findings before sending', { reasons: ['PRESEND_BLOCKING_FINDINGS'], findings: blocking });
  const recipients = await ctx.db
    .select({ id: contact.id, firstName: contact.firstName, lastName: contact.lastName, email: contact.email })
    .from(dealContact)
    .innerJoin(contact, eq(contact.id, dealContact.contactId))
    .where(and(eq(dealContact.dealId, pre.d.id), inArray(contact.id, input.recipientContactIds)));
  if (recipients.length !== input.recipientContactIds.length || recipients.some((r) => !r.email))
    throw rule('RECIPIENT_NOT_DEAL_CONTACT', 'Every recipient must be a contact on the deal with an email address');
  if (input.linkExpiresAt && new Date(input.linkExpiresAt) <= ctx.now()) throw rule('LINK_EXPIRY_IN_PAST', 'The link expiry must be in the future');
  const needed: { code: string; message: string }[] = findings.filter((f) => f.severity === 'warning').map((f) => ({ code: f.code, message: f.message }));
  if (await ports.hasOpenSignature(ctx.db as unknown as Tx, pre.d.id))
    needed.push({ code: 'OPEN_SIGNATURE_REQUEST_CONFIRM', message: 'The open signature request on the previous version will be voided.' });
  requireConfirmations(needed, input.confirm);

  const signerNames = recipients.map((r) => [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email!);
  const snapshot = await snapshotOf(ctx, ctx.db, pre.p, draft, signerNames);
  const snapshotSha256 = sha256Hex(canonicalJson(snapshot));
  const pdf = await ctx.pdf.render(renderHtml(snapshot)).catch((e: unknown) => {
    ctx.logger.error({ err: e }, 'pdf render failed');
    throw rule('DOCUMENT_GENERATION_FAILED', 'The PDF could not be generated. Try again.');
  });
  const docx = await renderDocx(snapshot);
  const pdfSha256 = sha256Hex(pdf);

  return unitOfWork(ctx, actor, async (u) => {
    await lockRow(u.tx, 'deal', pre.d.id);
    await lockRow(u.tx, 'proposal', id);
    const [v] = await u.tx.select().from(proposalVersion).where(eq(proposalVersion.id, draft.id));
    const [p] = await u.tx.select().from(proposal).where(eq(proposal.id, id));
    if (v?.state !== 'draft' || v.rowVersion !== draft.rowVersion || !p)
      throw conflict('CONCURRENT_MODIFICATION', 'The draft changed while it was being sent. Review and send again.');
    const nextStatus = nextProposalStatus(p.status, 'version_sent');
    if (!nextStatus) throw conflict('PROPOSAL_NOT_SENDABLE', 'This proposal can no longer be sent');
    const pdfKey = storageKeys.proposalPdf(v.id);
    const docxKey = storageKeys.proposalDocx(v.id);
    await ctx.storage.put(pdfKey, pdf, { contentType: 'application/pdf', immutable: true });
    await ctx.storage.put(docxKey, docx, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    const [pdfFile] = await u.tx
      .insert(fileObject)
      .values({ storageKey: pdfKey, contentType: 'application/pdf', sizeBytes: pdf.length, sha256: pdfSha256, purpose: 'proposal_pdf', immutable: true })
      .returning();
    const [docxFile] = await u.tx
      .insert(fileObject)
      .values({
        storageKey: docxKey,
        contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        sizeBytes: docx.length,
        sha256: sha256Hex(docx),
        purpose: 'proposal_docx',
      })
      .returning();
    // OD-21: the previous sent version is superseded; its open signature request is voided.
    if (p.lastSentVersionId)
      await u.tx
        .update(proposalVersion)
        .set({ state: 'superseded' })
        .where(and(eq(proposalVersion.id, p.lastSentVersionId), eq(proposalVersion.state, 'sent')));
    await ports.voidOpenSignature(u, pre.d.id, 'A newer proposal version was sent');
    await u.tx
      .update(proposalVersion)
      .set({
        state: 'sent',
        sentAt: ctx.now(),
        sentBy: actor.userId,
        frozenSnapshot: snapshot,
        snapshotSha256,
        pdfFileId: pdfFile!.id,
        pdfSha256,
        docxFileId: docxFile!.id,
        rowVersion: sql`${proposalVersion.rowVersion} + 1`,
      })
      .where(eq(proposalVersion.id, v.id));
    await u.tx
      .update(proposal)
      .set({ status: nextStatus, lastSentVersionId: v.id, currentVersionId: v.id, declineReason: null, updatedAt: ctx.now() })
      .where(eq(proposal.id, id));
    const links = await ports.createLinks(u, {
      proposalId: id,
      versionId: v.id,
      dealId: pre.d.id,
      contacts: recipients.map((r, i) => ({ id: r.id, name: signerNames[i]!, email: r.email! })),
      expiresAt: input.linkExpiresAt ? new Date(input.linkExpiresAt) : undefined,
    });
    await u.audit('proposal.version_sent', { type: 'proposal', id }, { versionNumber: v.versionNumber, recipients: recipients.length, pdfSha256 });
    await u.timeline({
      eventType: 'proposal_version_sent',
      source: { type: 'proposal', id },
      summary: `Proposal "${p.title}" v${v.versionNumber} sent to ${recipients.length} recipient(s)`,
      anchors: [{ type: 'deal', id: pre.d.id }, { type: 'company', id: pre.d.companyId }, ...recipients.map((r) => ({ type: 'contact' as const, id: r.id }))],
    });
    await u.enqueue('event', { name: 'proposal.version_sent', proposalId: id, versionId: v.id, dealId: pre.d.id });
    return { versionId: v.id, versionNumber: v.versionNumber, pdfSha256, links };
  });
}

/** BR-PRP-006: editing after sending means a new draft version; sent versions never change. */
export async function createVersion(ctx: AppContext, actor: UserActor, id: string) {
  return unitOfWork(ctx, actor, async (u) => {
    const { p } = await loadProposal(u.tx, actor, id, 'write');
    await lockRow(u.tx, 'proposal', id);
    const next = nextProposalStatus(p.status, 'new_draft');
    if (next === null)
      throw conflict(p.status === 'signed' ? 'PROPOSAL_SIGNED_IMMUTABLE' : 'PROPOSAL_TERMINAL', 'This proposal is final. Create a new proposal instead.');
    const versions = await u.tx.select().from(proposalVersion).where(eq(proposalVersion.proposalId, id)).orderBy(desc(proposalVersion.versionNumber));
    if (versions.some((v) => v.state === 'draft')) throw conflict('DRAFT_VERSION_EXISTS', 'A draft version already exists');
    const base = versions[0]!;
    const versionNumber = base.versionNumber + 1;
    const { values } = await placeholderValues(u.tx, p, versionNumber);
    const [v] = await u.tx
      .insert(proposalVersion)
      .values({
        proposalId: id,
        versionNumber,
        schemaVersion: 1,
        content: base.content,
        pricing: base.pricing,
        termMonths: base.termMonths,
        totals: base.totals,
        missingPlaceholders: missingPlaceholders(base.content as ProposalDocument, values),
        createdBy: actor.userId,
      })
      .returning();
    await u.tx.update(proposal).set({ currentVersionId: v!.id, status: next, updatedAt: ctx.now() }).where(eq(proposal.id, id));
    return { versionId: v!.id, versionNumber };
  });
}

export async function compareVersions(ctx: AppContext, actor: UserActor, id: string, fromId: string, toId: string) {
  const { p } = await loadProposal(ctx.db, actor, id, 'read');
  const rows = await ctx.db
    .select()
    .from(proposalVersion)
    .where(and(eq(proposalVersion.proposalId, id), inArray(proposalVersion.id, [fromId, toId])));
  const from = rows.find((r) => r.id === fromId);
  const to = rows.find((r) => r.id === toId);
  if (!from || !to) throw notFound('Version');
  return {
    sections: diffDocuments(from.content as ProposalDocument, to.content as ProposalDocument),
    pricing: diffPricing(from.pricing as Pricing, to.pricing as Pricing),
    totals: { from: (from.totals as { tcvExclTax: string }).tcvExclTax, to: (to.totals as { tcvExclTax: string }).tcvExclTax },
    // Sent versions carry their frozen validity date; a draft uses the proposal's current one (RULE-PRP-12 metadata diff).
    validUntil: { from: validityOf(from, p.validUntil), to: validityOf(to, p.validUntil) },
    termMonths: { from: from.termMonths, to: to.termMonths },
  };
}

const validityOf = (v: typeof proposalVersion.$inferSelect, current: string | null): string | null =>
  v.frozenSnapshot ? ((v.frozenSnapshot as Snapshot).validUntil ?? null) : current;

// ───────────── copy to another deal (BR-PRP-010, RULE-PRP-14) ─────────────
/** Open deals on which the user may create proposals — the only valid copy targets. Scope is enforced in SQL (ADR-076). */
export async function listCopyTargets(ctx: AppContext, actor: UserActor, q?: string) {
  requirePerm(actor, 'proposal.manage');
  const term = q?.trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  return ctx.db
    .select({ id: deal.id, name: deal.name, currency: deal.currency, companyName: company.name })
    .from(deal)
    .innerJoin(company, eq(company.id, deal.companyId))
    .where(and(eq(deal.status, 'open'), ownerScope(actor, deal.ownerId, 'deals', 'proposal.manage'), term ? ilike(deal.name, `%${term}%`) : undefined))
    .orderBy(asc(deal.name))
    .limit(50);
}

/**
 * Creates a NEW draft proposal (version 1) on the target deal from the source proposal's current content and pricing.
 * Placeholders are copied as placeholders, so they resolve against the target deal. Links, views, signatures, AI
 * suggestions and status are never copied.
 */
export async function copyProposal(ctx: AppContext, actor: UserActor, sourceId: string, input: { targetDealId: string; title?: string; copyPricing: boolean }) {
  requirePerm(actor, 'proposal.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const { p: src, d: srcDeal } = await loadProposal(u.tx, actor, sourceId, 'read');
    const target = await loadDealFor(u.tx, actor, input.targetDealId, 'write', 'proposal.manage');
    if (target.status !== 'open') throw conflict('DEAL_CLOSED', 'Proposals can be copied only to open deals');
    const [sv] = await u.tx.select().from(proposalVersion).where(eq(proposalVersion.id, src.currentVersionId!));
    if (!sv) throw notFound('Proposal');
    const [tv] = await u.tx
      .select({ archivedAt: proposalTemplate.archivedAt })
      .from(templateVersion)
      .innerJoin(proposalTemplate, eq(proposalTemplate.id, templateVersion.templateId))
      .where(eq(templateVersion.id, src.templateVersionId));
    const [org] = await u.tx.select().from(organizationSettings);
    const content = sv.content as ProposalDocument;
    const pricing: Pricing = input.copyPricing ? (sv.pricing as Pricing) : EMPTY_PRICING;
    let totals: ReturnType<typeof computeTotals>;
    try {
      totals = computeTotals(pricing, sv.termMonths, target.currency);
    } catch (e) {
      if (e instanceof PricingError) throw rule(e.code, e.message);
      throw e;
    }
    const currencyReviewFrom = src.currency !== target.currency && pricing.lines.length > 0 ? src.currency : null;
    const [p] = await u.tx
      .insert(proposal)
      .values({
        dealId: target.id,
        title: input.title ?? copyTitle(src.title, srcDeal.name, target.name),
        templateVersionId: src.templateVersionId,
        currency: target.currency,
        signatureRequired: src.signatureRequired,
        validUntil: isoDay(new Date(ctx.now().getTime() + org!.proposalDefaults.defaultValidityDays * 86_400_000)),
        currencyReviewFrom,
        createdBy: actor.userId,
      })
      .returning();
    const { values } = await placeholderValues(u.tx, p!, 1);
    const [v] = await u.tx
      .insert(proposalVersion)
      .values({
        proposalId: p!.id,
        versionNumber: 1,
        schemaVersion: 1,
        content,
        pricing,
        termMonths: sv.termMonths,
        totals,
        missingPlaceholders: missingPlaceholders(content, values),
        createdBy: actor.userId,
      })
      .returning();
    await u.tx.update(proposal).set({ currentVersionId: v!.id }).where(eq(proposal.id, p!.id));
    await u.audit(
      'proposal.copied',
      { type: 'proposal', id: p!.id },
      { sourceProposalId: src.id, sourceVersionId: sv.id, targetDealId: target.id, copyPricing: input.copyPricing, currencyReviewFrom },
    );
    await u.timeline({
      eventType: 'proposal_created',
      source: { type: 'proposal', id: p!.id },
      summary: `Proposal "${p!.title}" created as a copy of an existing proposal`,
      anchors: [
        { type: 'deal', id: target.id },
        { type: 'company', id: target.companyId },
      ],
    });
    const notices: string[] = [];
    if (tv?.archivedAt) notices.push('The template of the original proposal is archived; the copy keeps its content.');
    if (currencyReviewFrom) notices.push(`Prices were copied unchanged from ${currencyReviewFrom}; review them in ${target.currency} before sending.`);
    return { id: p!.id, dealId: target.id, dealName: target.name, currencyReviewRequired: Boolean(currencyReviewFrom), notices };
  });
}

/**
 * Default title of a copy. A title that still ends with the source deal's name (the "<Template> — <Deal>" default) is
 * re-pointed at the target deal, so one customer's deal name never appears on a proposal for another customer.
 */
export function copyTitle(sourceTitle: string, sourceDealName: string, targetDealName: string): string {
  const suffix = ` — ${sourceDealName}`;
  if (sourceDealName === targetDealName || !sourceTitle.endsWith(suffix)) return sourceTitle;
  return `${sourceTitle.slice(0, -suffix.length)} — ${targetDealName}`.slice(0, 200);
}

/** RULE-PRP-14: the user confirms the copied prices are right for the target deal's currency; unblocks sending. */
export async function confirmCurrencyReview(ctx: AppContext, actor: UserActor, id: string) {
  return unitOfWork(ctx, actor, async (u) => {
    const { p } = await loadProposal(u.tx, actor, id, 'write');
    if (!p.currencyReviewFrom) return { id, currencyReviewRequired: false };
    await u.tx.update(proposal).set({ currencyReviewFrom: null, updatedAt: ctx.now() }).where(eq(proposal.id, id));
    await u.audit('proposal.currency_review_confirmed', { type: 'proposal', id }, { from: p.currencyReviewFrom, to: p.currency });
    return { id, currencyReviewRequired: false };
  });
}

export async function voidProposal(ctx: AppContext, actor: UserActor, id: string, reason: string, ports: Pick<SendPorts, 'voidOpenSignature'>) {
  return unitOfWork(ctx, actor, async (u) => {
    const { p, d } = await loadProposal(u.tx, actor, id, 'write');
    await lockRow(u.tx, 'deal', d.id);
    await lockRow(u.tx, 'proposal', id);
    if (nextProposalStatus(p.status, 'void') === null) throw conflict('PROPOSAL_TERMINAL', 'This proposal is already final');
    await ports.voidOpenSignature(u, d.id, 'Proposal voided'); // OD-18
    await u.tx
      .update(proposal)
      .set({ status: 'void', voidReason: reason, voidKind: 'user', statusBeforeVoid: p.status, updatedAt: ctx.now() })
      .where(eq(proposal.id, id));
    await u.audit('proposal.voided', { type: 'proposal', id }, { reason });
    await u.timeline({
      eventType: 'proposal_voided',
      source: { type: 'proposal', id },
      summary: `Proposal "${p.title}" voided: ${reason}`,
      anchors: [{ type: 'deal', id: d.id }],
    });
    return { id };
  });
}

export async function downloadFile(ctx: AppContext, actor: UserActor, id: string, versionId: string, format: 'pdf' | 'docx') {
  await loadProposal(ctx.db, actor, id, 'read');
  const [v] = await ctx.db
    .select()
    .from(proposalVersion)
    .where(and(eq(proposalVersion.id, versionId), eq(proposalVersion.proposalId, id)));
  const fileId = format === 'pdf' ? v?.pdfFileId : v?.docxFileId;
  if (!fileId) throw notFound('File');
  const [f] = await ctx.db.select().from(fileObject).where(eq(fileObject.id, fileId));
  return { bytes: await ctx.storage.get(f!.storageKey), contentType: f!.contentType, fileName: `proposal-v${v!.versionNumber}.${format}` };
}

/** BR-PRC-004: the user accepts the prompt to set the deal amount to the proposal value. */
export async function syncDealAmount(ctx: AppContext, actor: UserActor, id: string) {
  return unitOfWork(ctx, actor, async (u) => {
    const { p, d } = await loadProposal(u.tx, actor, id, 'write');
    const [v] = await u.tx.select().from(proposalVersion).where(eq(proposalVersion.id, p.currentVersionId!));
    const amount = (v!.totals as { tcvExclTax: string }).tcvExclTax;
    await u.tx
      .update(deal)
      .set({ amount, amountSource: 'proposal', rowVersion: sql`${deal.rowVersion} + 1` })
      .where(eq(deal.id, d.id));
    await u.audit('proposal.deal_amount_updated', { type: 'deal', id: d.id }, { amount });
    return { amount };
  });
}

/**
 * The single place where a proposal's status changes because of buyer or signature activity (SM-02).
 * Caller holds locks deal → proposal. Returns the new status, or null if the event does not apply.
 */
export async function applyProposalEvent(
  ctx: AppContext,
  tx: Tx,
  proposalId: string,
  event: ProposalEvent,
  extra: { declineReason?: string; voidReason?: string; voidKind?: 'user' | 'automation' } = {},
) {
  const [p] = await tx.select().from(proposal).where(eq(proposal.id, proposalId));
  if (!p) return null;
  const next = nextProposalStatus(p.status, event);
  if (next === null || next === p.status) return next === p.status ? p.status : null;
  await tx
    .update(proposal)
    .set({
      status: next,
      updatedAt: ctx.now(),
      ...(event === 'decline' ? { declineReason: extra.declineReason ?? null } : {}),
      ...(event === 'void' ? { voidReason: extra.voidReason ?? 'Voided', voidKind: extra.voidKind ?? 'user', statusBeforeVoid: p.status } : {}),
    })
    .where(eq(proposal.id, proposalId));
  if (event === 'sign' && p.lastSentVersionId) await tx.update(proposalVersion).set({ state: 'signed' }).where(eq(proposalVersion.id, p.lastSentVersionId));
  return next;
}

/** BR-PRP-009 / OD-22(a): proposals past their validity date expire; an open signature request is voided. */
export async function expireProposals(ctx: AppContext, ports: Pick<SendPorts, 'voidOpenSignature'>) {
  const today = ctx.now().toISOString().slice(0, 10);
  const due = await ctx.db
    .select({ id: proposal.id, dealId: proposal.dealId, title: proposal.title })
    .from(proposal)
    .where(and(inArray(proposal.status, ['sent', 'viewed', 'accepted']), sql`${proposal.validUntil} < ${today}`));
  for (const row of due) {
    await unitOfWork(ctx, { type: 'system', name: 'Scheduler' }, async (u) => {
      await lockRow(u.tx, 'deal', row.dealId);
      await lockRow(u.tx, 'proposal', row.id);
      if ((await applyProposalEvent(ctx, u.tx, row.id, 'expire')) !== 'expired') return;
      await ports.voidOpenSignature(u, row.dealId, 'Proposal expired');
      await u.timeline({
        eventType: 'proposal_expired',
        source: { type: 'proposal', id: row.id },
        summary: `Proposal "${row.title}" expired`,
        anchors: [{ type: 'deal', id: row.dealId }],
      });
      await u.enqueue('event', { name: 'proposal.expired', proposalId: row.id, dealId: row.dealId });
    });
  }
  return due.length;
}
