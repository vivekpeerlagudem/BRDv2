import { describe, expect, it } from 'vitest';
import { problemSchema, problemTypeUri, ROLES, roleSchema } from './index.ts';

describe('roles', () => {
  it('exposes exactly the three BRD roles', () => {
    expect(ROLES).toEqual(['admin', 'sales_manager', 'salesperson']);
    expect(roleSchema.safeParse('sales_manager').success).toBe(true);
    expect(roleSchema.safeParse('owner').success).toBe(false);
  });
});

describe('problem details', () => {
  it('accepts a valid RFC 9457 problem', () => {
    const parsed = problemSchema.parse({
      type: problemTypeUri('NOT_FOUND'),
      title: 'Not found',
      status: 404,
      code: 'NOT_FOUND',
      requestId: 'abc',
    });
    expect(parsed.code).toBe('NOT_FOUND');
  });

  it('rejects codes that are not UPPER_SNAKE', () => {
    const result = problemSchema.safeParse({ type: 'x', title: 'x', status: 400, code: 'user.duplicate' });
    expect(result.success).toBe(false);
  });
});
