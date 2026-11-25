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
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq, inArray } from 'drizzle-orm';
import pg from 'pg';
import { buildContext } from '../composition.ts';
import { loadConfig } from '../config/env.ts';
import { weeklyReportRun } from '../db/schema-weekly-reports.ts';
import { addTeamMember, createTeam, renameTeam } from '../modules/admin.ts';
import { updateSettings as updateAiSettings } from '../modules/ai.ts';
import { completeTask, createCompany, createContact, createDeal, createLead, createTask, logActivity, qualifyLead } from '../modules/crm.ts';
import { deactivateUser, patchUser } from '../modules/identity.ts';
import { createProduct, createTemplate, getTemplate, publishTemplate, saveTemplateDraft } from '../modules/proposals.ts';
import { importEstimatesCsv } from '../modules/weekly-reports/estimates.ts';
import { metricValue } from '../modules/weekly-reports/metrics.ts';
import { lastFullWeek, periodInstants } from '../modules/weekly-reports/period.ts';
import { requestWeeklyReport, updateWeeklyReportSettings } from '../modules/weekly-reports.ts';
import { runDueJobs } from '../modules/workflow.ts';
import { StubPdfRenderer } from '../platform/adapters.ts';
import { buildUserActor, schema, type UserActor } from '../platform/core.ts';

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

const { ctx, pool } = buildContext({ ...config, LOG_LEVEL: 'warn' }, { pdf: new StubPdfRenderer() });
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
    features: { draft_section: true, presend_review: true, deal_summary: true, rewrite_text: true, follow_up_email: true, weekly_report: true },
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
  const created: { client: Client; companyId: string; ownerA: UserActor }[] = [];
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
    const add = (title: string, dueAt: Date) =>
      createTask(ctx, ownerA, { title, relatedType: 'deal', relatedId: deal.id, assigneeId: ownerA.userId, dueAt: dueAt.toISOString() });
    const t1 = await add(c.tasks.s1, inWeek(1, 17));
    const t2 = await add(c.tasks.s2, inWeek(3, 17));
    await add(c.tasks.s3, new Date(endInstant.getTime() + 4 * DAY)); // due in the coming week
    await add(c.tasks.s4, inWeek(4, 17)); // due last week and still open: overdue
    await add(c.tasks.plain, new Date(ctx.now().getTime() + 2 * DAY));
    await completeTask(ctx, ownerA, t1.id);
    await completeTask(ctx, ownerA, t2.id);
    // The CRM stamps "now" on completion; the weekly report covers last week, so move both completions into it.
    await ctx.db
      .update(task)
      .set({ completedAt: inWeek(1, 15) })
      .where(eq(task.id, t1.id));
    await ctx.db
      .update(task)
      .set({ completedAt: inWeek(3, 11) })
      .where(eq(task.id, t2.id));
    await logActivity(ctx, ownerA, {
      kind: 'meeting',
      occurredAt: inWeek(2, 15).toISOString(),
      durationMinutes: 45,
      outcome: c.meeting,
      relatedType: 'deal',
      relatedId: deal.id,
    });
    created.push({ client: c, companyId: company.id, ownerA });
  }

  // ── h. Leads ────────────────────────────────────────────────────────────────────────────────────────────────────
  const spideyA = await actor(spidey.userId);
  await createLead(ctx, spideyA, {
    name: 'Peter Quill',
    companyName: 'Guardians Logistics',
    email: 'peter.quill@guardianslogistics.example',
    jobTitle: 'Founder',
    source: 'referral',
    notes: 'Needs shipment tracking for a small fleet. Asked for a call next week.',
  });
  const carol = await createLead(ctx, spideyA, {
    name: 'Carol Danvers',
    companyName: 'Danvers Aerospace',
    email: 'carol.danvers@danversaerospace.example',
    jobTitle: 'Programme Director',
    source: 'web form',
    notes: 'Budget approved for a supplier portal in Q1. Ready to convert.',
  });
  await qualifyLead(ctx, spideyA, carol.id);

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
      'Leads (Spider-Man): Peter Quill – Guardians Logistics (new), Carol Danvers – Danvers Aerospace (qualified)',
      '',
      ...reports.flatMap((r) => [
        `${r.client.company} — owner ${r.client.owner}`,
        `  Opportunity  ${r.client.deal}, ${Number(r.client.amount).toLocaleString('en-US')}, stage ${r.client.stage}`,
        `  Estimates    ${Number(r.hours)} h · ${r.pct} complete by estimate`,
        `  Health       ${r.health} (${HEALTH_WORDS[r.health] ?? r.health})${r.reasons.length ? ` — ${r.reasons.join(', ').toLowerCase().replace(/_/g, ' ')}` : ''}`,
        `  Report       ${origin}/weekly-reports/${r.id} [${r.status}]`,
        '',
      ]),
    ].join('\n'),
  );
} finally {
  await pool.end();
}
