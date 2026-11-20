import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * Lead workflow through the UI: New → Start working → Qualify → Convert (reusing the existing company),
 * and Disqualify → Reopen. With LEADS_DEMO=1 the leads get plain Marvel names (run once on the Marvel data);
 * otherwise names are made unique per run. Screenshots go to DEMO_SHOTS when set.
 */
const OUT = process.env.DEMO_SHOTS;
const dialog = (page: Page, title: string | RegExp) => page.getByRole('dialog').filter({ hasText: title });

test('a lead moves from new to converted, reusing the existing company; a disqualified lead can be reopened', async ({ page }) => {
  test.setTimeout(120_000);
  const sfx = process.env.LEADS_DEMO ? '' : ` ${Date.now().toString(36)}`;
  const company = process.env.LEADS_DEMO ? 'Stark Industries' : `Lead Co${sfx}`;
  let n = 0;
  const shot = async (name: string) => {
    if (OUT) await page.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png` });
  };
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'riley@northwind.example');
  if (!process.env.LEADS_DEMO) expect((await page.request.post('/api/v1/companies', { data: { name: company } })).status()).toBe(201);

  // ── New lead ──
  const happy = `Happy Hogan${sfx}`;
  await page.goto('/leads');
  await page.getByRole('button', { name: 'New lead' }).first().click();
  const nl = dialog(page, 'New lead');
  await nl.getByLabel('Name').fill(happy);
  await nl.getByLabel('Company').fill(company.toUpperCase()); // different case: still matched on conversion
  await nl.getByLabel('Email').fill(`happy${sfx.trim()}@starkindustries.example`);
  await nl.getByLabel('Job title').fill('Head of Security');
  await nl.getByLabel('Source').fill('referral');
  await nl.getByLabel('Notes').fill('Met at the Stark Expo. Wants a security upgrade for the Malibu site.');
  await shot('new-lead');
  await nl.getByRole('button', { name: 'Create lead' }).click();
  await expect(page.getByText('Lead created')).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: happy });
  await expect(row.getByText('New', { exact: true })).toBeVisible();
  await shot('list-new');

  // ── Start working → Qualify ──
  await row.getByRole('button', { name: 'Start working' }).click();
  await expect(row.getByText('Working', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Qualify' }).click();
  await expect(row.getByText('Qualified', { exact: true })).toBeVisible();

  // ── Details view shows progress, notes and the next step ──
  await row.getByRole('button', { name: new RegExp(`^${happy}`) }).click();
  const details = page.getByRole('dialog').filter({ has: page.getByRole('list', { name: 'Lead progress' }) });
  await expect(details.getByRole('list', { name: 'Lead progress' })).toBeVisible();
  await expect(details.getByText('Met at the Stark Expo')).toBeVisible();
  await shot('details-qualified');
  await details.getByRole('button', { name: 'Convert…' }).click();

  // ── Convert: the existing company is pre-selected, so no duplicate is created ──
  const conv = dialog(page, `Convert ${happy}`);
  await expect(conv.getByText('already exists, so the person is linked to it')).toBeVisible();
  await conv.getByLabel('Amount').fill('120000');
  await shot('convert');
  await conv.getByRole('button', { name: 'Convert lead' }).click();
  await expect(page.getByText('Lead converted')).toBeVisible();
  await expect(row.getByText('Converted', { exact: true })).toBeVisible();
  await expect(row.getByRole('link', { name: 'Open opportunity' })).toBeVisible();
  const companies = await (await page.request.get(`/api/v1/companies?q=${encodeURIComponent(company)}`)).json();
  expect(companies.items.filter((c: { name: string }) => c.name.toLowerCase() === company.toLowerCase())).toHaveLength(1);

  // ── Disqualify → Reopen ──
  const loki = `Loki${sfx}`;
  await page.getByRole('button', { name: 'New lead' }).first().click();
  await nl.getByLabel('Name').fill(loki);
  await nl.getByLabel('Company').fill(`Asgard Trading${sfx}`);
  await nl.getByLabel('Source').fill('web form');
  await nl.getByRole('button', { name: 'Create lead' }).click();
  const lrow = page.getByRole('row').filter({ hasText: loki });
  await lrow.getByRole('button', { name: `More actions for ${loki}` }).click();
  await page.getByRole('menuitem', { name: 'Disqualify…' }).click();
  await dialog(page, `Disqualify ${loki}`).getByLabel('Reason').fill('Not a real buyer: wants the Tesseract, not a CRM rollout.');
  await dialog(page, `Disqualify ${loki}`).getByRole('button', { name: 'Disqualify' }).click();
  await expect(lrow.getByText('Unqualified', { exact: true })).toBeVisible();
  await expect(lrow.getByRole('button', { name: 'Reopen' })).toBeVisible();

  // Status tabs filter the list and show counts.
  await page.getByRole('tab', { name: /Unqualified/ }).click();
  await expect(lrow).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: happy })).toHaveCount(0);
  await shot('tab-unqualified');
  if (!process.env.LEADS_DEMO) {
    await lrow.getByRole('button', { name: 'Reopen' }).click();
    await page.getByRole('tab', { name: /^All/ }).click();
    await expect(lrow.getByText('New', { exact: true })).toBeVisible();
  }
  await page.getByRole('tab', { name: /^All/ }).click();
  await shot('list-all');
});
