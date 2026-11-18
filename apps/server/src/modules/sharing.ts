/**
 * sharing module — secure per-recipient links, buyer sessions, identity gate, view tracking, downloads,
 * accept/decline (BR-SHR-001..010; DOCUMENT-SHARING-DESIGN.md; ADR-034 hash + encrypted token, ADR-071 token in
 * the URL fragment exchanged for a link-bound cookie). Buyers never get an internal account.
 */
import type { Snapshot } from '@crm/proposal';
import { and, desc, eq, sql } from 'drizzle-orm';
import {
  type AppContext,
  conflict,
  decryptSecret,
  encryptSecret,
  loadDealFor,
  lockRow,
  normalizeEmail,
  notFound,
  randomToken,
  requireConfirmations,
  rule,
  schema,
  sha256Hex,
  type Tx,
  type Uow,
  type UserActor,
  unitOfWork,
} from '../platform/core.ts';
import { recordActivity } from './crm.ts';
import { applyProposalEvent } from './proposals.ts';

const {
  shareLink,
  buyerSession,
  viewerIdentity,
  viewSession,
  downloadEvent,
  buyerResponse,
  proposal,
  proposalVersion,
  contact,
  dealContact,
  deal,
  company,
  organizationSettings,
  fileObject,
  signatureRequest,
} = schema;
const BUYER: { type: 'buyer'; name: string } = { type: 'buyer', name: 'Buyer' };
/** Uniform answer for unknown, revoked or foreign links — never reveals whether a link exists (§18.2 row 1). */
const unavailable = () => notFound('Proposal');
const REOPEN_GAP_MS = 30 * 60_000; // OD-73

export async function createLinks(
  ctx: AppContext,
  u: Uow,
  args: { proposalId: string; versionId: string; dealId: string; contacts: { id: string; name: string; email: string }[]; expiresAt?: Date },
) {
  const out: { contactId: string; url: string }[] = [];
  for (const c of args.contacts) {
    const token = randomToken(32);
    const [row] = await u.tx
      .insert(shareLink)
      .values({
        proposalVersionId: args.versionId,
        proposalId: args.proposalId,
        dealId: args.dealId,
        contactId: c.id,
        recipientName: c.name,
        recipientEmail: c.email,
        tokenHash: sha256Hex(token),
        tokenCiphertext: 'pending',
        expiresAt: args.expiresAt,
        createdBy: u.actor.type === 'user' ? u.actor.userId : null,
      })
      .returning({ id: shareLink.id });
    // The token is stored only as a hash (lookup) and an encrypted copy bound to this row (re-copy, PERM-118).
    await u.tx
      .update(shareLink)
      .set({ tokenCiphertext: encryptSecret(ctx.config.KEYRING_LOCAL_MASTER_KEY, token, row!.id) })
      .where(eq(shareLink.id, row!.id));
    out.push({ contactId: c.id, url: linkUrl(ctx, token) });
  }
  return out;
}
const linkUrl = (ctx: AppContext, token: string) => `${ctx.config.BUYER_ORIGIN}/p#${token}`;

// ───────────── internal (sales team) ─────────────
export async function listLinks(ctx: AppContext, actor: UserActor, proposalId: string) {
  const [p] = await ctx.db.select().from(proposal).where(eq(proposal.id, proposalId));
  if (!p) throw notFound('Proposal');
  await loadDealFor(ctx.db, actor, p.dealId, 'read');
  const links = await ctx.db
    .select({
      id: shareLink.id,
      versionId: shareLink.proposalVersionId,
      versionNumber: proposalVersion.versionNumber,
      recipientName: shareLink.recipientName,
      recipientEmail: shareLink.recipientEmail,
      status: shareLink.status,
      expiresAt: shareLink.expiresAt,
      firstViewedAt: shareLink.firstViewedAt,
      lastViewedAt: shareLink.lastViewedAt,
    })
    .from(shareLink)
    .innerJoin(proposalVersion, eq(proposalVersion.id, shareLink.proposalVersionId))
    .where(eq(shareLink.proposalId, proposalId))
    .orderBy(desc(shareLink.createdAt));
  const views = await ctx.db
    .select({
      shareLinkId: viewSession.shareLinkId,
      viewerName: viewerIdentity.name,
      viewerEmail: viewerIdentity.normalizedEmail,
      forwarded: sql<boolean>`not ${viewerIdentity.isOriginalRecipient}`,
      startedAt: viewSession.startedAt,
      activeSeconds: viewSession.activeSeconds,
      isReopen: viewSession.isReopen,
      sectionSeconds: viewSession.sectionSeconds,
    })
    .from(viewSession)
    .innerJoin(viewerIdentity, eq(viewerIdentity.id, viewSession.viewerIdentityId))
    .innerJoin(shareLink, eq(shareLink.id, viewSession.shareLinkId))
    .where(and(eq(shareLink.proposalId, proposalId), eq(viewSession.counted, true)))
    .orderBy(desc(viewSession.startedAt));
  const downloads = await ctx.db
    .select({ shareLinkId: downloadEvent.shareLinkId, occurredAt: downloadEvent.occurredAt, format: downloadEvent.format })
    .from(downloadEvent)
    .innerJoin(shareLink, eq(shareLink.id, downloadEvent.shareLinkId))
    .where(eq(shareLink.proposalId, proposalId));
  const now = ctx.now();
  return links.map((l) => ({
    ...l,
    /** True once the per-link expiry has passed (BR-SHR-007); evaluated at read time, exactly like the buyer side. */
    expired: l.status === 'active' && l.expiresAt !== null && l.expiresAt <= now,
    views: views.filter((v) => v.shareLinkId === l.id),
    downloads: downloads.filter((d) => d.shareLinkId === l.id),
  }));
}

