/**
 * Kensium Copilot — role home cards (M4): deterministic data per role, scoped, with an optional grounded AI line.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createKit, hasTestDb, PASSWORD } from './copilot-test-kit.ts';
import { agentRun } from './db/schema-copilot.ts';
import { seedCopilotDemo } from './modules/copilot/demo-seed.ts';
import { schema } from './platform/core.ts';

describe.skipIf(!hasTestDb())('Copilot role home cards (PostgreSQL integration)', () => {
  const kit = createKit('Copilot Home Org');
  beforeAll(async () => {
    await kit.reset();
    await seedCopilotDemo(kit.ctx, { password: PASSWORD });
    await kit.signIn('spidey', 'spider.man@northwind.example');
    await kit.signIn('starlord', 'star.lord@northwind.example');
  }, 120_000);
  afterAll(async () => {
    await kit.pool.end();
  });

  it('salesperson: My Day with own tasks due, deals at risk and viewed proposals only', async () => {
    const r = await kit.call('spidey', 'GET', '/copilot/home');
    expect(r.status, r.text).toBe(200);
    expect(r.json).toMatchObject({ kind: 'my_day', title: 'My Day', summary: null });
    const [spidey] = await kit.ctx.db.select().from(schema.appUserProfile).where(eq(schema.appUserProfile.fullName, 'Spider-Man'));
    for (const d of r.json.dealsAtRisk) {
      const [row] = await kit.ctx.db.select().from(schema.deal).where(eq(schema.deal.id, d.id));
      expect(row?.ownerId).toBe(spidey?.userId);
    }
    const flagged = await kit.ctx.db
      .selectDistinct({ id: schema.deal.id })
      .from(schema.deal)
      .innerJoin(schema.dealFlag, and(eq(schema.dealFlag.dealId, schema.deal.id), isNull(schema.dealFlag.clearedAt)))
      .where(and(eq(schema.deal.ownerId, spidey!.userId), eq(schema.deal.status, 'open')));
    expect(r.json.counts.dealsAtRisk).toBeGreaterThan(0);
    expect(r.json.counts.dealsAtRisk).toBeLessThanOrEqual(flagged.length);
    expect(Array.isArray(r.json.tasksDue)).toBe(true);
  });

  it('manager: My Team with stalled deals by rep inside the team and the forecast comparison', async () => {
    const r = await kit.call('starlord', 'GET', '/copilot/home');
    expect(r.json.kind).toBe('my_team');
    expect(r.json.forecast.weightedNow).toMatch(/^\d+\.\d{2}$/);
    expect(r.json.forecast.weightedLastWeek).toMatch(/^\d+\.\d{2}$/);
    const names = r.json.stalledByRep.map((x: { owner: string }) => x.owner);
    expect(names.every((n: string) => ['Star-Lord', 'Gamora', 'Rocket'].includes(n))).toBe(true);
    expect(typeof r.json.approvalsWaiting).toBe('number');
  });

  it('admin: Company view with pipeline, won this week, throughput and Sales Brief status', async () => {
    const r = await kit.call('admin', 'GET', '/copilot/home');
    expect(r.json.kind).toBe('company');
    const report = await kit.call('admin', 'GET', '/reports/dashboard?days=90');
    expect(Number(r.json.pipeline.openValue)).toBe(Number(report.json.kpis.openPipelineValue));
    expect(r.json.throughput30Days.leads).toBeGreaterThan(0);
    expect(r.json.responseTimes30Days).toHaveProperty('medianMinutesToAccept');
  });

  it('the optional AI line copies figures from the card and is recorded as a home run', async () => {
    const r = await kit.call('starlord', 'GET', '/copilot/home?summary=1');
    expect(r.json.summary).toMatch(/^My Team: /);
    const runs = await kit.ctx.db.select().from(agentRun).where(eq(agentRun.kind, 'home'));
    expect(runs.at(-1)).toMatchObject({ status: 'completed', groundingFailures: 0 });
    // A summary with a figure that is not on the card is dropped, not shown.
    kit.ai.enqueueConverse({ text: 'You have 987654 stalled deals.' }, { text: 'Still 987654.' });
    const bad = await kit.call('starlord', 'GET', '/copilot/home?summary=1');
    expect(bad.json.summary).toBeNull();
  });
});
