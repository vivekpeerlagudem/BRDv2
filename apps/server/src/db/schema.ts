/**
 * Drizzle schema — implements docs/03-tld/DATABASE-DESIGN.md (table/column names follow that document).
 * Deviations are listed in ARCHITECTURE-DECISIONS.md (implementation register) at the repository root.
 * Triggers, partial unique indexes that need raw SQL and grants live in drizzle/9000_constraints.sql.
 */
import { sql } from 'drizzle-orm';
import { boolean, char, date, index, integer, jsonb, numeric, pgTable, primaryKey, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

const id = () => uuid('id').primaryKey().default(sql`uuidv7()`);
const ts = (name: string) => timestamp(name, { withTimezone: true });
const audit = {
  createdAt: ts('created_at').notNull().defaultNow(),
  createdBy: uuid('created_by'),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: uuid('updated_by'),
  rowVersion: integer('row_version').notNull().default(1),
};
const money = (name: string) => numeric(name, { precision: 18, scale: 2 });

// ───────────────────────── identity (Better Auth owns auth_* tables, ADR-006) ─────────────────────────
export const authUser = pgTable('auth_user', {
  id: uuid('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const authSession = pgTable('auth_session', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => authUser.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: ts('expires_at').notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const authAccount = pgTable('auth_account', {
  id: uuid('id').primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => authUser.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: ts('access_token_expires_at'),
  refreshTokenExpiresAt: ts('refresh_token_expires_at'),
  scope: text('scope'),
  password: text('password'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});
export const authVerification = pgTable('auth_verification', {
  id: uuid('id').primaryKey(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const organizationSettings = pgTable('organization_settings', {
  id: integer('id').primaryKey().default(1),
  organizationName: text('organization_name').notNull(),
  defaultCurrency: char('default_currency', { length: 3 }).notNull(),
  timeZone: text('time_zone').notNull(),
  locale: text('locale').notNull().default('en-US'),
  branding: jsonb('branding').$type<{ primaryColor: string; footerText: string }>().notNull(),
  salespersonCrossVisibility: jsonb('salesperson_cross_visibility')
    .$type<{ companies: 'none' | 'view_only'; contacts: 'none' | 'view_only'; deals: 'none' | 'view_only' }>()
    .notNull(),
  aiSettings: jsonb('ai_settings').$type<AiSettings>().notNull(),
  proposalDefaults: jsonb('proposal_defaults').$type<{ defaultTermMonths: number; defaultValidityDays: number }>().notNull(),
  automationSettings: jsonb('automation_settings').$type<{ followUpAfterDays: number; aut001Enabled: boolean; aut002Enabled: boolean }>().notNull(),
  defaultLeadOwnerId: uuid('default_lead_owner_id'),
  freeMailDomains: text('free_mail_domains').array().notNull(),
  privacyNoticeText: text('privacy_notice_text').notNull(),
  leadFormKey: text('lead_form_key').notNull(),
  leadRoundRobinCursor: uuid('lead_round_robin_cursor'),
  ...audit,
});

export const appUserProfile = pgTable('app_user_profile', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => authUser.id),
  email: text('email').notNull(),
  normalizedEmail: text('normalized_email').notNull().unique(),
  fullName: text('full_name').notNull(),
  role: text('role').$type<'admin' | 'sales_manager' | 'salesperson'>().notNull(),
  status: text('status').$type<'invited' | 'active' | 'deactivated'>().notNull(),
  canManageContent: boolean('can_manage_content').notNull().default(false),
  roundRobinEligible: boolean('round_robin_eligible').notNull().default(true),
  deactivatedAt: ts('deactivated_at'),
  ...audit,
});
export const team = pgTable('team', { id: id(), name: text('name').notNull(), archivedAt: ts('archived_at'), ...audit });
export const teamMembership = pgTable('team_membership', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => appUserProfile.userId),
  teamId: uuid('team_id')
    .notNull()
    .references(() => team.id),
  isActive: boolean('is_active').notNull().default(true),
});
export const teamManager = pgTable(
  'team_manager',
  {
    teamId: uuid('team_id')
      .notNull()
      .references(() => team.id),
    userId: uuid('user_id')
      .notNull()
      .references(() => appUserProfile.userId),
  },
  (t) => [primaryKey({ columns: [t.teamId, t.userId] })],
);

// ───────────────────────── crm ─────────────────────────
export const company = pgTable(
  'company',
  {
    id: id(),
    name: text('name').notNull(),
    normalizedName: text('normalized_name').notNull(),
    domain: text('domain'),
    normalizedDomain: text('normalized_domain'),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => appUserProfile.userId),
    industry: text('industry'),
    phone: text('phone'),
    website: text('website'),
    customFields: jsonb('custom_fields').$type<Record<string, unknown>>().notNull().default({}),
    archivedAt: ts('archived_at'),
    ...audit,
  },
  (t) => [
    uniqueIndex('company_domain_uq').on(t.normalizedDomain).where(sql`archived_at is null and normalized_domain is not null`),
    index('company_owner_idx').on(t.ownerId),
  ],
);
export const contact = pgTable(
  'contact',
  {
    id: id(),
    firstName: text('first_name'),
    lastName: text('last_name'),
    email: text('email'),
    normalizedEmail: text('normalized_email'),
    phone: text('phone'),
    jobTitle: text('job_title'),
    companyId: uuid('company_id').references(() => company.id),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => appUserProfile.userId),
    source: text('source').notNull().default('manual'),
    archivedAt: ts('archived_at'),
    ...audit,
  },
  (t) => [
    uniqueIndex('contact_email_uq').on(t.normalizedEmail).where(sql`archived_at is null and normalized_email is not null`),
    index('contact_company_idx').on(t.companyId),
    index('contact_owner_idx').on(t.ownerId),
  ],
);
export const pipeline = pgTable('pipeline', { id: id(), name: text('name').notNull(), isDefault: boolean('is_default').notNull().default(false), ...audit });
export const pipelineStage = pgTable(
  'pipeline_stage',
  {
    id: id(),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipeline.id),
    name: text('name').notNull(),
    kind: text('kind').$type<'open' | 'won' | 'lost'>().notNull(),
    sortOrder: integer('sort_order').notNull(),
    probability: numeric('probability', { precision: 7, scale: 4 }).notNull(),
    stallThresholdDays: integer('stall_threshold_days'),
    isProposalSentTarget: boolean('is_proposal_sent_target').notNull().default(false),
  },
  (t) => [uniqueIndex('stage_order_uq').on(t.pipelineId, t.sortOrder)],
);
export const lostReason = pgTable('lost_reason', { id: id(), name: text('name').notNull().unique() });
export const deal = pgTable(
  'deal',
  {
    id: id(),
    name: text('name').notNull(),
    companyId: uuid('company_id')
      .notNull()
      .references(() => company.id),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => appUserProfile.userId),
    pipelineId: uuid('pipeline_id')
      .notNull()
      .references(() => pipeline.id),
    stageId: uuid('stage_id')
      .notNull()
      .references(() => pipelineStage.id),
    status: text('status').$type<'open' | 'won' | 'lost'>().notNull().default('open'),
    amount: money('amount'),
    currency: char('currency', { length: 3 }).notNull(),
    amountSource: text('amount_source').notNull().default('manual'),
    closeDate: date('close_date'),
    closedAt: ts('closed_at'),
    lostReasonId: uuid('lost_reason_id').references(() => lostReason.id),
    lostReasonNote: text('lost_reason_note'),
    wonFromProposalId: uuid('won_from_proposal_id'),
    lastActivityAt: ts('last_activity_at'),
    stageEnteredAt: ts('stage_entered_at').notNull().defaultNow(),
    source: text('source').notNull().default('manual'),
    archivedAt: ts('archived_at'),
    ...audit,
  },
  (t) => [index('deal_owner_status_idx').on(t.ownerId, t.status), index('deal_company_idx').on(t.companyId), index('deal_stage_idx').on(t.stageId)],
);
export const dealContact = pgTable(
  'deal_contact',
  {
    id: id(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deal.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contact.id),
    roles: text('roles').array().notNull().default(sql`'{}'`),
    isPrimary: boolean('is_primary').notNull().default(false),
    addedVia: text('added_via').notNull().default('manual'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('deal_contact_uq').on(t.dealId, t.contactId)],
);
export const dealStageHistory = pgTable('deal_stage_history', {
  id: id(),
  dealId: uuid('deal_id')
    .notNull()
    .references(() => deal.id),
  fromStageId: uuid('from_stage_id'),
  toStageId: uuid('to_stage_id').notNull(),
  changedAt: ts('changed_at').notNull().defaultNow(),
  actorType: text('actor_type').notNull(),
  actorUserId: uuid('actor_user_id'),
  reason: text('reason'),
});
export const task = pgTable(
  'task',
  {
    id: id(),
    title: text('title').notNull(),
    description: text('description'),
    relatedType: text('related_type').$type<'company' | 'contact' | 'deal'>().notNull(),
    relatedId: uuid('related_id').notNull(),
    assigneeId: uuid('assignee_id')
      .notNull()
      .references(() => appUserProfile.userId),
    dueAt: ts('due_at').notNull(),
    status: text('status').$type<'open' | 'completed' | 'cancelled'>().notNull().default('open'),
    completedAt: ts('completed_at'),
    source: text('source').notNull().default('manual'),
    automationExecutionId: uuid('automation_execution_id'),
    reminderSentAt: ts('reminder_sent_at'),
    ...audit,
  },
  (t) => [index('task_assignee_idx').on(t.assigneeId, t.status), index('task_related_idx').on(t.relatedType, t.relatedId)],
);
export const note = pgTable('note', {
  id: id(),
  body: text('body').notNull(),
  relatedType: text('related_type').$type<'company' | 'contact' | 'deal'>().notNull(),
  relatedId: uuid('related_id').notNull(),
  authorId: uuid('author_id')
    .notNull()
    .references(() => appUserProfile.userId),
  ...audit,
});
export const activityLog = pgTable('activity_log', {
  id: id(),
  kind: text('kind').$type<'call' | 'meeting'>().notNull(),
  occurredAt: ts('occurred_at').notNull(),
  durationMinutes: integer('duration_minutes'),
  outcome: text('outcome'),
  notes: text('notes'),
  relatedType: text('related_type').$type<'company' | 'contact' | 'deal'>().notNull(),
  relatedId: uuid('related_id').notNull(),
  loggedBy: uuid('logged_by')
    .notNull()
    .references(() => appUserProfile.userId),
  createdAt: ts('created_at').notNull().defaultNow(),
});
export const leadSubmission = pgTable('lead_form_submission', {
  id: id(),
  receivedAt: ts('received_at').notNull().defaultNow(),
  payload: jsonb('payload').$type<Record<string, string>>().notNull(),
  spamVerdict: text('spam_verdict').notNull(),
  processingStatus: text('processing_status').notNull(),
  contactId: uuid('contact_id'),
  companyId: uuid('company_id'),
  dealId: uuid('deal_id'),
  assignedUserId: uuid('assigned_user_id'),
});

// ───────────────────────── catalog & templates ─────────────────────────
export const product = pgTable('product', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  sku: text('sku'),
  unit: text('unit').notNull(),
  unitPrice: numeric('unit_price', { precision: 18, scale: 4 }).notNull(),
  taxRatePercent: numeric('tax_rate_percent', { precision: 7, scale: 4 }).notNull().default('0'),
  billingType: text('billing_type').$type<'one_time' | 'recurring'>().notNull(),
  billingPeriod: text('billing_period').$type<'month' | 'quarter' | 'year'>(),
  archivedAt: ts('archived_at'),
  ...audit,
});
export const proposalTemplate = pgTable('proposal_template', {
  id: id(),
  name: text('name').notNull(),
  description: text('description'),
  currentPublishedVersionId: uuid('current_published_version_id'),
  archivedAt: ts('archived_at'),
  ...audit,
});
export const templateVersion = pgTable(
  'template_version',
  {
    id: id(),
    templateId: uuid('template_id')
      .notNull()
      .references(() => proposalTemplate.id),
    versionNumber: integer('version_number').notNull(),
    state: text('state').$type<'draft' | 'published' | 'retired'>().notNull(),
    schemaVersion: integer('schema_version').notNull(),
    content: jsonb('content').notNull(),
    publishedAt: ts('published_at'),
    ...audit,
  },
  (t) => [uniqueIndex('template_version_uq').on(t.templateId, t.versionNumber), uniqueIndex('template_one_draft').on(t.templateId).where(sql`state = 'draft'`)],
);

