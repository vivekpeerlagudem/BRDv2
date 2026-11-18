import { readFileSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Reports through the real screen: filters change the figures, a salesperson only ever sees their own data,
 * a manager can narrow to one rep, and the CSV download carries the same rows as the screen.
 *
 * Runs against the development database and only ADDS "E2E Report …" records. To get figures nobody else touches,
 * the activities are logged on one random day in the past (unique per run) and the report is filtered to that day;
 * counts already on that day (from an earlier run) are read first and added to the expectation.
 */
const stamp = Date.now().toString(36);
const dayIndex = Math.floor(Date.now() / 1000) % 1400;
const DAY = new Date(Date.UTC(2021, 0, 1) + dayIndex * 86_400_000).toISOString().slice(0, 10);
const NOON = `${DAY}T12:00:00.000Z`;
const RANGE = `from=${DAY}&to=${DAY}`;
const WON_AMOUNT = 4321;

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
type ActivityRow = { name: string; calls: number; meetings: number; notes: number; tasksCompleted: number };
const EMPTY: ActivityRow = { name: '', calls: 0, meetings: 0, notes: 0, tasksCompleted: 0 };
/** The signed-in user's own activity row for the test day, straight from the API (zeros when there is none). */
async function ownActivity(page: Page, name: string): Promise<ActivityRow> {
  const r = await apiCall(page, 'GET', `/reports/overview?${RANGE}`);
  expect(r.status).toBe(200);
  return (r.json.activity as ActivityRow[]).find((a) => a.name === name) ?? EMPTY;
}
async function createDeal(page: Page, who: string, amount: string) {
  const companyId = (await apiCall(page, 'POST', '/companies', { name: `E2E Report Company ${who} ${stamp}`, domain: `e2e-report-${who}-${stamp}.example` }))
    .json.id;
  const deal = await apiCall(page, 'POST', '/deals', { name: `E2E Report Deal ${who} ${stamp}`, companyId, amount });
  expect(deal.status).toBe(201);
  return { companyId: companyId as string, dealId: deal.json.id as string };
}
const logActivity = async (page: Page, kind: 'call' | 'meeting', dealId: string) =>
  expect((await apiCall(page, 'POST', '/activities', { kind, occurredAt: NOON, relatedType: 'deal', relatedId: dealId })).status).toBe(201);

const card = (page: Page, title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const rowOf = (page: Page, title: string, name: string) => card(page, title).locator('tbody tr').filter({ hasText: name });
const cells = async (page: Page, title: string, name: string) => (await rowOf(page, title, name).locator('td').allInnerTexts()).map((t) => t.trim());
const moneyOf = (text: string | null) => Number((text ?? '').replace(/[^0-9.]/g, ''));

let rileyBefore = EMPTY;
let jordanBefore = EMPTY;
let jordanId = '';

test.describe.configure({ mode: 'serial' });

test('salesperson: filters change the figures, only own data is visible, CSV matches the screen', async ({ page, browser }) => {
  // Another salesperson (same team) logs a call on the same day — Riley must never see it.
  await as(browser, 'jordan@northwind.example', async (p) => {
    jordanBefore = await ownActivity(p, 'Jordan Patel');
    const { dealId } = await createDeal(p, 'Jordan', '900.00');
    await logActivity(p, 'call', dealId);
  });

  await login(page, 'riley@northwind.example');
  rileyBefore = await ownActivity(page, 'Riley Chen');
  const wonBefore = Number((await apiCall(page, 'GET', '/reports/overview')).json.wonLost.wonValue);
  const { companyId, dealId } = await createDeal(page, 'Riley', '1500.00');
  await logActivity(page, 'call', dealId);
  await logActivity(page, 'call', dealId);
  await logActivity(page, 'meeting', dealId);
  const won = await apiCall(page, 'POST', '/deals', { name: `E2E Report Won ${stamp}`, companyId, amount: `${WON_AMOUNT}.00` });
  expect(won.status).toBe(201);
  expect((await apiCall(page, 'POST', `/deals/${won.json.id}/won`, {})).status).toBe(200);
  jordanId = (await apiCall(page, 'GET', '/users')).json.find((u: { fullName: string }) => u.fullName === 'Jordan Patel').id;

  // ── Default view (last 90 days): own scope, no team / owner filters, the deal just won is in the figures ──
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Reports', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
  await expect(page.getByText(/Your own performance · \d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}/)).toBeVisible();
  await expect(page.getByLabel('Owner', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Team', { exact: true })).toHaveCount(0);
  await expect(card(page, 'Rep performance').locator('tbody tr')).toHaveCount(1);
  await expect(rowOf(page, 'Rep performance', 'Riley Chen')).toBeVisible();
  const wonKpi = page.getByTestId('kpi-won-revenue');
  await expect(wonKpi).toHaveText(/^\$[\d,]+\.\d{2}$/);
  const wonLast90 = moneyOf(await wonKpi.textContent());
  expect(wonLast90).toBeGreaterThanOrEqual(wonBefore + WON_AMOUNT);
  expect(wonLast90).toBe(Number((await apiCall(page, 'GET', '/reports/overview')).json.wonLost.wonValue));
  const repRow = await cells(page, 'Rep performance', 'Riley Chen');
  expect(moneyOf(repRow[5] ?? '')).toBe(wonLast90); // own row = own total
  await page.screenshot({ path: 'test-results/screens/reports-salesperson.png', fullPage: true });

  // ── Change the dates: an impossible range is explained, a valid one changes every figure ──
  await page.getByLabel('To', { exact: true }).fill(DAY);
  await expect(page.getByRole('alert').filter({ hasText: '"To" must be on or after "From"' })).toBeVisible();
  await expect(card(page, 'Rep performance')).toHaveCount(0); // no stale figures under an invalid filter
  await page.getByLabel('From', { exact: true }).fill(DAY);
  await expect(page.getByLabel('Period', { exact: true })).toHaveValue('custom');
  await expect(page.getByText(new RegExp(`Your own performance · ${DAY} to ${DAY}`))).toBeVisible();
  await expect(wonKpi).toHaveText('$0.00'); // nothing was closed on that day years ago
  await expect(page.getByTestId('kpi-win-rate')).toHaveText('—');
  expect(await cells(page, 'Activity per rep', 'Riley Chen')).toEqual([
    'Riley Chen',
    String(rileyBefore.calls + 2),
    String(rileyBefore.meetings + 1),
    String(rileyBefore.notes),
    String(rileyBefore.tasksCompleted),
  ]);
  await expect(card(page, 'Activity per rep').locator('tbody tr')).toHaveCount(1);
  await expect(page.getByText('Jordan Patel')).toHaveCount(0);
  await expect(page.getByText(`E2E Report Deal Jordan ${stamp}`)).toHaveCount(0);

  // The filter lives in the address bar and survives a reload.
  expect(new URL(page.url()).search).toBe(`?${RANGE}`);
  await page.reload();
  await expect(page.getByLabel('From', { exact: true })).toHaveValue(DAY);
  await expect(page.getByLabel('To', { exact: true })).toHaveValue(DAY);
  await expect(rowOf(page, 'Activity per rep', 'Riley Chen')).toBeVisible();

  // ── CSV download: same rows as the screen, with a UTF-8 byte-order mark ──
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export activity per rep as CSV' }).click()]);
  expect(download.suggestedFilename()).toBe(`report-activity-${DAY}-to-${DAY}.csv`);
  const bytes = readFileSync(await download.path());
  expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  expect(bytes.subarray(3).toString('utf8')).toBe(
    `Rep,Calls,Meetings,Notes,Tasks completed\r\nRiley Chen,${rileyBefore.calls + 2},${rileyBefore.meetings + 1},${rileyBefore.notes},${rileyBefore.tasksCompleted}\r\n`,
  );
  await expect(page.getByText('CSV downloaded')).toBeVisible();

  // ── A preset brings the recent figures back ──
  await page.getByLabel('Period', { exact: true }).selectOption({ label: 'Last 30 days' });
  await expect(wonKpi).not.toHaveText('$0.00');
  expect(moneyOf(await wonKpi.textContent())).toBeGreaterThanOrEqual(WON_AMOUNT);
  await expect(page.getByLabel('From', { exact: true })).not.toHaveValue(DAY);

  // ── Asking for another owner's report is refused — on the screen, in the API and in the export ──
  await page.goto(`/reports?${RANGE}&ownerId=${jordanId}`);
  await expect(page.getByRole('alert').filter({ hasText: 'You can only see reports for people in your own reporting scope' })).toBeVisible();
  await expect(page.getByText('Jordan Patel')).toHaveCount(0);
  await expect(card(page, 'Activity per rep')).toHaveCount(0);
  expect((await apiCall(page, 'GET', `/reports/overview?${RANGE}&ownerId=${jordanId}`)).status).toBe(403);
  const exportStatus = await page.evaluate(async (qs) => (await fetch(`/api/v1/reports/export/activity.csv?${qs}`)).status, `${RANGE}&ownerId=${jordanId}`);
  expect(exportStatus).toBe(403);
});

test('sales manager: sees the team and can narrow the report to one rep', async ({ page }) => {
  await login(page, 'morgan@northwind.example');
  await page.goto(`/reports?${RANGE}`);
  await expect(page.getByText(new RegExp(`Your team · ${DAY} to ${DAY}`))).toBeVisible();
  const riley = ['Riley Chen', String(rileyBefore.calls + 2), String(rileyBefore.meetings + 1), String(rileyBefore.notes), String(rileyBefore.tasksCompleted)];
  const jordan = [
    'Jordan Patel',
    String(jordanBefore.calls + 1),
    String(jordanBefore.meetings),
    String(jordanBefore.notes),
    String(jordanBefore.tasksCompleted),
  ];
  expect(await cells(page, 'Activity per rep', 'Riley Chen')).toEqual(riley);
  expect(await cells(page, 'Activity per rep', 'Jordan Patel')).toEqual(jordan);

  // Owner filter → only that rep, everywhere on the page.
  await page.getByLabel('Owner', { exact: true }).selectOption({ label: 'Jordan Patel' });
  await expect(rowOf(page, 'Activity per rep', 'Riley Chen')).toHaveCount(0);
  expect(await cells(page, 'Activity per rep', 'Jordan Patel')).toEqual(jordan);
  await expect(card(page, 'Rep performance').locator('tbody tr').filter({ hasText: 'Riley Chen' })).toHaveCount(0);
  expect(new URL(page.url()).searchParams.get('ownerId')).toBe(jordanId);

  // Team filter → the members of that team again.
  await page.getByLabel('Owner', { exact: true }).selectOption({ label: 'Everyone in your scope' });
  await page.getByLabel('Team', { exact: true }).selectOption({ label: 'Enterprise East' });
  await expect(rowOf(page, 'Activity per rep', 'Riley Chen')).toBeVisible();
  expect(await cells(page, 'Activity per rep', 'Riley Chen')).toEqual(riley);
  expect(await cells(page, 'Activity per rep', 'Jordan Patel')).toEqual(jordan);
  await page.screenshot({ path: 'test-results/screens/reports-manager.png', fullPage: true });

  // The manager's export of the same view contains both reps.
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Export activity per rep as CSV' }).click()]);
  const csv = readFileSync(await download.path()).toString('utf8');
  expect(csv).toContain(`${jordan.join(',')}\r\n`);
  expect(csv).toContain(`${riley.join(',')}\r\n`);
});
