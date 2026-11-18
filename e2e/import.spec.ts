import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * CSV import through the real Admin screen: upload → map columns → review (validation errors, duplicates, nothing saved
 * yet) → import → the records exist in the CRM → undo → the records are gone. Also: a salesperson cannot use it.
 *
 * Runs against the development database. It creates companies named "E2E Import <stamp> …" and removes them again
 * with the product's own Undo; it never touches pre-existing data.
 */
const stamp = Date.now().toString(36);
const prefix = `E2E Import ${stamp}`;
const fileName = `e2e-import-${stamp}.csv`;
const csv = [
  'Company Name,Domain,Line of business',
  `${prefix} Alpha,e2e-import-${stamp}-alpha.example,Robotics`,
  `"${prefix} Beta, Ltd.",e2e-import-${stamp}-beta.example,"Paper, pulp"`,
  `,e2e-import-${stamp}-noname.example,Nameless`, // row 4: invalid — no company name
  `${prefix} Alpha copy,E2E-IMPORT-${stamp}-ALPHA.example,Robotics`, // row 5: same domain as row 2
].join('\r\n');

/** JSON API call from inside the signed-in page (same cookies and Origin as the app). */
const apiGet = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    const r = await fetch(`/api/v1${p}`);
    const text = await r.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {}
    return { status: r.status, json, text };
  }, path);
const findCompanies = async (page: Page) =>
  (await apiGet(page, `/companies?q=${encodeURIComponent(prefix)}&limit=50`)).json.items as { id: string; name: string }[];

test.describe.configure({ mode: 'serial' });

test('an Admin imports a CSV with column mapping, sees the validation errors, commits, and undoes the import', async ({ page }) => {
  await login(page, 'admin@northwind.example');
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Import data' }).click();
  await expect(page.getByRole('heading', { name: 'Import data' })).toBeVisible();

  // ── Upload ──
  await page.getByLabel('What does the file contain?').selectOption('companies');
  await page.getByLabel('CSV file').setInputFiles({ name: fileName, mimeType: 'text/csv', buffer: Buffer.from(csv, 'utf8') });
  await page.getByRole('button', { name: 'Upload and continue' }).click();

  // ── Map columns ── suggestions come from the header names; the unknown column is mapped by hand.
  await expect(page.getByRole('heading', { name: 'Map columns' })).toBeVisible();
  const nameColumn = page.getByLabel('Import column "Company Name" as');
  const lobColumn = page.getByLabel('Import column "Line of business" as');
  await expect(nameColumn).toHaveValue('name');
  await expect(page.getByLabel('Import column "Domain" as')).toHaveValue('domain');
  await expect(lobColumn).toHaveValue('');
  const check = page.getByRole('button', { name: 'Save mapping and check the file' });
  // A required field must be mapped before the file can be checked.
  await nameColumn.selectOption('');
  await expect(page.getByRole('alert').filter({ hasText: 'Company name' })).toBeVisible();
  await expect(check).toBeDisabled();
  await nameColumn.selectOption('name');
  await lobColumn.selectOption('industry');
  await check.click();

  // ── Review ── the bad row and the duplicate are reported, and nothing is in the CRM yet.
  await expect(page.getByRole('heading', { name: 'Review — nothing has been saved yet' })).toBeVisible();
  const badRow = page.locator('tr[data-row="4"]');
  await expect(badRow).toContainText('Invalid');
  await expect(badRow).toContainText('Company Name: Company name is required');
  await page.getByLabel('Show rows').selectOption('duplicate');
  const dupRow = page.locator('tr[data-row="5"]');
  await expect(dupRow).toContainText('as row 2 of this file');
  await expect(dupRow).toContainText('Cannot be created twice');
  await expect(page.getByTestId('import-summary')).toHaveText(/2 companies will be created\. 1 invalid row and 1 duplicate will not be\s+imported\./);
  // Same domain can never be created twice, so "create anyway" is not offered for this file.
  await expect(page.getByRole('radio', { name: /Create duplicates anyway/ })).toBeDisabled();
  expect(await findCompanies(page)).toHaveLength(0);

  // The error report is a real CSV with the original row and the problem.
  const href = await page.getByRole('link', { name: 'Download the error report (CSV)' }).getAttribute('href');
  const report = await page.evaluate(async (u) => (await fetch(u as string)).text(), href);
  expect(report).toContain('Company Name: Company name is required');
  expect(report).toContain(`e2e-import-${stamp}-noname.example`);
  expect(report).not.toContain(`${prefix} Beta`); // valid rows are not in the error report

  // ── Commit ──
  await page.getByRole('button', { name: 'Import 2 companies' }).click();
  await page.getByRole('button', { name: 'Yes, import' }).click();
  await expect(page.getByTestId('import-result')).toContainText('2 companies created');
  await expect(page.getByTestId('import-result')).toContainText('2 rows not imported (1 invalid, 1 duplicate)');

  // ── The records exist in the CRM, with the mapped values; the bad row and the duplicate do not. ──
  const created = await findCompanies(page);
  expect(created.map((c) => c.name).sort()).toEqual([`${prefix} Alpha`, `${prefix} Beta, Ltd.`]);
  const beta = created.find((c) => c.name.includes('Beta'))!;
  await page.goto(`/companies/${beta.id}`);
  await expect(page.getByRole('heading', { name: `${prefix} Beta, Ltd.` })).toBeVisible();
  await expect(page.getByText(`e2e-import-${stamp}-beta.example · Paper, pulp`)).toBeVisible();
  await page.goto('/companies');
  await expect(page.getByRole('link', { name: `${prefix} Alpha`, exact: true }).first()).toBeVisible();

  // ── History and Undo ── the dialog says what will be removed before anything happens.
  await page.goto('/admin/import');
  const historyRow = page.getByRole('row').filter({ hasText: fileName });
  await expect(historyRow).toContainText('Imported');
  await historyRow.getByRole('button', { name: `Undo import ${fileName}` }).click();
  await expect(page.getByTestId('undo-summary')).toContainText('2 companies will be permanently removed. 0 companies will be');
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('row').filter({ hasText: `${prefix} Alpha` })).toContainText('Will be removed');
  expect(await findCompanies(page)).toHaveLength(2); // opening the dialog removed nothing
  await dialog.getByRole('button', { name: 'Remove 2 companies' }).click();
  await expect(historyRow).toContainText('Undone');
  await expect(historyRow.getByRole('button', { name: `Undo import ${fileName}` })).toHaveCount(0);

  // ── The records are gone. ──
  expect(await findCompanies(page)).toHaveLength(0);
  expect((await apiGet(page, `/companies/${beta.id}`)).status).toBe(404);
  await historyRow.getByRole('button', { name: `View import ${fileName}` }).click();
  await expect(page.getByTestId('undo-result')).toContainText('2 companies removed, 0 kept');
});

test('a salesperson has no import screen and the API refuses them', async ({ page }) => {
  await login(page, 'riley@northwind.example');
  await expect(page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Import data' })).toHaveCount(0);
  expect((await apiGet(page, '/imports')).status).toBe(403);
  const posted = await page.evaluate(async () => {
    const r = await fetch('/api/v1/imports', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entityType: 'companies', fileName: 'x.csv', text: 'name\nE2E Import forbidden\n' }),
    });
    return r.status;
  });
  expect(posted).toBe(403);
});
