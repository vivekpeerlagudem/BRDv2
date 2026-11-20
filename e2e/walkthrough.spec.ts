import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Guided product walkthrough (not an assertion suite). Runs headed so it can be watched live, logging in via the
 * env password (never exposed), pausing on each screen and saving a screenshot to test-results/walkthrough/.
 * Read-only tour of seeded demo data — it creates nothing and changes nothing.
 */
const shots = 'test-results/walkthrough';
let n = 0;
async function stop(page: Page, name: string, seconds = 2.5) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${shots}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  await page.waitForTimeout(seconds * 1000); // dwell so a watcher can see it
}

test('admin walkthrough: dashboard, CRM, reports, settings, import, AI', async ({ page }) => {
  test.setTimeout(180_000);
  await login(page, 'admin@northwind.example');

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await stop(page, 'dashboard', 3);

  await page.goto('/deals');
  await expect(page.getByRole('heading', { name: 'Opportunities', level: 1 })).toBeVisible();
  await stop(page, 'deals-board', 3);

  // Open a seeded deal to show detail + timeline + AI summary control.
  await page.getByRole('button', { name: 'list' }).click();
  await page.getByRole('table').getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Activity timeline' })).toBeVisible();
  await stop(page, 'deal-detail', 3);

  await page.goto('/companies');
  await expect(page.getByRole('heading', { name: 'Companies', level: 1 })).toBeVisible();
  await stop(page, 'companies', 2);
  await page.getByRole('table').getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Timeline' })).toBeVisible();
  await stop(page, 'company-detail', 2.5);

  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await stop(page, 'reports', 3);
  // Change the period to show the filters are live.
  await page.getByLabel('Period', { exact: true }).selectOption('last30');
  await stop(page, 'reports-last30', 2.5);

  await page.goto('/admin/settings');
  await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
  await stop(page, 'settings', 3);

  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
  await stop(page, 'audit-log', 3);

  await page.goto('/admin/import');
  await expect(page.getByRole('heading', { name: 'Import data', level: 1 })).toBeVisible();
  await stop(page, 'import', 3);

  await page.goto('/admin/ai');
  await expect(page.getByRole('heading', { name: 'AI settings and usage', level: 1 })).toBeVisible();
  await stop(page, 'ai-settings', 3);
});

test('salesperson walkthrough: a proposal with the AI panel', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'riley@northwind.example');
  // Open a deal of Riley's that has a proposal (found through the API, so it works on any dev data).
  const deals = (await (await page.request.get('/api/v1/deals?limit=100')).json()).items as { id: string }[];
  let dealWithProposal: string | undefined;
  for (const d of deals) {
    const ps = await (await page.request.get(`/api/v1/deals/${d.id}/proposals`)).json();
    if (Array.isArray(ps) && ps.length) {
      dealWithProposal = d.id;
      break;
    }
  }
  expect(dealWithProposal, 'Riley needs at least one deal with a proposal').toBeTruthy();
  await page.goto(`/deals/${dealWithProposal}`);
  await expect(page.getByRole('heading', { name: 'Activity timeline' })).toBeVisible();
  await stop(page, 'sp-deal', 2.5);
  const proposalLink = page.getByRole('link', { name: /proposal/i }).first();
  if (await proposalLink.count()) {
    await proposalLink.click();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await stop(page, 'sp-proposal', 4);
  }
});
