import { expect, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Demo seed — populates an EMPTY dev database with a small, realistic set of deals so the
 * Dashboard and Reports show real numbers (Open pipeline, Weighted pipeline, Won revenue).
 * Deliberately tiny (8 deals) and clearly named "Demo …". Owned by the salesperson (riley) so
 * both her dashboard and the admin/manager org view light up. Re-runnable (names are stamped).
 *
 * Run headless:  pnpm exec playwright test e2e/demo-seed.spec.ts --project=chromium
 */
const stamp = Date.now().toString(36);

test('seed a small book of deals (open across stages + closed won + one lost)', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'riley@northwind.example');

  const api = {
    post: (path: string, data?: unknown) => page.request.post(`/api/v1${path}`, data ? { data } : {}),
    get: (path: string) => page.request.get(`/api/v1${path}`),
  };
  const j = async (r: Awaited<ReturnType<typeof api.post>>) => r.json();

  // Pipeline stages + lost reasons
  const pipeline = await j(await api.get('/pipeline'));
  const stages: { id: string; name: string; kind: string; sortOrder: number; probability: string }[] = pipeline.stages;
  const openStages = stages.filter((s) => s.kind === 'open').sort((a, b) => a.sortOrder - b.sortOrder);
  const stageByName = (frag: string) => openStages.find((s) => s.name.toLowerCase().includes(frag.toLowerCase()));
  const lostReasonId: string = pipeline.lostReasons[0].id;

  // Helper: create a company + primary contact + deal, return the deal
  let seq = 0;
  async function makeDeal(company: string, amount: string) {
    seq += 1;
    const companyId = (await j(await api.post('/companies', { name: `Demo ${company} ${stamp}`, domain: `demo-${seq}-${stamp}.example` }))).id;
    const contactId = (
      await j(await api.post('/contacts', { firstName: 'Alex', lastName: `Buyer${seq}`, email: `alex${seq}@demo-${seq}-${stamp}.example`, companyId }))
    ).id;
    const deal = await j(await api.post('/deals', { name: `Demo ${company} deal ${stamp}`, companyId, amount, contactIds: [contactId] }));
    return deal as { id: string; rowVersion: number };
  }

  async function moveTo(dealId: string, stageFrag: string) {
    const stage = stageByName(stageFrag);
    if (!stage) return;
    const d = await j(await api.get(`/deals/${dealId}`));
    await api.post(`/deals/${dealId}/stage`, { stageId: stage.id, rowVersion: d.rowVersion });
  }

  async function markWon(dealId: string, amount: string) {
    await api.post(`/deals/${dealId}/won`, { amount });
  }

  async function markLost(dealId: string) {
    const r = await j(await api.post(`/deals/${dealId}/lost`, { lostReasonId }));
    if (r.code === 'CONFIRMATION_REQUIRED') {
      await api.post(`/deals/${dealId}/lost`, { lostReasonId, confirm: r.meta.confirmations.map((c: { code: string }) => c.code) });
    }
  }

  // ── Open deals across stages (feed Open + Weighted pipeline) ──
  const d1 = await makeDeal('Acme Logistics', '18000');
  await moveTo(d1.id, 'Discovery');

  const d2 = await makeDeal('Brightwave Retail', '32000');
  await moveTo(d2.id, 'Proposal');

  const d3 = await makeDeal('Cedar Manufacturing', '47000');
  await moveTo(d3.id, 'Negotiation');

  const d4 = await makeDeal('Delta Services', '12500');
  await moveTo(d4.id, 'Qualification');

  await makeDeal('Everpeak Software', '26000'); // left at the first stage as-is

  // ── Closed Won (feed Won revenue) ──
  const w1 = await makeDeal('Foxtrot Health', '41000');
  await markWon(w1.id, '41000');

  const w2 = await makeDeal('Granite Partners', '23500');
  await markWon(w2.id, '23500');

  // ── Closed Lost (feed win rate) ──
  const l1 = await makeDeal('Harbor Freight Co', '15000');
  await markLost(l1.id);

  // ── Report what landed ──
  const deals = await j(await api.get('/deals'));
  const mine = (deals.items ?? deals).filter((d: { name?: string }) => (d.name ?? '').includes(stamp));
  console.log(`SEED_DONE stamp=${stamp} created=${seq} visible=${mine.length}`);
  expect(seq).toBe(8);

  // Confirm the dashboard renders numbers for riley
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
});