// ───────────────────────── proposals ─────────────────────────
export const proposal = pgTable(
  'proposal',
  {
    id: id(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deal.id),
    title: text('title').notNull(),
    templateVersionId: uuid('template_version_id')
      .notNull()
      .references(() => templateVersion.id),
    currency: char('currency', { length: 3 }).notNull(),
    status: text('status').$type<'draft' | 'sent' | 'viewed' | 'accepted' | 'signed' | 'declined' | 'expired' | 'void'>().notNull().default('draft'),
    currentVersionId: uuid('current_version_id'),
    lastSentVersionId: uuid('last_sent_version_id'),
    validUntil: date('valid_until'),
    signatureRequired: boolean('signature_required').notNull().default(true),
    voidReason: text('void_reason'),
    voidKind: text('void_kind'),
    statusBeforeVoid: text('status_before_void'),
    declineReason: text('decline_reason'),
    /** Source currency of a copied proposal whose prices still need review (RULE-PRP-14); null = no review pending. */
    currencyReviewFrom: char('currency_review_from', { length: 3 }),
    ...audit,
  },
  (t) => [index('proposal_deal_idx').on(t.dealId)],
);
export const proposalVersion = pgTable(
  'proposal_version',
  {
    id: id(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposal.id),
    versionNumber: integer('version_number').notNull(),
    state: text('state').$type<'draft' | 'sent' | 'superseded' | 'signed'>().notNull().default('draft'),
    schemaVersion: integer('schema_version').notNull(),
    content: jsonb('content').notNull(),
    pricing: jsonb('pricing').notNull(),
    termMonths: integer('term_months').notNull(),
    totals: jsonb('totals').notNull(),
    missingPlaceholders: jsonb('missing_placeholders').$type<string[]>().notNull().default([]),
    sentAt: ts('sent_at'),
    sentBy: uuid('sent_by'),
    frozenSnapshot: jsonb('frozen_snapshot'),
    snapshotSha256: char('snapshot_sha256', { length: 64 }),
    pdfFileId: uuid('pdf_file_id'),
    pdfSha256: char('pdf_sha256', { length: 64 }),
    docxFileId: uuid('docx_file_id'),
    ...audit,
  },
  (t) => [uniqueIndex('pv_number_uq').on(t.proposalId, t.versionNumber), uniqueIndex('pv_one_draft').on(t.proposalId).where(sql`state = 'draft'`)],
);

