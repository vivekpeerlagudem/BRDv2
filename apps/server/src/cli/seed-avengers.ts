/**
 * `pnpm db:seed:avengers` — a clean, simple demo dataset for the DEVELOPMENT database (Avengers theme, company Kensium).
 *
 * It WIPES all business data (companies, people, opportunities, leads, tasks, proposals, estimates, weekly reports,
 * audit and timeline history, catalogue and templates — the same tables as `db:reset:dev --demo`), keeps users,
 * organization settings and the pipeline, and then creates:
 *   - users: Tony Stark (admin), Captain America (sales manager of team "Avengers"), Spider-Man and Black Widow
 *     (salespeople in Avengers; Black Widow is the former "Jordan Patel"); every other user is deactivated. Passwords
 *     are not touched;
 *   - organization "Kensium", footer "Kensium — Confidential", weekly schedule Monday 09:00, AI and the weekly
 *     report switch on;
 *   - 3 products and one published template "Kensium services proposal";
 *   - 3 clients, each with contacts, one opportunity, an estimates sheet (e2e/fixtures/estimates-*.csv), scope tasks
 *     ([S-001], [S-002] completed last week, [S-003] due soon, [S-004] overdue), a plain task and a meeting last week;
 *   - 2 leads for Spider-Man;
 *   - one weekly report per client, generated as the client's owner.
 *
 * SAFETY: refuses NODE_ENV=production and any database whose name does not end in `_dev`.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { buildContext } from '../composition.ts';
import { loadConfig } from '../config/env.ts';
import { salesBriefRun } from '../db/schema-sales-brief.ts';
import { weeklyReportRun } from '../db/schema-weekly-reports.ts';
import { addTeamMember, createTeam, renameTeam } from '../modules/admin.ts';
import { updateSettings as updateAiSettings } from '../modules/ai.ts';
import { seedCopilotDemo } from '../modules/copilot/demo-seed.ts';
import {
  closeDealLost,
  closeDealWon,
  completeTask,
  convertLead,
  createCompany,
  createContact,
  createDeal,
  createLead,
  createTask,
  disqualifyLead,
  logActivity,
  moveDealStage,
  qualifyLead,
} from '../modules/crm.ts';
import { hasOpenSignature, voidOpenSignature } from '../modules/esign.ts';
import { deactivateUser, patchUser } from '../modules/identity.ts';
import {
  createProduct,
  createProposal,
  createTemplate,
  getProposal,
  getTemplate,
  publishTemplate,
  saveDraft,
  saveTemplateDraft,
  sendProposal,
} from '../modules/proposals.ts';
import { requestSalesBrief } from '../modules/sales-brief.ts';
import { createLinks } from '../modules/sharing.ts';
import { importEstimatesCsv } from '../modules/weekly-reports/estimates.ts';
import { metricValue } from '../modules/weekly-reports/metrics.ts';
import { lastFullWeek, periodInstants } from '../modules/weekly-reports/period.ts';
import { requestWeeklyReport, updateWeeklyReportSettings } from '../modules/weekly-reports.ts';
import { runDueJobs } from '../modules/workflow.ts';
import { BrowserPdfRenderer } from '../platform/adapters.ts';
import { buildUserActor, schema, type Uow, type UserActor } from '../platform/core.ts';

const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('db:seed:avengers must not run in production.');
const dbName = (url: string | undefined) => (url ? decodeURIComponent(new URL(url).pathname.replace(/^\//, '')) : '');
const migratorUrl = process.env.DATABASE_URL_MIGRATOR;
if (!migratorUrl) throw new Error('DATABASE_URL_MIGRATOR is not set (needed to clear append-only history).');
for (const name of [dbName(config.DATABASE_URL), dbName(migratorUrl)])
  if (!name.endsWith('_dev')) throw new Error(`Refusing: database "${name}" does not end in _dev. This seed only runs on the development database.`);

const root = fileURLToPath(new URL('../../../../', import.meta.url));
const DAY = 86_400_000;

// The same tables as `db:reset:dev --demo` (apps/server/src/cli/reset-dev.ts).
const WIPE = [
  'activity_log',
  'ai_generation',
  'ai_review',
  'ai_usage',
  'audit_log',
  'automation_execution',
  'buyer_response',
  'buyer_session',
  'client_estimate_source',
  'company',
  'contact',
  'deal',
  'deal_contact',
  'deal_flag',
  'deal_stage_history',
  'download_event',
  'esign_webhook_inbox',
  'estimate_import',
  'estimate_item',
  'file_object',
  'import_batch',
  'import_record_link',
  'import_row',
  'job_outbox',
  'lead',
  'lead_form_submission',
  'note',
  'notification',
  'proposal',
  'proposal_version',
  'sales_brief_run',
  'share_link',
  'signature_event',
  'signature_request',
  'signed_document',
  'signer',
  'task',
  'timeline_event',
  'timeline_event_anchor',
  'view_session',
  'viewer_identity',
  'weekly_report_run',
  'agent_action',
  'agent_run',
  'copilot_conversation',
  'copilot_message',
  'record_score',
  'work_assignment',
  'product',
  'proposal_template',
  'template_version',
];

interface Client {
  company: string;
  domain: string;
  industry: string;
  owner: string;
  contacts: { firstName: string; lastName: string; jobTitle: string; email: string }[];
  deal: string;
  amount: string;
  stage: string;
  csv: string;
  tasks: { s1: string; s2: string; s3: string; s4: string; plain: string };
  meeting: string;
}
const CLIENTS: Client[] = [
  {
    company: 'Stark Industries',
    domain: 'starkindustries.example',
    industry: 'Manufacturing',
    owner: 'Spider-Man',
    contacts: [{ firstName: 'Pepper', lastName: 'Potts', jobTitle: 'COO', email: 'pepper.potts@starkindustries.example' }],
    deal: 'Stark Industries – ERP integration',
    amount: '48000',
    stage: 'Proposal sent',
    csv: 'estimates-stark.csv',
    tasks: {
      s1: '[S-001] Run the requirements workshop',
      s2: '[S-002] Sign off the integration design',
      s3: '[S-003] Build the ERP order connector',
      s4: '[S-004] Draft the order status dashboard',
      plain: 'Send Pepper the updated project plan',
    },
    meeting: 'Agreed the ERP test data and the go-live window',
  },
  {
    company: 'Wakanda Design Group',
    domain: 'wakandadesign.example',
    industry: 'Design',
    owner: 'Black Widow',
    contacts: [
      { firstName: 'Shuri', lastName: 'Udaku', jobTitle: 'CTO', email: 'shuri@wakandadesign.example' },
      { firstName: 'Okoye', lastName: 'Milaje', jobTitle: 'Head of Operations', email: 'okoye@wakandadesign.example' },
    ],
    deal: 'Wakanda – Inventory portal',
    amount: '36000',
    stage: 'Negotiation',
    csv: 'estimates-wakanda.csv',
    tasks: {
      s1: '[S-001] Hold the warehouse discovery sessions',
      s2: '[S-002] Get the portal wireframes signed off',
      s3: '[S-003] Build the warehouse inventory sync',
      s4: '[S-004] Design the stock alert screens',
      plain: 'Confirm the training dates with Okoye',
    },
    meeting: 'Shuri approved the wireframes and the sync approach',
  },
  {
    company: 'S.H.I.E.L.D.',
    domain: 'shield.example',
    industry: 'Public sector',
    owner: 'Captain America',
    contacts: [{ firstName: 'Maria', lastName: 'Hill', jobTitle: 'Deputy Director', email: 'maria.hill@shield.example' }],
    deal: 'S.H.I.E.L.D. – Field reporting app',
    amount: '52000',
    stage: 'Discovery',
    csv: 'estimates-shield.csv',
    tasks: {
      s1: '[S-001] Interview field agents on reporting needs',
      s2: '[S-002] Finish the offline-first app design',
      s3: '[S-003] Build mobile report capture',
      s4: '[S-004] Set up the secure sync test environment',
      plain: 'Book the field trial with Maria Hill',
    },
    meeting: 'Maria Hill confirmed the two units for the field trial',
  },
];

const pdf = new BrowserPdfRenderer(config.PDF_BROWSER_CHANNEL);
const { ctx, pool } = buildContext({ ...config, LOG_LEVEL: 'warn' }, { pdf });
const { appUserProfile, team, teamMembership, organizationSettings, pipelineStage, task } = schema;
try {
  // ── a. Wipe business data (migrator role: the app role may not delete append-only history) ──────────────────────
  const admin = new pg.Client({ connectionString: migratorUrl });
  await admin.connect();
  try {
    await admin.query(`TRUNCATE ${WIPE.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`);
  } finally {
    await admin.end();
  }

  // ── c. Users and team ────────────────────────────────────────────────────────────────────────────────────────────
  const users = await ctx.db.select().from(appUserProfile);
  const byName = (...names: string[]) => users.find((u) => names.includes(u.fullName));
  const tony = byName('Tony Stark');
  const cap = byName('Captain America');
  const spidey = byName('Spider-Man');
  const widow = byName('Black Widow', 'Jordan Patel');
  if (!tony || !cap || !spidey || !widow)
    throw new Error('Expected the users Tony Stark, Captain America, Spider-Man and Jordan Patel (or Black Widow). Run the Marvel seed first.');
  const actor = async (userId: string): Promise<UserActor> => {
    const a = await buildUserActor(ctx.db, userId);
    if (!a) throw new Error(`User ${userId} is not active.`);
    return a;
  };
  const tonyA = await actor(tony.userId);
  if (widow.fullName !== 'Black Widow') await patchUser(ctx, tonyA, widow.userId, { fullName: 'Black Widow' });
  const keep = new Set([tony.userId, cap.userId, spidey.userId, widow.userId]);
  let deactivated = 0;
  for (const u of users.filter((x) => !keep.has(x.userId) && x.status !== 'deactivated')) {
    await deactivateUser(ctx, tonyA, u.userId, tony.userId);
    deactivated++;
  }
  const teams = await ctx.db.select().from(team);
  let avengers = teams.find((t) => t.name === 'Avengers');
  if (!avengers) {
    const managed = await ctx.db.select().from(schema.teamManager).where(eq(schema.teamManager.userId, cap.userId));
    const capTeam = teams.find((t) => managed.some((m) => m.teamId === t.id));
    avengers = capTeam
      ? { ...capTeam, ...(await renameTeam(ctx, tonyA, capTeam.id, { name: 'Avengers' })) }
      : { ...(teams[0] as (typeof teams)[number]), ...(await createTeam(ctx, tonyA, { name: 'Avengers', managerIds: [cap.userId] })) };
  }
  for (const u of [spidey, widow]) await addTeamMember(ctx, tonyA, avengers.id, { userId: u.userId, move: true });
  await ctx.db
    .update(teamMembership)
    .set({ isActive: true })
    .where(inArray(teamMembership.userId, [spidey.userId, widow.userId]));

  // ── b. Organization, schedule, AI ───────────────────────────────────────────────────────────────────────────────
  const [org] = await ctx.db.select().from(organizationSettings);
  if (!org) throw new Error('Organization settings are missing.');
  await ctx.db
    .update(organizationSettings)
    .set({ organizationName: 'Kensium', branding: { ...org.branding, footerText: 'Kensium — Confidential' }, updatedAt: ctx.now() })
    .where(eq(organizationSettings.id, org.id));
  await updateWeeklyReportSettings(ctx, tonyA, { enabled: true, runWeekday: 1, runTime: '09:00' });
  const ai = org.aiSettings as { perUserDailyCalls?: number; monthlyBudgetUsd?: number; features?: Record<string, boolean> };
  await updateAiSettings(ctx, tonyA, {
    enabled: true,
    perUserDailyCalls: Math.max(ai.perUserDailyCalls ?? 50, 200),
    monthlyBudgetUsd: ai.monthlyBudgetUsd ?? 50,
    features: {
      draft_section: true,
      presend_review: true,
      deal_summary: true,
      rewrite_text: true,
      follow_up_email: true,
      weekly_report: true,
      sales_brief: true,
    },
  });

  // ── d. Catalogue and template ───────────────────────────────────────────────────────────────────────────────────
  await createProduct(ctx, tonyA, {
    name: 'Implementation package',
    description: 'Discovery, build, testing and go-live by the Kensium delivery team',
    sku: 'KEN-IMPL',
    unit: 'package',
    unitPrice: '25000',
    taxRatePercent: '0',
    billingType: 'one_time',
  });
  await createProduct(ctx, tonyA, {
    name: 'Platform subscription',
    description: 'Hosted platform, updates and monitoring',
    sku: 'KEN-SUB',
    unit: 'month',
    unitPrice: '1500',
    taxRatePercent: '0',
    billingType: 'recurring',
    billingPeriod: 'month',
  });
  await createProduct(ctx, tonyA, {
    name: 'Support plan',
    description: 'Business-hours support with a named contact',
    sku: 'KEN-SUP',
    unit: 'month',
    unitPrice: '600',
    taxRatePercent: '0',
    billingType: 'recurring',
    billingPeriod: 'month',
  });
  const tpl = await createTemplate(ctx, tonyA, { name: 'Kensium services proposal', description: 'Standard proposal for Kensium implementation projects' });
  const draft = (await getTemplate(ctx, tonyA, tpl.id)).draft;
  if (!draft) throw new Error('The new template has no draft.');
  const content = structuredClone(draft.content) as Parameters<typeof saveTemplateDraft>[3];
  for (const s of content.sections)
    if (s.id === 'scope')
      s.body =
        'Kensium will deliver the work in four phases: discovery, build, testing and launch. Each phase ends with a short review with {{company.name}}, and progress is reported every week.';
  await saveTemplateDraft(ctx, tonyA, tpl.id, content);
  await publishTemplate(ctx, tonyA, tpl.id);

  // ── e–g. Clients, contacts, opportunities, estimates, tasks, meeting ───────────────────────────────────────────
  const stages = await ctx.db.select().from(pipelineStage);
  const stageId = (name: string) => {
    const s = stages.find((x) => x.name === name);
    if (!s) throw new Error(`Pipeline stage "${name}" not found.`);
    return s.id;
  };
  const timeZone = org.timeZone;
  const week = lastFullWeek(ctx.now(), timeZone);
  const { startInstant, endInstant } = periodInstants(week.periodStart, week.periodEnd, timeZone);
  const inWeek = (day: number, hour: number) => new Date(startInstant.getTime() + (day * 24 + hour) * 3_600_000);
  const owners: Record<string, string> = { 'Spider-Man': spidey.userId, 'Black Widow': widow.userId, 'Captain America': cap.userId };
  const created: { client: Client; companyId: string; dealId: string; contactIds: string[]; ownerA: UserActor }[] = [];
  for (const c of CLIENTS) {
    const ownerA = await actor(owners[c.owner] as string);
    const company = await createCompany(ctx, ownerA, { name: c.company, domain: c.domain, industry: c.industry });
    const contactIds: string[] = [];
    for (const p of c.contacts) contactIds.push((await createContact(ctx, ownerA, { ...p, companyId: company.id })).id);
    const deal = await createDeal(ctx, ownerA, {
      name: c.deal,
      companyId: company.id,
      stageId: stageId(c.stage),
      amount: c.amount,
      closeDate: new Date(ctx.now().getTime() + 45 * DAY).toISOString().slice(0, 10),
      contactIds,
    });
    await importEstimatesCsv(ctx, ownerA, company.id, { fileName: c.csv, text: readFileSync(join(root, 'e2e', 'fixtures', c.csv), 'utf8') });
    // For one client the admin holds and logs the work, so that rep shows "open deals, no logged activity" in the sales brief.
    const logger = c.owner === 'Black Widow' ? tonyA : ownerA;
    const add = (title: string, dueAt: Date) =>
      createTask(ctx, ownerA, { title, relatedType: 'deal', relatedId: deal.id, assigneeId: logger.userId, dueAt: dueAt.toISOString() });
    const t1 = await add(c.tasks.s1, inWeek(1, 17));
    const t2 = await add(c.tasks.s2, inWeek(3, 17));
    await add(c.tasks.s3, new Date(endInstant.getTime() + 4 * DAY)); // due in the coming week
    await add(c.tasks.s4, inWeek(4, 17)); // due last week and still open: overdue
    await add(c.tasks.plain, new Date(ctx.now().getTime() + 2 * DAY));
    await completeTask(ctx, logger, t1.id);
    await completeTask(ctx, logger, t2.id);
    // The CRM stamps "now" on completion; the weekly report covers last week, so move both completions into it.
    await ctx.db
      .update(task)
      .set({ completedAt: inWeek(1, 15) })
      .where(eq(task.id, t1.id));
    await ctx.db
      .update(task)
      .set({ completedAt: inWeek(3, 11) })
      .where(eq(task.id, t2.id));
    await logActivity(ctx, logger, {
      kind: 'meeting',
      occurredAt: inWeek(2, 15).toISOString(),
      durationMinutes: 45,
      outcome: c.meeting,
      relatedType: 'deal',
      relatedId: deal.id,
    });
    created.push({ client: c, companyId: company.id, dealId: deal.id, contactIds, ownerA });
  }

  // ── h. Leads and two weeks of sales activity (for the weekly sales brief) ──────────────────────────────────────
  // The CRM stamps "now" on creation, conversion and closing, and the audit log uses the database clock. The brief
  // covers LAST week and compares it with the week before, so those times are moved with the migrator role.
  const spideyA = await actor(spidey.userId);
  const widowA = await actor(widow.userId);
  const capA = await actor(cap.userId);
  const raw = new pg.Client({ connectionString: migratorUrl });
  await raw.connect();
  const briefDemo = { leads: 0, deals: 0, proposals: 0 };
  try {
    const W = (day: number, hour = 10) => inWeek(day, hour); // last full week
    const P = (day: number, hour = 10) => new Date(inWeek(day, hour).getTime() - 7 * DAY); // the week before
    const lostReasons = await ctx.db.select().from(schema.lostReason);
    const lostReason = lostReasons.find((r) => /price|budget/i.test(r.name)) ?? lostReasons[0];
    if (!lostReason) throw new Error('No lost reason is configured.');

    // The three client opportunities were opened a few weeks ago.
    await raw.query("update deal set created_at = $1, stage_entered_at = $2 where status = 'open'", [
      new Date(startInstant.getTime() - 21 * DAY),
      new Date(endInstant.getTime() - 4 * DAY),
    ]);

    const LEADS: {
      name: string;
      company: string;
      title: string;
      source: string;
      at: Date;
      qualify?: Date;
      disqualify?: Date;
      convert?: { at: Date; amount: string };
    }[] = [
      { name: 'Peter Quill', company: 'Guardians Logistics', title: 'Founder', source: 'referral', at: W(0) },
      { name: 'Carol Danvers', company: 'Danvers Aerospace', title: 'Programme Director', source: 'web form', at: W(1), qualify: W(2) },
      {
        name: 'Stephen Strange',
        company: 'Sanctum Clinics',
        title: 'Medical Director',
        source: 'referral',
        at: W(1),
        qualify: W(2),
        convert: { at: W(3), amount: '18000' },
      },
      { name: 'Nick Fury', company: 'Fury Security', title: 'Director', source: 'referral', at: W(2), qualify: W(3), convert: { at: W(4), amount: '24000' } },
      { name: 'Scott Lang', company: 'Lang Electronics', title: 'Owner', source: 'event', at: W(3), disqualify: W(4) },
      {
        name: 'Wanda Maximoff',
        company: 'Maximoff Studios',
        title: 'Managing Partner',
        source: 'web form',
        at: P(0),
        qualify: P(1),
        convert: { at: P(2), amount: '15000' },
      },
      { name: 'Sam Wilson', company: 'Wilson Air Charter', title: 'Operations Lead', source: 'event', at: P(1), qualify: P(3) },
      { name: 'Bruce Banner', company: 'Banner Labs', title: 'Head of Research', source: 'referral', at: P(2) },
      { name: 'Thor Odinson', company: 'Asgard Brewing', title: 'Owner', source: 'web form', at: P(3) },
      { name: 'Clint Barton', company: 'Barton Outdoor', title: 'Founder', source: 'event', at: P(4) },
    ];
    const converted: Record<string, string> = {};
    for (const l of LEADS) {
      const row = await createLead(ctx, spideyA, {
        name: l.name,
        companyName: l.company,
        email: `${l.name.toLowerCase().replace(/[^a-z]+/g, '.')}@${l.company.toLowerCase().replace(/[^a-z]+/g, '')}.example`,
        jobTitle: l.title,
        source: l.source,
      });
      briefDemo.leads++;
      await raw.query('update lead set created_at = $1 where id = $2', [l.at, row.id]);
      if (l.qualify) {
        await qualifyLead(ctx, spideyA, row.id);
        await raw.query("update audit_log set occurred_at = $1 where action = 'lead.qualified' and target_id = $2", [l.qualify, row.id]);
      }
      if (l.disqualify) {
        await disqualifyLead(ctx, spideyA, row.id, { reason: 'No budget this year' });
        await raw.query("update audit_log set occurred_at = $1 where action = 'lead.disqualified' and target_id = $2", [l.disqualify, row.id]);
      }
      if (l.convert) {
        const done = await convertLead(ctx, spideyA, row.id, {
          createDeal: true,
          dealName: `${l.company} – ${l.source === 'web form' ? 'Client portal' : 'Booking system'}`,
          amount: l.convert.amount,
        });
        await raw.query('update lead set converted_at = $1 where id = $2', [l.convert.at, row.id]);
        if (done.dealId) {
          await raw.query('update deal set created_at = $1, stage_entered_at = $1 where id = $2', [l.convert.at, done.dealId]);
          converted[l.name] = done.dealId;
          briefDemo.deals++;
        }
      }
    }

    // Opportunities opened directly by the reps.
    const direct = async (a: UserActor, company: string, name: string, stage: string, amount: string, createdAt: Date) => {
      const co = await createCompany(ctx, a, { name: company, domain: `${company.toLowerCase().replace(/[^a-z]+/g, '')}.example` });
      const d = await createDeal(ctx, a, {
        name,
        companyId: co.id,
        stageId: stageId(stage),
        amount,
        closeDate: new Date(ctx.now().getTime() + 30 * DAY).toISOString().slice(0, 10),
      });
      await raw.query('update deal set created_at = $1, stage_entered_at = $1 where id = $2', [createdAt, d.id]);
      briefDemo.deals++;
      return d.id;
    };
    const pym = await direct(spideyA, 'Pym Technologies', 'Pym Technologies – Sensor hub', 'Qualification', '30000', W(1));
    const oscorp = await direct(capA, 'Oscorp', 'Oscorp – Lab portal', 'Proposal sent', '22000', P(1));
    const bugle = await direct(widowA, 'Daily Bugle', 'Daily Bugle – Archive search', 'Discovery', '9000', P(2));
    const hydra = await direct(capA, 'Hydra Freight', 'Hydra Freight – Shipment tracking', 'Discovery', '28000', new Date(startInstant.getTime() - 35 * DAY));

    // Stage moves last week: two opportunities advanced.
    const advance = async (a: UserActor, dealId: string, to: string, when: Date) => {
      const [d] = await ctx.db.select({ rowVersion: schema.deal.rowVersion }).from(schema.deal).where(eq(schema.deal.id, dealId));
      await moveDealStage(ctx, a, dealId, stageId(to), d?.rowVersion ?? 1);
      await raw.query('update deal_stage_history set changed_at = $1 where deal_id = $2 and from_stage_id is not null', [when, dealId]);
      await raw.query('update deal set stage_entered_at = $1 where id = $2', [when, dealId]);
    };
    await advance(spideyA, pym, 'Discovery', W(3));
    if (converted['Stephen Strange']) await advance(spideyA, converted['Stephen Strange'], 'Discovery', W(4));

    // Two deals won and one lost last week.
    const closeAt = (dealId: string, when: Date) => raw.query('update deal set closed_at = $1 where id = $2', [when, dealId]);
    await closeDealWon(ctx, capA, oscorp);
    await closeAt(oscorp, W(2, 16));
    if (converted['Wanda Maximoff']) {
      await closeDealWon(ctx, spideyA, converted['Wanda Maximoff']);
      await closeAt(converted['Wanda Maximoff'], W(4, 11));
    }
    await closeDealLost(ctx, widowA, bugle, { lostReasonId: lostReason.id, note: 'Chose a cheaper off-the-shelf tool' }, voidOpenSignature, hasOpenSignature);
    await closeAt(bugle, W(3, 15));

    // The week before was busier on the phone: a few calls, so week-over-week activity differs.
    for (const [a, dealId] of [
      [spideyA, pym],
      [spideyA, pym],
      [capA, hydra],
      [capA, hydra],
      [capA, oscorp],
    ] as const)
      await logActivity(ctx, a, {
        kind: 'call',
        occurredAt: P(2, 14).toISOString(),
        durationMinutes: 20,
        outcome: 'Follow-up call',
        relatedType: 'deal',
        relatedId: dealId,
      });

    // A proposal for Stark Industries, sent through the app's real send path (pre-send checks, frozen version, PDF,
    // tracked link) by the deal owner, then dated to Tuesday of the reported week. Nobody opens the link, so it shows
    // as "proposal not viewed" once the follow-up window has passed.
    const stark = created.find((c) => c.client.company === 'Stark Industries');
    if (stark) {
      const proposal = await createProposal(ctx, stark.ownerA, stark.dealId, { templateId: tpl.id, signatureRequired: false });
      const draft = await getProposal(ctx, stark.ownerA, proposal.id);
      const doc = structuredClone(draft.currentVersion.content) as Parameters<typeof saveDraft>[3]['content'];
      for (const sec of doc.sections)
        if (sec.id === 'scope')
          sec.body =
            'Kensium will connect the Stark Industries ERP to the order and warehouse systems in four phases: discovery, build, testing and go-live, with two weeks of hypercare.';
      await saveDraft(ctx, stark.ownerA, proposal.id, {
        content: doc,
        pricing: {
          lines: [
            {
              lineKey: 'impl',
              name: 'Implementation package',
              unit: 'package',
              quantity: '1',
              unitPrice: '42000',
              taxRatePercent: '0',
              billingType: 'one_time',
            },
            { lineKey: 'sub', name: 'Platform subscription', unit: 'month', quantity: '4', unitPrice: '1500', taxRatePercent: '0', billingType: 'one_time' },
          ],
        },
        termMonths: 12,
        rowVersion: draft.currentVersion.rowVersion,
      });
      const contactId = stark.contactIds[0] as string;
      const ports = { createLinks: (u: Uow, args: Parameters<typeof createLinks>[2]) => createLinks(ctx, u, args), voidOpenSignature, hasOpenSignature };
      try {
        await sendProposal(ctx, stark.ownerA, proposal.id, { recipientContactIds: [contactId] }, ports);
      } catch (error) {
        const needed = (error as { code?: string; meta?: { confirmations?: { code: string }[] } }).meta?.confirmations;
        if ((error as { code?: string }).code !== 'CONFIRMATION_REQUIRED' || !needed) throw error;
        await sendProposal(ctx, stark.ownerA, proposal.id, { recipientContactIds: [contactId], confirm: needed.map((c) => c.code) }, ports);
      }
      await raw.query('update proposal_version set sent_at = $1 where proposal_id = $2 and sent_at is not null', [W(1, 11), proposal.id]);
      briefDemo.proposals++;
    }

    // Two deals stalled in the same stage, and one past its expected close date. This comes last: logging an
    // activity on a deal clears its "stalled" flag.
    const shield = created.find((c) => c.client.company === 'S.H.I.E.L.D.');
    const wakanda = created.find((c) => c.client.company === 'Wakanda Design Group');
    const quiet = new Date(startInstant.getTime() - 16 * DAY);
    const stalledIds = [hydra, ...(shield ? [shield.dealId] : [])];
    for (const dealId of stalledIds) {
      await raw.query('update deal set last_activity_at = $1, stage_entered_at = $1 where id = $2', [quiet, dealId]);
      await raw.query("insert into deal_flag (deal_id, kind, raised_at) values ($1, 'stalled', $2) on conflict do nothing", [dealId, W(5, 8)]);
    }
    if (wakanda) {
      await raw.query('update deal set close_date = $1 where id = $2', [week.periodStart, wakanda.dealId]);
      await raw.query("insert into deal_flag (deal_id, kind, raised_at) values ($1, 'past_close_date', $2) on conflict do nothing", [wakanda.dealId, W(2, 8)]);
    }
  } finally {
    await raw.end();
  }

  // ── i. One weekly report per client ────────────────────────────────────────────────────────────────────────────
  const reports: { client: Client; id: string; status: string; health: string; reasons: string[]; pct: string; hours: string }[] = [];
  for (const { client, companyId, ownerA } of created) {
    const { id } = await requestWeeklyReport(ctx, ownerA, companyId);
    let run = (await ctx.db.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, id)))[0];
    for (let i = 0; i < 40 && run && (run.status === 'queued' || run.status === 'running'); i++) {
      await runDueJobs(ctx);
      run = (await ctx.db.select().from(weeklyReportRun).where(eq(weeklyReportRun.id, id)))[0];
    }
    if (!run || (run.status !== 'ready' && run.status !== 'needs_attention'))
      throw new Error(
        `The report for ${client.company} did not finish (status ${run?.status ?? 'missing'}${run?.failureReason ? `, ${run.failureReason}` : ''}).`,
      );
    const doc = run.metrics;
    reports.push({
      client,
      id,
      status: run.status,
      health: doc?.health.level ?? 'n/a',
      reasons: doc?.health.reasons ?? [],
      pct: doc ? `${metricValue(doc, 'E-05') ?? '0.0'}%` : 'n/a',
      hours: doc ? (metricValue(doc, 'E-02') ?? '0') : 'n/a',
    });
  }

  // ── i2. The weekly sales brief for leadership (runs for the admin) ─────────────────────────────────────────────
  const briefRequest = await requestSalesBrief(ctx, tonyA);
  let brief = (await ctx.db.select().from(salesBriefRun).where(eq(salesBriefRun.id, briefRequest.id)))[0];
  for (let i = 0; i < 40 && brief && (brief.status === 'queued' || brief.status === 'running'); i++) {
    await runDueJobs(ctx);
    brief = (await ctx.db.select().from(salesBriefRun).where(eq(salesBriefRun.id, briefRequest.id)))[0];
  }
  if (!brief || (brief.status !== 'ready' && brief.status !== 'needs_attention'))
    throw new Error(`The sales brief did not finish (status ${brief?.status ?? 'missing'}${brief?.failureReason ? `, ${brief.failureReason}` : ''}).`);

  // ── i3. Kensium Copilot demo data: bulk leads, companies and deals over six months, canaries, injection texts ────
  // After the brief on purpose: the brief above keeps describing the small hand-made story.
  const copilotSeed = await seedCopilotDemo(ctx, { password: process.env.SEED_PASSWORD ?? randomUUID() });

  // ── j. Summary ──────────────────────────────────────────────────────────────────────────────────────────────────
  const origin = config.APP_ORIGIN.replace(/\/$/, '');
  const HEALTH_WORDS: Record<string, string> = { green: 'on track', amber: 'needs attention', red: 'at risk' };
  console.log(
    [
      `Avengers demo data for Kensium (database ${dbName(config.DATABASE_URL)}, week ${week.periodStart} to ${week.periodEnd})`,
      '',
      'Users: Tony Stark (admin) · Captain America (sales manager, team Avengers) · Spider-Man, Black Widow (salespeople, team Avengers)' +
        (deactivated ? ` · ${deactivated} other user(s) deactivated` : ''),
      'Catalogue: Implementation package, Platform subscription, Support plan · Template: Kensium services proposal (published)',
      `Sales activity (last two weeks): ${briefDemo.leads} leads (5 qualified, 3 converted, 1 disqualified), ${briefDemo.deals} more opportunities, 2 won, 1 lost, ${briefDemo.proposals} proposal sent and not viewed`,
      '',
      ...reports.flatMap((r) => [
        `${r.client.company} — owner ${r.client.owner}`,
        `  Opportunity  ${r.client.deal}, ${Number(r.client.amount).toLocaleString('en-US')}, stage ${r.client.stage}`,
        `  Estimates    ${Number(r.hours)} h · ${r.pct} complete by estimate`,
        `  Health       ${r.health} (${HEALTH_WORDS[r.health] ?? r.health})${r.reasons.length ? ` — ${r.reasons.join(', ').toLowerCase().replace(/_/g, ' ')}` : ''}`,
        `  Report       ${origin}/weekly-reports/${r.id} [${r.status}]`,
        '',
      ]),
      `Weekly sales brief — ${brief.status}, ${brief.signals.length} findings`,
      ...(brief.metrics?.metrics ?? []).map(
        (m) =>
          `  ${m.id}  ${m.label.padEnd(30)} ${String(m.value ?? '–').padStart(12)}   last week ${m.lastWeek ?? '–'}${m.mtd !== undefined ? ` · MTD ${m.mtd ?? '–'} · QTD ${m.qtd ?? '–'}` : ''}`,
      ),
      ...brief.signals.map((x) => `  [${x.severity}/${x.kind}] ${x.title}`),
      `  Brief        ${origin}/sales-brief/${brief.id}`,
      '',
      `Copilot demo data: ${copilotSeed.leads} leads · ${copilotSeed.companies} companies · ${copilotSeed.deals} deals (${copilotSeed.stageChanges} stage changes) · ${copilotSeed.contacts} contacts · ${copilotSeed.tasks} tasks · ${copilotSeed.notes} notes · ${copilotSeed.activities} calls and meetings · ${copilotSeed.formSubmissions} web-form enquiries · ${copilotSeed.canaries} canary records · ${copilotSeed.injections} planted injection texts · ${copilotSeed.users} active users (${copilotSeed.inserted} rows added by this run)`,
    ].join('\n'),
  );
} finally {
  await pdf.close();
  await pool.end();
}
