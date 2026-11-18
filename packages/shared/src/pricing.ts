import { Decimal } from 'decimal.js';
import { z } from 'zod';

/**
 * Pricing engine — BUSINESS-RULES §7.2 / PROPOSAL-ENGINE-DESIGN §4.
 * One implementation shared by the web app (live totals) and the server (authority).
 * Rounding: half-up to 2 decimals per line; totals are sums of rounded lines (R11).
 */
const D = Decimal.clone({ precision: 30, rounding: Decimal.ROUND_HALF_UP });
const decimalString = z.string().regex(/^\d{1,16}(\.\d{1,4})?$/, 'must be a non-negative decimal');

export const pricingLineSchema = z
  .object({
    lineKey: z.string().min(1).max(40),
    name: z.string().trim().min(1).max(255),
    description: z.string().max(2000).optional(),
    unit: z.string().trim().min(1).max(40),
    quantity: decimalString.refine((v) => new D(v).gt(0), 'quantity must be > 0'),
    unitPrice: decimalString,
    discountType: z.enum(['percent', 'amount']).optional(),
    discountValue: decimalString.optional(),
    taxRatePercent: decimalString.refine((v) => new D(v).lte(100), 'tax rate must be ≤ 100'),
    billingType: z.enum(['one_time', 'recurring']),
    billingPeriod: z.enum(['month', 'quarter', 'year']).optional(),
  })
  .refine((l) => (l.billingType === 'recurring') === (l.billingPeriod !== undefined), {
    message: 'recurring lines need a billing period; one-time lines must not have one',
    path: ['billingPeriod'],
  })
  .refine((l) => (l.discountType === undefined) === (l.discountValue === undefined), {
    message: 'discount type and value go together',
    path: ['discountValue'],
  });

export const pricingSchema = z.object({
  lines: z.array(pricingLineSchema).max(200),
  overallDiscountPercent: decimalString.refine((v) => new D(v).lte(100), 'must be ≤ 100').optional(),
});

export type PricingLine = z.infer<typeof pricingLineSchema>;
export type Pricing = z.infer<typeof pricingSchema>;

export interface GroupTotals {
  subtotal: string;
  discount: string;
  tax: string;
  total: string;
}
export interface ComputedLine {
  lineKey: string;
  subtotal: string;
  discount: string;
  net: string;
  tax: string;
  total: string;
}
export interface ProposalTotals {
  currency: string;
  termMonths: number;
  oneTime: GroupTotals;
  recurring: (GroupTotals & { period: 'month' | 'quarter' | 'year'; periodsInTerm: number })[];
  grandTotalFirstPeriod: string;
  tcvExclTax: string;
  maxLineDiscountPercent: string;
  lines: ComputedLine[];
}

export class PricingError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const MONTHS = { month: 1, quarter: 3, year: 12 } as const;
const r2 = (d: Decimal) => d.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
const f2 = (d: Decimal) => r2(d).toFixed(2);

export function computeTotals(pricing: Pricing, termMonths: number, currency: string): ProposalTotals {
  const overallPct = new D(pricing.overallDiscountPercent ?? '0');
  const zero = () => ({ subtotal: new D(0), discount: new D(0), net: new D(0), tax: new D(0) });
  const oneTime = zero();
  const recurring = new Map<'month' | 'quarter' | 'year', ReturnType<typeof zero>>();
  let maxPct = new D(0);
  const lines: ComputedLine[] = [];

  for (const line of pricing.lines) {
    const subtotal = r2(new D(line.quantity).mul(line.unitPrice));
    let lineDiscount = new D(0);
    if (line.discountType === 'percent') {
      const pct = new D(line.discountValue ?? '0');
      if (pct.gt(100)) throw new PricingError('PRICING_LINE_INVALID', `Discount above 100% on "${line.name}"`);
      lineDiscount = r2(subtotal.mul(pct).div(100));
    } else if (line.discountType === 'amount') {
      lineDiscount = r2(new D(line.discountValue ?? '0'));
      if (lineDiscount.gt(subtotal)) {
        throw new PricingError('PRICING_LINE_INVALID', `Discount exceeds line subtotal on "${line.name}"`);
      }
    }
    // Overall discount is applied to the net of every line (OD-66 WA: scope "both"), rounded per line.
    const afterLine = subtotal.minus(lineDiscount);
    const overallShare = r2(afterLine.mul(overallPct).div(100));
    const discount = lineDiscount.plus(overallShare);
    const net = subtotal.minus(discount);
    const tax = r2(net.mul(line.taxRatePercent).div(100));
    if (subtotal.gt(0)) maxPct = Decimal.max(maxPct, discount.div(subtotal).mul(100));

    let group = oneTime;
    if (line.billingType === 'recurring' && line.billingPeriod) {
      group = recurring.get(line.billingPeriod) ?? zero();
      recurring.set(line.billingPeriod, group);
    }
    group.subtotal = group.subtotal.plus(subtotal);
    group.discount = group.discount.plus(discount);
    group.net = group.net.plus(net);
    group.tax = group.tax.plus(tax);
    lines.push({ lineKey: line.lineKey, subtotal: f2(subtotal), discount: f2(discount), net: f2(net), tax: f2(tax), total: f2(net.plus(tax)) });
  }

  const fmt = (g: ReturnType<typeof zero>): GroupTotals => ({
    subtotal: f2(g.subtotal),
    discount: f2(g.discount),
    tax: f2(g.tax),
    total: f2(g.net.plus(g.tax)),
  });
  let tcv = oneTime.net;
  let first = oneTime.net.plus(oneTime.tax);
  const recurringOut: ProposalTotals['recurring'] = [];
  for (const period of ['month', 'quarter', 'year'] as const) {
    const g = recurring.get(period);
    if (!g) continue;
    // OD-67: the contract term must be a whole number of billing periods.
    if (termMonths % MONTHS[period] !== 0) {
      throw new PricingError('PRICING_TERM_PERIOD_MISMATCH', `Term of ${termMonths} months is not a whole number of ${period}s`);
    }
    const periodsInTerm = termMonths / MONTHS[period];
    tcv = tcv.plus(g.net.mul(periodsInTerm));
    first = first.plus(g.net).plus(g.tax);
    recurringOut.push({ ...fmt(g), period, periodsInTerm });
  }
  return {
    currency,
    termMonths,
    oneTime: fmt(oneTime),
    recurring: recurringOut,
    grandTotalFirstPeriod: f2(first),
    tcvExclTax: f2(tcv), // OD-16: deal amount = total contract value excluding tax
    maxLineDiscountPercent: maxPct.toDecimalPlaces(2).toString(),
    lines,
  };
}