async function loadLinkForWrite(tx: Tx, actor: UserActor, linkId: string) {
  const [l] = await tx.select().from(shareLink).where(eq(shareLink.id, linkId));
  if (!l) throw notFound('Link');
  await loadDealFor(tx, actor, l.dealId, 'write', 'proposal.manage').catch((e) => {
    throw e.code === 'NOT_FOUND' ? notFound('Link') : e; // never reveal that a link exists on an invisible deal
  });
  return l;
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const linkExpired = (l: { expiresAt: Date | null }, now: Date) => l.expiresAt !== null && l.expiresAt <= now;

/**
 * BR-SHR-007 / RULE-SHR-10: set, extend or clear the expiry of ONE link. The date-time must be in the future; a date
 * after the proposal's validity date is allowed only after the user confirms the warning (the earlier clock still wins
 * for the buyer). Revoked links and links of a void or expired proposal cannot be changed (SM L4).
 */
export async function setLinkExpiry(ctx: AppContext, actor: UserActor, linkId: string, input: { expiresAt: string | null; confirm?: string[] | undefined }) {
  return unitOfWork(ctx, actor, async (u) => {
    const l = await loadLinkForWrite(u.tx, actor, linkId);
    if (l.status === 'revoked') throw conflict('LINK_REVOKED', 'A revoked link cannot be changed');
    const [p] = await u.tx.select({ status: proposal.status, validUntil: proposal.validUntil }).from(proposal).where(eq(proposal.id, l.proposalId));
    if (!p) throw notFound('Link');
    if (p.status === 'void' || p.status === 'expired')
      throw conflict('PROPOSAL_NOT_AVAILABLE', 'This proposal is no longer available, so its links cannot be changed');
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= ctx.now()) throw rule('LINK_EXPIRY_IN_PAST', 'The link expiry must be in the future', { field: 'expiresAt' });
    if (expiresAt && p.validUntil && isoDay(expiresAt) > p.validUntil)
      requireConfirmations(
        [
          {
            code: 'LINK_EXPIRY_AFTER_VALIDITY',
            message: `This is later than the proposal's validity date (${p.validUntil}). The proposal will still expire for the buyer on that date.`,
          },
        ],
        input.confirm,
      );
    await u.tx.update(shareLink).set({ expiresAt }).where(eq(shareLink.id, linkId));
    await u.audit(
      'share_link.updated',
      { type: 'share_link', id: linkId },
      { expiresAt: { from: l.expiresAt?.toISOString() ?? null, to: expiresAt?.toISOString() ?? null } },
    );
    await u.timeline({
      eventType: 'share_link_updated',
      source: { type: 'share_link', id: linkId },
      summary: expiresAt
        ? `Link for ${l.recipientName} now expires on ${expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC`
        : `Link expiry removed for ${l.recipientName}`,
      anchors: [{ type: 'deal', id: l.dealId }],
    });
    return { id: l.id, expiresAt, expired: false };
  });
}

