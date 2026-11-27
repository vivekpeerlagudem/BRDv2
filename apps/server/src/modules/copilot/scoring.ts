/**
 * Deterministic lead scoring (scoring_version 1, SA §9.2). Code computes the score; the model never does — it only
 * picks tags from a fixed list and writes the one-line reason a person reads.
 *
 *   Fit (45)      platform 15 · size band 15 / 8 · industry in the admin's focus list 15
 *   Intent (35)   timeline 0–3 m 15 / 3–6 m 10 · budget ≥ 25k 10 / < 25k 3 · any service interest 10
 *   Quality (20)  source referral/partner 10, web form 6, import 3 · name + business email + job title 5 ·
 *                 company already a customer 5
 *   Engagement    activity in the last 14 days 5 · a proposal viewed 5 (bonus; the total is capped at 100)
 *   Penalties     spam verdict or suspected injection −20 · free-mail domain −5
 *
 * Bands: A ≥ 70, B 45–69, C < 45. Empty fields score 0, never negative, and are listed in `missing`.
 */
import type { ScoreFactor } from '../../db/schema-copilot.ts';

export const SCORING_VERSION = 1;

export interface ScoreInput {
  industry: string | null;
  currentPlatform: string | null;
  companySizeBand: string | null;
  serviceInterest: string[] | null;
  budgetBand: string | null;
  timeline: string | null;
  source: string | null;
  name: string | null;
  email: string | null;
  jobTitle: string | null;
  companyIsCustomer: boolean;
  spam: boolean;
  suspectedInjection: boolean;
  /** Days since the last logged activity on the related deal or company (null: none). */
  daysSinceActivity: number | null;
  proposalViewed: boolean;
}
export interface ScoreResult {
  score: number;
  band: 'A' | 'B' | 'C';
  factors: ScoreFactor[];
  missing: string[];
}

const FREE_MAIL = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'hotmail.com',
  'outlook.com',
  'live.com',
  'aol.com',
  'icloud.com',
  'me.com',
  'proton.me',
  'protonmail.com',
  'gmx.com',
  'mail.com',
  'yandex.com',
]);
export const DEFAULT_FOCUS_INDUSTRIES = ['distribution_wholesale', 'manufacturing'];

export function bandOf(score: number): 'A' | 'B' | 'C' {
  return score >= 70 ? 'A' : score >= 45 ? 'B' : 'C';
}

export function scoreLead(input: ScoreInput, focusIndustries: string[] = DEFAULT_FOCUS_INDUSTRIES): ScoreResult {
  const factors: ScoreFactor[] = [];
  const missing: string[] = [];
  const add = (group: ScoreFactor['group'], factor: string, field: string, value: string | null, points: number, max: number) =>
    factors.push({ group, factor, field, value, points, max });
  const known = (v: string | null | undefined) => (v && v !== 'unknown' ? v : null);

  // ── fit ──
  const platform = known(input.currentPlatform);
  if (!platform) missing.push('currentPlatform');
  add('fit', 'Platform Kensium serves or replaces', 'currentPlatform', platform, platform && platform !== 'other' && platform !== 'none' ? 15 : 0, 15);
  const size = known(input.companySizeBand);
  if (!size) missing.push('companySizeBand');
  add('fit', 'Company size', 'companySizeBand', size, size === '51-200' || size === '201-1000' ? 15 : size === '11-50' || size === '1000+' ? 8 : 0, 15);
  const industry = known(input.industry);
  if (!industry) missing.push('industry');
  add('fit', 'Industry in the focus list', 'industry', industry, industry && focusIndustries.includes(industry) ? 15 : 0, 15);

  // ── intent ──
  const timeline = known(input.timeline);
  if (!timeline) missing.push('timeline');
  add('intent', 'Timeline', 'timeline', timeline, timeline === '0_3_months' ? 15 : timeline === '3_6_months' ? 10 : 0, 15);
  const budget = known(input.budgetBand);
  if (!budget) missing.push('budgetBand');
  add('intent', 'Budget', 'budgetBand', budget, budget === 'under_25k' ? 3 : budget ? 10 : 0, 10);
  const interest = input.serviceInterest?.filter(Boolean) ?? [];
  if (!interest.length) missing.push('serviceInterest');
  add('intent', 'Service interest given', 'serviceInterest', interest.length ? interest.join(', ') : null, interest.length ? 10 : 0, 10);

  // ── quality ──
  const source = (input.source ?? '').toLowerCase().replace(/[\s-]+/g, '_');
  const sourcePoints = /referral|partner/.test(source) ? 10 : /web_?form|website/.test(source) ? 6 : /import/.test(source) ? 3 : 0;
  add('quality', 'Source', 'source', input.source || null, sourcePoints, 10);
  const domain = input.email?.split('@')[1]?.toLowerCase() ?? null;
  const freeMail = domain ? FREE_MAIL.has(domain) : false;
  const complete = Boolean(input.name && input.email && !freeMail && input.jobTitle);
  if (!input.email) missing.push('email');
  if (!input.jobTitle) missing.push('jobTitle');
  add('quality', 'Name, business email and job title present', 'contact', complete ? 'complete' : 'incomplete', complete ? 5 : 0, 5);
  add('quality', 'Company already a customer', 'company', input.companyIsCustomer ? 'customer' : null, input.companyIsCustomer ? 5 : 0, 5);

  // ── engagement (bonus) ──
  const recent = input.daysSinceActivity !== null && input.daysSinceActivity <= 14;
  add(
    'engagement',
    'Activity in the last 14 days',
    'activity',
    input.daysSinceActivity === null ? null : `${input.daysSinceActivity} days ago`,
    recent ? 5 : 0,
    5,
  );
  add('engagement', 'A proposal was viewed', 'proposal', input.proposalViewed ? 'viewed' : null, input.proposalViewed ? 5 : 0, 5);

  // ── penalties ──
  if (input.spam || input.suspectedInjection)
    add('penalty', input.spam ? 'Spam verdict' : 'Text written like an instruction', 'quality', input.spam ? 'spam' : 'suspected injection', -20, 0);
  if (freeMail) add('penalty', 'Free e-mail domain', 'email', domain, -5, 0);

  const total = factors.reduce((s, f) => s + f.points, 0);
  const score = Math.max(0, Math.min(100, total));
  return { score, band: bandOf(score), factors, missing };
}
