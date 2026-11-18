/**
 * esign module — signature orchestration through an external provider behind ESignatureProvider
 * (BR-SIG-001..013; E-SIGNATURE-DESIGN.md; ADR-025 signing-chain integrity). The CRM never implements signing
 * itself: it decides WHAT is signed and by WHOM, mirrors provider status, and stores the evidence.
 */
import type { signatureRequestInput } from '@crm/shared';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { storageKeys } from '../platform/adapters.ts';
import {
  type AppContext,
  conflict,
  loadDealFor,
  lockRow,
  notFound,
  rule,
  SYSTEM,
  schema,
  sha256Hex,
  type Tx,
  type Uow,
  type UserActor,
  unitOfWork,
} from '../platform/core.ts';
import { canAdvanceSignature, isOpenSignatureStatus, providerToSignatureStatus } from './domain.ts';
import { applyProposalEvent } from './proposals.ts';

const { signatureRequest, signer, signatureEvent, signedDocument, esignWebhookInbox, proposal, proposalVersion, contact, dealContact, fileObject, dealFlag } =
  schema;
const OPEN = ['pending', 'sent', 'viewed'] as const;

export async function hasOpenSignature(tx: Tx, dealId: string): Promise<boolean> {
  const [row] = await tx
    .select({ id: signatureRequest.id })
    .from(signatureRequest)
    .where(and(eq(signatureRequest.dealId, dealId), inArray(signatureRequest.status, [...OPEN])));
  return Boolean(row);
}

/**
 * Voids the deal's open request locally at once and asks the provider asynchronously (OD-18, OD-21). The provider
 * may still complete before it processes the void — that case is handled as a stale completion (ADR-025).
 */
export async function voidOpenSignature(u: Uow, dealId: string, reason: string): Promise<boolean> {
  const [sr] = await u.tx
    .select()
    .from(signatureRequest)
    .where(and(eq(signatureRequest.dealId, dealId), inArray(signatureRequest.status, [...OPEN])));
  if (!sr) return false;
  await u.tx.update(signatureRequest).set({ status: 'voided', voidReason: reason }).where(eq(signatureRequest.id, sr.id));
  await u.tx
    .update(signer)
    .set({ status: 'cancelled' })
    .where(and(eq(signer.signatureRequestId, sr.id), inArray(signer.status, ['waiting', 'sent', 'viewed'])));
  await u.tx.insert(signatureEvent).values({ signatureRequestId: sr.id, type: 'voided', source: 'user_action' });
  if (sr.providerEnvelopeId) await u.enqueue('esign.void', { envelopeId: sr.providerEnvelopeId, reason });
  await u.timeline({
    eventType: 'signature_voided',
    source: { type: 'signature_request', id: sr.id },
    summary: `Signature request voided: ${reason}`,
    anchors: [{ type: 'deal', id: dealId }],
  });
  return true;
}

