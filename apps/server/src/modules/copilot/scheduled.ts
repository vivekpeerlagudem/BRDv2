/**
 * Copilot work done by the scheduled scans (runScheduledScans in workflow.ts, every few minutes).
 * Each step is idempotent and cheap when there is nothing to do, so running it on every scan is safe.
 */
import type { AppContext } from '../../platform/core.ts';
import { purgeExpiredConversations } from './conversations.ts';

export async function runCopilotScans(ctx: AppContext): Promise<{ conversationsPurged: number }> {
  // Retention: conversations past their expiry date (30 days by default) are deleted with their messages.
  const conversationsPurged = await purgeExpiredConversations(ctx);
  return { conversationsPurged };
}
