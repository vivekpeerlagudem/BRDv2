import { z } from 'zod';
import { pricingSchema } from './pricing.ts';
import { roleSchema } from './roles.ts';

/** API request contracts (API-SPECIFICATION.md). The same schemas validate on the client and the server. */
const uuid = z.uuid();
const name = z.string().trim().min(1).max(255);
const optionalText = (max: number) => z.string().trim().max(max).optional();
const email = z.email().max(254);
const moneyString = z.string().regex(/^\d{1,16}(\.\d{1,2})?$/, 'must be an amount like 1234.50');
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const relatedType = z.enum(['company', 'contact', 'deal']);

export const pageQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  offset: z.coerce.number().int().min(0).default(0),
  ownerId: uuid.optional(),
});

export const companyInput = z.object({
  name,
  domain: optionalText(253),
  industry: optionalText(120),
  phone: optionalText(32),
  website: optionalText(2048),
});
const contactFields = z.object({
  firstName: optionalText(120),
  lastName: optionalText(120),
  email: email.optional(),
  phone: optionalText(32),
  jobTitle: optionalText(120),
  companyId: uuid.nullable().optional(),
});
const contactHasIdentity = (c: { firstName?: string; lastName?: string; email?: string }) => Boolean(c.firstName || c.lastName || c.email);
export const contactInput = contactFields.refine(contactHasIdentity, { message: 'Provide a name or an email', path: ['firstName'] });
/**
 * Creating a person: link an existing company (`companyId`) OR create one in the same step (`newCompany`),
 * so the company details are entered once and the person is always linked to it.
 */
export const contactCreateInput = contactFields
  .extend({
    newCompany: z.object({ name, domain: optionalText(253), industry: optionalText(120) }).optional(),
  })
  .refine(contactHasIdentity, { message: 'Provide a name or an email', path: ['firstName'] })
  .refine((c) => !(c.companyId && c.newCompany), { message: 'Choose an existing company or enter a new one, not both', path: ['newCompany'] });
export const dealInput = z.object({
  name,
  companyId: uuid,
  stageId: uuid.optional(),
  amount: moneyString.optional(),
  closeDate: isoDate.optional(),
  contactIds: z.array(uuid).max(50).optional(),
});
export const dealPatch = z.object({
  name: name.optional(),
  amount: moneyString.nullable().optional(),
  closeDate: isoDate.nullable().optional(),
  rowVersion: z.number().int(),
});
export const stageMoveInput = z.object({ stageId: uuid, rowVersion: z.number().int() });
export const closeLostInput = z.object({ lostReasonId: uuid, note: optionalText(2000), confirm: z.array(z.string()).optional() });
export const closeWonInput = z.object({ amount: moneyString.optional() });
export const reopenInput = z.object({ reason: z.string().trim().min(1).max(2000), stageId: uuid });
export const ownerInput = z.object({ ownerId: uuid });

// ── Managed leads (BR-LED) ──
export const leadStatus = z.enum(['new', 'working', 'qualified', 'unqualified', 'converted']);
export const leadInput = z.object({
  name,
  companyName: optionalText(200),
  email: email.optional(),
  phone: optionalText(32),
  jobTitle: optionalText(120),
  source: optionalText(80),
  notes: optionalText(5000),
  ownerId: uuid.optional(),
  confirm: z.array(z.string()).optional(),
});
export const leadPatch = z.object({
  name: name.optional(),
  companyName: optionalText(200),
  email: email.optional(),
  phone: optionalText(32),
  jobTitle: optionalText(120),
  source: optionalText(80),
  notes: optionalText(5000),
  status: z.enum(['new', 'working']).optional(), // only non-terminal transitions here; use qualify/disqualify/convert for the rest
  rowVersion: z.number().int().optional(),
});
export const leadAssignInput = z.object({ ownerId: uuid });
export const leadDisqualifyInput = z.object({ reason: z.string().trim().min(1).max(500) });
export const leadConvertInput = z.object({
  companyId: uuid.optional(),
  createDeal: z.boolean().optional(),
  dealName: optionalText(255),
  amount: moneyString.optional(),
  confirm: z.array(z.string()).optional(),
});
export const dealContactInput = z.object({ contactId: uuid, roles: z.array(z.string().max(40)).max(5).default([]), isPrimary: z.boolean().default(false) });

