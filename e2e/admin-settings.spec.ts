import { randomUUID } from 'node:crypto';
import { type Browser, expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Administration through the real screens: organization settings, pipeline stages, lost reasons, teams and the
 * audit log — and proof that non-admins are refused.
 *
 * Runs against the development database. It only creates records named "E2E … <stamp>" and removes them again.
 * The one existing value it edits (the proposal footer text) and the "proposal sent" stage it switches are
 * restored, also when a test fails (see the finally blocks). Seeded stages are never renamed, and their relative
 * order is checked to be unchanged at the end.
 */
const stamp = Date.now().toString(36);
const ADMIN = 'admin@northwind.example';

/** JSON API call from inside the signed-in page (same cookies and Origin as the app). */
const apiCall = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, p, b]) => {
      const r = await fetch(`/api/v1${p}`, {
        method: m as string,
        headers: b === null ? {} : { 'content-type': 'application/json' },
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
const openTab = async (page: Page, name: string) => {
  await page.goto('/admin/settings');
  await page.getByRole('tab', { name, exact: true }).click();
  await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0);
};
const toast = (page: Page, text: string | RegExp) => page.locator('[aria-live="polite"]').getByText(text).first();
/** Clicks a ConfirmButton and then the confirming button inside its dialog. */
const confirmClick = async (page: Page, label: string) => {
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: label, exact: true }).click();
};
type StageRow = { id: string; name: string; kind: string; probability: number; isProposalSentTarget: boolean; dealCount: number };
const stagesOf = async (page: Page): Promise<StageRow[]> => (await apiCall(page, 'GET', '/admin/pipeline/stages')).json.stages;

test.describe.configure({ mode: 'serial' });

test('salespeople and sales managers cannot reach administration', async ({ browser }) => {
  for (const email of ['riley@northwind.example', 'morgan@northwind.example']) {
    await as(browser, email, async (page) => {
      const nav = page.getByRole('navigation', { name: 'Main', exact: true });
      await expect(nav.getByRole('link', { name: 'Settings', exact: true })).toHaveCount(0);
      await expect(nav.getByRole('link', { name: 'Audit log', exact: true })).toHaveCount(0);
      for (const [method, path, body] of [
        ['GET', '/settings/organization'],
        ['PUT', '/settings/organization', { organizationName: 'Hijacked' }],
        ['GET', '/admin/pipeline/stages'],
        ['POST', '/admin/pipeline/stages', { name: `E2E Forbidden ${stamp}`, probability: 10 }],
        ['POST', '/admin/lost-reasons', { name: `E2E Forbidden ${stamp}` }],
        ['GET', '/admin/teams'],
        ['POST', '/admin/teams', { name: `E2E Forbidden ${stamp}` }],
        ['GET', '/audit-log'],
      ] as const)
        expect((await apiCall(page, method, path, body)).status, `${email} ${method} ${path}`).toBe(403);
      // Typing the address directly shows a refusal, not the settings.
      await page.goto('/admin/settings');
      await expect(page.getByRole('alert').filter({ hasText: 'not allowed' })).toBeVisible();
      await expect(page.getByLabel('Organization name')).toHaveCount(0);
      await page.goto('/admin/audit');
      await expect(page.getByRole('alert').filter({ hasText: 'not allowed' })).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
    });
  }
});

test('admin edits organization settings; the change persists; a currency change is refused while deals exist', async ({ page }) => {
  await login(page, ADMIN);
  const { updatedAt: _updatedAt, ...original } = (await apiCall(page, 'GET', '/settings/organization')).json;
  const footer = `E2E footer ${stamp}`;
  try {
    await openTab(page, 'Organization');
    await expect(page.getByLabel('Organization name')).toHaveValue(original.organizationName);
    await page.getByLabel('Proposal footer text').fill(footer);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(toast(page, 'Organization settings saved')).toBeVisible();

    // Persisted: re-read from the server after a full reload, and through the API.
    await openTab(page, 'Organization');
    await expect(page.getByLabel('Proposal footer text')).toHaveValue(footer);
    const saved = (await apiCall(page, 'GET', '/settings/organization')).json;
    expect(saved.branding.footerText).toBe(footer);
    expect(saved.organizationName).toBe(original.organizationName);

    // Validation message from the server for a bad time zone; nothing is saved.
    await page.getByLabel('Time zone').fill('Mars/Olympus');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Choose a valid time zone' })).toBeVisible();
    expect((await apiCall(page, 'GET', '/settings/organization')).json.timeZone).toBe(original.timeZone);
    await page.getByLabel('Time zone').fill(original.timeZone);

    // Currency rule: the demo data already has deals in the current currency.
    const other = original.defaultCurrency === 'EUR' ? 'USD' : 'EUR';
    await page.getByLabel('Default currency').fill(other);
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByRole('alert').filter({ hasText: `The default currency cannot change to ${other}` })).toBeVisible();
    expect((await apiCall(page, 'GET', '/settings/organization')).json.defaultCurrency).toBe(original.defaultCurrency);
  } finally {
    expect((await apiCall(page, 'PUT', '/settings/organization', original)).status).toBe(200);
  }
  expect((await apiCall(page, 'GET', '/settings/organization')).json.branding.footerText).toBe(original.branding.footerText);
});

