import { expect, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * The whole browser shares one session cookie, so signing in as another user in a second tab swaps the
 * session everywhere. The app must (a) keep a single consistent session stable across refresh, and
 * (b) surface a cross-tab session swap EXPLICITLY instead of silently rendering a different role.
 */

test('a single session stays on the same role across refresh', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, 'riley@northwind.example');
  await page.goto('/deals');
  await page.reload();
  await expect(page.getByTestId('current-user-role')).toHaveText(/salesperson/i);
  await expect(page.getByRole('heading', { name: 'Your session changed' })).toHaveCount(0);
});

test('signing in as another user in a second tab is surfaced, not silently applied', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await browser.newContext(); // one cookie jar = one browser
  const tab1 = await ctx.newPage();
  await login(tab1, 'riley@northwind.example'); // salesperson
  await expect(tab1.getByTestId('current-user-role')).toHaveText(/salesperson/i);

  const tab2 = await ctx.newPage();
  await login(tab2, 'admin@northwind.example'); // admin — swaps the shared cookie

  // Refreshing the salesperson tab must NOT silently become admin; it shows the explicit notice.
  await tab1.reload();
  await expect(tab1.getByRole('heading', { name: 'Your session changed' })).toBeVisible();
  await expect(tab1.getByText(/signed in as.*Avery Admin/i)).toBeVisible();

  // Choosing to continue adopts the real (admin) identity consistently.
  await tab1.getByRole('button', { name: /Continue as/ }).click();
  await expect(tab1.getByTestId('current-user-role')).toHaveText(/admin/i);
  await ctx.close();
});

test('same-tab account switch (sign out then in) does not trigger the notice', async ({ page }) => {
  test.setTimeout(60_000);
  await login(page, 'admin@northwind.example');
  await expect(page.getByTestId('current-user-role')).toHaveText(/admin/i);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.waitForURL(/\/login/);
  await login(page, 'riley@northwind.example');
  await page.goto('/');
  await expect(page.getByTestId('current-user-role')).toHaveText(/salesperson/i);
  await expect(page.getByRole('heading', { name: 'Your session changed' })).toHaveCount(0);
});