export async function revokeLink(ctx: AppContext, actor: UserActor, linkId: string) {
  return unitOfWork(ctx, actor, async (u) => {
    const l = await loadLinkForWrite(u.tx, actor, linkId);
    await u.tx.update(shareLink).set({ status: 'revoked', revokedAt: ctx.now() }).where(eq(shareLink.id, linkId));
    await u.tx.delete(buyerSession).where(eq(buyerSession.shareLinkId, linkId)); // existing buyer sessions end immediately
    await u.audit('share_link.revoked', { type: 'share_link', id: linkId });
    return { id: l.id };
  });
}

export async function copyLink(ctx: AppContext, actor: UserActor, linkId: string) {
  return unitOfWork(ctx, actor, async (u) => {
    const l = await loadLinkForWrite(u.tx, actor, linkId);
    if (l.status !== 'active') throw rule('PROPOSAL_NOT_AVAILABLE', 'This link is no longer active');
    await u.audit('share_link.copied', { type: 'share_link', id: linkId });
    return { url: linkUrl(ctx, decryptSecret(ctx.config.KEYRING_LOCAL_MASTER_KEY, l.tokenCiphertext, l.id)) };
  });
}

// ───────────── buyer surface ─────────────
/** POST /public/v1/session/exchange — the only place the raw token is ever sent to the server. */
export async function exchangeToken(ctx: AppContext, token: string) {
  const [l] = await ctx.db
    .select()
    .from(shareLink)
    .where(eq(shareLink.tokenHash, sha256Hex(token)));
  if (!l || l.status === 'revoked') throw unavailable();
  const session = randomToken(32);
  await ctx.db.insert(buyerSession).values({ sessionHash: sha256Hex(session), shareLinkId: l.id, expiresAt: new Date(ctx.now().getTime() + 30 * 86_400_000) });
  return { session };
}

export interface BuyerContext {
  session: typeof buyerSession.$inferSelect;
  link: typeof shareLink.$inferSelect;
}
/** Resolves the cookie to its link. Everything a buyer can reach is keyed by this — there are no ids to tamper with. */
export async function resolveBuyer(ctx: AppContext, sessionCookie: string | undefined): Promise<BuyerContext> {
  if (!sessionCookie) throw unavailable();
  const [row] = await ctx.db
    .select({ session: buyerSession, link: shareLink })
    .from(buyerSession)
    .innerJoin(shareLink, eq(shareLink.id, buyerSession.shareLinkId))
    .where(eq(buyerSession.sessionHash, sha256Hex(sessionCookie)));
  if (!row || row.session.expiresAt <= ctx.now() || row.link.status === 'revoked') throw unavailable();
  return row;
}

type BuyerState = { state: 'withdrawn' | 'expired' | 'link_expired' | 'needs_identity' | 'ready'; recipientName?: string; notice?: string };
/** BUSINESS-RULES §18.2 — first matching row decides what the buyer may see. */
async function evaluate(ctx: AppContext, b: BuyerContext): Promise<{ state: BuyerState; p: typeof proposal.$inferSelect }> {
  const [p] = await ctx.db.select().from(proposal).where(eq(proposal.id, b.link.proposalId));
  if (!p) throw unavailable();
  if (p.status === 'void') return { state: { state: 'withdrawn' }, p };
  if (p.status === 'expired' || (p.validUntil && p.validUntil < ctx.now().toISOString().slice(0, 10) && p.status !== 'signed'))
    return { state: { state: 'expired' }, p };
  if (linkExpired(b.link, ctx.now())) return { state: { state: 'link_expired' }, p };
  if (!b.session.viewerIdentityId) {
    const [org] = await ctx.db.select({ notice: organizationSettings.privacyNoticeText }).from(organizationSettings);
    return { state: { state: 'needs_identity', recipientName: b.link.recipientName, notice: org?.notice }, p };
  }
  return { state: { state: 'ready' }, p };
}

export async function buyerState(ctx: AppContext, b: BuyerContext) {
  return (await evaluate(ctx, b)).state;
}