// ───────────────────────── sharing ─────────────────────────
export const shareLink = pgTable(
  'share_link',
  {
    id: id(),
    proposalVersionId: uuid('proposal_version_id')
      .notNull()
      .references(() => proposalVersion.id),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposal.id),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deal.id),
    contactId: uuid('contact_id')
      .notNull()
      .references(() => contact.id),
    recipientName: text('recipient_name').notNull(),
    recipientEmail: text('recipient_email').notNull(),
    tokenHash: char('token_hash', { length: 64 }).notNull().unique(),
    tokenCiphertext: text('token_ciphertext').notNull(),
    status: text('status').$type<'active' | 'revoked' | 'expired'>().notNull().default('active'),
    expiresAt: ts('expires_at'),
    revokedAt: ts('revoked_at'),
    firstViewedAt: ts('first_viewed_at'),
    lastViewedAt: ts('last_viewed_at'),
    ...audit,
  },
  (t) => [index('share_link_version_idx').on(t.proposalVersionId)],
);
export const buyerSession = pgTable('buyer_session', {
  id: id(),
  sessionHash: char('session_hash', { length: 64 }).notNull().unique(),
  shareLinkId: uuid('share_link_id')
    .notNull()
    .references(() => shareLink.id),
  viewerIdentityId: uuid('viewer_identity_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
});
export const viewerIdentity = pgTable(
  'viewer_identity',
  {
    id: id(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLink.id),
    name: text('name').notNull(),
    normalizedEmail: text('normalized_email').notNull(),
    isOriginalRecipient: boolean('is_original_recipient').notNull(),
    contactId: uuid('contact_id'),
    firstSeenAt: ts('first_seen_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('viewer_identity_uq').on(t.shareLinkId, t.normalizedEmail)],
);
export const viewSession = pgTable(
  'view_session',
  {
    id: id(),
    shareLinkId: uuid('share_link_id')
      .notNull()
      .references(() => shareLink.id),
    dealId: uuid('deal_id').notNull(),
    viewerIdentityId: uuid('viewer_identity_id').notNull(),
    startedAt: ts('started_at').notNull().defaultNow(),
    lastHeartbeatAt: ts('last_heartbeat_at'),
    activeSeconds: integer('active_seconds').notNull().default(0),
    counted: boolean('counted').notNull().default(false),
    isReopen: boolean('is_reopen').notNull().default(false),
    sectionSeconds: jsonb('section_seconds').$type<Record<string, number>>().notNull().default({}),
  },
  (t) => [index('view_session_link_idx').on(t.shareLinkId)],
);
export const downloadEvent = pgTable('download_event', {
  id: id(),
  shareLinkId: uuid('share_link_id')
    .notNull()
    .references(() => shareLink.id),
  viewerIdentityId: uuid('viewer_identity_id').notNull(),
  format: text('format').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
});
export const buyerResponse = pgTable('buyer_response', {
  id: id(),
  proposalVersionId: uuid('proposal_version_id')
    .notNull()
    .unique()
    .references(() => proposalVersion.id),
  shareLinkId: uuid('share_link_id').notNull(),
  viewerIdentityId: uuid('viewer_identity_id').notNull(),
  response: text('response').$type<'accept' | 'decline'>().notNull(),
  reason: text('reason'),
  evidence: jsonb('evidence').notNull(),
  respondedAt: ts('responded_at').notNull().defaultNow(),
});

// ───────────────────────── e-signature ─────────────────────────
export const signatureRequest = pgTable(
  'signature_request',
  {
    id: id(),
    proposalId: uuid('proposal_id')
      .notNull()
      .references(() => proposal.id),
    proposalVersionId: uuid('proposal_version_id')
      .notNull()
      .references(() => proposalVersion.id),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deal.id),
    requestedBy: uuid('requested_by').notNull(),
    provider: text('provider').notNull(),
    providerEnvelopeId: text('provider_envelope_id'),
    signingOrder: text('signing_order').$type<'sequential' | 'parallel'>().notNull(),
    status: text('status').$type<'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired' | 'voided'>().notNull().default('pending'),
    documentSha256: char('document_sha256', { length: 64 }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    voidReason: text('void_reason'),
    declineReason: text('decline_reason'),
    completedAt: ts('completed_at'),
    staleCompletion: boolean('stale_completion').notNull().default(false),
    ...audit,
  },
  (t) => [uniqueIndex('sr_one_open_per_deal').on(t.dealId).where(sql`status in ('pending','sent','viewed')`)],
);
export const signer = pgTable('signer', {
  id: id(),
  signatureRequestId: uuid('signature_request_id')
    .notNull()
    .references(() => signatureRequest.id),
  contactId: uuid('contact_id')
    .notNull()
    .references(() => contact.id),
  name: text('name').notNull(),
  email: text('email').notNull(),
  signOrder: integer('sign_order').notNull(),
  status: text('status').$type<'waiting' | 'sent' | 'viewed' | 'signed' | 'declined' | 'cancelled'>().notNull(),
  consentCapturedAt: ts('consent_captured_at'),
  signedAt: ts('signed_at'),
  ipAddress: text('ip_address'),
});
export const signatureEvent = pgTable('signature_event', {
  id: id(),
  signatureRequestId: uuid('signature_request_id')
    .notNull()
    .references(() => signatureRequest.id),
  signerId: uuid('signer_id'),
  type: text('type').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  providerEventId: text('provider_event_id').unique(),
  source: text('source').notNull(),
});
export const signedDocument = pgTable('signed_document', {
  id: id(),
  signatureRequestId: uuid('signature_request_id')
    .notNull()
    .unique()
    .references(() => signatureRequest.id),
  signedPdfFileId: uuid('signed_pdf_file_id').notNull(),
  signedPdfSha256: char('signed_pdf_sha256', { length: 64 }).notNull(),
  certificateFileId: uuid('certificate_file_id').notNull(),
  certificateSha256: char('certificate_sha256', { length: 64 }).notNull(),
  sourceDocumentSha256: char('source_document_sha256', { length: 64 }).notNull(),
  sealedAt: ts('sealed_at').notNull(),
});
export const esignWebhookInbox = pgTable(
  'esign_webhook_inbox',
  {
    id: id(),
    provider: text('provider').notNull(),
    providerEventId: text('provider_event_id').notNull(),
    receivedAt: ts('received_at').notNull().defaultNow(),
    rawBody: text('raw_body').notNull(),
    status: text('status').notNull().default('received'),
  },
  (t) => [uniqueIndex('esign_inbox_uq').on(t.provider, t.providerEventId)],
);

// ───────────────────────── ai ─────────────────────────
/** Organization AI settings (BR-AIA-008). Older rows hold only {enabled, perUserDailyCalls}; code fills the rest with defaults. */
export type AiFeature = 'draft_section' | 'presend_review' | 'deal_summary' | 'rewrite_text' | 'follow_up_email';
export interface AiSettings {
  enabled: boolean;
  perUserDailyCalls: number;
  features?: Partial<Record<AiFeature, boolean>>;
  monthlyBudgetUsd?: number;
}

/** One AI output awaiting (or after) a human decision. Nothing here is live content until a user accepts it (BR-AIA-007). */
export const aiGeneration = pgTable('ai_generation', {
  id: id(),
  feature: text('feature').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  dealId: uuid('deal_id'),
  target: jsonb('target').notNull(),
  promptVersion: text('prompt_version').notNull(),
  output: jsonb('output'),
  status: text('status').$type<'pending' | 'accepted' | 'edited_accepted' | 'rejected' | 'failed' | 'discarded'>().notNull(),
  decidedAt: ts('decided_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  // Provenance (added in 0002): which provider/model produced it and which CRM records were given as context (ids only).
  provider: text('provider'),
  model: text('model'),
  simulated: boolean('simulated').notNull().default(false),
  requestId: uuid('request_id'),
  contextRefs: jsonb('context_refs').$type<{ type: string; id: string }[]>(),
  acceptedOutput: jsonb('accepted_output'),
  decidedBy: uuid('decided_by'),
});
/** One row per provider call attempt group — metadata only, never prompts or outputs. Append-only for the app role. */
export const aiUsage = pgTable('ai_usage', {
  id: id(),
  feature: text('feature').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  userId: uuid('user_id'),
  inputTokens: integer('input_tokens').notNull().default(0),
  outputTokens: integer('output_tokens').notNull().default(0),
  outcome: text('outcome').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  requestId: uuid('request_id'),
  correlationId: text('correlation_id'),
  providerRequestId: text('provider_request_id'),
  dealId: uuid('deal_id'),
  promptVersion: text('prompt_version'),
  latencyMs: integer('latency_ms'),
  attempts: integer('attempts').notNull().default(1),
  cacheReadTokens: integer('cache_read_tokens').notNull().default(0),
  cacheWriteTokens: integer('cache_write_tokens').notNull().default(0),
  /** Estimated cost in millionths of a US dollar; null when the model has no price entry. */
  costMicroUsd: integer('cost_micro_usd'),
  errorCode: text('error_code'),
  simulated: boolean('simulated').notNull().default(false),
});
/** Result of an AI-assisted pre-send review (BR-AIA-002): rule findings + validated AI findings, each with a user decision. */
export const aiReview = pgTable('ai_review', {
  id: id(),
  proposalId: uuid('proposal_id').notNull(),
  proposalVersionId: uuid('proposal_version_id').notNull(),
  versionRowVersion: integer('version_row_version').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  aiStatus: text('ai_status').$type<'completed' | 'disabled' | 'failed'>().notNull(),
  findings: jsonb('findings').notNull(),
  requestId: uuid('request_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ───────────────────────── notifications & automation ─────────────────────────
export const notification = pgTable(
  'notification',
  {
    id: id(),
    seq: integer('seq').generatedAlwaysAsIdentity(),
    recipientUserId: uuid('recipient_user_id')
      .notNull()
      .references(() => appUserProfile.userId),
    eventType: text('event_type').notNull(),
    dealId: uuid('deal_id'),
    title: text('title').notNull(),
    body: text('body').notNull(),
    linkPath: text('link_path').notNull(),
    dedupeKey: text('dedupe_key').notNull().unique(),
    emailStatus: text('email_status').notNull().default('not_sent'),
    readAt: ts('read_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('notification_user_idx').on(t.recipientUserId, t.seq)],
);
export const automationExecution = pgTable('automation_execution', {
  id: id(),
  ruleKey: text('rule_key').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  targetType: text('target_type').notNull(),
  targetId: uuid('target_id').notNull(),
  status: text('status').$type<'applied' | 'skipped_precondition' | 'failed' | 'reversed'>().notNull(),
  skipReason: text('skip_reason'),
  beforeSnapshot: jsonb('before_snapshot'),
  afterSnapshot: jsonb('after_snapshot'),
  relatedChanges: jsonb('related_changes').$type<{ proposalId: string; priorStatus: string }[]>().notNull().default([]),
  createdTaskId: uuid('created_task_id'),
  executedAt: ts('executed_at').notNull().defaultNow(),
  reversedAt: ts('reversed_at'),
  reversedBy: uuid('reversed_by'),
});
export const dealFlag = pgTable(
  'deal_flag',
  {
    id: id(),
    dealId: uuid('deal_id')
      .notNull()
      .references(() => deal.id),
    kind: text('kind').$type<'stalled' | 'past_close_date' | 'signed_on_stale_version'>().notNull(),
    raisedAt: ts('raised_at').notNull().defaultNow(),
    clearedAt: ts('cleared_at'),
  },
  (t) => [uniqueIndex('deal_flag_one_open').on(t.dealId, t.kind).where(sql`cleared_at is null`)],
);

// ───────────────────────── timeline & platform ─────────────────────────
export const timelineEvent = pgTable('timeline_event', {
  id: id(),
  eventType: text('event_type').notNull(),
  sourceType: text('source_type').notNull(),
  sourceId: uuid('source_id').notNull(),
  actorType: text('actor_type').$type<'user' | 'buyer' | 'system' | 'ai'>().notNull(),
  actorName: text('actor_name').notNull(),
  occurredAt: ts('occurred_at').notNull().defaultNow(),
  summary: text('summary').notNull(),
  isAutomated: boolean('is_automated').notNull().default(false),
  automationExecutionId: uuid('automation_execution_id'),
});
export const timelineEventAnchor = pgTable(
  'timeline_event_anchor',
  {
    timelineEventId: uuid('timeline_event_id')
      .notNull()
      .references(() => timelineEvent.id, { onDelete: 'cascade' }),
    recordType: text('record_type').notNull(),
    recordId: uuid('record_id').notNull(),
    occurredAt: ts('occurred_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.recordType, t.recordId, t.occurredAt, t.timelineEventId] })],
);
export const auditLog = pgTable(
  'audit_log',
  {
    id: id(),
    seq: integer('seq').generatedAlwaysAsIdentity(),
    occurredAt: ts('occurred_at').notNull().defaultNow(),
    actorType: text('actor_type').notNull(),
    actorUserId: uuid('actor_user_id'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: uuid('target_id'),
    changes: jsonb('changes'),
    requestId: text('request_id'),
    outcome: text('outcome').notNull().default('success'),
  },
  (t) => [index('audit_target_idx').on(t.targetType, t.targetId)],
);
export const fileObject = pgTable('file_object', {
  id: id(),
  storageKey: text('storage_key').notNull().unique(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  sha256: char('sha256', { length: 64 }).notNull(),
  purpose: text('purpose').notNull(),
  immutable: boolean('immutable').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});
/** ADR-022 documented fallback: transactional outbox drained by the worker. */
export const jobOutbox = pgTable(
  'job_outbox',
  {
    id: id(),
    queue: text('queue').notNull(),
    payload: jsonb('payload').notNull(),
    runAfter: ts('run_after').notNull().defaultNow(),
    status: text('status').$type<'pending' | 'done' | 'failed'>().notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('job_outbox_pending_idx').on(t.status, t.runAfter)],
);
export const rateLimitBucket = pgTable(
  'rate_limit_bucket',
  { bucketKey: text('bucket_key').notNull(), windowStart: ts('window_start').notNull(), count: integer('count').notNull() },
  (t) => [primaryKey({ columns: [t.bucketKey, t.windowStart] })],
);
