/**
 * `pnpm db:seed` — bootstraps an EMPTY development database and adds realistic demonstration data by calling the
 * real services (so every invariant, audit entry and timeline event is genuine). It refuses to run twice and
 * never touches existing data. The demo password is generated and stored in .env.local (SEED_PASSWORD), not in code.
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import { buildContext } from '../composition.ts';
import { loadConfig } from '../config/env.ts';
import * as crm from '../modules/crm.ts';
import { bootstrap, insertUser } from '../modules/identity.ts';
import * as proposals from '../modules/proposals.ts';
import { StubPdfRenderer } from '../platform/adapters.ts';
import { buildUserActor, schema } from '../platform/core.ts';

const config = loadConfig();
const { ctx, pool } = buildContext({ ...config, LOG_LEVEL: 'warn' }, { pdf: new StubPdfRenderer() });
const [existing] = await ctx.db.select({ id: schema.organizationSettings.id }).from(schema.organizationSettings);
if (existing) {
  console.log('Database is already bootstrapped — nothing changed.');
  await pool.end();
  process.exit(0);
}
let password = process.env.SEED_PASSWORD;
if (!password) {
  password = `Demo-${randomBytes(9).toString('base64url')}-1a`;
  appendFileSync(fileURLToPath(new URL('../../../../.env.local', import.meta.url)), `\nSEED_PASSWORD=${password}\n`);
}
const pw = password;
const mk = (email: string, fullName: string, role: 'admin' | 'sales_manager' | 'salesperson', teamId?: string) => ({
  email,
  fullName,
  role,
  password: pw,
  teamId,
});
const { adminId } = await bootstrap(ctx, {
  organizationName: 'Northwind Solutions',
  currency: 'USD',
  timeZone: 'America/New_York',
  admin: mk('admin@northwind.example', 'Avery Admin', 'admin'),
});
const [team] = await ctx.db.insert(schema.team).values({ name: 'Enterprise East' }).returning();
const ids = await ctx.db.transaction(async (tx) => {
  const manager = await insertUser(tx, mk('morgan@northwind.example', 'Morgan Lee', 'sales_manager'), adminId);
  const rep1 = await insertUser(tx, mk('riley@northwind.example', 'Riley Chen', 'salesperson', team?.id), adminId);
  const rep2 = await insertUser(tx, mk('jordan@northwind.example', 'Jordan Patel', 'salesperson', team?.id), adminId);
  await tx.insert(schema.teamManager).values({ teamId: team!.id, userId: manager });
  await tx.update(schema.appUserProfile).set({ canManageContent: true }).where(eq(schema.appUserProfile.userId, manager));
  return { manager, rep1, rep2 };
});
const admin = (await buildUserActor(ctx.db, adminId))!;
const rep1 = (await buildUserActor(ctx.db, ids.rep1))!;
const rep2 = (await buildUserActor(ctx.db, ids.rep2))!;

const tpl = await proposals.createTemplate(ctx, admin, { name: 'Services proposal', description: 'Standard proposal with pricing and signature block' });
await proposals.publishTemplate(ctx, admin, tpl.id);
const products = [
  { name: 'Implementation package', unit: 'project', unitPrice: '12000', taxRatePercent: '0', billingType: 'one_time' as const },
  { name: 'Platform subscription', unit: 'seat', unitPrice: '85', taxRatePercent: '0', billingType: 'recurring' as const, billingPeriod: 'month' as const },
  { name: 'Premium support', unit: 'plan', unitPrice: '1500', taxRatePercent: '0', billingType: 'recurring' as const, billingPeriod: 'quarter' as const },
  { name: 'Training workshop', unit: 'day', unitPrice: '1800', taxRatePercent: '0', billingType: 'one_time' as const },
];
for (const p of products) await proposals.createProduct(ctx, admin, p);

const { stages } = await crm.getPipeline(ctx);
const open = stages.filter((s) => s.kind === 'open');
type Person = [string, string, string, string];
type DealSeed = [string, string, number];
const data: [typeof rep1, string, string, string, Person[], DealSeed[]][] = [
  [
    rep1,
    'Contoso Manufacturing',
    'contoso.example',
    'Manufacturing',
    [
      ['Dana', 'Whitfield', 'dana.whitfield@contoso.example', 'VP Operations'],
      ['Luis', 'Ortega', 'luis.ortega@contoso.example', 'CFO'],
    ],
    [
      ['Contoso — plant analytics rollout', '48000.00', 1],
      ['Contoso — training programme', '9000.00', 0],
    ],
  ],
  [
    rep1,
    'Fabrikam Logistics',
    'fabrikam.example',
    'Logistics',
    [['Priya', 'Nair', 'priya.nair@fabrikam.example', 'Head of IT']],
    [['Fabrikam — fleet platform', '72000.00', 3]],
  ],
  [
    rep2,
    'Tailspin Retail',
    'tailspin.example',
    'Retail',
    [['Marcus', 'Bell', 'marcus.bell@tailspin.example', 'COO']],
    [['Tailspin — store operations suite', '31000.00', 2]],
  ],
  [
    rep2,
    'Wingtip Health',
    'wingtip.example',
    'Healthcare',
    [['Ingrid', 'Solberg', 'ingrid.solberg@wingtip.example', 'Director of Procurement']],
    [['Wingtip — scheduling pilot', '15500.00', 0]],
  ],
  [
    rep1,
    'Adatum Energy',
    'adatum.example',
    'Energy',
    [['Tomas', 'Reyes', 'tomas.reyes@adatum.example', 'Programme Manager']],
    [['Adatum — field service upgrade', '56000.00', 1]],
  ],
];
for (const [actor, name, domain, industry, people, deals] of data) {
  const co = await crm.createCompany(ctx, actor, { name, domain, industry });
  const contactIds: string[] = [];
  for (const [firstName, lastName, email, jobTitle] of people)
    contactIds.push((await crm.createContact(ctx, actor, { firstName, lastName, email, jobTitle, companyId: co.id })).id);
  for (const [dealName, amount, stageIdx] of deals) {
    const d = await crm.createDeal(ctx, actor, {
      name: dealName,
      companyId: co.id,
      amount,
      stageId: open[stageIdx]?.id,
      contactIds,
      closeDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
    });
    await crm.createNote(ctx, actor, {
      body: 'Discovery call completed. Key drivers: faster reporting and fewer manual steps. Budget confirmed for this quarter.',
      relatedType: 'deal',
      relatedId: d.id,
    });
    await crm.logActivity(ctx, actor, {
      kind: 'call',
      occurredAt: new Date().toISOString(),
      durationMinutes: 30,
      outcome: 'Discovery call',
      relatedType: 'deal',
      relatedId: d.id,
    });
    await crm.createTask(ctx, actor, {
      title: `Prepare proposal for ${name}`,
      relatedType: 'deal',
      relatedId: d.id,
      dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
    });
  }
}
console.log('Seed complete. Users: admin@, morgan@ (manager), riley@, jordan@ — all @northwind.example.');
console.log('Password: SEED_PASSWORD in .env.local (not printed here).');
await pool.end();
