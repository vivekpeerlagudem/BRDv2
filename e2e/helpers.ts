import { expect, type Page } from '@playwright/test';

export const password = process.env.SEED_PASSWORD ?? '';

/**
 * Signs in through the real login form. The server rate-limits sign-in attempts (a few per 10 seconds);
 * a test suite logs in far faster than a person, so on "Too many attempts" this waits and tries again.
 */
export async function login(page: Page, email: string) {
  if (!password) throw new Error('SEED_PASSWORD is missing — run `pnpm db:seed` first (it writes the demo password to .env.local).');
  const nav = page.getByRole('navigation', { name: 'Main', exact: true });
  const limited = page.getByRole('alert').filter({ hasText: 'Too many attempts' });
  for (let attempt = 0; attempt < 4; attempt++) {
    await page.goto('/login');
    await page.getByLabel('Email').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(nav.or(limited)).toBeVisible();
    if (await nav.isVisible()) return;
    await page.waitForTimeout(11_000);
  }
  throw new Error('Could not sign in: still rate-limited after several attempts');
}
