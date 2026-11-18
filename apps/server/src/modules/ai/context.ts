/**
 * AI context engine (AI-ARCHITECTURE §4, AI-IMPLEMENTATION-DESIGN §3).
 *
 * The model never queries the database. This module is the ONLY place that reads CRM data for an AI call, and it:
 *  1. authorizes first — every context is anchored to one deal that the REQUESTING user may read (`loadDealFor`);
 *     every other record is reached through that deal, so a user can never pull another owner's data into a prompt;
 *  2. minimizes — each source selects named fields only (no phone numbers, no addresses, no other users' emails);
 *  3. separates trusted facts (structured CRM fields) from untrusted free text (notes, call notes, buyer reasons);
 *  4. budgets — facts always fit; free text is added newest-first until the feature's token budget is used;
 *  5. records provenance — `refs` lists the {type,id} of every record used (ids only, no content).
 */
import type { Pricing, ProposalDocument, ProposalTotals } from '@crm/shared';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { type AppContext, loadDealFor, schema, type UserActor } from '../../platform/core.ts';

const {
  activityLog,
  appUserProfile,
  buyerResponse,
  company,
  contact,
  deal,
  dealContact,
  dealFlag,
  dealStageHistory,
  downloadEvent,
  note,
  organizationSettings,
  pipelineStage,
  product,
  proposal,
  proposalVersion,
  shareLink,
  signatureRequest,
  task,
  viewerIdentity,
  viewSession,
} = schema;

export type ContextSource = 'company' | 'contacts' | 'proposal' | 'activities' | 'tasks' | 'engagement' | 'catalogue';
export interface ContextRef {
  type: string;
  id: string;
}
/** Free text written by people (or buyers). Passed to the model as data, never as instructions. */
export interface UntrustedText {
  id: string;
  type: 'note' | 'call' | 'meeting' | 'buyer_decline_reason' | 'lost_reason_note';
  date: string;
  text: string;
}
export interface AiContext {
  /** Structured CRM facts. Authoritative: prompts tell the model these are the only facts it may state. */
  facts: Record<string, unknown>;
  untrusted: UntrustedText[];
  refs: ContextRef[];
  /** Rough size of what will be sent (4 characters ≈ 1 token). */
  estimatedTokens: number;
  /** Free-text items left out because the budget was reached (count only). */
  omittedTexts: number;
}

const CHARS_PER_TOKEN = 4;
const MAX_TEXT_CHARS = 1500;
export const estimateTokens = (value: unknown): number => Math.ceil((typeof value === 'string' ? value : JSON.stringify(value)).length / CHARS_PER_TOKEN);
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const person = (p: { firstName: string | null; lastName: string | null }) => [p.firstName, p.lastName].filter(Boolean).join(' ') || null;
/** Control characters and invisible or bidirectional Unicode marks (used to hide text from human readers). */
// biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are exactly what is being removed
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u2028-\u202e\u2060\ufeff]/g;
/** Removes markup and control characters and caps the length; keeps prompts small and delimiters intact. */
export function sanitizeText(text: string, max = MAX_TEXT_CHARS): string {
  const clean = text
    .replace(/<[^>]{0,200}>/g, ' ')
    .replace(INVISIBLE, '')
    .replace(/[ \t]+/g, ' ')
    .trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

type Db = AppContext['db'];
type DealRow = typeof deal.$inferSelect;
interface Part {
  facts?: Record<string, unknown>;
  untrusted?: UntrustedText[];
  refs: ContextRef[];
}

// ───────────────────────── sources (each takes an ALREADY AUTHORIZED deal row) ─────────────────────────
async function dealSource(db: Db, d: DealRow): Promise<Part> {
  const [stage] = await db.select({ name: pipelineStage.name }).from(pipelineStage).where(eq(pipelineStage.id, d.stageId));
  const [owner] = await db.select({ fullName: appUserProfile.fullName }).from(appUserProfile).where(eq(appUserProfile.userId, d.ownerId));
  const [org] = await db.select({ name: organizationSettings.organizationName }).from(organizationSettings);
  const flags = await db
    .select({ kind: dealFlag.kind })
    .from(dealFlag)
    .where(and(eq(dealFlag.dealId, d.id), isNull(dealFlag.clearedAt)));
  return {
    facts: {
      sellerOrganization: org?.name ?? null,
      deal: {
        name: d.name,
        status: d.status,
        stage: stage?.name ?? null,
        amount: d.amount,
        currency: d.currency,
        expectedCloseDate: d.closeDate,
        daysInCurrentStage: Math.max(0, Math.floor((Date.now() - new Date(d.stageEnteredAt).getTime()) / 86_400_000)),
        lastActivityDate: iso(d.lastActivityAt),
        ownerName: owner?.fullName ?? null,
        flags: flags.map((f) => f.kind),
      },
    },
    untrusted: d.lostReasonNote ? [{ id: `deal:${d.id}`, type: 'lost_reason_note', date: iso(d.closedAt) ?? '', text: sanitizeText(d.lostReasonNote) }] : [],
    refs: [{ type: 'deal', id: d.id }],
  };
}

async function companySource(db: Db, d: DealRow): Promise<Part> {
  const [c] = await db
    .select({ id: company.id, name: company.name, industry: company.industry, domain: company.domain })
    .from(company)
    .where(eq(company.id, d.companyId));
  if (!c) return { refs: [] };
  return { facts: { company: { name: c.name, industry: c.industry, website: c.domain } }, refs: [{ type: 'company', id: c.id }] };
}

async function contactsSource(db: Db, d: DealRow): Promise<Part> {
  const rows = await db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      jobTitle: contact.jobTitle,
      roles: dealContact.roles,
      isPrimary: dealContact.isPrimary,
    })
    .from(dealContact)
    .innerJoin(contact, eq(contact.id, dealContact.contactId))
    .where(eq(dealContact.dealId, d.id))
    .orderBy(desc(dealContact.isPrimary), asc(dealContact.createdAt))
    .limit(10);
  return {
    // Names, titles and deal roles only — email addresses and phone numbers are not needed to write text.
    facts: {
      contacts: rows.map((r) => ({ id: r.id, firstName: r.firstName, fullName: person(r), jobTitle: r.jobTitle, roles: r.roles, isPrimary: r.isPrimary })),
    },
    refs: rows.map((r) => ({ type: 'contact', id: r.id })),
  };
}

