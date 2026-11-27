import { copilotConversationInput, copilotTurnInput } from '@crm/shared';
import { streamSSE } from 'hono/streaming';
import * as conversations from '../../modules/copilot/conversations.ts';
import type { CopilotEvent } from '../../modules/copilot/loop.ts';
import type { Api, RouteKit } from '../kit.ts';

/**
 * Routes for the Kensium Copilot chat. Mounted under /api/v1 (authenticated). Every conversation belongs to the
 * signed-in user: another user's conversation id answers 404. A turn is answered as Server-Sent Events
 * (status, delta, reset, tool, action, done, error) so the first words appear while the tools are still running.
 */
export function register(api: Api, kit: RouteKit): void {
  const { ctx } = kit;

  api.get('/copilot/conversations', async (c) => c.json(await conversations.listConversations(ctx, kit.actor(c))));
  api.post('/copilot/conversations', async (c) =>
    c.json(await conversations.createConversation(ctx, kit.actor(c), await kit.body(c, copilotConversationInput)), 201),
  );
  api.get('/copilot/conversations/:id', async (c) => c.json(await conversations.getConversation(ctx, kit.actor(c), kit.id(c))));
  api.delete('/copilot/conversations/:id', async (c) => c.json(await conversations.deleteConversation(ctx, kit.actor(c), kit.id(c))));

  api.post('/copilot/conversations/:id/turns', async (c) => {
    const actor = kit.actor(c);
    const id = kit.id(c);
    const input = await kit.body(c, copilotTurnInput);
    // Ownership is checked before the stream opens, so a foreign id is a plain 404 and not an empty stream.
    await conversations.getConversation(ctx, actor, id);
    const requestId = c.get('requestId');
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const abort = new AbortController();
      stream.onAbort(() => abort.abort());
      let queue: Promise<unknown> = Promise.resolve();
      const emit = (e: CopilotEvent) => {
        queue = queue.then(() => stream.writeSSE({ event: e.event, data: JSON.stringify(e.data) })).catch(() => {});
      };
      try {
        await conversations.runTurn(ctx, actor, id, input, { emit, requestId, signal: abort.signal });
      } catch {
        // Ids only in the log; the user gets a plain message and the CRM keeps working.
        ctx.logger.error({ requestId, conversationId: id }, 'copilot turn failed');
        emit({ event: 'error', data: { code: 'COPILOT_FAILED', message: 'The Copilot could not finish this. Nothing was changed. Please try again.' } });
      }
      await queue;
    });
  });
}
