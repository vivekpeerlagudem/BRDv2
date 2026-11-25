import { statSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Weekly client reports through the real screens, on the built-in AI simulator (no external or paid call):
 * admin uploads a client's estimates sheet → Generate now → the job drafts the report → admin edits a sentence →
 * approves → downloads the final PowerPoint. A salesperson who does not own the client cannot open the report.
 *
 * Runs against the development database. It adds one "E2E Weekly …" company with its estimates and one report.
 * It temporarily switches the weekly-report AI feature on and always restores the original AI settings afterwards.
 */
const stamp = Date.now().toString(36);
const company = `E2E Weekly ${stamp}`;
let original: Record<string, unknown> | null = null;

/** JSON API call from inside the signed-in page (same cookies and Origin as the app). */
const apiCall = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(`/api/v1${p}`, {
        method: m as string,
        headers: { 'content-type': 'application/json' },
        ...(b === null ? {} : { body: JSON.stringify(b) }),
      });
      return { status: r.status, json: await r.json().catch(() => null) };
    },
    [method, path, body ?? null] as const,
  );
async function asAdmin<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, 'admin@northwind.example');
    return await fn(page);
  } finally {
    await context.close();
  }
}

test.beforeAll(async ({ browser }) => {
  await asAdmin(browser, async (page) => {
    const current = (await apiCall(page, 'GET', '/ai/settings')).json.settings;
    original = current;
    const raised = await apiCall(page, 'PUT', '/ai/settings', {
      ...current,
      enabled: true,
      perUserDailyCalls: 1000,
      features: { ...(current.features ?? {}), weekly_report: true },
    });
    expect(raised.status).toBe(200);
  });
});
test.afterAll(async ({ browser }) => {
  if (!original) return;
  await asAdmin(browser, async (page) => {
    expect((await apiCall(page, 'PUT', '/ai/settings', original)).status).toBe(200);
  });
});

test('admin generates, edits, approves and downloads a weekly report; a non-owner cannot open it', async ({ page, browser }) => {
  await login(page, 'admin@northwind.example');
  const created = await apiCall(page, 'POST', '/companies', { name: company, domain: `e2e-weekly-${stamp}.example` });
  expect(created.status).toBe(201);
  const companyId = created.json.id as string;

  // --- Estimates sheet ---------------------------------------------------------------------------------------------
  await page.goto(`/companies/${companyId}`);
  await expect(page.getByRole('heading', { name: company })).toBeVisible();
  const generate = page.getByRole('button', { name: 'Generate now' });
  await expect(generate).toBeDisabled(); // nothing to report against until the estimates sheet is there
  await page.getByLabel('Estimates CSV file').setInputFiles('e2e/fixtures/estimates-sample.csv');
  await page.getByRole('button', { name: 'Upload estimates CSV' }).click();
  const sheet = page.getByRole('region', { name: 'Estimates sheet' });
  await expect(sheet.getByText('estimates-sample.csv')).toBeVisible();
  await expect(sheet.getByText(/8 scope items/)).toBeVisible();

  // --- Generate now → the job drafts the report -------------------------------------------------------------------
  await expect(generate).toBeEnabled();
  await generate.click();
  const runs = page.getByRole('region', { name: 'Weekly report runs' });
  await expect(runs.getByRole('link', { name: 'Open' })).toBeVisible();
  let run: { id: string; status: string } | undefined;
  await expect
    .poll(
      async () => {
        await page.request.post('/dev/jobs/run');
        run = (await apiCall(page, 'GET', `/weekly-reports?companyId=${companyId}`)).json.items[0];
        return run?.status;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toMatch(/^(ready|needs_attention)$/);
  const reportUrl = `/weekly-reports/${run?.id}`;

  // --- Report page: figures, text, edit one sentence ---------------------------------------------------------------
  await page.goto(`/companies/${companyId}`);
  await runs.getByRole('link', { name: 'Open' }).click();
  await expect(page).toHaveURL(new RegExp(`${reportUrl}$`));
  await expect(page.getByRole('link', { name: company })).toBeVisible();
  await expect(page.getByText('Remaining hours')).toBeVisible();
  await expect(page.getByText('AI fallback')).toHaveCount(0); // drafted by the (simulated) AI, not placeholder text

  const edited = `E2E ${stamp}: the team and the client agreed the next steps on the weekly call.`;
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  const box = page.getByLabel(/^Edit sentence in /);
  await box.fill(edited);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(edited)).toBeVisible();
  await expect(page.getByText('Edited', { exact: true }).first()).toBeVisible();

  // --- Approve (acknowledging warnings when the dialog asks) -------------------------------------------------------
  const approve = page.getByRole('button', { name: 'Approve', exact: true });
  await expect(approve).toBeEnabled();
  await approve.click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Approve weekly report' });
  const acknowledge = dialog.getByLabel('I checked the flagged figures');
  if (await acknowledge.isVisible()) await acknowledge.check();
  await dialog.getByRole('button', { name: 'Approve report' }).click();
  await expect(page.getByText(/^Approved by /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0); // an approved report is final

  // --- Final PowerPoint --------------------------------------------------------------------------------------------
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: 'Download final' }).click()]);
  expect(download.suggestedFilename()).toMatch(/^E2E_Weekly_[a-z0-9]+_Weekly_Status_\d{4}-\d{2}-\d{2}_v1\.pptx$/);
  expect(statSync(await download.path()).size).toBeGreaterThan(10_000);
  const head = await page.evaluate(async (url) => {
    const r = await fetch(url);
    return { status: r.status, magic: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 2)) };
  }, `/api/v1${reportUrl}/pptx/final`);
  expect(head).toEqual({ status: 200, magic: 'PK' }); // a .pptx is a zip archive

  // --- A salesperson who does not own the client gets not-found ---------------------------------------------------
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await login(other, 'riley@northwind.example');
  await other.goto(reportUrl);
  await expect(other.getByRole('alert').filter({ hasText: 'This record does not exist or you do not have access to it.' })).toBeVisible();
  await expect(other.getByText(edited)).toHaveCount(0);
  expect((await apiCall(other, 'GET', reportUrl)).status).toBe(404);
  expect(await other.evaluate(async (url) => (await fetch(url)).status, `/api/v1${reportUrl}/pptx/final`)).toBe(404);
  await otherContext.close();
});