async function proposalSource(db: Db, d: DealRow, proposalId?: string): Promise<Part> {
  const proposals = await db
    .select()
    .from(proposal)
    .where(proposalId ? and(eq(proposal.dealId, d.id), eq(proposal.id, proposalId)) : eq(proposal.dealId, d.id))
    .orderBy(desc(proposal.createdAt))
    .limit(proposalId ? 1 : 5);
  if (proposals.length === 0) return { facts: { proposals: [] }, refs: [] };
  const versions = await db
    .select()
    .from(proposalVersion)
    .where(
      inArray(
        proposalVersion.id,
        proposals.map((p) => p.currentVersionId).filter((x): x is string => x !== null),
      ),
    );
  const byId = new Map(versions.map((v) => [v.id, v]));
  const summarize = (p: (typeof proposals)[number], detailed: boolean) => {
    const v = p.currentVersionId ? byId.get(p.currentVersionId) : undefined;
    const totals = v?.totals as ProposalTotals | undefined;
    const pricing = v?.pricing as Pricing | undefined;
    const doc = v?.content as ProposalDocument | undefined;
    return {
      id: p.id,
      title: p.title,
      status: p.status,
      versionNumber: v?.versionNumber ?? null,
      sentDate: iso(v?.sentAt),
      validUntil: p.validUntil,
      signatureRequired: p.signatureRequired,
      currency: p.currency,
      termMonths: v?.termMonths ?? null,
      // Pricing comes from the database calculation. The model may quote these numbers but must never compute its own.
      totals: totals
        ? {
            oneTime: totals.oneTime.total,
            recurring: totals.recurring.map((r) => ({ period: r.period, total: r.total })),
            contractValueExclTax: totals.tcvExclTax,
          }
        : null,
      lineItems: (pricing?.lines ?? []).map((l) => ({
        name: l.name,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        billing: l.billingType === 'recurring' ? `recurring per ${l.billingPeriod}` : 'one-time',
        ...(l.discountValue ? { discount: `${l.discountValue}${l.discountType === 'percent' ? '%' : ''}` } : {}),
      })),
      ...(detailed && doc
        ? { sections: doc.sections.filter((s) => s.kind !== 'signature').map((s) => ({ id: s.id, title: s.title, required: s.required, text: s.body })) }
        : {}),
    };
  };
  return proposalId
    ? { facts: { proposal: summarize(proposals[0]!, true) }, refs: [{ type: 'proposal', id: proposals[0]!.id }] }
    : { facts: { proposals: proposals.map((p) => summarize(p, false)) }, refs: proposals.map((p) => ({ type: 'proposal', id: p.id })) };
}

