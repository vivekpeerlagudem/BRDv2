import { describe, expect, it } from 'vitest';
import { addBusinessHours, type BusinessCalendar, businessMinutesBetween } from './business-hours.ts';

const cal: BusinessCalendar = { workdays: [1, 2, 3, 4, 5], start: '09:00', end: '18:00', holidays: [] };
const at = (iso: string) => new Date(iso);

describe('addBusinessHours', () => {
  it('adds within the same working day', () => {
    expect(addBusinessHours(at('2026-11-18T10:00:00Z'), 4, cal, 'UTC').toISOString()).toBe('2026-11-18T14:00:00.000Z');
  });
  it('carries over the evening to the next morning', () => {
    expect(addBusinessHours(at('2026-11-18T16:00:00Z'), 4, cal, 'UTC').toISOString()).toBe('2026-11-19T11:00:00.000Z');
  });
  it('starts at the next opening when assigned at night or on a weekend', () => {
    expect(addBusinessHours(at('2026-11-18T22:00:00Z'), 4, cal, 'UTC').toISOString()).toBe('2026-11-19T13:00:00.000Z');
    expect(addBusinessHours(at('2026-11-21T10:00:00Z'), 2, cal, 'UTC').toISOString()).toBe('2026-11-23T11:00:00.000Z'); // Saturday → Monday
  });
  it('skips Friday evening and the weekend', () => {
    expect(addBusinessHours(at('2026-11-20T17:00:00Z'), 4, cal, 'UTC').toISOString()).toBe('2026-11-23T12:00:00.000Z');
  });
  it('skips holidays', () => {
    const h = { ...cal, holidays: ['2026-11-19'] };
    expect(addBusinessHours(at('2026-11-18T16:00:00Z'), 4, h, 'UTC').toISOString()).toBe('2026-11-20T11:00:00.000Z');
  });
  it('works in the organization time zone, across a DST change', () => {
    // New York: 09:00 local = 14:00 UTC in November (EST).
    expect(addBusinessHours(at('2026-11-18T13:00:00Z'), 1, cal, 'America/New_York').toISOString()).toBe('2026-11-18T15:00:00.000Z');
    // DST ends on 2026-11-01 (Sunday): Friday 17:00 EDT (21:00Z) + 2 h → Monday 10:00 EST (15:00Z).
    expect(addBusinessHours(at('2026-10-30T21:00:00Z'), 2, cal, 'America/New_York').toISOString()).toBe('2026-11-02T15:00:00.000Z');
  });
});

describe('businessMinutesBetween', () => {
  it('counts only working minutes', () => {
    expect(businessMinutesBetween(at('2026-11-18T17:00:00Z'), at('2026-11-19T10:00:00Z'), cal, 'UTC')).toBe(120);
    expect(businessMinutesBetween(at('2026-11-20T17:00:00Z'), at('2026-11-23T09:30:00Z'), cal, 'UTC')).toBe(90);
    expect(businessMinutesBetween(at('2026-11-19T10:00:00Z'), at('2026-11-18T10:00:00Z'), cal, 'UTC')).toBe(0);
  });
});