/** Identity gate (BR-SHR-005, OD-26, OD-69): "continue as recipient" or identify as someone the proposal was forwarded to. */
export async function identify(ctx: AppContext, b: BuyerContext, input: { continueAsRecipient: true } | { name: string; email: string }) {
  // §18.2 row 4: an expired link refuses every buyer action, including identifying (no contact is created from it).
  if (linkExpired(b.link, ctx.now())) throw rule('PROPOSAL_NOT_AVAILABLE', 'This proposal is not available');
  return unitOfWork(ctx, BUYER, async (u) => {
    await lockRow(u.tx, 'deal', b.link.dealId);
    const original = 'continueAsRecipient' in input;
    const email = normalizeEmail(original ? b.link.recipientEmail : input.email);
    const name = original ? b.link.recipientName : input.name;
    const isOriginal = original || email === normalizeEmail(b.link.recipientEmail);
    let contactId = b.link.contactId;
    let [identity] = await u.tx
      .select()
      .from(viewerIdentity)
      .where(and(eq(viewerIdentity.shareLinkId, b.link.id), eq(viewerIdentity.normalizedEmail, email)));
    if (!identity && !isOriginal) {
      // Forwarded viewer → matched or created as a contact and added to the deal as a stakeholder.
      const [d] = await u.tx.select({ ownerId: deal.ownerId, companyId: deal.companyId }).from(deal).where(eq(deal.id, b.link.dealId));
      const [co] = await u.tx.select({ domain: company.normalizedDomain }).from(company).where(eq(company.id, d!.companyId));
      let [person] = await u.tx.select().from(contact).where(eq(contact.normalizedEmail, email));
      if (!person) {
        const [first, ...rest] = name.split(/\s+/);
        [person] = await u.tx
          .insert(contact)
          .values({
            firstName: first,
            lastName: rest.join(' ') || null,
            email,
            normalizedEmail: email,
            ownerId: d!.ownerId,
            source: 'forwarded_viewer',
            companyId: co?.domain && email.endsWith(`@${co.domain}`) ? d!.companyId : null,
          })
          .returning();
      }
      contactId = person!.id;
      const added = await u.tx
        .insert(dealContact)
        .values({ dealId: b.link.dealId, contactId, roles: ['Forwarded viewer'], addedVia: 'forwarded_viewer' })
        .onConflictDoNothing()
        .returning();
      if (added.length) {
        await u.timeline({
          eventType: 'proposal_forwarded',
          source: { type: 'share_link', id: b.link.id },
          summary: `${name} (${email}) opened a forwarded proposal and was added as a stakeholder`,
          anchors: [
            { type: 'deal', id: b.link.dealId },
            { type: 'contact', id: contactId },
          ],
        });
        await u.enqueue('event', {
          name: 'share.forwarded_viewer_identified',
          dealId: b.link.dealId,
          proposalId: b.link.proposalId,
          contactId,
          viewerName: name,
        });
      }
    }
    if (!identity)
      [identity] = await u.tx
        .insert(viewerIdentity)
        .values({ shareLinkId: b.link.id, name, normalizedEmail: email, isOriginalRecipient: isOriginal, contactId })
        .returning();
    await u.tx.update(buyerSession).set({ viewerIdentityId: identity!.id }).where(eq(buyerSession.id, b.session.id));
    await u.audit('buyer.identity_established', { type: 'share_link', id: b.link.id }, { forwarded: !isOriginal });
    return { state: 'ready' as const };
  });
}

async function requireReady(ctx: AppContext, b: BuyerContext) {
  const { state, p } = await evaluate(ctx, b);
  if (state.state !== 'ready') throw rule('PROPOSAL_NOT_AVAILABLE', 'This proposal is not available');
  const [v] = await ctx.db.select().from(proposalVersion).where(eq(proposalVersion.id, b.link.proposalVersionId));
  const [identity] = await ctx.db.select().from(viewerIdentity).where(eq(viewerIdentity.id, b.session.viewerIdentityId!));
  return { p, v: v!, identity: identity! };
}

/** Returns only the frozen snapshot of the linked version — no internal ids, owners or other deal data. */
export async function buyerProposal(ctx: AppContext, b: BuyerContext) {
  const { p, v, identity } = await requireReady(ctx, b);
  const superseded = v.state === 'superseded';
  const [response] = await ctx.db.select({ response: buyerResponse.response }).from(buyerResponse).where(eq(buyerResponse.proposalVersionId, v.id));
  const [openSig] = await ctx.db
    .select({ id: signatureRequest.id })
    .from(signatureRequest)
    .where(and(eq(signatureRequest.proposalVersionId, v.id), sql`${signatureRequest.status} in ('pending','sent','viewed')`));
  const canRespond = !superseded && !p.signatureRequired && identity.isOriginalRecipient && !response && (p.status === 'sent' || p.status === 'viewed');
  return {
    snapshot: v.frozenSnapshot as Snapshot,
    superseded,
    outcome: p.status === 'signed' ? 'signed' : (response?.response ?? null),
    signatureRequested: Boolean(openSig),
    actions: { accept: canRespond, decline: canRespond, download: true },
  };
}

