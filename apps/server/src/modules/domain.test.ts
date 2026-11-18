import { describe, expect, it } from 'vitest';
import { canAdvanceSignature, isStalled, nextProposalStatus, reversalConflicts, shouldMoveToProposalStage } from './domain.ts';

describe('proposal state machine (SM-02)', () => {
  it('follows the happy path draft → sent → viewed → signed', () => {
    expect(nextProposalStatus('draft', 'version_sent')).toBe('sent');
    expect(nextProposalStatus('sent', 'first_view')).toBe('viewed');
    expect(nextProposalStatus('viewed', 'sign')).toBe('signed');
  });
  it('treats signed and void as terminal (R13)', () => {
    for (const e of ['version_sent', 'accept', 'decline', 'void', 'expire'] as const) {
      expect(nextProposalStatus('signed', e)).toBeNull();
      expect(nextProposalStatus('void', e)).toBeNull();
    }
  });
  it('allows accept/decline only from sent or viewed (OD-17)', () => {
    expect(nextProposalStatus('viewed', 'accept')).toBe('accepted');
    expect(nextProposalStatus('draft', 'accept')).toBeNull();
    expect(nextProposalStatus('accepted', 'sign')).toBe('signed');
    expect(nextProposalStatus('declined', 'new_draft')).toBe('draft');
    expect(nextProposalStatus('viewed', 'new_draft')).toBe('viewed');
  });
});

describe('signature transitions (ADR-025)', () => {
  it('are forward-only', () => {
    expect(canAdvanceSignature('sent', 'signed')).toBe(true);
    expect(canAdvanceSignature('viewed', 'sent')).toBe(false);
    expect(canAdvanceSignature('signed', 'voided')).toBe(false);
    expect(canAdvanceSignature('voided', 'signed')).toBe(false);
  });
});

describe('automation guards', () => {
  it('AUT-001 moves only from an earlier stage', () => {
    expect(shouldMoveToProposalStage({ status: 'open', stageOrder: 1 }, 3)).toBe(true);
    expect(shouldMoveToProposalStage({ status: 'open', stageOrder: 3 }, 3)).toBe(false);
    expect(shouldMoveToProposalStage({ status: 'won', stageOrder: 1 }, 3)).toBe(false);
    expect(shouldMoveToProposalStage({ status: 'open', stageOrder: 1 }, null)).toBe(false);
  });
  it('AUT-005 flags stalled deals by stage threshold', () => {
    const now = new Date('2026-11-17T00:00:00Z');
    const old = new Date('2026-11-01T00:00:00Z');
    expect(isStalled({ status: 'open', lastActivityAt: old, createdAt: old }, 10, now)).toBe(true);
    expect(isStalled({ status: 'open', lastActivityAt: old, createdAt: old }, 30, now)).toBe(false);
    expect(isStalled({ status: 'open', lastActivityAt: old, createdAt: old }, null, now)).toBe(false);
  });
  it('reversal is refused for fields changed since the automation ran', () => {
    expect(reversalConflicts({ stageId: 'a', amount: '10.00' }, { stageId: 'a', amount: '12.00' })).toEqual(['amount']);
  });
});