export async function createRequest(ctx: AppContext, actor: UserActor, proposalId: string, input: z.infer<typeof signatureRequestInput>) {
  return unitOfWork(ctx, actor, async (u) => {
    const [p] = await u.tx.select().from(proposal).where(eq(proposal.id, proposalId));
    if (!p) throw notFound('Proposal');
    const d = await loadDealFor(u.tx, actor, p.dealId, 'write', 'proposal.manage');
    await lockRow(u.tx, 'deal', d.id);
    await lockRow(u.tx, 'proposal', proposalId);
    const [v] = p.lastSentVersionId ? await u.tx.select().from(proposalVersion).where(eq(proposalVersion.id, p.lastSentVersionId)) : [];
    // BR-SIG-001/011: only the current sent version can be signed.
    if (v?.state !== 'sent' || !['sent', 'viewed', 'accepted'].includes(p.status) || d.status !== 'open')
      throw rule('SIGNATURE_VERSION_NOT_ELIGIBLE', 'Signatures can be requested only on the current sent version of an open deal');
    if (await hasOpenSignature(u.tx, d.id)) throw conflict('SIGNATURE_REQUEST_ALREADY_OPEN', 'This deal already has an open signature request'); // OD-23
    if (new Set(input.signerContactIds).size !== input.signerContactIds.length) throw rule('SIGNER_DUPLICATE', 'A signer is listed twice');
    const people = await u.tx
      .select({ id: contact.id, firstName: contact.firstName, lastName: contact.lastName, email: contact.email })
      .from(dealContact)
      .innerJoin(contact, eq(contact.id, dealContact.contactId))
      .where(and(eq(dealContact.dealId, d.id), inArray(contact.id, input.signerContactIds)));
    if (people.length !== input.signerContactIds.length || people.some((x) => !x.email))
      throw rule('SIGNER_NOT_DEAL_CONTACT', 'Every signer must be a contact on the deal with an email address');
    const [sr] = await u.tx
      .insert(signatureRequest)
      .values({
        proposalId,
        proposalVersionId: v.id,
        dealId: d.id,
        requestedBy: actor.userId,
        provider: ctx.esign.name,
        signingOrder: input.signingOrder,
        documentSha256: v.pdfSha256!,
        expiresAt: new Date(ctx.now().getTime() + 30 * 86_400_000),
        createdBy: actor.userId,
      })
      .returning();
    await u.tx.insert(signer).values(
      input.signerContactIds.map((id, i) => {
        const c = people.find((x) => x.id === id)!;
        return {
          signatureRequestId: sr!.id,
          contactId: id,
          name: [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email!,
          email: c.email!,
          signOrder: i + 1,
          status: 'waiting' as const,
        };
      }),
    );
    await u.audit('signature_request.created', { type: 'signature_request', id: sr!.id }, { signers: people.length, documentSha256: v.pdfSha256 });
    await u.timeline({
      eventType: 'signature_requested',
      source: { type: 'signature_request', id: sr!.id },
      summary: `Signature requested from ${people.length} signer(s)`,
      anchors: [{ type: 'deal', id: d.id }],
    });
    await u.enqueue('esign.dispatch', { signatureRequestId: sr!.id });
    return { id: sr!.id };
  });
}

/** Job: send the frozen PDF to the provider. Aborts if the stored bytes no longer match the frozen hash. */
export async function dispatch(ctx: AppContext, signatureRequestId: string): Promise<void> {
  const [sr] = await ctx.db.select().from(signatureRequest).where(eq(signatureRequest.id, signatureRequestId));
  if (sr?.status !== 'pending') return; // voided meanwhile, or already dispatched (idempotent)
  const [v] = await ctx.db.select().from(proposalVersion).where(eq(proposalVersion.id, sr.proposalVersionId));
  const [p] = await ctx.db.select({ title: proposal.title }).from(proposal).where(eq(proposal.id, sr.proposalId));
  const [f] = await ctx.db.select().from(fileObject).where(eq(fileObject.id, v!.pdfFileId!));
  const document = await ctx.storage.get(f!.storageKey);
  if (sha256Hex(document) !== sr.documentSha256) {
    ctx.logger.error({ signatureRequestId }, 'ESIGN_HASH_MISMATCH: stored PDF does not match the frozen fingerprint');
    throw new Error('ESIGN_HASH_MISMATCH');
  }
  const signers = await ctx.db.select().from(signer).where(eq(signer.signatureRequestId, sr.id)).orderBy(asc(signer.signOrder));
  const { envelopeId } = await ctx.esign.createEnvelope({
    title: p!.title,
    document,
    documentSha256: sr.documentSha256,
    order: sr.signingOrder,
    signers: signers.map((s) => ({ key: s.id, name: s.name, email: s.email, order: s.signOrder })),
    metadata: { signatureRequestId: sr.id },
  });
  await ctx.db.transaction(async (tx) => {
    const updated = await tx
      .update(signatureRequest)
      .set({ providerEnvelopeId: envelopeId, status: 'sent' })
      .where(and(eq(signatureRequest.id, sr.id), eq(signatureRequest.status, 'pending')))
      .returning();
    if (!updated.length) return;
    await tx.insert(signatureEvent).values({ signatureRequestId: sr.id, type: 'dispatched', source: 'scheduler' });
  });
  await syncRequest(ctx, sr.id);
}

/** Webhook entry: verify → persist → acknowledge. Business processing happens in a job (ADR-053). */
export async function ingestWebhook(ctx: AppContext, rawBody: string, signature: string | undefined): Promise<boolean> {
  const check = ctx.esign.verifyWebhook(rawBody, signature);
  if (!check.valid || !check.eventId || !check.envelopeId) return false;
  await ctx.db.transaction(async (tx) => {
    const inserted = await tx
      .insert(esignWebhookInbox)
      .values({ provider: ctx.esign.name, providerEventId: check.eventId!, rawBody })
      .onConflictDoNothing()
      .returning();
    if (inserted.length)
      await tx
        .insert(schema.jobOutbox)
        .values({ queue: 'esign.webhook', payload: { envelopeId: check.envelopeId, inboxId: inserted[0]!.id }, runAfter: ctx.now() }); // duplicates are dropped here
  });
  return true;
}

export async function processWebhook(ctx: AppContext, envelopeId: string, inboxId?: string): Promise<void> {
  const [sr] = await ctx.db.select({ id: signatureRequest.id }).from(signatureRequest).where(eq(signatureRequest.providerEnvelopeId, envelopeId));
  if (sr) await syncRequest(ctx, sr.id);
  if (inboxId)
    await ctx.db
      .update(esignWebhookInbox)
      .set({ status: sr ? 'processed' : 'ignored' })
      .where(eq(esignWebhookInbox.id, inboxId));
}

/**
 * Re-reads the AUTHORITATIVE status from the provider and applies only forward transitions. Safe to call any
 * number of times (webhooks, duplicates, hourly reconciliation) — the result is the same.
 */
export async function syncRequest(ctx: AppContext, signatureRequestId: string): Promise<void> {
  const [pre] = await ctx.db.select().from(signatureRequest).where(eq(signatureRequest.id, signatureRequestId));
  if (!pre?.providerEnvelopeId) return;
  const env = await ctx.esign.getEnvelope(pre.providerEnvelopeId);
  await unitOfWork(ctx, SYSTEM, async (u) => {
    await lockRow(u.tx, 'deal', pre.dealId);
    await lockRow(u.tx, 'proposal', pre.proposalId);
    await lockRow(u.tx, 'signature_request', pre.id);
    const [sr] = await u.tx.select().from(signatureRequest).where(eq(signatureRequest.id, pre.id));
    const signers = await u.tx.select().from(signer).where(eq(signer.signatureRequestId, sr!.id));
    const localOpen = isOpenSignatureStatus(sr!.status);
    for (const es of env.signers) {
      const s = signers.find((x) => x.id === es.key);
      if (!s || s.status === es.status || s.status === 'signed' || s.status === 'declined') continue;
      if (s.status === 'cancelled' && es.status !== 'signed') continue; // a cancelled signer only changes if the provider says they signed
      await u.tx
        .update(signer)
        .set({
          status: es.status,
          signedAt: es.signedAt ? new Date(es.signedAt) : null,
          consentCapturedAt: es.consentAt ? new Date(es.consentAt) : null,
          ipAddress: es.ip ?? null,
        })
        .where(eq(signer.id, s.id));
      if (es.status === 'signed') {
        await u.tx
          .insert(signatureEvent)
          .values({
            signatureRequestId: sr!.id,
            signerId: s.id,
            type: 'signed',
            source: 'provider_webhook',
            providerEventId: `${env.envelopeId}:${s.id}:signed`,
          })
          .onConflictDoNothing();
        if (localOpen && env.status !== 'completed')
          await u.enqueue('event', { name: 'signature.signer_signed', dealId: sr!.dealId, proposalId: sr!.proposalId, signerId: s.id, signerName: s.name });
      }
    }
    const target = providerToSignatureStatus(env.status);
    if (target === 'signed') {
      if (sr!.completedAt) return; // already handled (duplicate webhook)
      const [p] = await u.tx.select().from(proposal).where(eq(proposal.id, sr!.proposalId));
      const [v] = await u.tx.select().from(proposalVersion).where(eq(proposalVersion.id, sr!.proposalVersionId));
      const stale = !localOpen || v!.state !== 'sent' || p!.lastSentVersionId !== v!.id;
      await u.tx
        .insert(signatureEvent)
        .values({ signatureRequestId: sr!.id, type: 'completed', source: 'provider_webhook', providerEventId: `${env.envelopeId}:completed` })
        .onConflictDoNothing();
      if (stale) {
        // Signed after void/supersede/expiry: keep the legal record, do NOT close the deal, flag for the owner.
        await u.tx.update(signatureRequest).set({ completedAt: ctx.now(), staleCompletion: true }).where(eq(signatureRequest.id, sr!.id));
        await u.tx.insert(dealFlag).values({ dealId: sr!.dealId, kind: 'signed_on_stale_version' }).onConflictDoNothing();
        await u.audit('signature_request.stale_completion', { type: 'signature_request', id: sr!.id });
        await u.timeline({
          eventType: 'signature_completed',
          source: { type: 'signature_request', id: sr!.id },
          summary: 'A signature was completed on a version that is no longer current — review required',
          anchors: [{ type: 'deal', id: sr!.dealId }],
        });
        await u.enqueue('event', { name: 'signature_request.stale_completion', dealId: sr!.dealId, proposalId: sr!.proposalId, signatureRequestId: sr!.id });
      } else {
        await u.tx.update(signatureRequest).set({ status: 'signed', completedAt: ctx.now() }).where(eq(signatureRequest.id, sr!.id));
        await applyProposalEvent(ctx, u.tx, sr!.proposalId, 'sign');
        await u.audit('signature_request.completed', { type: 'signature_request', id: sr!.id });
        await u.timeline({
          eventType: 'signature_completed',
          source: { type: 'signature_request', id: sr!.id },
          summary: `All signers signed "${p!.title}"`,
          anchors: [{ type: 'deal', id: sr!.dealId }],
        });
        await u.enqueue('event', {
          name: 'signature_request.completed',
          dealId: sr!.dealId,
          proposalId: sr!.proposalId,
          versionId: v!.id,
          signatureRequestId: sr!.id,
        });
      }
      await u.enqueue('esign.fetch-signed', { signatureRequestId: sr!.id });
      return;
    }
    if (!canAdvanceSignature(sr!.status, target)) return;
    await u.tx
      .update(signatureRequest)
      .set({ status: target, declineReason: target === 'declined' ? (env.signers.find((s) => s.status === 'declined')?.declineReason ?? null) : null })
      .where(eq(signatureRequest.id, sr!.id));
    if (target === 'declined') {
      // OD-25: one decline ends the request; remaining signers are cancelled; the proposal is Declined.
      await u.tx
        .update(signer)
        .set({ status: 'cancelled' })
        .where(and(eq(signer.signatureRequestId, sr!.id), inArray(signer.status, ['waiting', 'sent', 'viewed'])));
      const reason = env.signers.find((s) => s.status === 'declined')?.declineReason ?? 'No reason given';
      await applyProposalEvent(ctx, u.tx, sr!.proposalId, 'decline', { declineReason: reason });
      await u.timeline({
        eventType: 'signature_declined',
        source: { type: 'signature_request', id: sr!.id },
        summary: `A signer declined: ${reason}`,
        anchors: [{ type: 'deal', id: sr!.dealId }],
      });
      await u.enqueue('event', {
        name: 'proposal.declined',
        dealId: sr!.dealId,
        proposalId: sr!.proposalId,
        versionId: sr!.proposalVersionId,
        by: 'A signer',
        reason,
      });
    }
  });
}

/** Job: store the provider's sealed PDF and completion certificate write-once, with fingerprints (BR-SIG-009/010). */
export async function fetchSigned(ctx: AppContext, signatureRequestId: string): Promise<void> {
  const [sr] = await ctx.db.select().from(signatureRequest).where(eq(signatureRequest.id, signatureRequestId));
  const [existing] = await ctx.db.select({ id: signedDocument.id }).from(signedDocument).where(eq(signedDocument.signatureRequestId, signatureRequestId));
  if (!sr?.providerEnvelopeId || existing) return;
  const { signedPdf, certificate } = await ctx.esign.downloadCompleted(sr.providerEnvelopeId);
  const files = [
    { key: storageKeys.signedPdf(sr.id), bytes: signedPdf, contentType: 'application/pdf', purpose: 'signed_pdf' },
    { key: storageKeys.certificate(sr.id), bytes: certificate, contentType: 'text/plain', purpose: 'certificate' },
  ];
  for (const f of files)
    await ctx.storage
      .put(f.key, f.bytes, { contentType: f.contentType, immutable: true })
      .catch((e: NodeJS.ErrnoException) => (e.code === 'EEXIST' ? undefined : Promise.reject(e)));
  await ctx.db.transaction(async (tx) => {
    const ids: string[] = [];
    for (const f of files) {
      const [row] = await tx
        .insert(fileObject)
        .values({ storageKey: f.key, contentType: f.contentType, sizeBytes: f.bytes.length, sha256: sha256Hex(f.bytes), purpose: f.purpose, immutable: true })
        .onConflictDoUpdate({ target: fileObject.storageKey, set: { purpose: f.purpose } })
        .returning();
      ids.push(row!.id);
    }
    await tx
      .insert(signedDocument)
      .values({
        signatureRequestId: sr.id,
        signedPdfFileId: ids[0]!,
        signedPdfSha256: sha256Hex(signedPdf),
        certificateFileId: ids[1]!,
        certificateSha256: sha256Hex(certificate),
        sourceDocumentSha256: sr.documentSha256,
        sealedAt: ctx.now(),
      })
      .onConflictDoNothing();
  });
}

export async function voidRequest(ctx: AppContext, actor: UserActor, id: string, reason: string) {
  return unitOfWork(ctx, actor, async (u) => {
    const [sr] = await u.tx.select().from(signatureRequest).where(eq(signatureRequest.id, id));
    if (!sr) throw notFound('Signature request');
    await loadDealFor(u.tx, actor, sr.dealId, 'write', 'proposal.manage');
    await lockRow(u.tx, 'deal', sr.dealId);
    if (!(await voidOpenSignature(u, sr.dealId, reason))) throw rule('SIGNATURE_REQUEST_NOT_OPEN', 'This signature request is no longer open');
    await u.audit('signature_request.voided', { type: 'signature_request', id }, { reason });
    return { id };
  });
}

export async function listForProposal(ctx: AppContext, actor: UserActor, proposalId: string) {
  const [p] = await ctx.db.select().from(proposal).where(eq(proposal.id, proposalId));
  if (!p) throw notFound('Proposal');
  await loadDealFor(ctx.db, actor, p.dealId, 'read');
  const requests = await ctx.db
    .select()
    .from(signatureRequest)
    .where(eq(signatureRequest.proposalId, proposalId))
    .orderBy(sql`${signatureRequest.createdAt} desc`);
  const signers = requests.length
    ? await ctx.db
        .select()
        .from(signer)
        .where(
          inArray(
            signer.signatureRequestId,
            requests.map((r) => r.id),
          ),
        )
        .orderBy(asc(signer.signOrder))
    : [];
  const docs = requests.length
    ? await ctx.db
        .select()
        .from(signedDocument)
        .where(
          inArray(
            signedDocument.signatureRequestId,
            requests.map((r) => r.id),
          ),
        )
    : [];
  return requests.map((r) => ({
    ...r,
    simulated: r.provider === 'fake',
    signers: signers.filter((s) => s.signatureRequestId === r.id),
    signedDocument: docs.find((d) => d.signatureRequestId === r.id) ?? null,
  }));
}

export async function downloadSigned(ctx: AppContext, actor: UserActor, id: string, kind: 'signed-pdf' | 'certificate') {
  const [sr] = await ctx.db.select().from(signatureRequest).where(eq(signatureRequest.id, id));
  if (!sr) throw notFound('Signature request');
  await loadDealFor(ctx.db, actor, sr.dealId, 'read');
  const [doc] = await ctx.db.select().from(signedDocument).where(eq(signedDocument.signatureRequestId, id));
  if (!doc) throw notFound('Signed document');
  const [f] = await ctx.db
    .select()
    .from(fileObject)
    .where(eq(fileObject.id, kind === 'signed-pdf' ? doc.signedPdfFileId : doc.certificateFileId));
  const bytes = await ctx.storage.get(f!.storageKey);
  if (sha256Hex(bytes) !== f!.sha256) throw rule('TEMPORARILY_UNAVAILABLE', 'Stored document failed its integrity check'); // tamper evidence
  return { bytes, contentType: f!.contentType, fileName: kind === 'signed-pdf' ? 'signed-proposal.pdf' : 'completion-certificate.txt' };
}

/** Hourly: converge every open request with the provider, so a lost webhook cannot leave a deal stuck. */
export async function reconcile(ctx: AppContext): Promise<number> {
  const open = await ctx.db
    .select({ id: signatureRequest.id })
    .from(signatureRequest)
    .where(and(inArray(signatureRequest.status, ['sent', 'viewed']), sql`${signatureRequest.providerEnvelopeId} is not null`));
  for (const r of open) await syncRequest(ctx, r.id);
  return open.length;
}
