import { describe, expect, it } from 'vitest';
import { readable } from './copilot.tsx';

const sources = [
  { alias: 'D3', type: 'deal', id: 'd3', label: 'Stark Industries – ERP integration' },
  { alias: 'L1', type: 'lead', id: 'l1', label: 'Pepper Potts' },
];

describe('Copilot answer text', () => {
  it('shows the record name in place of its alias', () => {
    expect(readable('Next step for [D3] is a call.', sources as never)).toBe('Next step for Stark Industries – ERP integration is a call.');
  });
  it('does not repeat a name the answer already wrote before the alias', () => {
    expect(readable('Stark Industries – ERP integration [D3] is in Negotiation; Pepper Potts [L1] is new.', sources as never)).toBe(
      'Stark Industries – ERP integration is in Negotiation; Pepper Potts is new.',
    );
  });
  it('drops aliases it does not know', () => {
    expect(readable('See [Q9].', sources as never)).toBe('See.');
  });
});