export const taskInput = z.object({
  title: name,
  description: optionalText(4000),
  relatedType,
  relatedId: uuid,
  assigneeId: uuid.optional(),
  dueAt: z.iso.datetime({ offset: true }),
});
export const noteInput = z.object({ body: z.string().trim().min(1).max(20000), relatedType, relatedId: uuid });
export const activityInput = z.object({
  kind: z.enum(['call', 'meeting']),
  occurredAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(0).max(1440).optional(),
  outcome: optionalText(255),
  notes: optionalText(20000),
  relatedType,
  relatedId: uuid,
});

export const sectionSchema = z.object({
  id: z.string().min(1).max(40),
  title: z.string().trim().min(1).max(200),
  locked: z.boolean(),
  required: z.boolean(),
  aiDraftable: z.boolean(),
  /** Plain text with `{{namespace.field}}` placeholders; blank lines separate paragraphs. */
  body: z.string().max(50000),
  /** `pricing` renders the pricing table after the body; `signature` renders signature lines. */
  kind: z.enum(['text', 'pricing', 'signature']).default('text'),
});
export const documentSchema = z.object({ schemaVersion: z.literal(1), sections: z.array(sectionSchema).min(1).max(200) });
export type Section = z.infer<typeof sectionSchema>;
export type ProposalDocument = z.infer<typeof documentSchema>;

export const templateInput = z.object({ name, description: optionalText(2000) });
export const templateDraftInput = z.object({ content: documentSchema });
export const productInput = z
  .object({
    name,
    description: optionalText(2000),
    sku: optionalText(64),
    unit: z.string().trim().min(1).max(40),
    unitPrice: z.string().regex(/^\d{1,14}(\.\d{1,4})?$/),
    taxRatePercent: z
      .string()
      .regex(/^\d{1,3}(\.\d{1,4})?$/)
      .default('0'),
    billingType: z.enum(['one_time', 'recurring']),
    billingPeriod: z.enum(['month', 'quarter', 'year']).optional(),
  })
  .refine((p) => (p.billingType === 'recurring') === (p.billingPeriod !== undefined), {
    message: 'Recurring products need a billing period',
    path: ['billingPeriod'],
  });

export const proposalCreateInput = z.object({ templateId: uuid, title: name.optional(), signatureRequired: z.boolean().default(true) });
export const proposalDraftInput = z.object({
  content: documentSchema,
  pricing: pricingSchema,
  termMonths: z.number().int().min(1).max(120),
  validUntil: isoDate.nullable().optional(),
  rowVersion: z.number().int(),
});
export const proposalSendInput = z.object({
  recipientContactIds: z.array(uuid).min(1).max(20),
  linkExpiresAt: z.iso.datetime({ offset: true }).optional(),
  confirm: z.array(z.string()).optional(),
});
export const voidInput = z.object({ reason: z.string().trim().min(1).max(2000) });
export const signatureRequestInput = z.object({
  signerContactIds: z.array(uuid).min(1).max(10),
  signingOrder: z.enum(['sequential', 'parallel']).default('sequential'),
});

export const buyerExchangeInput = z.object({ token: z.string().min(20).max(200) });
export const buyerIdentityInput = z.object({ name: z.string().trim().min(1).max(200), email });
export const buyerHeartbeatInput = z.object({ viewSessionId: uuid, activeSeconds: z.number().int().min(0).max(60), sectionId: z.string().max(40).optional() });
export const buyerResponseInput = z.object({ response: z.enum(['accept', 'decline']), reason: optionalText(2000), typedName: optionalText(200) });

export const leadSubmissionInput = z.object({
  firstName: optionalText(120),
  lastName: optionalText(120),
  email,
  company: optionalText(255),
  message: optionalText(4000),
  /** Honeypot: real users leave it empty (BR-LED-006). */
  website: z.string().max(200).optional(),
});

