/**
 * Kensium Copilot — accept-and-escalate (M5) with a FAKE CLOCK, against a REAL PostgreSQL test database.
 * Calendar: Mon–Fri 09:00–18:00 UTC; accept within 4 business hours, reminder at 50 %, then the team manager,
 * then (4 more business hours) an admin. The kit's clock starts on Wednesday 2026-11-18 10:00 UTC.
 */
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createKit, hasTestDb } from './copilot-test-kit.ts';
import { workAssignment } from './db/schema-copilot.ts';
import * as crm from './modules/crm.ts';
import { runDueJobs, runScheduledScans } from './modules/workflow.ts';
import { schema } from './platform/core.ts';

describe.skipIf(!hasTestDb())('Copilot accept-and-escalate (PostgreSQL integration, fake clock)', () => {
  const kit = createKit('Copilot SLA Org');
  const at = (iso: string) => {
    kit.clock.now = new Date(iso);
  };
  const newLead = async (name: string) => {
    const r = await kit.call('admin', 'POST', '/leads', { name });
    expect(r.status, r.text).toBe(201);
    return r.json.id as string;
  };
  const assign = async (leadId: string, to: string, who = 'admin') => {
    const r = await kit.call(who, 'POST', `/leads/${leadId}/assign`, { ownerId: kit.ids[to] });
    expect(r.status, r.text).toBeLessThan(300);
    await runDueJobs(kit.ctx);
  };
  const assignmentFor = async (recordId: string) =>
    (await kit.ctx.db.select().from(workAssignment).where(eq(workAssignment.recordId, recordId))).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const notes = async (userKey: string, type: string) =>
    kit.ctx.db
      .select()
      .from(schema.notification)
      .where(and(eq(schema.notification.recipientUserId, kit.ids[userKey] as string), eq(schema.notification.eventType, type)));

  beforeAll(async () => {
    await kit.reset();
  }, 120_000);
  beforeEach(() => at('2026-11-18T10:00:00.000Z'));
  afterAll(async () => {
    await kit.pool.end();
  });

  it('a manual assignment gets a 4-business-hour deadline, a reminder at 50 %, and is accepted within the limit', async () => {
    const lead = await newLead('Ayo Accept');
    await assign(lead, 'rep1');
    const [a] = await assignmentFor(lead);
    expect(a).toMatchObject({ status: 'pending', assigneeId: kit.ids.rep1, source: 'manual' });
    expect(a?.acceptDueAt.toISOString()).toBe('2026-11-18T14:00:00.000Z');
    expect(a?.reminderAt?.toISOString()).toBe('2026-11-18T12:00:00.000Z');
    expect((await notes('rep1', 'new_lead_assigned')).length).toBeGreaterThan(0);

    at('2026-11-18T12:05:00.000Z');
    expect((await runScheduledScans(kit.ctx)).copilot.assignments.reminded).toBe(1);
    expect((await runScheduledScans(kit.ctx)).copilot.assignments.reminded).toBe(0); // once
    expect(await notes('rep1', 'assignment_reminder')).toHaveLength(1);

    const mine = await kit.call('rep1', 'GET', '/assignments?mine=1');
    expect(mine.json.items[0]).toMatchObject({ recordLabel: 'Ayo Accept', status: 'pending' });
    expect(mine.json.items[0].secondsLeft).toBe(115 * 60);

    at('2026-11-18T13:00:00.000Z');
    expect((await kit.call('rep2', 'POST', `/assignments/${a!.id}/accept`)).status).toBe(404); // not in rep2's scope
    const ok = await kit.call('rep1', 'POST', `/assignments/${a!.id}/accept`);
    expect(ok.status, ok.text).toBe(200);
    const [done] = await assignmentFor(lead);
    expect(done).toMatchObject({ status: 'accepted', minutesToAccept: 180, businessMinutesToAccept: 180, acceptedWithinSla: true, acceptedBy: kit.ids.rep1 });
    expect((await kit.call('rep1', 'POST', `/assignments/${a!.id}/accept`)).status).toBe(409);
  });

  it('escalates twice: team manager after 4 business hours, then an admin after 4 more; each step notifies', async () => {
    const lead = await newLead('Eli Escalate');
    await assign(lead, 'rep1');
    at('2026-11-18T14:01:00.000Z');
    expect((await runScheduledScans(kit.ctx)).copilot.assignments.escalated).toBe(1);
    let [a] = await assignmentFor(lead);
    expect(a).toMatchObject({ status: 'escalated_manager', escalatedTo: kit.ids.manager, escalationLevel: 1 });
    expect(a?.escalationDueAt?.toISOString()).toBe('2026-11-19T09:01:00.000Z'); // 14:01 + 4 h → overnight
    expect((await notes('manager', 'assignment_escalated')).length).toBeGreaterThan(0);
    expect((await kit.call('manager', 'GET', '/assignments?mine=1')).json.items.map((i: { id: string }) => i.id)).toContain(a!.id);

    at('2026-11-19T09:02:00.000Z');
    await runScheduledScans(kit.ctx);
    [a] = await assignmentFor(lead);
    expect(a).toMatchObject({ status: 'escalated_admin', escalatedTo: kit.ids.admin, escalationLevel: 2 });
    expect((await notes('admin', 'assignment_escalated')).length).toBeGreaterThan(0);
    // The admin accepts for the rep; it is recorded as late.
    const ok = await kit.call('admin', 'POST', `/assignments/${a!.id}/accept`);
    expect(ok.status, ok.text).toBe(200);
    [a] = await assignmentFor(lead);
    expect(a).toMatchObject({ status: 'accepted', acceptedWithinSla: false, acceptedBy: kit.ids.admin, businessMinutesToAccept: 8 * 60 + 2 }); // Wed 10:00–18:00 + Thu 09:00–09:02
  });

  it('a rep with no team escalates straight to an admin', async () => {
    const lead = await newLead('Noa Noteam');
    await assign(lead, 'rep3');
    at('2026-11-18T14:30:00.000Z');
    await runScheduledScans(kit.ctx);
    const [a] = await assignmentFor(lead);
    expect(a).toMatchObject({ status: 'escalated_admin', escalatedTo: kit.ids.admin });
  });

  it('decline notifies the manager, who reassigns; a new assignment starts and the old one is superseded', async () => {
    const lead = await newLead('Dee Decline');
    await assign(lead, 'rep1');
    const [a] = await assignmentFor(lead);
    expect((await kit.call('manager', 'POST', `/assignments/${a!.id}/decline`, { reason: 'x' })).status).toBe(403); // only the rep declines
    const d = await kit.call('rep1', 'POST', `/assignments/${a!.id}/decline`, { reason: 'Conflict of interest' });
    expect(d.status, d.text).toBe(200);
    expect((await notes('manager', 'assignment_declined')).some((n) => n.body.includes('Conflict of interest'))).toBe(true);
    expect((await kit.call('rep1', 'POST', `/assignments/${a!.id}/reassign`, { assigneeId: kit.ids.manager })).status).toBe(403);
    const r = await kit.call('manager', 'POST', `/assignments/${a!.id}/reassign`, { assigneeId: kit.ids.manager });
    expect(r.status, r.text).toBe(200);
    await runDueJobs(kit.ctx); // the lead.assigned event of the owner change must not create a duplicate
    const all = await assignmentFor(lead);
    expect(all.map((x) => x.status)).toEqual(['superseded', 'pending']);
    expect(all[1]).toMatchObject({ assigneeId: kit.ids.manager, source: 'reassignment' });
  });

  it('holidays and weekends are not working time', async () => {
    const [org] = await kit.ctx.db.select().from(schema.organizationSettings);
    await kit.ctx.db.update(schema.organizationSettings).set({ copilotSettings: { calendar: { holidays: ['2026-11-19'] } } });
    at('2026-11-18T16:00:00.000Z');
    const lead = await newLead('Hal Holiday');
    await assign(lead, 'rep1');
    const [a] = await assignmentFor(lead);
    expect(a?.acceptDueAt.toISOString()).toBe('2026-11-20T11:00:00.000Z'); // Wed 2 h + (Thu holiday) + Fri 2 h
    await kit.ctx.db.update(schema.organizationSettings).set({ copilotSettings: org?.copilotSettings ?? {} });
  });

  it('a web-form enquiry creates an assignment; the first logged call after it is the first contact; reports show response times', async () => {
    const [org] = await kit.ctx.db.select().from(schema.organizationSettings);
    await crm.submitLead(
      kit.ctx,
      org!.leadFormKey as string,
      { firstName: 'Wanda', lastName: 'Web', email: 'wanda@acme.example', company: 'Acme Web' },
      'ip-hash-1',
    );
    await runDueJobs(kit.ctx);
    const [sub] = await kit.ctx.db
      .select()
      .from(schema.leadSubmission)
      .where(eq(schema.leadSubmission.payload, { firstName: 'Wanda', lastName: 'Web', email: 'wanda@acme.example', company: 'Acme Web' } as never));
    const dealId = sub?.dealId ?? (await kit.ctx.db.select().from(schema.leadSubmission))[0]?.dealId;
    const [a] = await assignmentFor(dealId as string);
    expect(a).toMatchObject({ recordType: 'deal', source: 'web_form', status: 'pending' });
    const owner = Object.entries(kit.ids).find(([, id]) => id === a!.assigneeId)?.[0] as string;

    at('2026-11-18T11:00:00.000Z');
    await kit.call(owner, 'POST', `/assignments/${a!.id}/accept`);
    at('2026-11-18T11:30:00.000Z');
    const call = await kit.call(owner, 'POST', '/activities', {
      kind: 'call',
      occurredAt: '2026-11-18T11:20:00.000Z',
      relatedType: 'deal',
      relatedId: dealId,
      outcome: 'Intro call',
    });
    expect(call.status, call.text).toBeLessThan(300);
    expect((await runScheduledScans(kit.ctx)).copilot.assignments.firstContacts).toBeGreaterThan(0);
    const [b] = await assignmentFor(dealId as string);
    expect(b?.firstContactAt?.toISOString()).toBe('2026-11-18T11:20:00.000Z');

    const report = await kit.call('admin', 'GET', '/reports/overview?from=2026-11-01&to=2026-11-30');
    expect(report.status, report.text).toBe(200);
    expect(report.json.responseTimes.total.accepted).toBeGreaterThanOrEqual(2);
    expect(report.json.responseTimes.byRep.length).toBeGreaterThan(0);
    // A salesperson sees only their own response times.
    const rep = await kit.call('rep1', 'GET', '/reports/overview?from=2026-11-01&to=2026-11-30');
    expect(rep.json.responseTimes.byRep.every((r: { ownerId: string }) => r.ownerId === kit.ids.rep1)).toBe(true);
  });

  it('the Copilot can accept an assignment only through a one-click card', async () => {
    const lead = await newLead('Cara Card');
    await assign(lead, 'rep1');
    kit.ai.enqueueConverse(
      { toolCalls: [{ name: 'my_lead_inbox', input: {} }] },
      { toolCalls: [{ name: 'accept_assignment', input: { assignment: 'A1' } }] },
      { text: 'A card is waiting.' },
    );
    kit.clock.now = new Date(kit.clock.now.getTime() + 61_000);
    const c = await kit.call('rep1', 'POST', '/copilot/conversations', {});
    const res = await kit.sse('rep1', `/copilot/conversations/${c.json.id}/turns`, { message: 'Accept my new lead' });
    const card = res.events.find((e) => e.event === 'action')?.data;
    expect(card).toMatchObject({ tool: 'accept_assignment', tier: 'approval', status: 'proposed' });
    expect((await assignmentFor(lead))[0]?.status).toBe('pending');
    expect((await kit.call('rep1', 'POST', `/copilot/actions/${card.id}/approve`)).json.status).toBe('approved');
    expect((await assignmentFor(lead))[0]?.status).toBe('accepted');
  });
});
