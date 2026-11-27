/**
 * Copilot conversations: owner-only threads kept for a limited time (30 days by default, principle P8′).
 *  - Only the owner can list, read, continue or delete a conversation; there is no admin view and no export.
 *  - History sent to the model: the last 20 turns as text; older turns are folded into a rolling summary.
 *  - Nothing here is ever written to the logs.
 */

import type { copilotConversationInput, copilotTurnInput } from '@crm/shared';
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { copilotConversation, copilotMessage } from '../../db/schema-copilot.ts';
import { type AppContext, notFound, type UserActor } from '../../platform/core.ts';
import type { AiContentBlock, AiMessage } from '../../platform/ports.ts';
import { type CopilotEvent, runAgent } from './loop.ts';
import { loadCopilotSettings, modelFor } from './settings.ts';
import { AliasBook } from './tools.ts';

const DAY = 86_400_000;
const VERBATIM_TURNS = 20;

const textOf = (content: AiContentBlock[]) =>
  content
    .filter((b): b is Extract<AiContentBlock, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('');

async function own(ctx: AppContext, actor: UserActor, id: string) {
  const [row] = await ctx.db
    .select()
    .from(copilotConversation)
    .where(and(eq(copilotConversation.id, id), eq(copilotConversation.userId, actor.userId)));
  // Someone else's conversation is "not found", like any record outside the user's scope.
  if (!row || row.expiresAt.getTime() <= ctx.now().getTime()) throw notFound('Conversation');
  return row;
}

export async function createConversation(ctx: AppContext, actor: UserActor, input: z.infer<typeof copilotConversationInput>) {
  const settings = await loadCopilotSettings(ctx);
  const now = ctx.now();
  const [row] = await ctx.db
    .insert(copilotConversation)
    .values({
      userId: actor.userId,
      title: input.title ?? 'New conversation',
      contextRef: input.context ?? null,
      roleAtStart: actor.role,
      createdAt: now,
      lastAt: now,
      expiresAt: new Date(now.getTime() + settings.retentionDays * DAY),
    })
    .returning();
  return publicConversation(row as typeof copilotConversation.$inferSelect);
}
const publicConversation = (c: typeof copilotConversation.$inferSelect) => ({
  id: c.id,
  title: c.title,
  context: c.contextRef,
  createdAt: c.createdAt,
  lastAt: c.lastAt,
  expiresAt: c.expiresAt,
});

export async function listConversations(ctx: AppContext, actor: UserActor) {
  const rows = await ctx.db
    .select()
    .from(copilotConversation)
    .where(and(eq(copilotConversation.userId, actor.userId), sql`${copilotConversation.expiresAt} > ${ctx.now()}`))
    .orderBy(desc(copilotConversation.lastAt))
    .limit(50);
  return { items: rows.map(publicConversation) };
}

/** The conversation as the owner sees it: their questions and the Copilot's answers (not the tool traffic). */
export async function getConversation(ctx: AppContext, actor: UserActor, id: string) {
  const c = await own(ctx, actor, id);
  const rows = await ctx.db.select().from(copilotMessage).where(eq(copilotMessage.conversationId, id)).orderBy(asc(copilotMessage.seq));
  const finals = finalMessages(rows);
  return {
    ...publicConversation(c),
    messages: finals.map((m) => ({ id: m.id, role: m.role, text: textOf(m.content), tainted: m.tainted, runId: m.runId, createdAt: m.createdAt })),
  };
}

export async function deleteConversation(ctx: AppContext, actor: UserActor, id: string) {
  await own(ctx, actor, id);
  await ctx.db.delete(copilotConversation).where(eq(copilotConversation.id, id));
  return { deleted: true };
}

type Row = typeof copilotMessage.$inferSelect;
/** User questions and, per run, the last assistant message (the checked answer). */
function finalMessages(rows: Row[]): Row[] {
  const lastAssistantOfRun = new Map<string, number>();
  for (const r of rows) if (r.role === 'assistant' && r.runId) lastAssistantOfRun.set(r.runId, r.seq);
  return rows.filter(
    (r) =>
      (r.role === 'user' && r.content.some((b) => b.type === 'text')) ||
      (r.role === 'assistant' && r.runId !== null && lastAssistantOfRun.get(r.runId) === r.seq),
  );
}

/** Folds turns older than the verbatim window into the rolling summary (with the cheap model, or code for the simulator). */
async function summarizeOlder(ctx: AppContext, actor: UserActor, conversation: typeof copilotConversation.$inferSelect, finals: Row[]): Promise<string | null> {
  const turns = finals.filter((m) => m.role === 'user').length;
  if (turns <= VERBATIM_TURNS) return conversation.summary;
  const userRows = finals.filter((m) => m.role === 'user');
  const cutSeq = (userRows[userRows.length - VERBATIM_TURNS] as Row).seq; // first seq that stays verbatim
  const older = finals.filter((m) => m.seq < cutSeq && m.seq > conversation.summarizedThrough);
  if (!older.length) return conversation.summary;
  const transcript = older.map((m) => `${m.role === 'user' ? 'User' : 'Copilot'}: ${textOf(m.content).slice(0, 600)}`).join('\n');
  let summary: string;
  if (ctx.ai.simulated) {
    summary = [conversation.summary, ...older.filter((m) => m.role === 'user').map((m) => textOf(m.content).slice(0, 80))]
      .filter(Boolean)
      .join(' · ')
      .slice(-1200);
  } else {
    const settings = await loadCopilotSettings(ctx);
    try {
      const r = await ctx.ai.converse({
        requestId: crypto.randomUUID(),
        feature: 'copilot_background',
        model: modelFor(ctx, settings, 'fast'),
        effort: 'low',
        maxTokens: 400,
        timeoutMs: 20_000,
        system:
          'Summarise this CRM assistant conversation in at most 120 words: what the user asked about and what was decided. Plain text. Do not include figures.',
        tools: [],
        messages: [
          { role: 'user', content: [{ type: 'text', text: `${conversation.summary ? `Earlier summary: ${conversation.summary}\n\n` : ''}${transcript}` }] },
        ],
        userRef: actor.userId.slice(0, 8),
      });
      summary = textOf(r.content).slice(0, 1200) || (conversation.summary ?? '');
    } catch {
      summary = conversation.summary ?? '';
    }
  }
  await ctx.db
    .update(copilotConversation)
    .set({ summary, summarizedThrough: cutSeq - 1 })
    .where(eq(copilotConversation.id, conversation.id));
  return summary;
}

/** One chat turn: loads the history, runs the loop and stores what was said. Events are passed on as they happen. */
export async function runTurn(
  ctx: AppContext,
  actor: UserActor,
  id: string,
  input: z.infer<typeof copilotTurnInput>,
  opts: { emit?: (e: CopilotEvent) => void; requestId?: string; signal?: AbortSignal } = {},
) {
  const conversation = await own(ctx, actor, id);
  const rows = await ctx.db.select().from(copilotMessage).where(eq(copilotMessage.conversationId, id)).orderBy(asc(copilotMessage.seq));
  const finals = finalMessages(rows);
  const summary = await summarizeOlder(ctx, actor, conversation, finals);
  const userRows = finals.filter((m) => m.role === 'user');
  const fromSeq = userRows.length > VERBATIM_TURNS ? (userRows[userRows.length - VERBATIM_TURNS] as Row).seq : 0;
  const history: AiMessage[] = finals
    .filter((m) => m.seq >= fromSeq)
    .map((m) => ({ role: m.role === 'user' ? 'user' : 'assistant', content: [{ type: 'text', text: textOf(m.content) }] }));
  const open = input.context === undefined ? conversation.contextRef : input.context;

  const result = await runAgent(ctx, {
    actor,
    kind: 'chat',
    trigger: 'user',
    question: input.message,
    history,
    summary,
    aliases: new AliasBook(conversation.aliasMap),
    conversationId: id,
    open,
    ...(opts.emit ? { emit: opts.emit } : {}),
    ...(opts.requestId ? { requestId: opts.requestId } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  let seq = rows.at(-1)?.seq ?? 0;
  const settings = await loadCopilotSettings(ctx);
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    for (const m of result.messages) {
      const role = m.role === 'assistant' ? 'assistant' : m.content.some((b) => b.type === 'tool_result') ? 'tool' : 'user';
      await tx
        .insert(copilotMessage)
        .values({ conversationId: id, seq: ++seq, role, content: m.content, tainted: result.tainted, runId: result.runId, createdAt: now });
    }
    await tx
      .update(copilotConversation)
      .set({
        lastAt: now,
        expiresAt: new Date(now.getTime() + settings.retentionDays * DAY),
        aliasMap: result.aliases.toJSON(),
        contextRef: open ?? null,
        ...(conversation.title === 'New conversation' ? { title: input.message.slice(0, 60) } : {}),
      })
      .where(eq(copilotConversation.id, id));
  });
  return result;
}

/** Nightly: removes expired conversations (their messages go with them). Returns how many were deleted. */
export async function purgeExpiredConversations(ctx: AppContext): Promise<number> {
  const gone = await ctx.db.delete(copilotConversation).where(lt(copilotConversation.expiresAt, ctx.now())).returning({ id: copilotConversation.id });
  return gone.length;
}
