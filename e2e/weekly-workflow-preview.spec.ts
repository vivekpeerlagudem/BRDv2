import { execFileSync } from 'node:child_process';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Weekly client report — the whole business flow through the real screens, with screenshots for a QA preview:
 * lead → qualified → converted (company, person, opportunity) → tasks and a meeting on the opportunity → estimates
 * sheet → Generate now → report page → edit → approve → final PowerPoint → list and settings → access check.
 * A second test covers the error paths.
 *
 * Runs against the development database on the AI simulator. It adds records named "Preview <timestamp> …".
 * The only non-UI steps: POST /dev/jobs/run (runs the job queue) and one helper that moves the completion time of
 * the two finished tasks and the meeting into LAST week (`apps/server/src/cli/weekly-preview-backdate.ts`) — the UI
 * always records "now", and a weekly report covers the last full week.
 * Screenshots, the two .pptx files and report.json go to demo-preview/weekly/ (not committed).
 * AI settings are switched on for the run and restored afterwards.
 */
const OUT = 'demo-preview/weekly';
const stamp = Date.now().toString(36);
const companyName = `Preview ${stamp} Acme Retail`;
const leadName = `Preview ${stamp} – Acme Retail`;
let original: Record<string, unknown> | null = null;
let shotNo = 0;

mkdirSync(OUT, { recursive: true });
const dialog = (page: Page, title: string | RegExp) => page.getByRole('dialog').filter({ hasText: title });
const shot = async (page: Page, name: string, fullPage = true) => {
  shotNo += 1;
  await page.screenshot({ path: `${OUT}/${String(shotNo).padStart(2, '0')}-${name}.png`, fullPage });
};
const log = (line: string) => console.log(`[preview] ${line}`);

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
const setAi = async (page: Page, weeklyReport: boolean) => {
  const current = (await apiCall(page, 'GET', '/ai/settings')).json.settings;
  const r = await apiCall(page, 'PUT', '/ai/settings', {
    ...current,
    enabled: true,
    perUserDailyCalls: 1000,
    features: { ...(current.features ?? {}), weekly_report: weeklyReport },
  });
  expect(r.status).toBe(200);
};
/** Runs the job queue until the newest report of the company is drafted; returns it. */
async function waitForReport(page: Page, companyId: string) {
  let run: { id: string; status: string; attempt: number } | undefined;
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
  return run as { id: string; status: string; attempt: number };
}
/** "YYYY-MM-DDTHH:mm" for a datetime-local input. */
const localInput = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** Sunday that ended the last full week (local time), at noon. */
const lastWeekEnd = () => {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() - (d.getDay() === 0 ? 7 : d.getDay()));
  return d;
};
const plusDays = (d: Date, days: number) => new Date(d.getTime() + days * 86_400_000);

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ browser }) => {
  await asAdmin(browser, async (page) => {
    original = (await apiCall(page, 'GET', '/ai/settings')).json.settings;
    await setAi(page, true);
  });
});
test.afterAll(async ({ browser }) => {
  if (!original) return;
  await asAdmin(browser, async (page) => {
    expect((await apiCall(page, 'PUT', '/ai/settings', original)).status).toBe(200);
  });
});

let reportUrl = '';
let companyId = '';

