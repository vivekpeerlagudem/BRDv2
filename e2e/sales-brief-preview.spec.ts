import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Weekly sales brief — the leadership flow through the real screens, with screenshots for a QA preview:
 * admin: Sales brief → Generate now → brief page (key figures, findings with evidence, AI analysis) → open an
 * evidence link → edit a sentence → approve → download the final PowerPoint and Excel → dashboard card → settings.
 * A salesperson has no "Sales brief" navigation item and gets 403 from every sales-brief route.
 *
 * Runs against the development database on the AI simulator (best after `pnpm db:seed:avengers`, which loads two
 * weeks of sales activity). It works on its OWN new version of the brief ("Generate now") and never edits the demo
 * brief; the sentence it writes is ordinary business text, so no test wording shows on the dashboard. The sales brief
 * settings it changes are put back at the end.
 * The only non-UI step is POST /dev/jobs/run (runs the job queue). Screenshots, the .pptx, the .xlsx and
 * brief.json go to demo-preview/sales-brief/ (not committed). AI settings are restored afterwards.
 */
const OUT = 'demo-preview/sales-brief';
let original: Record<string, unknown> | null = null;
let shotNo = 0;
mkdirSync(OUT, { recursive: true });
const shot = async (page: Page, name: string, fullPage = true) => {
  shotNo += 1;
  await page.screenshot({ path: `${OUT}/${String(shotNo).padStart(2, '0')}-${name}.png`, fullPage });
};
const log = (line: string) => console.log(`[brief] ${line}`);
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
    const r = await apiCall(page, 'PUT', '/ai/settings', {
      ...current,
      enabled: true,
      perUserDailyCalls: 1000,
      features: { ...(current.features ?? {}), sales_brief: true },
    });
    expect(r.status).toBe(200);
  });
});
test.afterAll(async ({ browser }) => {
  if (!original) return;
  await asAdmin(browser, async (page) => {
    expect((await apiCall(page, 'PUT', '/ai/settings', original)).status).toBe(200);
  });
});

