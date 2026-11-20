import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * New person form: link an existing company, or create a new one (name, domain, industry) in the same step.
 * Screenshots go to DEMO_SHOTS when set.
 */
const OUT = process.env.DEMO_SHOTS;
const dialog = (page: Page, title: string) => page.getByRole('dialog').filter({ hasText: title });

test('a new person can link an existing company or create one in the same form', async ({ page }) => {
  const stamp = Date.now().toString(36);
  const shot = async (name: string) => {
    if (OUT) await page.screenshot({ path: `${OUT}/${name}.png` });
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'riley@northwind.example');

  // An existing company is offered while typing and linked with one click.
  const existing = `Existing Co ${stamp}`;
  expect((await page.request.post('/api/v1/companies', { data: { name: existing, domain: `existing-${stamp}.example` } })).status()).toBe(201);
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'New person' }).first().click();
  const d = dialog(page, 'New person');
  await d.getByLabel('First name').fill('Maria');
  await d.getByLabel('Last name').fill(`Hill ${stamp}`);
  await d.getByLabel('Company', { exact: true }).fill(existing.slice(0, 11));
  await expect(d.getByRole('list', { name: 'Matching companies' })).toBeVisible();
  await shot('people-01-match-existing');
  await d.getByRole('button', { name: new RegExp(existing) }).click();
  await expect(d.getByText('Linked to an existing company.')).toBeVisible();
  await d.getByRole('button', { name: 'Create person' }).click();
  await expect(page.getByText('Person created')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: `Hill ${stamp}` })).toContainText(existing);

  // A company that does not exist yet is created with the person: name, domain and industry entered once.
  const fresh = `Avengers Initiative ${stamp}`;
  await page.getByRole('button', { name: 'New person' }).first().click();
  await d.getByLabel('First name').fill('Phil');
  await d.getByLabel('Last name').fill(`Coulson ${stamp}`);
  await d.getByLabel('Email').fill(`phil.${stamp}@avengers.example`);
  await d.getByLabel('Company', { exact: true }).fill(fresh);
  await d.getByLabel('Company domain').fill(`avengers-${stamp}.example`);
  await d.getByLabel('Industry').fill('Defense');
  await shot('people-02-new-company');
  await d.getByRole('button', { name: 'Create person' }).click();
  await expect(page.getByText('Person and company created')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: `Coulson ${stamp}` })).toContainText(fresh);

  // The Companies page lists it with domain, industry and owner.
  await page.goto('/companies');
  const row = page.getByRole('row').filter({ hasText: fresh });
  await expect(row).toContainText(`avengers-${stamp}.example`);
  await expect(row).toContainText('Defense');
  await expect(row).toContainText('Spider-Man');
  await shot('people-03-companies-page');

  // Typing a domain that another company already uses offers that company instead of a duplicate.
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'New person' }).first().click();
  await d.getByLabel('First name').fill('Clint');
  await d.getByLabel('Company', { exact: true }).fill(`Hawkeye Corp ${stamp}`);
  await d.getByLabel('Company domain').fill(`https://www.avengers-${stamp}.example`);
  await expect(d.getByRole('button', { name: `Link ${fresh}` })).toBeVisible();
  await shot('people-04-domain-taken');
  await d.getByRole('button', { name: `Link ${fresh}` }).click();
  await expect(d.getByText('Linked to an existing company.')).toBeVisible();
});
