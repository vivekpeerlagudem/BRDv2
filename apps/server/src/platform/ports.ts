/**
 * Ports for everything outside the process (ADR-012). Business modules depend on these interfaces only.
 * Drivers: see adapters.ts. Real third-party drivers are added behind the same ports once the open
 * decisions are made (OD-03 e-signature, OD-05 AI, OD-11 storage, OD-14 email).
 */
export interface ObjectStorage {
  put(key: string, body: Uint8Array, opts: { contentType: string; immutable?: boolean }): Promise<void>;
  get(key: string): Promise<Uint8Array>;
}

export interface PdfRenderer {
  /** Renders trusted, self-contained HTML to PDF with all network access blocked (ADR-026, ADR-045). */
  render(html: string): Promise<Uint8Array>;
  close(): Promise<void>;
}

export interface EnvelopeSigner {
  key: string; // our signer id
  name: string;
  email: string;
  order: number;
}
export interface EnvelopeStatus {
  envelopeId: string;
  status: 'sent' | 'viewed' | 'completed' | 'declined' | 'voided' | 'expired';
  signers: {
    key: string;
    status: 'waiting' | 'sent' | 'viewed' | 'signed' | 'declined';
    signedAt?: string;
    consentAt?: string;
    ip?: string;
    declineReason?: string;
  }[];
}
export interface ESignatureProvider {
  readonly name: string;
  createEnvelope(input: {
    title: string;
    document: Uint8Array;
    documentSha256: string;
    signers: EnvelopeSigner[];
    order: 'sequential' | 'parallel';
    metadata: Record<string, string>;
  }): Promise<{ envelopeId: string }>;
  /** Authoritative status — webhook payloads are only a hint (ADR-025). */
  getEnvelope(envelopeId: string): Promise<EnvelopeStatus>;
  voidEnvelope(envelopeId: string, reason: string): Promise<void>;
  remind(envelopeId: string): Promise<void>;
  downloadCompleted(envelopeId: string): Promise<{ signedPdf: Uint8Array; certificate: Uint8Array }>;
  verifyWebhook(rawBody: string, signatureHeader: string | undefined): { valid: boolean; eventId?: string; envelopeId?: string };
}

// ───────────────────────── AI provider port (ADR-014: provider-switchable, no tools, no side effects) ─────────────────────────
export type AiFeature = 'draft_section' | 'presend_review' | 'deal_summary' | 'rewrite_text' | 'follow_up_email' | 'weekly_report';

/** One structured-output completion. The provider receives text only: it has no tools and cannot act on anything. */
export interface AiRequest {
  /** Our id for this logical request; the same id is stored on ai_usage and ai_generation. */
  requestId: string;
  /** HTTP request id of the API call that triggered this, for tracing across logs. */
  correlationId?: string;
  feature: AiFeature;
  model: string;
  effort: 'low' | 'medium' | 'high';
  maxTokens: number;
  timeoutMs: number;
  system: string;
  user: string;
  /** JSON Schema the answer must follow; providers that support constrained output enforce it. */
  jsonSchema: Record<string, unknown>;
  /** Opaque, non-reversible user reference for provider-side abuse monitoring. Never an email or name. */
  userRef: string;
}
export interface AiResult {
  /** Raw model text (expected to be a JSON document); validated by the caller, never trusted as-is. */
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  providerRequestId?: string;
}
export type AiErrorKind = 'rate_limited' | 'overloaded' | 'server_error' | 'timeout' | 'network' | 'auth' | 'bad_request' | 'refused' | 'truncated';
/** The only error a provider may throw. `retryable` tells the caller whether one more attempt is reasonable. */
export class AiProviderError extends Error {
  readonly kind: AiErrorKind;
  readonly retryable: boolean;
  readonly status?: number;
  readonly retryAfterMs?: number;
  readonly providerRequestId?: string;
  constructor(kind: AiErrorKind, message: string, opts: { status?: number; retryAfterMs?: number; providerRequestId?: string } = {}) {
    super(message);
    this.name = 'AiProviderError';
    this.kind = kind;
    this.retryable = kind === 'rate_limited' || kind === 'overloaded' || kind === 'server_error' || kind === 'timeout' || kind === 'network';
    if (opts.status !== undefined) this.status = opts.status;
    if (opts.retryAfterMs !== undefined) this.retryAfterMs = opts.retryAfterMs;
    if (opts.providerRequestId !== undefined) this.providerRequestId = opts.providerRequestId;
  }
}
export interface AiProviderStatus {
  provider: string;
  /** True when answers come from the built-in deterministic mock rather than a real model. */
  simulated: boolean;
  /** True when the provider has what it needs to be called (for a real provider: a credential is present). */
  configured: boolean;
  detail: string;
}
export interface AiProvider {
  readonly name: string;
  readonly simulated: boolean;
  complete(req: AiRequest): Promise<AiResult>;
  /** Configuration status only — never makes a (billable) call. */
  status(): AiProviderStatus;
}

export interface TransactionalEmail {
  send(msg: { to: string; subject: string; text: string }): Promise<void>;
}