export async function startView(ctx: AppContext, b: BuyerContext) {
  const { identity } = await requireReady(ctx, b);
  const [row] = await ctx.db
    .insert(viewSession)
    .values({ shareLinkId: b.link.id, dealId: b.link.dealId, viewerIdentityId: identity.id, startedAt: ctx.now() })
    .returning({ id: viewSession.id });
  return { viewSessionId: row!.id };
}

/**
 * A view is COUNTED only on its first heartbeat — a request that needs JavaScript running in a real browser, so
 * mail scanners and link previews never trigger "opened" alerts (ADR-071). Later heartbeats add active time.
 */
export async function heartbeat(ctx: AppContext, b: BuyerContext, input: { viewSessionId: string; activeSeconds: number; sectionId?: string }) {
  // A page left open past the link expiry must not keep counting views (the expiry is enforced on every request).
  if (linkExpired(b.link, ctx.now())) throw rule('PROPOSAL_NOT_AVAILABLE', 'This proposal is not available');
  return unitOfWork(ctx, BUYER, async (u) => {
    const [vs] = await u.tx
      .select()
      .from(viewSession)
      .where(and(eq(viewSession.id, input.viewSessionId), eq(viewSession.shareLinkId, b.link.id)));
    if (!vs) throw unavailable();
    const add = Math.min(input.activeSeconds, 20);
    const sectionSeconds = { ...vs.sectionSeconds };
    if (input.sectionId) sectionSeconds[input.sectionId] = (sectionSeconds[input.sectionId] ?? 0) + add;
    if (vs.counted) {
      await u.tx
        .update(viewSession)
        .set({ lastHeartbeatAt: ctx.now(), activeSeconds: vs.activeSeconds + add, sectionSeconds })
        .where(eq(viewSession.id, vs.id));
      return { counted: false };
    }
    await lockRow(u.tx, 'deal', b.link.dealId);
    await lockRow(u.tx, 'proposal', b.link.proposalId);
    const [prev] = await u.tx
      .select({ last: sql<Date | null>`max(coalesce(${viewSession.lastHeartbeatAt}, ${viewSession.startedAt}))` })
      .from(viewSession)
      .where(and(eq(viewSession.viewerIdentityId, vs.viewerIdentityId), eq(viewSession.counted, true)));
    const [anyCounted] = await u.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(viewSession)
      .innerJoin(shareLink, eq(shareLink.id, viewSession.shareLinkId))
      .where(and(eq(shareLink.proposalVersionId, b.link.proposalVersionId), eq(viewSession.counted, true)));
    const isFirstOfVersion = (anyCounted?.n ?? 0) === 0;
    const isReopen = !isFirstOfVersion && prev?.last != null && ctx.now().getTime() - new Date(prev.last).getTime() >= REOPEN_GAP_MS;
    await u.tx
      .update(viewSession)
      .set({ counted: true, isReopen, lastHeartbeatAt: ctx.now(), activeSeconds: add, sectionSeconds })
      .where(eq(viewSession.id, vs.id));
    await u.tx
      .update(shareLink)
      .set({ firstViewedAt: sql`coalesce(${shareLink.firstViewedAt}, ${ctx.now().toISOString()}::timestamptz)`, lastViewedAt: ctx.now() })
      .where(eq(shareLink.id, b.link.id));
    await recordActivity(u.tx, b.link.dealId, ctx.now());
    const [v] = await u.tx.select({ state: proposalVersion.state }).from(proposalVersion).where(eq(proposalVersion.id, b.link.proposalVersionId));
    if (v?.state === 'sent') await applyProposalEvent(ctx, u.tx, b.link.proposalId, 'first_view');
    const [identity] = await u.tx.select().from(viewerIdentity).where(eq(viewerIdentity.id, vs.viewerIdentityId));
    if (isFirstOfVersion || isReopen) {
      await u.timeline({
        eventType: 'proposal_viewed',
        source: { type: 'share_link', id: b.link.id },
        summary: `${identity!.name} ${isReopen ? 'reopened' : 'opened'} the proposal`,
        anchors: [{ type: 'deal', id: b.link.dealId }],
      });
      await u.enqueue('event', {
        name: 'proposal.view_counted',
        dealId: b.link.dealId,
        proposalId: b.link.proposalId,
        versionId: b.link.proposalVersionId,
        viewerIdentityId: identity!.id,
        viewerName: identity!.name,
        isFirstOfVersion,
        isReopen,
      });
    }
    return { counted: true };
  });
}

