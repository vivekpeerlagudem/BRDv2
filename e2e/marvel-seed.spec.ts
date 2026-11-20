import { test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Marvel-themed demo dataset. Products are created as Admin (content.manage); companies, contacts, deals
 * and a proposal are created as Riley (salesperson) so they are owned by her — visible to Morgan (her
 * manager) and Admin. Admin also creates and publishes the Marvel proposal template and retires stray test users.
 * Best run on a freshly reset dev database (`pnpm db:reset:dev --demo`) for a clean set of 7 companies.
 *
 * Run:  pnpm exec playwright test e2e/marvel-seed.spec.ts
 */
type Api = { post: (p: string, d?: unknown) => Promise<any>; put: (p: string, d: unknown) => Promise<any>; get: (p: string) => Promise<any> };
const makeApi = (page: import('@playwright/test').Page): Api => ({
  post: async (p, d) => (await page.request.post(`/api/v1${p}`, d ? { data: d } : {})).json(),
  put: async (p, d) => (await page.request.put(`/api/v1${p}`, { data: d })).json(),
  get: async (p) => (await page.request.get(`/api/v1${p}`)).json(),
});

test('seed Marvel demo data', async ({ page }) => {
  test.setTimeout(240_000);

  // ── Admin: product catalogue ──
  await login(page, 'admin@northwind.example');
  let api = makeApi(page);
  for (const pr of [
    { name: 'Arc Reactor License', sku: 'ARC-1', unit: 'unit', unitPrice: '100000', taxRatePercent: '0', billingType: 'one_time' },
    { name: 'Vibranium Module', sku: 'VIB-1', unit: 'unit', unitPrice: '50000', taxRatePercent: '0', billingType: 'one_time' },
    { name: 'Shield Security Pack', sku: 'SEC-1', unit: 'unit', unitPrice: '15000', taxRatePercent: '0', billingType: 'one_time' },
    { name: 'Quantum Analytics', sku: 'QA-1', unit: 'month', unitPrice: '2000', taxRatePercent: '0', billingType: 'recurring', billingPeriod: 'month' },
  ])
    await api.post('/products', pr);

  // Marvel proposal template (published, so salespeople can build proposals from it).
  if (!(await api.get('/templates')).some((t: { name: string }) => t.name === 'Avengers services proposal')) {
    const tpl = await api.post('/templates', { name: 'Avengers services proposal', description: 'Marvel demo proposal with pricing and signature block' });
    await api.post(`/templates/${tpl.id}/publish`);
  }

  // Marvel display names for the demo users (logins/emails stay the same).
  const MARVEL_NAMES: Record<string, string> = {
    'admin@northwind.example': 'Tony Stark',
    'morgan@northwind.example': 'Captain America',
    'riley@northwind.example': 'Spider-Man',
  };
  const all = await api.get('/users');
  for (const u of (all.items ?? all) as { id: string; email: string; fullName: string }[])
    if (MARVEL_NAMES[u.email] && u.fullName !== MARVEL_NAMES[u.email])
      await page.request.patch(`/api/v1/users/${u.id}`, { data: { fullName: MARVEL_NAMES[u.email] } });

  // Keep only the seeded demo users (admin, sales manager, salespeople); retire users created by test runs.
  const KEEP = ['admin@northwind.example', 'morgan@northwind.example', 'riley@northwind.example', 'jordan@northwind.example'];
  const userList = await api.get('/users');
  const users: { id: string; email: string; status?: string; deactivatedAt?: string | null }[] = userList.items ?? userList;
  const adminId = users.find((u) => u.email === KEEP[0])?.id;
  for (const u of users)
    if (adminId && !KEEP.includes(u.email) && u.status !== 'deactivated' && !u.deactivatedAt)
      await api.post(`/users/${u.id}/deactivate`, { reassignToUserId: adminId });

  // ── Riley: companies, contacts, deals, a proposal ──
  await login(page, 'riley@northwind.example');
  api = makeApi(page);
  const pipeline = await api.get('/pipeline');
  const stage = (frag: string) =>
    pipeline.stages.find((s: { name: string; kind: string }) => s.kind === 'open' && s.name.toLowerCase().includes(frag.toLowerCase()));
  const lostReasonId = pipeline.lostReasons[0].id;

  const companies: Record<string, string> = {};
  const CO = [
    ['Stark Industries', 'starkindustries.example', 'Technology'],
    ['S.H.I.E.L.D.', 'shield.example', 'Defense'],
    ['Wakanda Design Group', 'wakanda.example', 'Advanced Materials'],
    ['Pym Technologies', 'pymtech.example', 'R&D'],
    ['Oscorp Industries', 'oscorp.example', 'Biotech'],
    ['Daily Bugle', 'dailybugle.example', 'Media'],
    ['Hydra', 'hydra.example', 'Security'],
  ];
  for (const [name, domain, industry] of CO) companies[name] = (await api.post('/companies', { name, domain, industry })).id;

  const contacts: Record<string, string> = {};
  const CT: [string, string, string, string, string][] = [
    ['Tony', 'Stark', 'tony.stark@starkindustries.example', 'CEO', 'Stark Industries'],
    ['Pepper', 'Potts', 'pepper.potts@starkindustries.example', 'COO', 'Stark Industries'],
    ['Bruce', 'Banner', 'bruce.banner@starkindustries.example', 'Head of R&D', 'Stark Industries'],
    ['Steve', 'Rogers', 'steve.rogers@shield.example', 'Director', 'S.H.I.E.L.D.'],
    ['Natasha', 'Romanoff', 'natasha.romanoff@shield.example', 'Head of Operations', 'S.H.I.E.L.D.'],
    ['Nick', 'Fury', 'nick.fury@shield.example', 'Commander', 'S.H.I.E.L.D.'],
    ["T'Challa", 'Udaku', 'tchalla@wakanda.example', 'CTO', 'Wakanda Design Group'],
    ['Shuri', 'Udaku', 'shuri@wakanda.example', 'Head of Design', 'Wakanda Design Group'],
    ['Hank', 'Pym', 'hank.pym@pymtech.example', 'Founder', 'Pym Technologies'],
    ['Norman', 'Osborn', 'norman.osborn@oscorp.example', 'CEO', 'Oscorp Industries'],
    ['Peter', 'Parker', 'peter.parker@dailybugle.example', 'Photojournalist', 'Daily Bugle'],
    ['Wanda', 'Maximoff', 'wanda.maximoff@hydra.example', 'Director', 'Hydra'],
  ];
  for (const [firstName, lastName, email, jobTitle, co] of CT)
    contacts[`${firstName} ${lastName}`] = (await api.post('/contacts', { firstName, lastName, email, jobTitle, companyId: companies[co] })).id;

  // Deals: [name, company, amount, primaryContact, stageFrag|null, outcome]
  const DEALS: [string, string, string, string, string | null, 'open' | 'won' | 'lost'][] = [
    ['Arc Reactor ERP Rollout', 'Stark Industries', '250000', 'Tony Stark', 'Negotiation', 'open'],
    ['Helicarrier Logistics Platform', 'S.H.I.E.L.D.', '500000', 'Nick Fury', 'Proposal', 'open'],
    ['Vibranium Supply Chain', 'Wakanda Design Group', '180000', "T'Challa Udaku", 'Discovery', 'open'],
    ['Quantum Realm Analytics', 'Pym Technologies', '90000', 'Hank Pym', 'Qualification', 'open'],
    ['Newsroom CMS Upgrade', 'Daily Bugle', '30000', 'Peter Parker', null, 'won'],
    ['Oscorp Security Audit', 'Oscorp Industries', '45000', 'Norman Osborn', null, 'won'],
    ['Hydra Surveillance Suite', 'Hydra', '75000', 'Wanda Maximoff', null, 'lost'],
  ];
  const dealIds: Record<string, string> = {};
  for (const [name, co, amount, contact, stageFrag, outcome] of DEALS) {
    const d = await api.post('/deals', { name, companyId: companies[co], amount, contactIds: [contacts[contact]] });
    dealIds[name] = d.id;
    if (outcome === 'won') await api.post(`/deals/${d.id}/won`, { amount });
    else if (outcome === 'lost') {
      const r = await api.post(`/deals/${d.id}/lost`, { lostReasonId });
      if (r.code === 'CONFIRMATION_REQUIRED')
        await api.post(`/deals/${d.id}/lost`, { lostReasonId, confirm: r.meta.confirmations.map((c: { code: string }) => c.code) });
    } else if (stageFrag) {
      const s = stage(stageFrag);
      const cur = await api.get(`/deals/${d.id}`);
      if (s) await api.post(`/deals/${d.id}/stage`, { stageId: s.id, rowVersion: cur.rowVersion });
    }
  }

  // A proposal on the Stark deal, built from a published template and sent to Tony Stark.
  const templates = await api.get('/templates');
  const template =
    templates.find((t: { name: string; published: boolean }) => t.published && t.name === 'Avengers services proposal') ??
    templates.find((t: { published: boolean }) => t.published);
  if (template) {
    const dealId = dealIds['Arc Reactor ERP Rollout'];
    const proposal = await api.post(`/deals/${dealId}/proposals`, { templateId: template.id });
    const pv = await api.get(`/proposals/${proposal.id}`);
    const pricing = {
      lines: [
        { lineKey: 'arc', name: 'Arc Reactor License', unit: 'unit', quantity: '2', unitPrice: '100000', taxRatePercent: '0', billingType: 'one_time' },
        {
          lineKey: 'impl',
          name: 'Implementation & integration',
          unit: 'project',
          quantity: '1',
          unitPrice: '50000',
          taxRatePercent: '0',
          billingType: 'one_time',
        },
      ],
    };
    // Fill the required "Scope of work" section so the pre-send checks pass.
    const content = structuredClone(pv.currentVersion.content);
    for (const sec of content.sections ?? [])
      if (sec.id === 'scope')
        sec.body =
          'Kensium will replace the legacy order and inventory systems at Stark Industries with a unified ERP. ' +
          'Phase 1 installs two Arc Reactor licences and migrates finance and procurement data. ' +
          'Phase 2 integrates the e-commerce storefront and warehouse operations, followed by user training and four weeks of hypercare.';
    await api.put(`/proposals/${proposal.id}/draft`, { content, pricing, termMonths: 12, rowVersion: pv.currentVersion.rowVersion });
    const send = await api.post(`/proposals/${proposal.id}/send`, { recipientContactIds: [contacts['Tony Stark']] });
    if (send.code && send.code !== 'CONFIRMATION_REQUIRED') throw new Error(`Proposal not sent: ${JSON.stringify(send)}`);
    if (send.code === 'CONFIRMATION_REQUIRED')
      await api.post(`/proposals/${proposal.id}/send`, {
        recipientContactIds: [contacts['Tony Stark']],
        confirm: send.meta.confirmations.map((c: { code: string }) => c.code),
      });
  }

  const deals = await api.get('/deals');
  console.log(`MARVEL_SEED_DONE companies=${CO.length} contacts=${CT.length} deals=${DEALS.length} total_deals_now=${deals.total}`);
});