test('admin manages pipeline stages: add, edit probability, reorder, proposal-sent stage, protected removal', async ({ page }) => {
  await login(page, ADMIN);
  const name = `E2E Stage ${stamp}`;
  const before = await stagesOf(page);
  const originalTarget = before.find((s) => s.isProposalSentTarget);
  const won = before.find((s) => s.kind === 'won');
  const firstOpen = before.find((s) => s.kind === 'open');
  if (!originalTarget || !won || !firstOpen) throw new Error('The demo pipeline is incomplete');
  const row = page.locator(`tr[data-stage="${name}"]`);
  try {
    await openTab(page, 'Pipeline');
    await expect(page.locator('tbody tr')).toHaveCount(before.length);

    // A duplicate name is refused with a clear message; then the stage is added under its own name.
    await page.getByRole('button', { name: 'Add stage' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Stage name').fill(firstOpen.name);
    await dialog.getByLabel('Win probability (%)').fill('55');
    await dialog.getByRole('button', { name: 'Add stage' }).click();
    await expect(toast(page, `A stage named "${firstOpen.name}" already exists`)).toBeVisible();
    await dialog.getByLabel('Stage name').fill(name);
    await dialog.getByLabel('Stall threshold (days)').fill('9');
    await dialog.getByRole('button', { name: 'Add stage' }).click();
    await expect(toast(page, 'Stage added')).toBeVisible();
    await expect(row).toContainText('55%');
    await expect(row).toContainText('9 days');
    // Everyone who moves deals is offered the new stage.
    const offered = (await apiCall(page, 'GET', '/pipeline')).json.stages.find((s: { name: string }) => s.name === name);
    expect(Number(offered.probability)).toBe(55);
    expect(offered.kind).toBe('open');

    // Edit the win probability; it survives a reload.
    await page.getByRole('button', { name: `Edit ${name}`, exact: true }).click();
    await dialog.getByLabel('Win probability (%)').fill('65');
    await dialog.getByRole('button', { name: 'Save stage' }).click();
    await expect(toast(page, 'Stage saved')).toBeVisible();
    await openTab(page, 'Pipeline');
    await expect(row).toContainText('65%');
    // The forecast report reads the same probability.
    const forecast = (await apiCall(page, 'GET', '/reports/dashboard')).json.pipeline.find((p: { stage: string }) => p.stage === name);
    expect(Number(forecast.probability)).toBe(65);

    // Reorder: the new stage moves up one place; Won and Lost stay last.
    const openBefore = (await stagesOf(page)).filter((s) => s.kind === 'open').map((s) => s.name);
    await page.getByRole('button', { name: `Move ${name} up`, exact: true }).click();
    await expect(toast(page, 'Stage order saved')).toBeVisible();
    const afterMove = await stagesOf(page);
    const openAfter = afterMove.filter((s) => s.kind === 'open').map((s) => s.name);
    expect(openAfter.indexOf(name)).toBe(openBefore.indexOf(name) - 1);
    expect(afterMove.slice(-2).map((s) => s.kind)).toEqual(['won', 'lost']);
    await expect(page.locator('tbody tr').nth(openAfter.indexOf(name))).toContainText(name);

    // Exactly one "proposal sent" stage.
    await page.getByRole('button', { name: `Use ${name} as the proposal sent stage`, exact: true }).click();
    await expect(row.getByText('Proposal sent stage')).toBeVisible();
    expect((await stagesOf(page)).filter((s) => s.isProposalSentTarget).map((s) => s.name)).toEqual([name]);
    // While it is the target it cannot be removed.
    await confirmClick(page, `Remove ${name}`);
    await expect(toast(page, /Choose another stage for that first/)).toBeVisible();
    await page.getByRole('button', { name: `Use ${originalTarget.name} as the proposal sent stage`, exact: true }).click();
    await expect(page.locator(`tr[data-stage="${originalTarget.name}"]`).getByText('Proposal sent stage')).toBeVisible();
    expect((await stagesOf(page)).filter((s) => s.isProposalSentTarget).map((s) => s.id)).toEqual([originalTarget.id]);

    // Won / Lost: no remove control, and the server refuses a direct call.
    await expect(page.getByRole('button', { name: `Remove ${won.name}`, exact: true })).toHaveCount(0);
    expect((await apiCall(page, 'DELETE', `/admin/pipeline/stages/${won.id}`)).status).toBe(409);
    // A stage that holds deals is refused with an explanation.
    const inUse = before.find((s) => s.kind === 'open' && s.dealCount > 0 && !s.isProposalSentTarget);
    if (inUse) {
      await confirmClick(page, `Remove ${inUse.name}`);
      await expect(toast(page, /This stage cannot be removed/)).toBeVisible();
      expect((await stagesOf(page)).map((s) => s.id)).toContain(inUse.id);
    }

    // The unused E2E stage can be removed; the seeded stages are exactly as they were.
    await confirmClick(page, `Remove ${name}`);
    await expect(toast(page, 'Stage removed')).toBeVisible();
    await expect(row).toHaveCount(0);
  } finally {
    const now = await stagesOf(page);
    if (!now.find((s) => s.id === originalTarget.id)?.isProposalSentTarget)
      await apiCall(page, 'POST', `/admin/pipeline/stages/${originalTarget.id}/proposal-sent-target`, {});
    const leftover = now.find((s) => s.name === name);
    if (leftover) await apiCall(page, 'DELETE', `/admin/pipeline/stages/${leftover.id}`);
  }
  const after = await stagesOf(page);
  expect(after.map((s) => [s.id, s.name, s.probability, s.isProposalSentTarget])).toEqual(
    before.map((s) => [s.id, s.name, s.probability, s.isProposalSentTarget]),
  );
});

test('admin manages lost reasons: add, rename, deactivate, reactivate, remove', async ({ page }) => {
  await login(page, ADMIN);
  const name = `E2E Reason ${stamp}`;
  const renamed = `${name} renamed`;
  const list = async (): Promise<{ id: string; name: string; isActive: boolean }[]> => (await apiCall(page, 'GET', '/admin/lost-reasons')).json;
  const seeded = (await list())[0];
  if (!seeded) throw new Error('The demo data has no lost reasons');
  try {
    await openTab(page, 'Lost reasons');
    await page.getByRole('button', { name: 'Add lost reason' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Reason').fill(seeded.name.toUpperCase());
    await dialog.getByRole('button', { name: 'Add reason' }).click();
    await expect(toast(page, /already exists/)).toBeVisible();
    await dialog.getByLabel('Reason').fill(name);
    await dialog.getByRole('button', { name: 'Add reason' }).click();
    await expect(toast(page, 'Lost reason added')).toBeVisible();
    await expect(page.locator(`tr[data-reason="${name}"]`)).toContainText('Active');

    await page.getByRole('button', { name: `Rename ${name}`, exact: true }).click();
    await dialog.getByLabel('Reason').fill(renamed);
    await dialog.getByRole('button', { name: 'Save name' }).click();
    const row = page.locator(`tr[data-reason="${renamed}"]`);
    await expect(row).toBeVisible();

    await confirmClick(page, `Deactivate ${renamed}`);
    await expect(row).toContainText('Inactive');
    // Persisted after a reload, and seen by the API.
    await openTab(page, 'Lost reasons');
    await expect(row).toContainText('Inactive');
    expect((await list()).find((r) => r.name === renamed)).toMatchObject({ isActive: false });

    await page.getByRole('button', { name: `Reactivate ${renamed}`, exact: true }).click();
    await expect(row.getByText('Active', { exact: true })).toBeVisible();
    expect((await list()).find((r) => r.name === renamed)).toMatchObject({ isActive: true });

    await confirmClick(page, `Remove ${renamed}`);
    await expect(toast(page, 'Lost reason removed')).toBeVisible();
    await expect(row).toHaveCount(0);
    expect((await list()).some((r) => r.name.startsWith(name))).toBe(false);
  } finally {
    for (const r of (await list()).filter((x) => x.name.startsWith(name))) await apiCall(page, 'DELETE', `/admin/lost-reasons/${r.id}`);
  }
});

test('a manager sees a new team member’s deal immediately, and loses it when the member is removed', async ({ page, browser }) => {
  await login(page, ADMIN);
  const teamName = `E2E Team ${stamp}`;
  const renamedTeam = `${teamName} renamed`;
  const repName = `E2E Rep ${stamp}`;
  const adminId = (await apiCall(page, 'GET', '/me')).json.user.id as string;
  const users = (await apiCall(page, 'GET', '/users')).json as { id: string; email: string; fullName: string }[];
  const morgan = users.find((u) => u.email === 'morgan@northwind.example');
  if (!morgan) throw new Error('Demo manager is missing — run `pnpm db:seed`');

  // A new salesperson (never signs in) who owns one deal.
  const rep = await apiCall(page, 'POST', '/users', {
    email: `e2e-rep-${stamp}@northwind.example`,
    fullName: repName,
    role: 'salesperson',
    password: `E2e-${randomUUID()}`,
  });
  expect(rep.status).toBe(201);
  const repId = rep.json.id as string;
  const companyId = (await apiCall(page, 'POST', '/companies', { name: `E2E Team Company ${stamp}`, domain: `e2e-team-${stamp}.example` })).json.id;
  const deal = await apiCall(page, 'POST', '/deals', { name: `E2E Team Deal ${stamp}`, companyId, amount: '4200' });
  expect(deal.status).toBe(201);
  expect((await apiCall(page, 'POST', `/deals/${deal.json.id}/owner`, { ownerId: repId })).status).toBe(200);
  const dealPath = `/deals/${deal.json.id}`;
  const teams = async (): Promise<{ id: string; name: string; members: { userId: string }[]; managers: { userId: string }[] }[]> =>
    (await apiCall(page, 'GET', '/admin/teams')).json;
  const managerSees = () =>
    as(browser, morgan.email, async (m) => {
      const status = (await apiCall(m, 'GET', dealPath)).status;
      await m.goto(dealPath);
      if (status === 200) await expect(m.getByRole('heading', { name: `E2E Team Deal ${stamp}` })).toBeVisible();
      else await expect(m.getByRole('alert').filter({ hasText: 'does not exist or you do not have access' })).toBeVisible();
      return status;
    });

  try {
    expect(await managerSees()).toBe(404);

    await openTab(page, 'Teams');
    await page.getByRole('button', { name: 'New team' }).first().click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Team name').fill(teamName);
    await dialog.getByRole('button', { name: 'Create team' }).click();
    await expect(toast(page, 'Team created')).toBeVisible();
    await page.getByRole('button', { name: `Rename team ${teamName}`, exact: true }).click();
    await dialog.getByLabel('Team name').fill(renamedTeam);
    await dialog.getByRole('button', { name: 'Save name' }).click();
    const card = page.getByRole('region', { name: `Team ${renamedTeam}`, exact: true });
    await expect(card).toBeVisible();

    // A salesperson is not offered as a manager, and the server refuses it too.
    const managerPicker = card.getByLabel(`Add manager to ${renamedTeam}`);
    await expect(managerPicker.locator('option', { hasText: repName })).toHaveCount(0);
    const teamId = (await teams()).find((t) => t.name === renamedTeam)?.id as string;
    expect((await apiCall(page, 'POST', `/admin/teams/${teamId}/managers`, { userId: repId })).status).toBe(422);

    await managerPicker.selectOption(morgan.id);
    await card.getByRole('button', { name: 'Assign manager' }).click();
    await expect(toast(page, 'Manager assigned')).toBeVisible();
    await card.getByLabel(`Add member to ${renamedTeam}`).selectOption(repId);
    await card.getByRole('button', { name: 'Add member' }).click();
    await expect(toast(page, /Member added/)).toBeVisible();
    await expect(card.getByText(repName, { exact: true })).toBeVisible();
    await expect(card.getByText(morgan.fullName, { exact: true })).toBeVisible();

    // Persisted, and effective for the manager's very next request.
    const saved = (await teams()).find((t) => t.id === teamId);
    expect(saved?.members.map((x) => x.userId)).toEqual([repId]);
    expect(saved?.managers.map((x) => x.userId)).toEqual([morgan.id]);
    expect(await managerSees()).toBe(200);

    // The last manager cannot be removed while the team has members.
    await confirmClick(page, `Remove ${morgan.fullName} as manager of ${renamedTeam}`);
    await expect(toast(page, /needs at least one manager/)).toBeVisible();

    await confirmClick(page, `Remove ${repName} from ${renamedTeam}`);
    await expect(toast(page, 'Member removed')).toBeVisible();
    expect(await managerSees()).toBe(404);

    await confirmClick(page, `Remove ${morgan.fullName} as manager of ${renamedTeam}`);
    await expect(toast(page, 'Manager removed')).toBeVisible();
    await confirmClick(page, `Delete team ${renamedTeam}`);
    await expect(toast(page, 'Team deleted')).toBeVisible();
    await expect(card).toHaveCount(0);
  } finally {
    for (const t of (await teams()).filter((x) => x.name.startsWith(teamName))) {
      for (const m of t.members) await apiCall(page, 'DELETE', `/admin/teams/${t.id}/members/${m.userId}`);
      for (const m of t.managers) await apiCall(page, 'DELETE', `/admin/teams/${t.id}/managers/${m.userId}`);
      await apiCall(page, 'DELETE', `/admin/teams/${t.id}`);
    }
    await apiCall(page, 'POST', `/users/${repId}/deactivate`, { reassignToUserId: adminId });
  }
  expect((await teams()).some((t) => t.name.startsWith(teamName))).toBe(false);
});

test('admin reads the audit log: newest first, filters, readable changes, no way to edit', async ({ page }) => {
  await login(page, ADMIN);
  const adminName = (await apiCall(page, 'GET', '/me')).json.user.fullName as string;
  await page.goto('/admin/audit');
  await expect(page.getByRole('heading', { name: 'Audit log', level: 1 })).toBeVisible();
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toBeVisible();

  // Newest first, and the same order the API returns.
  const api = (await apiCall(page, 'GET', '/audit-log?limit=50')).json;
  const seqs: number[] = api.items.map((i: { seq: number }) => i.seq);
  expect(seqs).toEqual([...seqs].sort((a, b) => b - a));
  // Paging: older entries are appended, never repeated.
  if (api.nextCursor) {
    await expect(rows).toHaveCount(50);
    await page.getByRole('button', { name: 'Load older entries' }).click();
    await expect.poll(() => rows.count()).toBeGreaterThan(50);
  }

  // Filter by action prefix and person: the lost-reason test above left its trail.
  await page.getByLabel('Action starts with').fill('lost_reason.');
  await page.getByLabel('Person').selectOption({ label: adminName });
  await page.getByRole('button', { name: 'Apply filters' }).click();
  const reasonRow = rows.filter({ hasText: `name: E2E Reason ${stamp}` }).filter({ hasText: 'lost_reason.created' });
  await expect(reasonRow).toHaveCount(1);
  await expect(reasonRow).toContainText(adminName);
  await expect(rows.filter({ hasText: `name: E2E Reason ${stamp} → E2E Reason ${stamp} renamed` })).toHaveCount(1);
  await expect(rows.filter({ hasText: 'is active: yes → no' }).first()).toBeVisible();
  const actions = await page.locator('tbody tr code').allTextContents();
  expect(actions.length).toBeGreaterThan(0);
  expect(actions.every((a) => a.startsWith('lost_reason.'))).toBe(true);

  // Record-type filter, and the organization change with before → after values.
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Record type').selectOption('team');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(rows.filter({ hasText: 'team.created' }).filter({ hasText: `E2E Team ${stamp}` })).toHaveCount(1);
  expect((await page.locator('tbody tr code').allTextContents()).every((a) => a.startsWith('team.'))).toBe(true);
  await page.getByRole('button', { name: 'Clear filters' }).click();
  await page.getByLabel('Action starts with').fill('settings.organization');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(rows.filter({ hasText: `E2E footer ${stamp}` }).first()).toContainText('branding · footer text');

  // A date range in the future has nothing; the empty state says so.
  await page.getByRole('button', { name: 'Clear filters' }).click();
  const tomorrow = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel('From date').fill(tomorrow);
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('No entries match these filters')).toBeVisible();

  // Read-only: no secrets in the payload and no endpoint to change or remove an entry.
  expect(JSON.stringify(api)).not.toMatch(/"(password|token|secret|apiKey)":"(?!\[hidden\])/i);
  const count = (await apiCall(page, 'GET', '/audit-log?limit=1')).json.items[0].seq;
  for (const method of ['POST', 'PUT', 'DELETE']) expect([404, 405]).toContain((await apiCall(page, method, '/audit-log', {})).status);
  expect((await apiCall(page, 'GET', '/audit-log?limit=1')).json.items[0].seq).toBe(count);
});