async function activitiesSource(db: Db, d: DealRow): Promise<Part> {
  const notes = await db
    .select({ id: note.id, body: note.body, at: note.createdAt })
    .from(note)
    .where(and(eq(note.relatedType, 'deal'), eq(note.relatedId, d.id)))
    .orderBy(desc(note.createdAt))
    .limit(15);
  const logs = await db
    .select({ id: activityLog.id, kind: activityLog.kind, at: activityLog.occurredAt, outcome: activityLog.outcome, notes: activityLog.notes })
    .from(activityLog)
    .where(and(eq(activityLog.relatedType, 'deal'), eq(activityLog.relatedId, d.id)))
    .orderBy(desc(activityLog.occurredAt))
    .limit(15);
  const history = await db
    .select({ at: dealStageHistory.changedAt, to: pipelineStage.name, actorType: dealStageHistory.actorType })
    .from(dealStageHistory)
    .innerJoin(pipelineStage, eq(pipelineStage.id, dealStageHistory.toStageId))
    .where(eq(dealStageHistory.dealId, d.id))
    .orderBy(desc(dealStageHistory.changedAt))
    .limit(10);
  const untrusted: UntrustedText[] = [
    ...notes.map((n) => ({ id: `note:${n.id}`, type: 'note' as const, date: iso(n.at) ?? '', text: sanitizeText(n.body) })),
    ...logs
      .filter((l) => l.notes || l.outcome)
      .map((l) => ({ id: `${l.kind}:${l.id}`, type: l.kind, date: iso(l.at) ?? '', text: sanitizeText([l.outcome, l.notes].filter(Boolean).join(' — ')) })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  return {
    facts: {
      activity: {
        notesCount: notes.length,
        callsAndMeetings: logs.map((l) => ({ kind: l.kind, date: iso(l.at) })),
        stageHistory: history.map((h) => ({ date: iso(h.at), movedTo: h.to, by: h.actorType })),
      },
    },
    untrusted,
    refs: [...notes.map((n) => ({ type: 'note', id: n.id })), ...logs.map((l) => ({ type: 'activity', id: l.id }))],
  };
}

async function tasksSource(db: Db, d: DealRow): Promise<Part> {
  const rows = await db
    .select({ id: task.id, title: task.title, dueAt: task.dueAt, source: task.source })
    .from(task)
    .where(and(eq(task.relatedType, 'deal'), eq(task.relatedId, d.id), eq(task.status, 'open')))
    .orderBy(asc(task.dueAt))
    .limit(10);
  const today = new Date();
  return {
    facts: {
      openTasks: rows.map((t) => ({
        title: sanitizeText(t.title, 200),
        dueDate: iso(t.dueAt),
        overdue: new Date(t.dueAt) < today,
        createdBy: t.source === 'automation' ? 'automation' : 'user',
      })),
    },
    refs: rows.map((t) => ({ type: 'task', id: t.id })),
  };
}

async function engagementSource(db: Db, d: DealRow, proposalId?: string): Promise<Part> {
  const links = await db
    .select({
      id: shareLink.id,
      proposalId: shareLink.proposalId,
      recipientName: shareLink.recipientName,
      status: shareLink.status,
      firstViewedAt: shareLink.firstViewedAt,
      lastViewedAt: shareLink.lastViewedAt,
    })
    .from(shareLink)
    .where(proposalId ? and(eq(shareLink.dealId, d.id), eq(shareLink.proposalId, proposalId)) : eq(shareLink.dealId, d.id))
    .limit(20);
  const linkIds = links.map((l) => l.id);
  const views = linkIds.length
    ? await db
        .select({
          linkId: viewSession.shareLinkId,
          seconds: viewSession.activeSeconds,
          viewer: viewerIdentity.name,
          original: viewerIdentity.isOriginalRecipient,
        })
        .from(viewSession)
        .leftJoin(viewerIdentity, eq(viewerIdentity.id, viewSession.viewerIdentityId))
        .where(and(inArray(viewSession.shareLinkId, linkIds), eq(viewSession.counted, true)))
    : [];
  const downloads = linkIds.length
    ? await db.select({ linkId: downloadEvent.shareLinkId }).from(downloadEvent).where(inArray(downloadEvent.shareLinkId, linkIds))
    : [];
  const responses = linkIds.length
    ? await db
        .select({ id: buyerResponse.id, response: buyerResponse.response, reason: buyerResponse.reason, at: buyerResponse.respondedAt })
        .from(buyerResponse)
        .where(inArray(buyerResponse.shareLinkId, linkIds))
    : [];
  const signatures = await db
    .select({ status: signatureRequest.status, completedAt: signatureRequest.completedAt })
    .from(signatureRequest)
    .where(proposalId ? and(eq(signatureRequest.dealId, d.id), eq(signatureRequest.proposalId, proposalId)) : eq(signatureRequest.dealId, d.id));
  return {
    facts: {
      buyerEngagement: {
        linksShared: links.length,
        recipients: links.map((l) => {
          const own = views.filter((v) => v.linkId === l.id);
          return {
            recipientName: l.recipientName,
            linkStatus: l.status,
            firstViewed: iso(l.firstViewedAt),
            lastViewed: iso(l.lastViewedAt),
            viewCount: own.length,
            totalReadingMinutes: Math.round(own.reduce((s, v) => s + v.seconds, 0) / 60),
            downloads: downloads.filter((x) => x.linkId === l.id).length,
            forwardedTo: [...new Set(own.filter((v) => v.original === false && v.viewer).map((v) => v.viewer as string))],
          };
        }),
        buyerResponses: responses.map((r) => ({ response: r.response, date: iso(r.at) })),
        signatureRequests: signatures.map((s) => ({ status: s.status, completedDate: iso(s.completedAt) })),
      },
    },
    untrusted: responses
      .filter((r) => r.reason)
      .map((r) => ({ id: `buyer_response:${r.id}`, type: 'buyer_decline_reason' as const, date: iso(r.at) ?? '', text: sanitizeText(r.reason as string) })),
    refs: links.map((l) => ({ type: 'share_link', id: l.id })),
  };
}

async function catalogueSource(db: Db): Promise<Part> {
  const rows = await db
    .select({ id: product.id, name: product.name, description: product.description, unit: product.unit, billingType: product.billingType })
    .from(product)
    .where(isNull(product.archivedAt))
    .limit(50);
  // Catalogue PRICES are deliberately left out: proposal prices come only from the proposal's own pricing table.
  return {
    facts: { productCatalogue: rows.map((r) => ({ name: r.name, description: r.description, unit: r.unit, billing: r.billingType })) },
    refs: rows.map((r) => ({ type: 'product', id: r.id })),
  };
}

/**
 * Builds the context for one AI request. Throws 404 (not 403) when the user cannot see the deal, exactly like the
 * rest of the API, so AI endpoints cannot be used to probe for records.
 */
export async function buildContext(
  ctx: AppContext,
  actor: UserActor,
  input: { dealId: string; proposalId?: string; include: ContextSource[]; budgetTokens: number },
): Promise<AiContext> {
  const d = await loadDealFor(ctx.db, actor, input.dealId, 'read');
  const want = new Set(input.include);
  const parts: Part[] = [await dealSource(ctx.db, d)];
  if (want.has('company')) parts.push(await companySource(ctx.db, d));
  if (want.has('contacts')) parts.push(await contactsSource(ctx.db, d));
  if (want.has('proposal')) parts.push(await proposalSource(ctx.db, d, input.proposalId));
  if (want.has('tasks')) parts.push(await tasksSource(ctx.db, d));
  if (want.has('engagement')) parts.push(await engagementSource(ctx.db, d, input.proposalId));
  if (want.has('activities')) parts.push(await activitiesSource(ctx.db, d));
  if (want.has('catalogue')) parts.push(await catalogueSource(ctx.db));

  const facts = Object.assign({}, ...parts.map((p) => p.facts ?? {})) as Record<string, unknown>;
  let used = estimateTokens(facts);
  const candidates = parts.flatMap((p) => p.untrusted ?? []).sort((a, b) => b.date.localeCompare(a.date));
  const untrusted: UntrustedText[] = [];
  for (const item of candidates) {
    const cost = estimateTokens(item.text) + 20;
    if (used + cost > input.budgetTokens) continue; // newest first; older or oversized items are dropped
    untrusted.push(item);
    used += cost;
  }
  return { facts, untrusted, refs: parts.flatMap((p) => p.refs), estimatedTokens: used, omittedTexts: candidates.length - untrusted.length };
}