test('lead to approved weekly report: the full workflow with screenshots', async ({ page, browser }) => {
  test.setTimeout(300_000);
  await page.setViewportSize({ width: 1440, height: 900 });

  // 1 ── Sign in as the admin ───────────────────────────────────────────────────────────────────────────────────────
  await login(page, 'admin@northwind.example');

  // 2 ── Lead ───────────────────────────────────────────────────────────────────────────────────────────────────────
  await page.goto('/leads');
  await page.getByRole('button', { name: 'New lead' }).first().click();
  const nl = dialog(page, 'New lead');
  await nl.getByLabel('Name').fill(leadName);
  await nl.getByLabel('Company').fill(companyName);
  await nl.getByLabel('Email').fill(`dana.${stamp}@acme-retail.example`);
  await nl.getByLabel('Job title').fill('Head of E-commerce');
  await nl.getByLabel('Source').fill('referral');
  await nl.getByLabel('Notes').fill('Wants an ERP integration for the web shop before the spring season.');
  await shot(page, 'new-lead', false);
  await nl.getByRole('button', { name: 'Create lead' }).click();
  await expect(page.getByText('Lead created')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: leadName });
  await expect(row.getByText('New', { exact: true })).toBeVisible();

  // 3 ── Start working → Qualify → Convert (company + person + opportunity) ─────────────────────────────────────────
  await row.getByRole('button', { name: 'Start working' }).click();
  await expect(row.getByText('Working', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Qualify' }).click();
  await expect(row.getByText('Qualified', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Convert…' }).click();
  const conv = dialog(page, `Convert ${leadName}`);
  await expect(conv.getByLabel('Company')).toHaveValue(''); // "Create “<company>”": a new company
  await conv.getByLabel('Amount').fill('48000');
  await shot(page, 'convert-lead', false);
  await conv.getByRole('button', { name: 'Convert lead' }).click();
  await expect(page.getByText('Lead converted')).toBeVisible();
  await expect(row.getByText('Converted', { exact: true })).toBeVisible();
  await shot(page, 'lead-converted', false);

  // 4 ── Opportunity: tasks and a meeting ───────────────────────────────────────────────────────────────────────────
  await row.getByRole('link', { name: 'Open opportunity' }).click();
  await expect(page).toHaveURL(/\/deals\/[0-9a-f-]+$/);
  const dealUrl = new URL(page.url()).pathname;
  const weekEnd = lastWeekEnd();
  const tasksCard = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Tasks', exact: true }) });
  const addTask = async (title: string, due: Date) => {
    await tasksCard.getByRole('button', { name: 'Add' }).click();
    const d = dialog(page, 'New task');
    await d.getByLabel('Task').fill(title);
    await d.getByLabel('Due').fill(localInput(due));
    await d.getByRole('button', { name: 'Create task' }).click();
    await expect(tasksCard.getByText(title)).toBeVisible();
  };
  const T = {
    s1: '[S-001] Run the discovery workshop',
    s2: '[S-002] Write the solution design',
    s3: '[S-003] Build the integration',
    s4: '[S-004] Set up test environment',
  };
  await addTask(T.s1, plusDays(weekEnd, -3));
  await addTask(T.s2, plusDays(weekEnd, -2));
  await addTask(T.s3, plusDays(weekEnd, 5)); // within the 7 days after the reported week
  await addTask(T.s4, plusDays(weekEnd, -2)); // overdue at the end of the reported week
  for (const title of [T.s1, T.s2]) {
    await tasksCard.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Done' }).click();
    await expect(tasksCard.getByText(title)).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Log call / meeting' }).click();
  const call = dialog(page, 'Log call or meeting');
  await call.getByLabel('Type').selectOption('meeting');
  await call.getByLabel('Outcome').fill('Agreed the integration scope and the test plan');
  await call.getByLabel('Notes').fill('Dana confirmed the ERP sandbox will be available next week.');
  await call.getByRole('button', { name: 'Log activity' }).click();
  await expect(page.getByText('Agreed the integration scope and the test plan').first()).toBeVisible();
  await shot(page, 'opportunity-tasks-meeting');

  // The UI stamps "now"; the report covers last week → move the two completions and the meeting into last week.
  const moved = JSON.parse(
    execFileSync('pnpm', ['--filter', '@crm/server', 'exec', 'tsx', 'src/cli/weekly-preview-backdate.ts'], {
      encoding: 'utf8',
      shell: true,
      env: { ...process.env, PREVIEW_COMPANY: companyName },
    })
      .trim()
      .split('\n')
      .pop() as string,
  );
  log(`backdated into ${moved.periodStart}..${moved.periodEnd}: ${moved.tasks} task completions, ${moved.activities} meeting`);
  expect(moved).toMatchObject({ tasks: 2, activities: 1 });

  // 5 ── Company → Weekly reports card → estimates (a broken file first) ────────────────────────────────────────────
  await page.getByRole('link', { name: companyName }).first().click();
  await expect(page).toHaveURL(/\/companies\/[0-9a-f-]+$/);
  companyId = page.url().split('/').pop() as string;
  const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Weekly reports', exact: true }) });
  const generate = page.getByRole('button', { name: 'Generate now' });
  await expect(generate).toBeDisabled();
  await expect(card.getByText('Upload the estimates sheet first')).toBeVisible();
  const noEstimates = await apiCall(page, 'POST', `/companies/${companyId}/weekly-reports`);
  log(`Generate without estimates → ${noEstimates.status} ${noEstimates.json?.code}: ${noEstimates.json?.detail ?? noEstimates.json?.title}`);
  expect([noEstimates.status, noEstimates.json?.code]).toEqual([422, 'NO_ESTIMATES']);

  const broken = 'Scope ID,Task,Phase,Estimate hours,Status\nS-001,Workshop,Discovery,sixteen,Done\nS-002,,Discovery,24,Started\nS-003,Build,Build,-5,\n';
  await page.getByLabel('Estimates CSV file').setInputFiles({ name: 'broken-estimates.csv', mimeType: 'text/csv', buffer: Buffer.from(broken) });
  await page.getByRole('button', { name: 'Upload estimates CSV' }).click();
  const sheet = page.getByRole('region', { name: 'Estimates sheet' });
  await expect(sheet.getByRole('alert')).toBeVisible();
  log(`broken CSV → ${((await sheet.getByRole('alert').textContent()) ?? '').replace(/\s+/g, ' ')}`);
  await expect(sheet.getByText('No estimates sheet yet')).toBeVisible(); // nothing was imported
  await shot(page, 'estimates-row-errors');

  await page.getByLabel('Estimates CSV file').setInputFiles('e2e/fixtures/estimates-sample.csv');
  await page.getByRole('button', { name: 'Upload estimates CSV' }).click();
  await expect(sheet.getByText('estimates-sample.csv')).toBeVisible();
  await expect(sheet.getByText(/8 scope items · 220(\.00)? h/)).toBeVisible();
  await shot(page, 'estimates-uploaded');

  // 6 ── Generate now → job → report page ───────────────────────────────────────────────────────────────────────────
  await generate.click();
  const runs = page.getByRole('region', { name: 'Weekly report runs' });
  await expect(runs.getByRole('link', { name: 'Open' })).toBeVisible();
  const again = await apiCall(page, 'POST', `/companies/${companyId}/weekly-reports`);
  log(`second Generate while one is running → ${again.status} ${again.json?.code}: ${again.json?.detail ?? again.json?.title}`);
  const run = await waitForReport(page, companyId);
  if (again.status !== 409) log('note: the first run had already finished, so the second request was accepted');
  await page.goto(`/companies/${companyId}`);
  await shot(page, 'company-card-report-ready');
  await runs.getByRole('link', { name: 'Open' }).first().click();
  reportUrl = `/weekly-reports/${run.id}`;
  await expect(page).toHaveURL(/\/weekly-reports\/[0-9a-f-]+$/);
  reportUrl = new URL(page.url()).pathname;

  // 7 ── Check the report page ──────────────────────────────────────────────────────────────────────────────────────
  await expect(page.getByRole('link', { name: companyName })).toBeVisible();
  await expect(page.getByText('AI fallback')).toHaveCount(0);
  const report = (await apiCall(page, 'GET', reportUrl)).json;
  writeFileSync(`${OUT}/report-draft.json`, JSON.stringify(report, null, 2));
  const metric = (id: string) => report.metrics.find((m: { id: string }) => m.id === id)?.value;
  // Estimates: 220 h in 8 rows. Done in the CRM: S-001 (16 h) + S-002 (24 h) = 40 h → 40 / 220 = 18.2 %.
  expect(metric('E-01')).toBe('8');
  expect(Number(metric('E-02'))).toBe(220);
  expect(metric('E-03')).toBe('2');
  expect(Number(metric('E-04'))).toBe(40);
  expect(metric('E-05')).toBe('18.2');
  expect(metric('E-06')).toBe('2');
  expect(Number(metric('E-07'))).toBe(180);
  expect(metric('E-08')).toBe('1'); // S-003. S-004 also has an open task, but the sheet says "Not started": it counts as planned
  expect(metric('E-10')).toBe('1'); // the overdue task on S-004
  expect(metric('A-02')).toBe('1'); // S-003 is due within 7 days after the week
  expect(metric('A-01')).toBe('1'); // the meeting
  expect(report.health.level).toBe('amber'); // one overdue task
  expect(report.health.reasons).toEqual(['OVERDUE_TASKS']);
  const tile = (label: string) =>
    page
      .locator('div')
      .filter({ has: page.getByText(label, { exact: true }) })
      .last();
  await expect(tile('Complete by estimate')).toContainText('18.2%');
  await expect(tile('Completed this week')).toContainText('2');
  await expect(tile('Remaining hours')).toContainText('180');
  await expect(tile('In progress')).toContainText('1');
  await expect(page.getByText('Health: needs attention').first()).toBeVisible();
  await expect(page.getByText('Ready for review').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Scope progress' })).toBeVisible();
  await shot(page, 'report-page');

  // A source chip opens the record it names.
  const chip = page.getByRole('link', { name: /^S-001 · / }).first();
  await expect(chip).toBeVisible();
  const chipText = ((await chip.textContent()) ?? '').trim();
  await chip.click();
  await expect(page).toHaveURL(new RegExp(`${dealUrl}$`));
  log(`source chip "${chipText}" → ${new URL(page.url()).pathname} (the opportunity that holds the task)`);
  await shot(page, 'source-chip-target', false);
  await page.goto(reportUrl);

  // 8 ── Edit → draft → approve → final ─────────────────────────────────────────────────────────────────────────────
  const edited = `Preview ${stamp}: the team and Acme Retail agreed the integration scope and the test plan.`;
  await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
  await page.getByLabel(/^Edit sentence in /).fill(edited);
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText(edited)).toBeVisible();
  await expect(page.getByText('Edited', { exact: true }).first()).toBeVisible();
  await shot(page, 'report-edited');

  const save = async (link: string) => {
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('link', { name: link }).click()]);
    const path = `${OUT}/${download.suggestedFilename()}`;
    await download.saveAs(path);
    expect(statSync(path).size).toBeGreaterThan(10_000);
    log(`${link} → ${path} (${statSync(path).size} bytes)`);
    return download.suggestedFilename();
  };
  expect(await save('Download draft')).toMatch(/_Weekly_Status_\d{4}-\d{2}-\d{2}_v1_DRAFT\.pptx$/);

  // Approving from a stale page (the report changed after it was loaded) is refused.
  const stale = await apiCall(page, 'POST', `${reportUrl}/approve`, { rowVersion: report.rowVersion, acknowledgeWarnings: true });
  log(`approve with a stale page → ${stale.status} ${stale.json?.code}: ${stale.json?.detail ?? stale.json?.title}`);
  expect([stale.status, stale.json?.code]).toEqual([409, 'CONCURRENT_MODIFICATION']);

  await page.getByRole('button', { name: 'Approve', exact: true }).click();
  const approve = dialog(page, 'Approve weekly report');
  const acknowledge = approve.getByLabel('I checked the flagged figures');
  if (await acknowledge.isVisible()) await acknowledge.check();
  await shot(page, 'approve-dialog', false);
  await approve.getByRole('button', { name: 'Approve report' }).click();
  await expect(page.getByText(/^Approved by /)).toBeVisible();
  await shot(page, 'report-approved');
  expect(await save('Download final')).toMatch(/_Weekly_Status_\d{4}-\d{2}-\d{2}_v1\.pptx$/);
  writeFileSync(`${OUT}/report-final.json`, JSON.stringify((await apiCall(page, 'GET', reportUrl)).json, null, 2));

  // 9 ── List and settings ──────────────────────────────────────────────────────────────────────────────────────────
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Weekly reports' }).click();
  await page.getByRole('tab', { name: 'Approved' }).click();
  await expect(page.getByRole('link', { name: companyName })).toBeVisible();
  await shot(page, 'list-approved');
  await page.goto('/admin/settings');
  await page.getByRole('tab', { name: 'Weekly reports' }).click();
  await expect(page.getByText('Default (mock)')).toBeVisible();
  await expect(page.getByLabel('Day')).toBeVisible();
  await shot(page, 'settings-weekly-reports');

  // 10 ── A salesperson who does not own the company ────────────────────────────────────────────────────────────────
  const otherContext = await browser.newContext();
  const other = await otherContext.newPage();
  await other.setViewportSize({ width: 1440, height: 900 });
  await login(other, 'riley@northwind.example');
  await other.goto(reportUrl);
  await expect(other.getByRole('alert').filter({ hasText: 'This record does not exist or you do not have access to it.' })).toBeVisible();
  shotNo += 1;
  await other.screenshot({ path: `${OUT}/${String(shotNo).padStart(2, '0')}-salesperson-not-found.png` });
  await other.goto('/weekly-reports');
  await expect(other.getByRole('heading', { name: 'Weekly reports' })).toBeVisible();
  await expect(other.getByText(companyName)).toHaveCount(0);
  expect((await apiCall(other, 'GET', reportUrl)).status).toBe(404);
  expect((await apiCall(other, 'GET', '/weekly-reports')).json.items.some((r: { companyId: string }) => r.companyId === companyId)).toBe(false);
  shotNo += 1;
  await other.screenshot({ path: `${OUT}/${String(shotNo).padStart(2, '0')}-salesperson-list.png` });
  await otherContext.close();
});

test('error path: with the AI feature off the report falls back to placeholders, which a person replaces and approves', async ({ page }) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'admin@northwind.example');
  await setAi(page, false);
  try {
    const created = await apiCall(page, 'POST', '/companies', { name: `Preview ${stamp} Fallback Co`, domain: `preview-fallback-${stamp}.example` });
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    await page.goto(`/companies/${id}`);
    await page.getByLabel('Estimates CSV file').setInputFiles('e2e/fixtures/estimates-sample.csv');
    await page.getByRole('button', { name: 'Upload estimates CSV' }).click();
    await expect(page.getByRole('region', { name: 'Estimates sheet' }).getByText('estimates-sample.csv')).toBeVisible();
    await page.getByRole('button', { name: 'Generate now' }).click();
    const run = await waitForReport(page, id);
    expect(run.status).toBe('needs_attention');
    await page.goto(`/weekly-reports/${run.id}`);
    await expect(page.getByText('AI fallback').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Approve', exact: true })).toBeDisabled();
    await shot(page, 'fallback-placeholders');

    const write = page.getByRole('button', { name: 'Write this sentence' });
    const count = await write.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await write.first().click();
      await page.getByLabel(/^Edit sentence in /).fill(`Written by hand, sentence ${i + 1}: work is progressing as planned.`);
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(write).toHaveCount(count - i - 1);
    }
    log(`AI off → ${count} placeholder sentence(s) replaced by hand`);
    await expect(page.getByText('Placeholder', { exact: true })).toHaveCount(0);
    const approveButton = page.getByRole('button', { name: 'Approve', exact: true });
    await expect(approveButton).toBeEnabled();
    await approveButton.click();
    const approve = dialog(page, 'Approve weekly report');
    const acknowledge = approve.getByLabel('I checked the flagged figures');
    if (await acknowledge.isVisible()) await acknowledge.check();
    await approve.getByRole('button', { name: 'Approve report' }).click();
    await expect(page.getByText(/^Approved by /)).toBeVisible();
    await shot(page, 'fallback-approved');
  } finally {
    await setAi(page, true);
  }
});