test('admin generates, reviews, edits, approves and downloads the weekly sales brief; a salesperson cannot see it', async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'admin@northwind.example');
  const nav = page.getByRole('navigation', { name: 'Main', exact: true });

  // 1 ── Sales brief → Generate now ─────────────────────────────────────────────────────────────────────────────────
  await nav.getByRole('link', { name: 'Sales brief' }).click();
  await expect(page.getByRole('heading', { name: 'Sales brief' })).toBeVisible();
  const before = (await apiCall(page, 'GET', '/sales-briefs')).json.items.length as number;
  await page.getByRole('button', { name: 'Generate now' }).click();
  let brief: { id: string; status: string; attempt: number } | undefined;
  await expect
    .poll(
      async () => {
        await page.request.post('/dev/jobs/run');
        const items = (await apiCall(page, 'GET', '/sales-briefs')).json.items as { id: string; status: string; attempt: number }[];
        brief = items.length > before ? items[0] : undefined;
        return brief?.status;
      },
      { timeout: 60_000, intervals: [500, 1000, 2000] },
    )
    .toMatch(/^(ready|needs_attention)$/);
  await page.reload();
  await shot(page, 'list');

  // 2 ── Brief page: key figures equal the Reports page for the same week ───────────────────────────────────────────
  await page
    .getByRole('link', { name: /\d{4}$/ })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/sales-brief/${brief?.id}$`));
  const url = new URL(page.url()).pathname;
  const data = (await apiCall(page, 'GET', `/sales-briefs/${brief?.id}`)).json;
  writeFileSync(`${OUT}/brief-draft.json`, JSON.stringify(data, null, 2));
  const m = (id: string) => data.metrics.find((x: { id: string }) => x.id === id);
  const report = (await apiCall(page, 'GET', `/reports/overview?from=${data.periodStart}&to=${data.periodEnd}`)).json;
  expect(Number(m('S-07').value)).toBe(report.wonLost.won);
  expect(m('S-08').value).toBe(report.wonLost.wonValue);
  expect(m('S-11').value).toBe(report.pipelineTotals.value);
  expect(Number(m('S-09').value)).toBe(report.wonLost.lost);
  log(`figures equal the Reports page: won ${report.wonLost.won}, revenue ${report.wonLost.wonValue}, pipeline ${report.pipelineTotals.value}`);
  const figures = page.getByRole('region', { name: 'Key figures' });
  for (const label of ['New leads', 'New opportunities', 'Revenue won', 'Win rate', 'Open pipeline'])
    await expect(figures.getByText(label, { exact: true })).toBeVisible();
  await expect(figures).toContainText(m('S-01').value);
  await expect(figures).toContainText(`${m('S-10').value}%`);
  await expect(page.getByText('AI fallback')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Key insights' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Recommended actions' })).toBeVisible();
  const findings = page.getByRole('list', { name: 'Findings' });
  expect(await findings.getByRole('listitem').count()).toBeGreaterThanOrEqual(3);
  await expect(page.getByRole('list', { name: 'Throughput funnel' }).getByText('New leads')).toBeVisible();
  await shot(page, 'brief-page');

  // 3 ── An evidence chip opens the deal it names ───────────────────────────────────────────────────────────────────
  const chip = findings.getByRole('link').first();
  const chipText = ((await chip.textContent()) ?? '').trim();
  await chip.click();
  await expect(page).toHaveURL(/\/deals\/[0-9a-f-]+$/);
  await expect(page.getByRole('heading', { name: chipText })).toBeVisible();
  log(`evidence "${chipText}" → ${new URL(page.url()).pathname}`);
  await shot(page, 'evidence-opens-deal', false);
  await page.goto(url);

  // 4 ── Edit a sentence → approve → final files ────────────────────────────────────────────────────────────────────
  // Ordinary business text (never "Preview" or "E2E"): this version may become the latest brief on the dashboard.
  const edited = 'The stalled deals in Discovery are the main point to act on this week.';
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByLabel(/^Edit sentence in /).fill(edited);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByLabel(/^Edit sentence in /)).toHaveCount(0);
  await expect(page.getByText(edited)).toBeVisible();
  await shot(page, 'brief-edited');

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Approve sales brief' });
  const acknowledge = dialog.getByLabel('I checked the flagged figures');
  if (await acknowledge.isVisible()) await acknowledge.check();
  await dialog.getByRole('button', { name: 'Approve brief' }).click();
  await expect(page.getByText(/^Approved by /)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await shot(page, 'brief-approved');

  const save = async (linkName: string, pattern: RegExp) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: linkName }).click()]);
    expect(download.suggestedFilename()).toMatch(pattern);
    const path = `${OUT}/${download.suggestedFilename()}`;
    await download.saveAs(path);
    expect(statSync(path).size).toBeGreaterThan(5_000);
    log(`${linkName} → ${path} (${statSync(path).size} bytes)`);
  };
  await save('Download PowerPoint', new RegExp(`_Sales_Brief_\\d{4}-\\d{2}-\\d{2}_v${brief?.attempt}\\.pptx$`));
  await save('Download Excel', new RegExp(`_Sales_Brief_\\d{4}-\\d{2}-\\d{2}_v${brief?.attempt}\\.xlsx$`));
  writeFileSync(`${OUT}/brief-final.json`, JSON.stringify((await apiCall(page, 'GET', `/sales-briefs/${brief?.id}`)).json, null, 2));

  // 5 ── Dashboard card and settings ────────────────────────────────────────────────────────────────────────────────
  await page.goto('/');
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Latest sales brief' }) });
  await expect(card.getByText('Approved', { exact: true })).toBeVisible();
  await expect(card.getByText(edited)).toBeVisible();
  await shot(page, 'dashboard-card', false);
  await page.goto('/admin/settings');
  await page.getByRole('tab', { name: 'Sales brief' }).click();
  await expect(page.getByText('Generate the sales brief automatically')).toBeVisible();
  await expect(page.getByText(/Excel download/).first()).toBeVisible();
  // Save a different weekday, time and owner, reload, and see them kept; then put the settings back.
  const savedSettings = (await apiCall(page, 'GET', '/admin/sales-brief-settings')).json;
  const form = page.locator('form').filter({ has: page.getByLabel('Runs for') });
  await form.getByLabel('Day').selectOption({ label: 'Tuesday' });
  await form.getByLabel('Time').fill('07:30');
  await form.getByLabel('Runs for').selectOption({ label: 'Tony Stark' });
  await form.getByRole('button', { name: 'Save sales brief settings' }).click();
  await expect(page.getByText('Sales brief settings saved')).toBeVisible();
  await page.reload();
  await page.getByRole('tab', { name: 'Sales brief' }).click();
  const reloaded = page.locator('form').filter({ has: page.getByLabel('Runs for') });
  await expect(reloaded.getByLabel('Day')).toHaveValue('2');
  await expect(reloaded.getByLabel('Time')).toHaveValue('07:30');
  await expect(reloaded.getByLabel('Runs for').locator('option:checked')).toHaveText('Tony Stark');
  await shot(page, 'settings-sales-brief', false);
  const restored = await apiCall(page, 'PUT', '/admin/sales-brief-settings', {
    enabled: savedSettings.enabled,
    runWeekday: savedSettings.runWeekday,
    runTime: savedSettings.runTime,
    ownerUserId: savedSettings.ownerUserId,
  });
  expect(restored.status).toBe(200);
  log(`settings saved (Tuesday 07:30, Tony Stark), reloaded, then restored to day ${savedSettings.runWeekday} ${savedSettings.runTime}`);

  // 6 ── A salesperson: no navigation item, 403 everywhere ──────────────────────────────────────────────────────────
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.setViewportSize({ width: 1440, height: 900 });
  await login(other, 'riley@northwind.example');
  await expect(other.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Sales brief' })).toHaveCount(0);
  await expect(other.getByRole('heading', { name: 'Latest sales brief' })).toHaveCount(0);
  for (const path of [
    '/sales-briefs',
    `/sales-briefs/${brief?.id}`,
    `/sales-briefs/${brief?.id}/pptx/final`,
    `/sales-briefs/${brief?.id}/xlsx/final`,
    '/admin/sales-brief-settings',
  ])
    expect([path, (await apiCall(other, 'GET', path)).status]).toEqual([path, 403]);
  expect((await apiCall(other, 'POST', '/sales-briefs')).status).toBe(403);
  await other.goto(url);
  await expect(other.getByRole('alert').first()).toBeVisible();
  await expect(other.getByText(edited)).toHaveCount(0);
  shotNo += 1;
  await other.screenshot({ path: `${OUT}/${String(shotNo).padStart(2, '0')}-salesperson-no-access.png` });
  await otherContext.close();
});