export const inviteUserInput = z.object({ email, fullName: name, role: roleSchema, password: z.string().min(12).max(128), teamId: uuid.optional() });
export const userPatchInput = z.object({
  fullName: z.string().trim().min(1).max(120).optional(),
  role: roleSchema.optional(),
  canManageContent: z.boolean().optional(),
  teamId: uuid.nullable().optional(),
});
export const deactivateInput = z.object({ reassignToUserId: uuid });
// ───────────────────────── AI assistance (BR-AIA-001..008) ─────────────────────────
export const AI_FEATURES = ['draft_section', 'presend_review', 'deal_summary', 'rewrite_text', 'follow_up_email', 'weekly_report'] as const;
export type AiFeatureKey = (typeof AI_FEATURES)[number];
export const AI_REWRITE_MODES = ['improve', 'professional', 'concise', 'expand', 'friendly', 'formal', 'simplify', 'custom'] as const;
export const AI_FOLLOW_UP_SCENARIOS = ['initial', 'viewed', 'revisited', 'not_viewed', 'changes_requested', 'gone_quiet'] as const;
export const aiDraftInput = z.object({ proposalId: uuid, sectionId: z.string().max(40), instructions: optionalText(500) });
/** Draft several sections at once. Without `sectionIds`, every empty section that allows AI drafting is drafted. */
export const aiDraftSectionsInput = z.object({
  proposalId: uuid,
  sectionIds: z.array(z.string().max(40)).min(1).max(20).optional(),
  instructions: optionalText(500),
});
export const aiReviewInput = z.object({ proposalId: uuid });
export const aiFindingDecisionInput = z.object({ decision: z.enum(['acknowledged', 'dismissed']) });
export const aiRewriteInput = z
  .object({
    proposalId: uuid,
    sectionId: z.string().max(40),
    /** Character offset of the selection inside the SAVED section text. */
    selectionStart: z.number().int().min(0),
    selectedText: z.string().min(3).max(5000),
    mode: z.enum(AI_REWRITE_MODES),
    instructions: optionalText(500),
  })
  .refine((v) => v.mode !== 'custom' || Boolean(v.instructions), { message: 'Describe how the text should be rewritten', path: ['instructions'] });
export const aiFollowUpInput = z.object({
  dealId: uuid,
  proposalId: uuid.optional(),
  contactId: uuid,
  scenario: z.enum(AI_FOLLOW_UP_SCENARIOS),
  instructions: optionalText(500),
});
export const aiDecisionInput = z.object({
  decision: z.enum(['accept', 'reject']),
  /** The user's edited version of the suggestion (section text, replacement text, summary or email body). */
  editedText: z.string().max(50000).optional(),
  editedSubject: z.string().max(300).optional(),
});
export const aiSettingsInput = z.object({
  enabled: z.boolean(),
  perUserDailyCalls: z.number().int().min(1).max(1000),
  monthlyBudgetUsd: z.number().min(0).max(100000),
  // 'weekly_report' was added later: optional, so clients that send only the original switches keep working (default on).
  features: z
    .object(
      Object.fromEntries(AI_FEATURES.filter((f) => f !== 'weekly_report').map((f) => [f, z.boolean()])) as Record<
        Exclude<AiFeatureKey, 'weekly_report'>,
        z.ZodBoolean
      >,
    )
    .extend({ weekly_report: z.boolean().optional() }),
});

// ───────────────────────── Weekly Report Agents (prototype) ─────────────────────────
/** The client's estimates (scope) sheet, uploaded as CSV text (size and row limits are enforced by the server). */
export const estimatesUploadInput = z.object({
  fileName: z.string().trim().min(1).max(255),
  text: z.string().min(1).max(3_000_000),
});
export const WEEKLY_REPORT_STATUSES = ['queued', 'running', 'ready', 'needs_attention', 'approved', 'failed'] as const;
export const weeklyReportListQuery = z.object({
  companyId: uuid.optional(),
  status: z.enum(WEEKLY_REPORT_STATUSES).optional(),
  /** Company name contains … */
  q: z.string().trim().max(120).optional(),
});
export const weeklyReportApproveInput = z.object({
  rowVersion: z.number().int().min(1),
  /** Required (true) when the report has warnings, for example a figure a person typed that is not in the report data. */
  acknowledgeWarnings: z.boolean().optional(),
});
/** When the weekly run becomes due, in the organization time zone. Weekday: 1 = Monday … 7 = Sunday. */
export const weeklyReportSettingsInput = z.object({
  enabled: z.boolean(),
  runWeekday: z.number().int().min(1).max(7),
  runTime: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use a 24-hour time such as 09:00'),
});
export const WEEKLY_REPORT_SECTIONS = ['summary', 'completed', 'nextWeek', 'risks'] as const;
const weeklyStatementText = z.string().trim().min(1).max(600);
export const weeklyNarrativeUpdateInput = z
  .object({
    statements: z
      .array(z.object({ id: z.string().max(20), text: weeklyStatementText }))
      .max(40)
      .optional(),
    added: z
      .array(z.object({ section: z.enum(WEEKLY_REPORT_SECTIONS), text: weeklyStatementText, sources: z.array(z.string().max(80)).max(10).default([]) }))
      .max(20)
      .optional(),
    removed: z.array(z.string().max(20)).max(40).optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((v) => Boolean(v.statements?.length || v.added?.length || v.removed?.length), { message: 'Nothing to change', path: ['statements'] });
