import { type Browser, expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Kensium Copilot through the real screens, one flow per role, on the built-in simulator (AI_PROVIDER=fake):
 *  - salesperson: ask about the open deal → streamed answer with source chips; an automatic change is undone;
 *    a newly assigned lead is accepted from the banner before its timer runs out.
 *  - sales manager: a stage move proposed by the Copilot is approved on its card.
 *  - admin: the Company view card, a pipeline answer, and the Copilot admin page.
 *
 * Runs against the development database with the Avengers demo seed (`pnpm db:seed:avengers`). It only adds tasks,
 * approval cards and one lead assignment; nothing existing is deleted.
 */
const SPIDEY = 'riley@northwind.example'; // Spider-Man (the Avengers seed renames the base seed's users)
const CAP = 'morgan@northwind.example'; // Captain America
const ADMIN = 'admin@northwind.example';

const apiCall = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(p as string, {
        method: m as string,
        headers: { 'content-type': 'application/json' },
        ...(b === null ? {} : { body: JSON.stringify(b) }),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    [method, path, body ?? null] as const,
  );
async function as<T>(browser: Browser, email: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, email);
    return await fn(page);
  } finally {
    await context.close();
  }
}
const panel = (page: Page) => page.getByTestId('copilot-panel');
async function ask(page: Page, question: string) {
  if (!(await panel(page).isVisible())) await page.getByTestId('copilot-toggle').click();
  await panel(page).getByRole('button', { name: 'New conversation' }).click();
  await panel(page).getByLabel('Message to the Copilot').fill(question);
  await panel(page).getByRole('button', { name: 'Send' }).click();
  await expect(panel(page).getByTestId('copilot-answer').last()).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Send' }).locator('svg.animate-spin')).toHaveCount(0);
}
/** The first open deal of the signed-in user, from the deals list API. */
async function myOpenDeal(page: Page) {
  const me = (await apiCall(page, 'GET', '/api/v1/me')).json;
  const deals = (await apiCall(page, 'GET', '/api/v1/deals?status=open&limit=100')).json.items as { id: string; name: string; ownerId: string }[];
  const d = deals.find((x) => x.ownerId === me.user.id && !x.name.includes('CNRY-'));
  if (!d) throw new Error('no open deal for this user');
  return d;
}

test.describe.configure({ mode: 'serial' });

test('salesperson: streamed answer with sources, Undo of an automatic change, and accepting a lead in time', async ({ browser }) => {
  await as(browser, SPIDEY, async (page) => {
    const deal = await myOpenDeal(page);
    await page.goto(`/deals/${deal.id}`);
    await ask(page, 'Summarise this deal');
    await expect(panel(page).getByTestId('copilot-answer').last()).toContainText(deal.name);
    await expect(panel(page).getByTestId('copilot-tools').last()).toContainText('get record');
    await expect(panel(page).getByTestId('copilot-sources').last().getByRole('link').first()).toBeVisible();
    // No image or link is ever rendered from the model's text.
    await expect(panel(page).getByTestId('copilot-answer').locator('img, a')).toHaveCount(0);

    await page.goto('/');
    await ask(page, 'Create follow-ups for my stalled deals');
    const card = panel(page).getByTestId('copilot-action').first();
    await expect(card).toContainText('Create task');
    await card.getByRole('button', { name: 'Undo' }).click();
    await expect(card).toContainText('Undone');
  });

  // An admin hands a new lead to Spider-Man; the job runner creates the assignment with its timer.
  const leadName = `E2E Copilot lead ${Date.now().toString(36)}`;
  await as(browser, ADMIN, async (page) => {
    const users = (await apiCall(page, 'GET', '/api/v1/users')).json as
      | { id?: string; userId?: string; email: string }[]
      | { items: { id?: string; userId?: string; email: string }[] };
    const list = Array.isArray(users) ? users : users.items;
    const spidey = list.find((u) => u.email === SPIDEY);
    const lead = await apiCall(page, 'POST', '/api/v1/leads', { name: leadName });
    expect(lead.status).toBe(201);
    expect((await apiCall(page, 'POST', `/api/v1/leads/${lead.json.id}/assign`, { ownerId: spidey?.userId ?? spidey?.id })).status).toBeLessThan(300);
    await apiCall(page, 'POST', '/dev/jobs/run');
  });
  await as(browser, SPIDEY, async (page) => {
    await page.goto('/leads');
    const item = page.getByTestId('assignment-banner-item').filter({ hasText: leadName });
    await expect(item).toBeVisible();
    await expect(item.getByTestId('assignment-countdown')).toContainText(/left/);
    await item.getByRole('button', { name: 'Accept' }).click();
    await expect(item).toHaveCount(0);
  });
});

test('sales manager: approves a stage move proposed by the Copilot', async ({ browser }) => {
  await as(browser, CAP, async (page) => {
    // An open deal of the team that is NOT already in Negotiation, so a stage move can be proposed.
    const deals = (await apiCall(page, 'GET', '/api/v1/deals?status=open&limit=100')).json.items as { id: string; name: string; stageName: string }[];
    const deal = deals.find((d) => !d.name.includes('CNRY-') && d.stageName !== 'Negotiation');
    if (!deal) throw new Error('no open team deal outside Negotiation');
    await page.goto(`/deals/${deal.id}`);
    await ask(page, 'Move this deal to Negotiation');
    const card = panel(page).getByTestId('copilot-action').first();
    await expect(card).toContainText('Move');
    await expect(card).toContainText('Waiting for your OK');
    await card.getByRole('button', { name: 'Approve' }).click();
    await expect(card).toContainText('Approved');
  });
});

test('admin: Company view card, a pipeline answer, and the Copilot admin page', async ({ browser }) => {
  await as(browser, ADMIN, async (page) => {
    await page.goto('/');
    await expect(page.getByTestId('copilot-home')).toContainText('Company view');
    await ask(page, 'What is my open pipeline value and weighted forecast?');
    await expect(panel(page).getByTestId('copilot-answer').last()).toContainText(/weighted forecast/i);
    await page.goto('/admin/copilot');
    await expect(page.getByRole('heading', { name: 'Copilot' })).toBeVisible();
    await expect(page.getByText('Copilot on for the organization (kill switch)')).toBeVisible();
  });
});