export async function download(ctx: AppContext, b: BuyerContext) {
  const { v, identity } = await requireReady(ctx, b);
  const [f] = await ctx.db.select().from(fileObject).where(eq(fileObject.id, v.pdfFileId!));
  await unitOfWork(ctx, BUYER, async (u) => {
    await u.tx.insert(downloadEvent).values({ shareLinkId: b.link.id, viewerIdentityId: identity.id, format: 'pdf' });
    await recordActivity(u.tx, b.link.dealId, ctx.now());
    await u.timeline({
      eventType: 'proposal_downloaded',
      source: { type: 'share_link', id: b.link.id },
      summary: `${identity.name} downloaded the proposal PDF`,
      anchors: [{ type: 'deal', id: b.link.dealId }],
    });
    await u.enqueue('event', {
      name: 'proposal.downloaded',
      dealId: b.link.dealId,
      proposalId: b.link.proposalId,
      versionId: v.id,
      viewerIdentityId: identity.id,
      viewerName: identity.name,
    });
  });
  return { bytes: await ctx.storage.get(f!.storageKey), fileName: `proposal-v${v.versionNumber}.pdf` };
}

/** Accept or decline without a signature (BR-SHR-010, OD-17). First response wins; evidence is stored. */
export async function respond(
  ctx: AppContext,
  b: BuyerContext,
  input: { response: 'accept' | 'decline'; reason?: string; typedName?: string },
  client: { ip: string; userAgent: string },
) {
  if (input.response === 'decline' && !input.reason?.trim()) throw rule('DECLINE_REASON_REQUIRED', 'Please tell us why you are declining');
  return unitOfWork(ctx, BUYER, async (u) => {
    await lockRow(u.tx, 'deal', b.link.dealId);
    await lockRow(u.tx, 'proposal', b.link.proposalId);
    const view = await buyerProposal(ctx, b);
    if (!view.actions.accept)
      throw rule(view.outcome ? 'RESPONSE_ALREADY_RECORDED' : 'RESPONSE_NOT_ALLOWED', 'A response cannot be recorded for this proposal');
    const [v] = await u.tx.select({ sha: proposalVersion.snapshotSha256 }).from(proposalVersion).where(eq(proposalVersion.id, b.link.proposalVersionId));
    const [identity] = await u.tx.select().from(viewerIdentity).where(eq(viewerIdentity.id, b.session.viewerIdentityId!));
    const evidence = {
      name: identity!.name,
      email: identity!.normalizedEmail,
      typedName: input.typedName ?? null,
      ipTruncated: client.ip.replace(/\.\d+$/, '.0'),
      userAgent: client.userAgent.slice(0, 300),
      versionSha256: v!.sha,
      at: ctx.now().toISOString(),
    };
    const inserted = await u.tx
      .insert(buyerResponse)
      .values({
        proposalVersionId: b.link.proposalVersionId,
        shareLinkId: b.link.id,
        viewerIdentityId: identity!.id,
        response: input.response,
        reason: input.reason,
        evidence,
      })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) throw rule('RESPONSE_ALREADY_RECORDED', 'A response has already been recorded');
    await applyProposalEvent(ctx, u.tx, b.link.proposalId, input.response, { declineReason: input.reason });
    await recordActivity(u.tx, b.link.dealId, ctx.now());
    await u.audit('buyer.response_recorded', { type: 'proposal', id: b.link.proposalId }, { response: input.response });
    await u.timeline({
      eventType: input.response === 'accept' ? 'proposal_accepted' : 'proposal_declined',
      source: { type: 'proposal', id: b.link.proposalId },
      summary: `${identity!.name} ${input.response === 'accept' ? 'accepted' : 'declined'} the proposal${input.reason ? `: ${input.reason}` : ''}`,
      anchors: [{ type: 'deal', id: b.link.dealId }],
    });
    await u.enqueue('event', {
      name: input.response === 'accept' ? 'proposal.accepted' : 'proposal.declined',
      dealId: b.link.dealId,
      proposalId: b.link.proposalId,
      versionId: b.link.proposalVersionId,
      by: identity!.name,
      reason: input.reason ?? null,
    });
    return { outcome: input.response };
  });
}
