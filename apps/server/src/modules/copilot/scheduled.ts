/**
 * Copilot work done by the scheduled scans (runScheduledScans in workflow.ts, every few minutes).
 * Each step is idempotent and cheap when there is nothing to do, so running it on every scan is safe.
 */
import type { AppContext } from '../../platform/core.ts';
import { expireCards } from './actions.ts';
import { runAssignmentTimers } from './assignments.ts';
import { purgeExpiredConversations } from './conversations.ts';

export async function runCopilotScans(
  ctx: AppContext,
): Promise<{ conversationsPurged: number; cardsExpired: number; assignments: Awaited<ReturnType<typeof runAssignmentTimers>> }> {
  // Retention: conversations past their expiry date (30 days by default) are deleted with their messages.
  const conversationsPurged = await purgeExpiredConversations(ctx);
  // Approval cards last 24 hours.
  const cardsExpired = await expireCards(ctx);
  // Accept-and-escalate timers (reminder, manager, admin) and time to first contact.
  const assignments = await runAssignmentTimers(ctx);
  return { conversationsPurged, cardsExpired, assignments };
}
