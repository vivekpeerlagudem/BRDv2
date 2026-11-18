import { describe, expect, it } from 'vitest';
import { permissionSummary, scopeFor } from './permissions.ts';
import { computeTotals, type Pricing, PricingError } from './pricing.ts';

const line = (over: Partial<Pricing['lines'][number]>): Pricing['lines'][number] => ({
  lineKey: 'l1',
  name: 'Item',
  unit: 'each',
  quantity: '1',
  unitPrice: '100',
  taxRatePercent: '0',
  billingType: 'one_time',
  ...over,
});

describe('computeTotals', () => {
  it('computes one-time and recurring groups and TCV excluding tax (OD-16)', () => {
    const t = computeTotals(
      {
        lines: [
          line({ lineKey: 'a', quantity: '2', unitPrice: '5000', discountType: 'percent', discountValue: '5', taxRatePercent: '10' }),
          line({ lineKey: 'b', unitPrice: '1000', billingType: 'recurring', billingPeriod: 'month', taxRatePercent: '10' }),
        ],
      },
      12,
      'USD',
    );
    expect(t.oneTime).toEqual({ subtotal: '10000.00', discount: '500.00', tax: '950.00', total: '10450.00' });
    expect(t.recurring[0]).toMatchObject({ period: 'month', total: '1100.00', periodsInTerm: 12 });
    expect(t.tcvExclTax).toBe('21500.00'); // 9500 + 1000 × 12
    expect(t.grandTotalFirstPeriod).toBe('11550.00');
  });

  it('rounds half-up per line and sums rounded lines (R11)', () => {
    const t = computeTotals({ lines: [line({ quantity: '3', unitPrice: '0.335' }), line({ lineKey: 'l2', quantity: '1', unitPrice: '0.005' })] }, 12, 'USD');
    expect(t.lines[0]?.subtotal).toBe('1.01'); // 1.005 → 1.01
    expect(t.lines[1]?.subtotal).toBe('0.01');
    expect(t.oneTime.subtotal).toBe('1.02');
  });

  it('applies an overall discount to every line', () => {
    const t = computeTotals({ lines: [line({}), line({ lineKey: 'l2', unitPrice: '300' })], overallDiscountPercent: '10' }, 12, 'USD');
    expect(t.oneTime.discount).toBe('40.00');
    expect(t.tcvExclTax).toBe('360.00');
    expect(t.maxLineDiscountPercent).toBe('10');
  });

  it('rejects a term that is not a whole number of billing periods (OD-67)', () => {
    const run = () => computeTotals({ lines: [line({ billingType: 'recurring', billingPeriod: 'year' })] }, 18, 'USD');
    expect(run).toThrow(PricingError);
  });

  it('rejects an amount discount larger than the line', () => {
    expect(() => computeTotals({ lines: [line({ discountType: 'amount', discountValue: '101' })] }, 12, 'USD')).toThrow(/exceeds/);
  });
});

describe('permission matrix', () => {
  it('salespeople cannot reassign records (BRD §9.17)', () => {
    expect(scopeFor('salesperson', 'record.reassign')).toBe('none');
    expect(scopeFor('sales_manager', 'record.reassign')).toBe('team');
  });
  it('content management for managers depends on the Admin-granted flag', () => {
    expect(permissionSummary('sales_manager', false)['content.manage']).toBe(false);
    expect(permissionSummary('sales_manager', true)['content.manage']).toBe(true);
    expect(permissionSummary('sales_manager', true)['template.lockSections']).toBe(false);
  });
});
