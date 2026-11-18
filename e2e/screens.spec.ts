import { expect, test } from '@playwright/test';
import { login } from './helpers.ts';

/** Every screen opens for an Admin without a script error; the hosted lead form creates a lead; roles are enforced. */
const stamp = Date.now().toString(36);

test('admin can open every screen without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await login(page, 'admin@northwind.example');

  const screens: [path: string, heading: string][] = [
    ['/', 'Dashboard'],
    ['/deals', 'Deals'],
    ['/companies', 'Companies'],
    ['/contacts', 'Contacts'],
    ['/tasks', 'My tasks'],
    ['/leads', 'Leads'],
    ['/templates', 'Proposal templates'],
    ['/catalog', 'Product catalogue'],
    ['/admin/users', 'Users and roles'],
  ];
  for (const [path, heading] of screens) {
    await page.goto(path);
    await expect(page.getByRole('heading', { name: heading, level: 1 })).toBeVisible();
    await expect(page.getByRole('status', { name: 'Loading' })).toHaveCount(0); // data finished loading
    await expect(page.getByText('Something went wrong')).toHaveCount(0);
    await page.screenshot({ path: `test-results/screens/${path === '/' ? 'dashboard' : path.slice(1).replace('/', '-')}.png` });
  }

  // Deal board → list layout, then a deal detail page and the template editor.
  await page.goto('/deals');
  await page.getByRole('button', { name: 'list' }).click();
  await page.getByRole('table').getByRole('link').first().click();
  await expect(page.getByRole('heading', { name: 'Activity timeline' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/deal-detail.png', fullPage: true });
  await page.goto('/templates');
  await page.getByRole('link', { name: 'Services proposal' }).click();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();

  // Global search finds a seeded company.
  await page.getByLabel('Search companies, contacts and deals').fill('E2E');
  expect(errors).toEqual([]);
});

test('hosted lead form creates a lead that appears in the CRM', async ({ page }) => {
  await login(page, 'admin@northwind.example');
  await page.goto('/leads');
  const formUrl = await page.getByLabel('Lead form URL').inputValue();
  expect(formUrl).toContain('proposals.localhost:5273/f?form=');

  const email = `lena@lead-${stamp}.example`;
  await page.goto(formUrl);
  await page.getByLabel('First name').fill('Lena');
  await page.getByLabel('Last name').fill(`Lead${stamp}`);
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Company').fill(`E2E Lead Co ${stamp}`);
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Thank you')).toBeVisible();

  await page.goto('http://localhost:5273/leads');
  const row = page.getByRole('row').filter({ hasText: email });
  await expect(row.getByText('Accepted')).toBeVisible();
  await expect(row.getByRole('link', { name: 'Open deal' })).toBeVisible();
});

test('a salesperson cannot use admin functions', async ({ page }) => {
  await login(page, 'riley@northwind.example');
  // Called from the page so the request carries the same Origin header and session cookie as the app itself.
  const attempt = (method: string, path: string) =>
    page.evaluate(
      async ([m, p]) => {
        const r = await fetch(p as string, { method: m as string, headers: { 'content-type': 'application/json' }, body: '{}' });
        return { status: r.status, code: (await r.json()).code };
      },
      [method, path],
    );
  expect(await attempt('POST', '/api/v1/users')).toEqual({ status: 403, code: 'FORBIDDEN' });
  expect(await attempt('POST', '/api/v1/templates')).toEqual({ status: 403, code: 'FORBIDDEN' });
  expect(await attempt('POST', '/api/v1/products')).toEqual({ status: 403, code: 'FORBIDDEN' });
  await expect(page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: /Users/ })).toHaveCount(0);
});
