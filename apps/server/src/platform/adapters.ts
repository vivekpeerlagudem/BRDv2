/**
 * Drivers for the ports in ports.ts.
 *  - LocalFsStorage      real, for local development (S3/Azure driver pending OD-11)
 *  - BrowserPdfRenderer  real, uses the installed Microsoft Edge through playwright-core, network blocked
 *  - FakeESignProvider   SIMULATOR — not a legally valid signature (real provider pending OD-02/OD-03)
 *  (AI providers live in ./anthropic.ts and ./mock-ai.ts)
 *  - LogEmail            logs instead of sending (provider pending OD-14) — no real email ever leaves
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { type Browser, chromium } from 'playwright-core';
import { randomToken, sha256Hex } from './core.ts';
import type { Logger } from './logging/logger.ts';
import type { EnvelopeStatus, ESignatureProvider, ObjectStorage, PdfRenderer, TransactionalEmail } from './ports.ts';

export class LocalFsStorage implements ObjectStorage {
  private readonly root: string;
  constructor(root: string) {
    this.root = resolve(root);
  }
  private path(key: string): string {
    const full = resolve(this.root, key);
    if (!full.startsWith(this.root + sep)) throw new Error('Invalid storage key'); // no path traversal
    return full;
  }
  async put(key: string, body: Uint8Array, opts: { contentType: string; immutable?: boolean }): Promise<void> {
    const file = this.path(key);
    await mkdir(dirname(file), { recursive: true });
    // Immutable objects are write-once: `wx` fails if the file already exists (stand-in for Object Lock, ADR-036).
    await writeFile(file, body, { flag: opts.immutable ? 'wx' : 'w' });
  }
  async get(key: string): Promise<Uint8Array> {
    return new Uint8Array(await readFile(this.path(key)));
  }
}

export class BrowserPdfRenderer implements PdfRenderer {
  private browser: Promise<Browser> | null = null;
  private readonly channel: string;
  constructor(channel: string) {
    this.channel = channel;
  }
  async render(html: string): Promise<Uint8Array> {
    this.browser ??= chromium.launch({ channel: this.channel, headless: true });
    const browser = await this.browser;
    const context = await browser.newContext({ javaScriptEnabled: false, offline: true });
    try {
      // SSRF guard: every network request is aborted; the HTML is self-contained (ADR-026 A10).
      await context.route('**/*', (route) => route.abort());
      const page = await context.newPage();
      await page.setContent(html, { waitUntil: 'load', timeout: 8000 });
      return new Uint8Array(await page.pdf({ format: 'A4', printBackground: true, margin: { top: '16mm', bottom: '16mm', left: '14mm', right: '14mm' } }));
    } finally {
      await context.close();
    }
  }
  async close(): Promise<void> {
    if (this.browser) await (await this.browser).close();
    this.browser = null;
  }
}

/** Deterministic stand-in used by tests so they do not need a browser. Output is clearly not a real PDF render. */
export class StubPdfRenderer implements PdfRenderer {
  async render(html: string): Promise<Uint8Array> {
    return new TextEncoder().encode(`%PDF-1.4\n% test stub\n${sha256Hex(html)}\n%%EOF`);
  }
  async close(): Promise<void> {}
}

interface FakeEnvelope extends EnvelopeStatus {
  order: 'sequential' | 'parallel';
  documentSha256: string;
  documentKey: string;
  signerInfo: Record<string, { name: string; email: string; order: number }>;
}

/**
 * E-signature SIMULATOR. It reproduces the provider contract (envelopes, ordered signers, HMAC-signed
 * webhooks, authoritative status, completion artefacts) so the whole signing chain can be built and tested.
 * It does NOT produce legally valid signatures and must be replaced by a real provider (OD-02/OD-03).
 */
export class FakeESignProvider implements ESignatureProvider {
  readonly name = 'fake';
  private readonly storage: ObjectStorage;
  private readonly secret: string;
  constructor(storage: ObjectStorage, webhookSecret: string) {
    this.storage = storage;
    this.secret = webhookSecret;
  }
  private key = (id: string) => `esign-fake/${id}.json`;
  private async load(id: string): Promise<FakeEnvelope> {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('Unknown envelope');
    return JSON.parse(new TextDecoder().decode(await this.storage.get(this.key(id)))) as FakeEnvelope;
  }
  private save = (e: FakeEnvelope) =>
    this.storage.put(this.key(e.envelopeId), new TextEncoder().encode(JSON.stringify(e)), { contentType: 'application/json' });

