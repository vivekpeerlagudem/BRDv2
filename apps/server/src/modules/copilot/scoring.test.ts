import { describe, expect, it } from 'vitest';
import { bandOf, type ScoreInput, scoreLead } from './scoring.ts';

const empty: ScoreInput = {
  industry: null,
  currentPlatform: null,
  companySizeBand: null,
  serviceInterest: null,
  budgetBand: null,
  timeline: null,
  source: null,
  name: 'Ada',
  email: null,
  jobTitle: null,
  companyIsCustomer: false,
  spam: false,
  suspectedInjection: false,
  daysSinceActivity: null,
  proposalViewed: false,
};
const ideal: ScoreInput = {
  ...empty,
  industry: 'distribution_wholesale',
  currentPlatform: 'quickbooks',
  companySizeBand: '51-200',
  serviceInterest: ['erp_implementation'],
  budgetBand: '100k_250k',
  timeline: '0_3_months',
  source: 'referral',
  email: 'ada@acme.example',
  jobTitle: 'CFO',
  companyIsCustomer: true,
};

describe('scoreLead (scoring_version 1)', () => {
  it('scores an ideal lead 100, band A, with nothing missing', () => {
    const r = scoreLead(ideal);
    expect(r.score).toBe(100);
    expect(r.band).toBe('A');
    expect(r.missing).toEqual([]);
    expect(r.factors.filter((f) => f.group === 'fit').reduce((s, f) => s + f.points, 0)).toBe(45);
  });
  it('scores empty fields as 0 (never negative) and lists them as missing', () => {
    const r = scoreLead(empty);
    expect(r.score).toBe(0);
    expect(r.band).toBe('C');
    expect(r.missing).toEqual(
      expect.arrayContaining(['industry', 'currentPlatform', 'companySizeBand', 'serviceInterest', 'budgetBand', 'timeline', 'email', 'jobTitle']),
    );
    expect(r.factors.every((f) => f.points >= 0)).toBe(true);
  });
  it('treats "unknown" like an empty field', () => {
    const r = scoreLead({ ...empty, budgetBand: 'unknown', timeline: 'unknown' });
    expect(r.missing).toEqual(expect.arrayContaining(['budgetBand', 'timeline']));
  });
  it('uses the partial points of the table', () => {
    const r = scoreLead({ ...empty, companySizeBand: '11-50', timeline: '3_6_months', budgetBand: 'under_25k', source: 'Web form' });
    expect(r.score).toBe(8 + 10 + 3 + 6);
  });
  it('the focus list decides the industry points', () => {
    expect(scoreLead({ ...empty, industry: 'retail_ecommerce' }).score).toBe(0);
    expect(scoreLead({ ...empty, industry: 'retail_ecommerce' }, ['retail_ecommerce']).score).toBe(15);
  });
  it('penalises spam, suspected injection and free mail, and never goes below 0', () => {
    expect(scoreLead({ ...ideal, suspectedInjection: true }).score).toBe(80);
    expect(scoreLead({ ...ideal, email: 'ada@gmail.com' }).score).toBe(100 - 5 - 5); // loses "complete" and gets the penalty
    expect(scoreLead({ ...empty, spam: true }).score).toBe(0);
  });
  it('engagement adds up to 10 points', () => {
    expect(scoreLead({ ...empty, daysSinceActivity: 3, proposalViewed: true }).score).toBe(10);
    expect(scoreLead({ ...empty, daysSinceActivity: 30 }).score).toBe(0);
  });
  it('bands at 70 and 45', () => {
    expect([bandOf(70), bandOf(69), bandOf(45), bandOf(44)]).toEqual(['A', 'B', 'B', 'C']);
  });
});
