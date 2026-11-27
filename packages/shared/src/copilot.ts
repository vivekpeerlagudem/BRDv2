/**
 * Kensium Copilot — shared vocabulary for the server and the web app: the optional Kensium lead qualification fields
 * (fixed lists; no free text, so they are safe inputs for deterministic scoring), lead score tags, and the Copilot API
 * contracts.
 */
import { z } from 'zod';

export const LEAD_INDUSTRIES = ['distribution_wholesale', 'manufacturing', 'retail_ecommerce', 'food_beverage', 'other'] as const;
export const LEAD_PLATFORMS = [
  'acumatica',
  'netsuite',
  'sage',
  'quickbooks',
  'microsoft_dynamics',
  'sap_business_one',
  'shopify',
  'bigcommerce',
  'adobe_commerce',
  'other',
  'none',
] as const;
export const LEAD_SIZE_BANDS = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;
export const LEAD_SERVICE_INTERESTS = ['erp_implementation', 'ecommerce_build', 'integration', 'upgrade_migration', 'support_managed_services'] as const;
export const LEAD_BUDGET_BANDS = ['under_25k', '25k_100k', '100k_250k', 'over_250k', 'unknown'] as const;
export const LEAD_TIMELINES = ['0_3_months', '3_6_months', '6_12_months', 'over_12_months', 'unknown'] as const;
export const LEAD_SCORE_TAGS = ['erp', 'ecommerce', 'integration', 'urgent', 'needs_budget_check', 'possible_spam'] as const;
export type LeadScoreTag = (typeof LEAD_SCORE_TAGS)[number];

export const LEAD_FIELD_LABELS: Record<string, string> = {
  distribution_wholesale: 'Distribution / wholesale',
  manufacturing: 'Manufacturing',
  retail_ecommerce: 'Retail and e-commerce',
  food_beverage: 'Food and beverage',
  other: 'Other',
  acumatica: 'Acumatica',
  netsuite: 'NetSuite',
  sage: 'Sage',
  quickbooks: 'QuickBooks',
  microsoft_dynamics: 'Microsoft Dynamics',
  sap_business_one: 'SAP Business One',
  shopify: 'Shopify',
  bigcommerce: 'BigCommerce',
  adobe_commerce: 'Adobe Commerce (Magento)',
  none: 'None',
  '1-10': '1–10 employees',
  '11-50': '11–50 employees',
  '51-200': '51–200 employees',
  '201-1000': '201–1,000 employees',
  '1000+': '1,000+ employees',
  erp_implementation: 'ERP implementation',
  ecommerce_build: 'E-commerce build',
  integration: 'Integration',
  upgrade_migration: 'Upgrade / migration',
  support_managed_services: 'Support / managed services',
  under_25k: 'Under USD 25k',
  '25k_100k': 'USD 25–100k',
  '100k_250k': 'USD 100–250k',
  over_250k: 'Over USD 250k',
  unknown: 'Not known',
  '0_3_months': '0–3 months',
  '3_6_months': '3–6 months',
  '6_12_months': '6–12 months',
  over_12_months: 'Over 12 months',
};

/** The six optional qualification fields. `null` clears a value; leaving a key out keeps it. */
export const leadQualificationFields = {
  industry: z.enum(LEAD_INDUSTRIES).nullable().optional(),
  currentPlatform: z.enum(LEAD_PLATFORMS).nullable().optional(),
  companySizeBand: z.enum(LEAD_SIZE_BANDS).nullable().optional(),
  serviceInterest: z.array(z.enum(LEAD_SERVICE_INTERESTS)).max(5).nullable().optional(),
  budgetBand: z.enum(LEAD_BUDGET_BANDS).nullable().optional(),
  timeline: z.enum(LEAD_TIMELINES).nullable().optional(),
};
export const LEAD_QUALIFICATION_KEYS = ['industry', 'currentPlatform', 'companySizeBand', 'serviceInterest', 'budgetBand', 'timeline'] as const;
export type LeadQualificationKey = (typeof LEAD_QUALIFICATION_KEYS)[number];

// ───────────────────────── Copilot API contracts ─────────────────────────
const uuid = z.uuid();
export const copilotContextRef = z.object({ type: z.enum(['company', 'contact', 'deal', 'lead', 'proposal']), id: uuid });
export const copilotConversationInput = z.object({ title: z.string().trim().min(1).max(120).optional(), context: copilotContextRef.nullable().optional() });
export const copilotTurnInput = z.object({ message: z.string().trim().min(1).max(4000), context: copilotContextRef.nullable().optional() });
export const copilotDecisionInput = z.object({ note: z.string().trim().max(500).optional() });
export const assignmentDeclineInput = z.object({ reason: z.string().trim().min(1).max(500) });
export const assignmentReassignInput = z.object({ assigneeId: uuid });

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM');
export const copilotSettingsInput = z.object({
  enabled: z.boolean().optional(),
  roles: z.object({ admin: z.boolean().optional(), sales_manager: z.boolean().optional(), salesperson: z.boolean().optional() }).optional(),
  autonomy: z.object({ create_task: z.boolean().optional(), add_ai_note: z.boolean().optional(), set_lead_score: z.boolean().optional() }).optional(),
  acceptSlaHours: z.number().int().min(1).max(72).optional(),
  escalationSlaHours: z.number().int().min(1).max(72).optional(),
  calendar: z
    .object({
      workdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).optional(),
      start: hhmm.optional(),
      end: hhmm.optional(),
      holidays: z
        .array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
        .max(60)
        .optional(),
    })
    .optional(),
  retentionDays: z.number().int().min(1).max(365).optional(),
  models: z.object({ main: z.string().trim().max(120).nullable().optional(), fast: z.string().trim().max(120).nullable().optional() }).optional(),
  monthlyBudgetUsd: z.number().min(0).max(100000).optional(),
  perUserDailyTurns: z.number().int().min(1).max(5000).optional(),
});
