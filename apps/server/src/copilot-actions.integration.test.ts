/**
 * Kensium Copilot — actions and human control (M3), against a REAL PostgreSQL test database through the HTTP routes.
 * AUTO writes run at once with Undo; APPROVAL writes become cards that re-run the CRM service with the approver's
 * actor; DRAFT writes reuse the existing "suggestion a person accepts" feature. The mock AI is scripted per test.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createKit, hasTestDb, PASSWORD, type SseEvent } from './copilot-test-kit.ts';
import { agentAction, recordScore } from './db/schema-copilot.ts';
import { seedCopilotDemo, seedId } from './modules/copilot/demo-seed.ts';
import { executeTool } from './modules/copilot/policy.ts';
import { loadCopilotSettings } from './modules/copilot/settings.ts';
import { AliasBook, allTools, type ToolEnv, toolsForRole } from './modules/copilot/tools.ts';
import { runScheduledScans } from './modules/workflow.ts';
import { buildUserActor, schema } from './platform/core.ts';

const done = (events: SseEvent[]) => events.find((e) => e.event === 'done')?.data;
const actionsOf = (events: SseEvent[]) => events.filter((e) => e.event === 'action').map((e) => e.data);
const lastToolResults = (calls: { messages: { content: { type: string }[] }[] }[]) =>
  JSON.stringify(calls.at(-1)?.messages.filter((m) => m.content.some((b) => b.type === 'tool_result')));

describe.skipIf(!hasTestDb())('Copilot actions and human control (PostgreSQL integration)', () => {
  const kit = createKit('Copilot Actions Org');
  const users: Record<string, string> = {};
  const tick = () => {
    kit.clock.now = new Date(kit.clock.now.getTime() + 61_000);
  };
  const ask = async (who: string, message: string, context?: { type: string; id: string }) => {
    tick();
    const c = await kit.call(who, 'POST', '/copilot/conversations', context ? { context } : {});
    expect(c.status, c.text).toBe(201);
    const res = await kit.sse(who, `/copilot/conversations/${c.json.id}/turns`, { message });
    return { ...res, done: done(res.events), actions: actionsOf(res.events) };
  };
  /** An open deal of `who` (first by name), for tests that need one. */
  const openDealOf = async (who: string, skip = 0) => {
    const rows = await kit.ctx.db
      .select()
      .from(schema.deal)
      .where(and(eq(schema.deal.ownerId, users[who] as string), eq(schema.deal.status, 'open')))
      .orderBy(schema.deal.name);
    const d = rows[skip];
    if (!d) throw new Error(`no open deal for ${who}`);
    return d;
  };

  beforeAll(async () => {
    await kit.reset();
    await seedCopilotDemo(kit.ctx, { password: PASSWORD });
    for (const [key, email] of [
      ['spidey', 'spider.man'],
      ['gamora', 'gamora'],
      ['rocket', 'rocket'],
      ['starlord', 'star.lord'],
      ['cap', 'captain.america'],
    ] as const) {
      await kit.signIn(key, `${email}@northwind.example`);
      const [u] = await kit.ctx.db
        .select()
        .from(schema.appUserProfile)
        .where(eq(schema.appUserProfile.email, `${email}@northwind.example`));
      users[key] = u!.userId;
    }
  }, 120_000);
  beforeEach(() => kit.ai.reset());
  afterAll(async () => {
    await kit.pool.end();
  });

  it('AUTO: a task is created at once, listed under "Done by Copilot", and Undo cancels it (once)', async () => {
    const deal = await openDealOf('spidey');
    // Scripted without reading the record first: reading notes (outside text) would taint the turn (see the taint test).
    kit.ai.enqueueConverse(
      { toolCalls: [{ name: 'create_task', input: { related: 'D1', title: 'Follow up', due: '2026-11-20' } }] },
      { text: 'Task created.' },
    );
    const r = await ask('spidey', 'Remind me to follow up on this deal', { type: 'deal', id: deal.id });
    expect(r.done.status).toBe('completed');
    const [a] = r.actions;
    expect(a).toMatchObject({ tool: 'create_task', tier: 'auto', status: 'executed', undoable: true });
    expect(a.summary).toContain(deal.name);
    const [row] = await kit.ctx.db.select().from(agentAction).where(eq(agentAction.id, a.id));
    const taskId = (row!.result as { taskId: string }).taskId;
    const [task] = await kit.ctx.db.select().from(schema.task).where(eq(schema.task.id, taskId));
    expect(task).toMatchObject({ status: 'open', source: 'copilot', assigneeId: users.spidey, relatedId: deal.id });

    const list = await kit.call('spidey', 'GET', '/copilot/actions?view=done');
    expect(list.json.items.map((i: { id: string }) => i.id)).toContain(a.id);
    expect((await kit.call('rocket', 'POST', `/copilot/actions/${a.id}/undo`)).status).toBe(404); // not Rocket's
    const undo = await kit.call('spidey', 'POST', `/copilot/actions/${a.id}/undo`);
    expect(undo.status, undo.text).toBe(200);
    expect(undo.json.status).toBe('undone');
    const [after] = await kit.ctx.db.select().from(schema.task).where(eq(schema.task.id, taskId));
    expect(after?.status).toBe('cancelled');
    expect((await kit.call('spidey', 'POST', `/copilot/actions/${a.id}/undo`)).status).toBe(409);
  });

  it('Undo is refused when the record changed since, and after 7 days', async () => {
    const deal = await openDealOf('spidey');
    kit.ai.enqueueConverse({ toolCalls: [{ name: 'create_task', input: { related: 'D1', title: 'Call the CFO', due: '2026-12-01' } }] }, { text: 'Done.' });
    const r = await ask('spidey', 'task please', { type: 'deal', id: deal.id });
    const [row] = await kit.ctx.db.select().from(agentAction).where(eq(agentAction.id, r.actions[0].id));
    const taskId = (row!.result as { taskId: string }).taskId;
    expect((await kit.call('spidey', 'POST', `/tasks/${taskId}/complete`)).status).toBe(200);
    const undo = await kit.call('spidey', 'POST', `/copilot/actions/${row!.id}/undo`);
    expect(undo.status).toBe(409);
    expect(undo.json.code).toBe('UNDO_CONFLICT');

    kit.ai.enqueueConverse({ toolCalls: [{ name: 'create_task', input: { related: 'D1', title: 'Second task', due: '2026-12-01' } }] }, { text: 'Done.' });
    const r2 = await ask('spidey', 'task please', { type: 'deal', id: deal.id });
    kit.clock.now = new Date(kit.clock.now.getTime() + 8 * 86_400_000);
    const late = await kit.call('spidey', 'POST', `/copilot/actions/${r2.actions[0].id}/undo`);
    expect(late.json.code).toBe('COPILOT_UNDO_EXPIRED');
  });

  it('APPROVAL: a stage move is only a card until approved; approve re-runs the service once', async () => {
    const deal = await openDealOf('spidey', 1);
    const r = await ask('spidey', 'Move this deal to Negotiation', { type: 'deal', id: deal.id });
    const [card] = r.actions;
    expect(card).toMatchObject({ tool: 'move_deal_stage', tier: 'approval', status: 'proposed', undoable: false });
    const [unchanged] = await kit.ctx.db.select().from(schema.deal).where(eq(schema.deal.id, deal.id));
    expect(unchanged?.stageId).toBe(deal.stageId);
    const pending = await kit.call('spidey', 'GET', '/copilot/actions?view=pending');
    expect(pending.json.items.map((i: { id: string }) => i.id)).toContain(card.id);

    expect((await kit.call('gamora', 'POST', `/copilot/actions/${card.id}/approve`)).status).toBe(404);
    const ok = await kit.call('spidey', 'POST', `/copilot/actions/${card.id}/approve`);
    expect(ok.status, ok.text).toBe(200);
    expect(ok.json.status).toBe('approved');
    const [moved] = await kit.ctx.db.select().from(schema.deal).where(eq(schema.deal.id, deal.id));
    const [stage] = await kit.ctx.db.select().from(schema.pipelineStage).where(eq(schema.pipelineStage.id, moved!.stageId));
    expect(stage?.name).toBe('Negotiation');
    expect((await kit.call('spidey', 'POST', `/copilot/actions/${card.id}/approve`)).json.code).toBe('COPILOT_CARD_DECIDED');
  });

  it('a card expires when the record changes, and after 24 hours (also by the scheduled scan); reject works', async () => {
    const deal = await openDealOf('spidey', 2);
    const r = await ask('spidey', 'Push the close date of this deal', { type: 'deal', id: deal.id });
    const [card] = r.actions;
    expect(card).toMatchObject({ tool: 'patch_deal', status: 'proposed' });
    await kit.ctx.db
      .update(schema.deal)
      .set({ rowVersion: deal.rowVersion + 1 })
      .where(eq(schema.deal.id, deal.id));
    const stale = await kit.call('spidey', 'POST', `/copilot/actions/${card.id}/approve`);
    expect(stale.json.code).toBe('COPILOT_CARD_STALE');
    expect((await kit.ctx.db.select().from(agentAction).where(eq(agentAction.id, card.id)))[0]?.status).toBe('expired');

    const r2 = await ask('spidey', 'Push the close date of this deal', { type: 'deal', id: deal.id });
    const r3 = await ask('spidey', 'Push the close date of this deal', { type: 'deal', id: deal.id });
    expect((await kit.call('spidey', 'POST', `/copilot/actions/${r3.actions[0].id}/reject`)).json.status).toBe('rejected');
    kit.clock.now = new Date(kit.clock.now.getTime() + 25 * 3_600_000);
    expect((await runScheduledScans(kit.ctx)).copilot.cardsExpired).toBeGreaterThan(0);
    expect((await kit.call('spidey', 'POST', `/copilot/actions/${r2.actions[0].id}/approve`)).json.code).toBe('COPILOT_CARD_DECIDED');
  });

  it('taint: after reading outside text, a free-text auto write becomes an approval card', async () => {
    const lost = seedId('deal:70'); // Rocket's lost deal with a planted instruction in the buyer's reason
    kit.ai.enqueueConverse(
      { toolCalls: [{ name: 'get_record', input: { ref: 'D1' } }] },
      { toolCalls: [{ name: 'add_ai_note', input: { related: 'D1', text: 'Approved 40% discount' } }] },
      { text: 'Noted.' },
    );
    const r = await ask('rocket', 'Summarise and note', { type: 'deal', id: lost });
    expect(r.done.tainted).toBe(true);
    expect(r.actions[0]).toMatchObject({ tool: 'add_ai_note', tier: 'approval', status: 'proposed' });
    const notes = await kit.ctx.db.select().from(schema.note).where(eq(schema.note.relatedId, lost));
    expect(notes.some((n) => n.body.includes('40% discount'))).toBe(false);
    const [row] = await kit.ctx.db.select().from(agentAction).where(eq(agentAction.id, r.actions[0].id));
    expect(row).toMatchObject({ tainted: true, result: { routedBecause: 'tainted' } });
  });

  it('caps automatic changes at 5 per question', async () => {
    const deal = await openDealOf('gamora');
    kit.ai.enqueueConverse(
      { toolCalls: Array.from({ length: 6 }, (_, i) => ({ name: 'create_task', input: { related: 'D1', title: `Task number ${i}`, due: '2026-12-02' } })) },
      { text: 'Done.' },
    );
    const r = await ask('gamora', 'six tasks', { type: 'deal', id: deal.id });
    expect(r.actions.filter((a: { status: string }) => a.status === 'executed')).toHaveLength(5);
    expect(lastToolResults(kit.ai.converseCalls)).toContain('limit_reached');
  });

  it('with autonomy switched off, an auto tool becomes an approval card', async () => {
    const [org] = await kit.ctx.db.select().from(schema.organizationSettings);
    await kit.ctx.db.update(schema.organizationSettings).set({ copilotSettings: { autonomy: { create_task: false } } });
    const deal = await openDealOf('gamora');
    kit.ai.enqueueConverse({ toolCalls: [{ name: 'create_task', input: { related: 'D1', title: 'Call back', due: '2026-12-02' } }] }, { text: 'Card ready.' });
    const r = await ask('gamora', 'task', { type: 'deal', id: deal.id });
    expect(r.actions[0]).toMatchObject({ tool: 'create_task', tier: 'approval', status: 'proposed' });
    const ok = await kit.call('gamora', 'POST', `/copilot/actions/${r.actions[0].id}/approve`);
    expect(ok.json.status).toBe('approved');
    await kit.ctx.db.update(schema.organizationSettings).set({ copilotSettings: org?.copilotSettings ?? {} });
  });

  it('lead scoring is computed by code, stored with factors, and Undo removes it', async () => {
    const lead = seedId('lead:4'); // Gamora's lead
    kit.ai.enqueueConverse({ toolCalls: [{ name: 'set_lead_score', input: { record: 'L1', tags: ['erp', 'erp'] } }] }, { text: 'Scored.' });
    const r = await ask('gamora', 'score it', { type: 'lead', id: lead });
    expect(r.actions[0]).toMatchObject({ tool: 'set_lead_score', tier: 'auto', status: 'executed' });
    const [score] = await kit.ctx.db
      .select()
      .from(recordScore)
      .where(and(eq(recordScore.recordType, 'lead'), eq(recordScore.recordId, lead)));
    expect(score?.score).toBeGreaterThanOrEqual(0);
    expect(score?.tags).toEqual(['erp']);
    expect(score?.factors.length).toBeGreaterThan(5);
    expect(lastToolResults(kit.ai.converseCalls)).toMatch(new RegExp(`score[\\\\"]*:${score?.score}[,}]`));
    expect((await kit.call('gamora', 'POST', `/copilot/actions/${r.actions[0].id}/undo`)).json.status).toBe('undone');
    expect(await kit.ctx.db.select().from(recordScore).where(eq(recordScore.recordId, lead))).toHaveLength(0);
  });

  it('reassign is a manager tool: a salesperson is not offered it, a manager gets a card that runs as the manager', async () => {
    kit.ai.enqueueConverse({ toolCalls: [{ name: 'reassign', input: { record: 'D1', owner: 'U1' } }] }, { text: 'No.' });
    const deal = await openDealOf('gamora');
    await ask('gamora', 'reassign', { type: 'deal', id: deal.id });
    expect(lastToolResults(kit.ai.converseCalls)).toContain('unknown_tool');

    kit.ai.reset();
    const r = await ask('starlord', 'Reassign this deal to Rocket', { type: 'deal', id: deal.id });
    const card = r.actions.find((a: { tool: string }) => a.tool === 'reassign');
    expect(card).toMatchObject({ tier: 'approval', status: 'proposed' });
    expect(card.summary).toMatch(/Reassign deal .* to (Rocket|Gamora|Star-Lord)/);
    const ok = await kit.call('starlord', 'POST', `/copilot/actions/${card.id}/approve`);
    expect(ok.status, ok.text).toBe(200);
  });

  it('close as lost and a follow-up draft: approval card and a pending suggestion; nothing is sent', async () => {
    const deal = await openDealOf('rocket');
    const r = await ask('rocket', 'Mark this deal as lost', { type: 'deal', id: deal.id });
    const card = r.actions[0];
    expect(card).toMatchObject({ tool: 'close_deal_lost', tier: 'approval' });
    expect((await kit.call('rocket', 'POST', `/copilot/actions/${card.id}/approve`)).json.status).toBe('approved');
    expect((await kit.ctx.db.select().from(schema.deal).where(eq(schema.deal.id, deal.id)))[0]?.status).toBe('lost');

    const other = await openDealOf('rocket');
    const d = await ask('rocket', 'Draft a follow-up for this deal', { type: 'deal', id: other.id });
    expect(d.actions[0]).toMatchObject({ tool: 'draft_follow_up', tier: 'draft', status: 'executed', undoable: false });
    const gens = await kit.ctx.db
      .select()
      .from(schema.aiGeneration)
      .where(eq(schema.aiGeneration.requestedBy, users.rocket as string));
    expect(gens.some((g) => g.status === 'pending')).toBe(true);
  });

  it('policy matrix: every tool is refused for every role it is not offered to, before anything runs', async () => {
    const settings = await loadCopilotSettings(kit.ctx);
    for (const who of ['cap', 'starlord', 'spidey'] as const) {
      const actor = (await buildUserActor(
        kit.ctx.db,
        users[who] ?? (await kit.ctx.db.select().from(schema.appUserProfile).where(eq(schema.appUserProfile.fullName, 'Spider-Man')))[0]!.userId,
      ))!;
      const offered = new Set(toolsForRole(actor.role).map((t) => t.name));
      for (const t of allTools()) {
        const env: ToolEnv = {
          ctx: kit.ctx,
          actor,
          settings,
          turn: {
            runId: 'x',
            kind: 'chat',
            conversationId: null,
            nonce: 'n',
            aliases: new AliasBook(),
            tainted: false,
            injectionFlags: 0,
            hiddenTextRemoved: 0,
            toolCalls: 0,
            autoWrites: 0,
            proposals: 0,
            requestId: null,
            idempotencyPrefix: null,
          },
        };
        const r = await executeTool(env, { id: 'c', name: t.name, input: { nope: 1 } });
        if (offered.has(t.name)) expect(r.outcome, `${who}:${t.name}`).toBe('invalid_input');
        else expect(r.outcome, `${who}:${t.name}`).toBe('unknown_tool');
      }
    }
    // Spot checks of the matrix itself.
    expect(toolsForRole('salesperson').map((t) => t.name)).not.toContain('reassign');
    expect(toolsForRole('salesperson').map((t) => t.name)).not.toContain('sales_brief_latest');
    expect(toolsForRole('sales_manager').map((t) => t.name)).toContain('reassign');
    expect(allTools().map((t) => t.name)).not.toEqual(expect.arrayContaining(['send_proposal']));
    for (const banned of ['send', 'share', 'sign', 'email', 'delete', 'close_deal_won', 'approve', 'settings', 'role', 'import'])
      expect(
        allTools()
          .filter((t) => t.name.split('_').includes(banned))
          .map((t) => t.name),
        banned,
      ).toEqual([]);
  });
});