  async createEnvelope(input: Parameters<ESignatureProvider['createEnvelope']>[0]): Promise<{ envelopeId: string }> {
    const envelopeId = `env_${randomToken(12)}`;
    const documentKey = `esign-fake/${envelopeId}.pdf`;
    await this.storage.put(documentKey, input.document, { contentType: 'application/pdf' });
    const first = Math.min(...input.signers.map((s) => s.order));
    await this.save({
      envelopeId,
      status: 'sent',
      order: input.order,
      documentSha256: input.documentSha256,
      documentKey,
      signers: input.signers.map((s) => ({ key: s.key, status: input.order === 'parallel' || s.order === first ? 'sent' : 'waiting' })),
      signerInfo: Object.fromEntries(input.signers.map((s) => [s.key, { name: s.name, email: s.email, order: s.order }])),
    });
    return { envelopeId };
  }
  async getEnvelope(envelopeId: string): Promise<EnvelopeStatus> {
    const { envelopeId: id, status, signers } = await this.load(envelopeId);
    return { envelopeId: id, status, signers };
  }
  async voidEnvelope(envelopeId: string): Promise<void> {
    const e = await this.load(envelopeId);
    if (e.status === 'sent' || e.status === 'viewed') await this.save({ ...e, status: 'voided' });
  }
  async remind(): Promise<void> {}
  async downloadCompleted(envelopeId: string): Promise<{ signedPdf: Uint8Array; certificate: Uint8Array }> {
    const e = await this.load(envelopeId);
    if (e.status !== 'completed') throw new Error('Envelope is not completed');
    const lines = ['SIMULATED COMPLETION CERTIFICATE — NOT LEGALLY VALID', `Envelope: ${e.envelopeId}`, `Document SHA-256: ${e.documentSha256}`];
    for (const s of e.signers)
      lines.push(`${e.signerInfo[s.key]?.name} <${e.signerInfo[s.key]?.email}> consent ${s.consentAt} signed ${s.signedAt} ip ${s.ip}`);
    return { signedPdf: await this.storage.get(e.documentKey), certificate: new TextEncoder().encode(lines.join('\n')) };
  }
  sign(body: string): string {
    return createHmac('sha256', this.secret).update(body).digest('hex');
  }
  verifyWebhook(rawBody: string, signatureHeader: string | undefined) {
    const expected = Buffer.from(this.sign(rawBody));
    const given = Buffer.from(signatureHeader ?? '');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return { valid: false };
    const parsed = JSON.parse(rawBody) as { eventId: string; envelopeId: string };
    return { valid: true, eventId: parsed.eventId, envelopeId: parsed.envelopeId };
  }
  /** Simulator-only: a signer acts. Returns the webhook the "provider" would send (body + signature). */
  async simulateSignerAction(envelopeId: string, signerKey: string, action: 'sign' | 'decline', reason?: string): Promise<{ body: string; signature: string }> {
    const e = await this.load(envelopeId);
    const signer = e.signers.find((s) => s.key === signerKey);
    // The provider keeps accepting actions until IT processes a void — this is how late completions happen (ADR-025).
    if (!signer || signer.status === 'signed' || signer.status === 'declined' || e.status === 'completed' || e.status === 'declined' || e.status === 'voided')
      throw new Error('Signer cannot act');
    if (signer.status === 'waiting') throw new Error('Not this signer’s turn');
    const now = new Date().toISOString();
    if (action === 'decline') {
      signer.status = 'declined';
      signer.declineReason = reason ?? 'No reason given';
      e.status = 'declined';
    } else {
      Object.assign(signer, { status: 'signed', signedAt: now, consentAt: now, ip: '203.0.113.10' });
      const waiting = e.signers.filter((s) => s.status === 'waiting').sort((a, b) => (e.signerInfo[a.key]?.order ?? 0) - (e.signerInfo[b.key]?.order ?? 0));
      if (waiting[0]) waiting[0].status = 'sent';
      if (e.signers.every((s) => s.status === 'signed')) e.status = 'completed';
    }
    await this.save(e);
    const body = JSON.stringify({ eventId: `evt_${randomToken(10)}`, envelopeId, type: action });
    return { body, signature: this.sign(body) };
  }
}

export class LogEmail implements TransactionalEmail {
  readonly sent: { to: string; subject: string }[] = [];
  private readonly logger: Logger;
  constructor(logger: Logger) {
    this.logger = logger;
  }
  async send(msg: { to: string; subject: string; text: string }): Promise<void> {
    this.sent.push({ to: msg.to, subject: msg.subject });
    this.logger.info({ emailTo: '[redacted]', subject: msg.subject }, 'email not sent (TXEMAIL_PROVIDER=log)');
  }
}

export const storageKeys = {
  proposalPdf: (versionId: string) => join('proposals', `${versionId}.pdf`).replaceAll('\\', '/'),
  proposalDocx: (versionId: string) => join('proposals', `${versionId}.docx`).replaceAll('\\', '/'),
  signedPdf: (requestId: string) => `signed/${requestId}.pdf`,
  certificate: (requestId: string) => `signed/${requestId}.certificate.txt`,
};
