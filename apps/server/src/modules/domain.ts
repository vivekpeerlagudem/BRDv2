/**
 * Domain layer — pure state machines and rules with no I/O (BUSINESS-RULES §17: SM-01 deal, SM-02 proposal,
 * SM-04 signature request). Services call these; nothing here touches the database.
 */
export type DealStatus = 'open' | 'won' | 'lost';
export type ProposalStatus = 'draft' | 'sent' | 'viewed' | 'accepted' | 'signed' | 'declined' | 'expired' | 'void';
export type ProposalEvent = 'version_sent' | 'first_view' | 'accept' | 'decline' | 'sign' | 'expire' | 'void' | 'new_draft';
export type SignatureStatus = 'pending' | 'sent' | 'viewed' | 'signed' | 'declined' | 'expired' | 'voided';

/** SM-02 (+ OD-17 Accepted, R13: Signed and Void are terminal). Returns the next status, or null when the event is not allowed. */
export function nextProposalStatus(current: ProposalStatus, event: ProposalEvent): ProposalStatus | null {
  if (current === 'signed' || current === 'void') return null;
  switch (event) {
    case 'version_sent':
      return 'sent';
    case 'first_view':
      return current === 'sent' ? 'viewed' : current === 'viewed' || current === 'accepted' ? current : null;
    case 'accept':
      return current === 'sent' || current === 'viewed' ? 'accepted' : null;
    case 'decline':
      return current === 'sent' || current === 'viewed' ? 'declined' : null;
    case 'sign':
      return current === 'sent' || current === 'viewed' || current === 'accepted' ? 'signed' : null;
    case 'expire':
      return current === 'sent' || current === 'viewed' || current === 'accepted' ? 'expired' : null;
    case 'void':
      return 'void';
    case 'new_draft':
      // Declined/Expired return to Draft when a new version is drafted; otherwise status follows the last sent version.
      return current === 'declined' || current === 'expired' ? 'draft' : current;
  }
}

export const isOpenSignatureStatus = (s: SignatureStatus) => s === 'pending' || s === 'sent' || s === 'viewed';

const RANK: Record<SignatureStatus, number> = { pending: 0, sent: 1, viewed: 2, signed: 3, declined: 3, expired: 3, voided: 3 };
/** Forward-only transitions (ADR-025): duplicate and out-of-order webhooks can never move a request backwards. */
export function canAdvanceSignature(current: SignatureStatus, target: SignatureStatus): boolean {
  return RANK[target] > RANK[current];
}

export function providerToSignatureStatus(s: 'sent' | 'viewed' | 'completed' | 'declined' | 'voided' | 'expired'): SignatureStatus {
  return s === 'completed' ? 'signed' : s;
}

/** BR-AUT-001 guard (RULE-AUT-11): move only when the deal is at an EARLIER open stage than the target. */
export function shouldMoveToProposalStage(deal: { status: DealStatus; stageOrder: number }, targetOrder: number | null): boolean {
  return deal.status === 'open' && targetOrder !== null && deal.stageOrder < targetOrder;
}

/** BR-AUT-005: stalled when open and no qualifying activity for more than N days in a stage that has a threshold. */
export function isStalled(deal: { status: DealStatus; lastActivityAt: Date | null; createdAt: Date }, thresholdDays: number | null, now: Date): boolean {
  if (deal.status !== 'open' || thresholdDays === null) return false;
  const last = deal.lastActivityAt ?? deal.createdAt;
  return now.getTime() - last.getTime() > thresholdDays * 86_400_000;
}

/** RULE-AUT-06: an automated change can be reversed only if the changed fields still hold the automated values. */
export function reversalConflicts(after: Record<string, unknown>, current: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => String(after[k] ?? '') !== String(current[k] ?? ''));
}
