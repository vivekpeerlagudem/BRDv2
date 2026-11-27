/**
 * Kensium Copilot — administration, budgets and operations (M7): settings and kill switch, monthly budget with the
 * 80 % alert and the hard stop (the CRM keeps working), usage metadata without chat content.
 */
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createKit, hasTestDb } from './copilot-test-kit.ts';
import { schema } from './platform/core.ts';

describe.skipIf(!hasTestDb())('Copilot administration and budgets (PostgreSQL integration)', () => {
  const kit = createKit('Copilot Admin Org');
  const ask = async (who: string, message: string) => {
    kit.clock.now = new Date(kit.clock.now.getTime() + 61_000);
    const c = await kit.call(who, 'POST', '/copilot/conversations', {});
    const r = await kit.sse(who, `/copilot/conversations/${c.json.id}/turns`, { message });
    return { events: r.events, done: r.events.find((e) => e.event === 'done')?.data, error: r.events.find((e) => e.event === 'error')?.data };
  };
  const spend = async (usd: number) =>
    kit.ctx.db.insert(schema.aiUsage).values({
      feature: 'copilot_chat',
      provider: 'fake',
      model: 'm',
      userId: kit.ids.admin,
      inputTokens: 1,
      outputTokens: 1,
      outcome: 'success',
      requestId: crypto.randomUUID(),
      promptVersion: 'x',
      latencyMs: 1,
      attempts: 1,
      costMicroUsd: Math.round(usd * 1_000_000),
      simulated: true,
      occurredAt: kit.clock.now,
    } as never);

  beforeAll(async () => {
    await kit.reset();
  }, 120_000);
  beforeEach(() => kit.ai.reset());
  afterAll(async () => {
    await kit.pool.end();
  });

  it('only admins read and change the Copilot settings; changes merge and are validated', async () => {
    expect((await kit.call('rep1', 'GET', '/admin/copilot/settings')).status).toBe(403);
    expect((await kit.call('manager', 'PATCH', '/admin/copilot/settings', { enabled: false })).status).toBe(403);
    const g = await kit.call('admin', 'GET', '/admin/copilot/settings');
    expect(g.json.settings).toMatchObject({ enabled: true, acceptSlaHours: 4, monthlyBudgetUsd: 250, retentionDays: 30 });
    expect(g.json.provider).toBe('fake');
    const p = await kit.call('admin', 'PATCH', '/admin/copilot/settings', {
      autonomy: { add_ai_note: false },
      calendar: { holidays: ['2026-12-25'] },
      acceptSlaHours: 6,
    });
    expect(p.status, p.text).toBe(200);
    expect(p.json.settings.autonomy).toEqual({ create_task: true, add_ai_note: false, set_lead_score: true });
    expect(p.json.settings.calendar).toMatchObject({ start: '09:00', holidays: ['2026-12-25'] });
    expect(p.json.settings.acceptSlaHours).toBe(6);
    expect((await kit.call('admin', 'PATCH', '/admin/copilot/settings', { acceptSlaHours: 0 })).status).toBe(400);
    expect((await kit.call('admin', 'PATCH', '/admin/copilot/settings', { calendar: { start: '9am' } })).status).toBe(400);
    await kit.call('admin', 'PATCH', '/admin/copilot/settings', { autonomy: { add_ai_note: true }, acceptSlaHours: 4 });
  });

  it('kill switch: off overall or per role stops the Copilot with a clear message; the CRM keeps working', async () => {
    await kit.call('admin', 'PATCH', '/admin/copilot/settings', { roles: { salesperson: false } });
    expect((await ask('rep1', 'hello')).error).toMatchObject({ code: 'AI_DISABLED' });
    expect((await ask('manager', 'hello')).done.status).toBe('completed');
    await kit.call('admin', 'PATCH', '/admin/copilot/settings', { enabled: false, roles: { salesperson: true } });
    expect((await ask('manager', 'hello')).error).toMatchObject({ code: 'AI_DISABLED' });
    expect(kit.ai.converseCalls).toHaveLength(1);
    expect((await kit.call('rep1', 'GET', '/deals')).status).toBe(200);
    await kit.call('admin', 'PATCH', '/admin/copilot/settings', { enabled: true });
  });

  it('budget: 80 % alerts the admins once a month; 100 % stops the Copilot, not the CRM', async () => {
    await kit.call('admin', 'PATCH', '/admin/copilot/settings', { monthlyBudgetUsd: 10 });
    await spend(8.5);
    expect((await ask('rep1', 'my deals')).done.status).toBe('completed');
    await ask('rep1', 'my deals again');
    const alerts = await kit.ctx.db.select().from(schema.notification).where(eq(schema.notification.eventType, 'copilot.budget_alert'));
    expect(alerts).toHaveLength(1);
    expect(alerts[0]?.recipientUserId).toBe(kit.ids.admin);
    expect((await kit.call('admin', 'GET', '/admin/copilot/settings')).json.budget).toMatchObject({ monthlyBudgetUsd: 10, percentUsed: 85 });

    await spend(2);
    const stopped = await ask('rep1', 'my deals');
    expect(stopped.error).toMatchObject({ code: 'AI_QUOTA_EXCEEDED' });
    expect(stopped.error.message).toMatch(/rest of the CRM works/);
    expect((await kit.call('rep1', 'GET', '/deals')).status).toBe(200);
    expect((await kit.call('rep1', 'POST', '/leads', { name: 'Still works' })).status).toBeLessThan(500);
    await kit.call('admin', 'PATCH', '/admin/copilot/settings', { monthlyBudgetUsd: 250 });
  });

  it('usage shows counts, costs, rates and latency — and no chat content', async () => {
    const secret = 'Zebra-question-7731';
    await ask('manager', `What about ${secret}?`);
    const u = await kit.call('admin', 'GET', '/admin/copilot/usage?days=30');
    expect(u.status, u.text).toBe(200);
    expect(u.json.runs.length).toBeGreaterThan(0);
    expect(u.json.quality).toHaveProperty('firstWordsMs');
    expect(u.json.costByFeature.some((c: { feature: string }) => c.feature === 'copilot_chat')).toBe(true);
    expect(u.json.actions).toHaveProperty('undoRatePercent');
    expect(u.json.sla).toHaveProperty('acceptedWithinSlaPercent');
    expect(u.text).not.toContain(secret);
    expect((await kit.call('manager', 'GET', '/admin/copilot/usage')).status).toBe(403);
  });
});
