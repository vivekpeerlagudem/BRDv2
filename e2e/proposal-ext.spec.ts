import { type Browser, expect, type Page, test } from '@playwright/test';
import { login, publishedTemplate } from './helpers.ts';

/**
 * Proposal and sharing extensions through the real CRM and buyer screens:
 * validity date (BR-PRP-009) → per-link expiry seen by the buyer (BR-SHR-007) → version comparison (BR-PRP-006)
 * → copy to another deal (BR-PRP-010) → revoke.
 *
 * Runs against the development database. It only adds "E2E PX …" records and changes nothing that existed before.
 */
const stamp = Date.now().toString(36);
const companyA = `E2E PX Alpha ${stamp}`;
const companyB = `E2E PX Beta ${stamp}`;
const dealA = `E2E PX Deal A ${stamp}`;
const dealB = `E2E PX Deal B ${stamp}`;
const jordanDeal = `E2E PX Jordan Deal ${stamp}`;
const DAY = 86_400_000;
/** Calendar day in UTC (the server's "today"), offset by whole days. */
const day = (offset: number) => new Date(Date.now() + offset * DAY).toISOString().slice(0, 10);
/** Value for <input type="datetime-local"> in the browser's (= this machine's) time zone. */
const localInput = (d: Date, withSeconds = false) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, withSeconds ? 19 : 16);

const dialog = (page: Page, title: string) => page.getByRole('dialog').filter({ hasText: title });
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
async function asUser<T>(browser: Browser, email: string, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, email);
    return await fn(page);
  } finally {
    await context.close();
  }
}
/** Sends the open draft to the first deal contact and returns the recipient's personal link. */
async function sendFromUi(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Send…' }).click();
  const send = dialog(page, 'Send proposal');
  const recipient = send.getByRole('checkbox').first();
  if (!(await recipient.isChecked())) await recipient.check();
  await send.getByRole('button', { name: 'Send', exact: true }).click();
  const confirmSend = send.getByRole('button', { name: 'Confirm and send' });
  const shareLink = page.getByLabel('Share link').first();
  await expect(confirmSend.or(shareLink)).toBeVisible({ timeout: 60_000 });
  if (await confirmSend.isVisible()) await confirmSend.click();
  await expect(shareLink).toBeVisible({ timeout: 60_000 });
  const url = await shareLink.inputValue();
  await dialog(page, 'Proposal sent').getByRole('button', { name: 'Close' }).click();
  return url;
}

test('validity date, link expiry, version comparison and copy to another deal', async ({ page, browser }) => {
  test.setTimeout(300_000);

  // A deal of another salesperson: it must never be offered as a copy target to Riley.
  const jordanDealId = await asUser(browser, 'jordan@northwind.example', async (p) => {
    const co = (await apiCall(p, 'POST', '/companies', { name: `E2E PX Gamma ${stamp}`, domain: `e2e-px-g-${stamp}.example` })).json.id;
    const d = await apiCall(p, 'POST', '/deals', { name: jordanDeal, companyId: co, amount: '1000' });
    expect(d.status).toBe(201);
    return d.json.id as string;
  });

  await login(page, 'riley@northwind.example');
  // Test data through the API (creating companies, contacts and deals in the UI is covered by journey.spec.ts).
  const mk = async (company: string, deal: string, slug: string, first: string) => {
    const companyId = (await apiCall(page, 'POST', '/companies', { name: company, domain: `e2e-px-${slug}-${stamp}.example` })).json.id;
    const contactId = (
      await apiCall(page, 'POST', '/contacts', {
        firstName: first,
        lastName: `Buyer${stamp}`,
        email: `${first.toLowerCase()}@e2e-px-${slug}-${stamp}.example`,
        companyId,
      })
    ).json.id;
    const d = await apiCall(page, 'POST', '/deals', { name: deal, companyId, amount: '15000', contactIds: [contactId] });
    expect(d.status).toBe(201);
    return d.json.id as string;
  };
  const dealAId = await mk(companyA, dealA, 'a', 'Erin');
  const dealBId = await mk(companyB, dealB, 'b', 'Omar');
  const template = await publishedTemplate(page);
  const created = await apiCall(page, 'POST', `/deals/${dealAId}/proposals`, { templateId: template.id, signatureRequired: false });
  expect(created.status).toBe(201);
  const proposalId = created.json.id as string;
  const proposalUrl = `/proposals/${proposalId}`;
  const saved = async () => (await apiCall(page, 'GET', proposalUrl)).json;

  // ── 1. Validity date (BR-PRP-009) ────────────────────────────────────────────────────────────────────────────────
  await page.goto(proposalUrl);
  const validUntil = page.getByLabel('Valid until');
  const before = await saved();
  expect(before.defaultValidUntil).toBe(day(before.defaultValidityDays));
  await expect(validUntil).toHaveValue(before.defaultValidUntil); // starts on the organization default
  await expect(page.getByText(`(${before.defaultValidityDays} days from today)`)).toBeVisible();

  // A past date is refused before anything is saved.
  await validUntil.fill(day(-3));
  await expect(page.getByRole('alert').filter({ hasText: 'The validity date must be today or later' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeDisabled();
  expect((await saved()).validUntil).toBe(before.defaultValidUntil);
  // The server refuses it too (the rule does not depend on the screen).
  const direct = await apiCall(page, 'PUT', `${proposalUrl}/draft`, {
    content: before.currentVersion.content,
    pricing: before.currentVersion.pricing,
    termMonths: before.currentVersion.termMonths,
    rowVersion: before.currentVersion.rowVersion,
    validUntil: day(-3),
  });
  expect(direct.status).toBe(422);
  expect(direct.json.code).toBe('VALIDITY_DATE_PAST');

  const chosen = day(9);
  await validUntil.fill(chosen);
  await page.getByLabel('Add from catalogue').selectOption({ index: 1 });
  await page.getByRole('textbox', { name: 'Scope of work', exact: true }).fill('Discovery and implementation for the {{company.name}} team.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  expect((await saved()).validUntil).toBe(chosen); // persisted
  await page.reload();
  await expect(page.getByLabel('Valid until')).toHaveValue(chosen); // and re-read into the editor
  await expect(page.getByRole('button', { name: 'Use default' })).toBeVisible();
  await expect(page.getByText('No issues found. Ready to send.').or(page.getByText('Opportunity amount', { exact: false }).first())).toBeVisible();

  // The preview (the buyer's document and the PDF source) carries the date.
  await page.getByRole('button', { name: 'Preview' }).click();
  const preview = page.frameLocator('iframe[title="Proposal preview"]');
  await expect(preview.getByText(`· Valid until ${chosen}`)).toBeVisible();
  await expect(preview.getByText(companyA).first()).toBeVisible();
  await dialog(page, 'Preview').getByRole('button', { name: 'Close' }).click();

  const url = await sendFromUi(page);
  expect(url).toMatch(/^http:\/\/proposals\.localhost:5273\/p#.+/);
  // Once sent, the date is frozen with the version: the field is gone and the date is shown read-only.
  await expect(page.getByLabel('Valid until')).toHaveCount(0);
  await expect(page.getByText('Sent versions cannot change. Create a new version to change the validity date.')).toBeVisible();

  // The buyer sees the same validity date.
  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  await buyer.goto(url);
  await buyer.getByRole('button', { name: /Continue as Erin/ }).click();
  await expect(buyer.frameLocator('iframe').getByText(`· Valid until ${chosen}`)).toBeVisible();

  // ── 2. Per-link expiry (BR-SHR-007) ──────────────────────────────────────────────────────────────────────────────
  const row = page.getByRole('listitem', { name: /^Link for Erin .*version 1$/ });
  await expect(row.getByText('No link expiry — open until the proposal itself expires')).toBeVisible();
  const linkId = (await apiCall(page, 'GET', `${proposalUrl}/links`)).json[0].id as string;
  const linkNow = async () => (await apiCall(page, 'GET', `${proposalUrl}/links`)).json.find((l: { id: string }) => l.id === linkId);

  // Set an expiry inside the validity period.
  await row.getByRole('button', { name: 'Set expiry…' }).click();
  let expiry = dialog(page, 'Link expiry');
  await expect(expiry.getByText(/The proposal itself is valid until/)).toBeVisible();
  // A moment in the past cannot be saved.
  await expiry.getByLabel('Link expires on').fill(localInput(new Date(Date.now() - 2 * DAY)));
  await expect(expiry.getByRole('alert').filter({ hasText: 'The link expiry must be in the future' })).toBeVisible();
  await expect(expiry.getByRole('button', { name: 'Save expiry' })).toBeDisabled();
  const inTwoDays = new Date(Math.floor((Date.now() + 2 * DAY) / 60_000) * 60_000);
  await expiry.getByLabel('Link expires on').fill(localInput(inTwoDays));
  await expiry.getByRole('button', { name: 'Save expiry' }).click();
  await expect(row.getByText(/^Link expires on /)).toBeVisible();
  expect(new Date((await linkNow()).expiresAt).getTime()).toBe(inTwoDays.getTime()); // persisted exactly

  // Later than the proposal's validity date → the user must confirm explicitly.
  await row.getByRole('button', { name: 'Change expiry…' }).click();
  expiry = dialog(page, 'Link expiry');
  const inThirtyDays = new Date(Math.floor((Date.now() + 30 * DAY) / 60_000) * 60_000);
  await expiry.getByLabel('Link expires on').fill(localInput(inThirtyDays));
  await expiry.getByRole('button', { name: 'Save expiry' }).click();
  await expect(expiry.getByRole('alert').filter({ hasText: "later than the proposal's validity date" })).toBeVisible();
  expect(new Date((await linkNow()).expiresAt).getTime()).toBe(inTwoDays.getTime()); // nothing saved yet
  await expiry.getByRole('button', { name: 'Confirm and save' }).click();
  await expect(expiry).toHaveCount(0);
  expect(new Date((await linkNow()).expiresAt).getTime()).toBe(inThirtyDays.getTime());

  // Another salesperson cannot change this link (it is not even visible to them).
  const foreign = await asUser(browser, 'jordan@northwind.example', (p) =>
    apiCall(p, 'PUT', `/share-links/${linkId}/expiry`, { expiresAt: new Date(Date.now() + DAY).toISOString() }),
  );
  expect([403, 404]).toContain(foreign.status);
  expect(new Date((await linkNow()).expiresAt).getTime()).toBe(inThirtyDays.getTime());

  // Let the link run out: a few seconds from now, entered in the same dialog.
  await row.getByRole('button', { name: 'Change expiry…' }).click();
  expiry = dialog(page, 'Link expiry');
  const soon = new Date(Math.floor(Date.now() / 1000) * 1000 + 8_000);
  await expiry.getByLabel('Link expires on').fill(localInput(soon, true));
  await expiry.getByRole('button', { name: 'Save expiry' }).click();
  await expect(expiry).toHaveCount(0);
  expect(new Date((await linkNow()).expiresAt).getTime()).toBe(soon.getTime());
  await page.waitForTimeout(Math.max(0, soon.getTime() - Date.now()) + 1_500);

  // The buyer now gets the neutral "link expired" page — no proposal content.
  await buyer.reload();
  await expect(buyer.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await expect(buyer.locator('iframe')).toHaveCount(0);
  await expect(buyer.getByText(companyA)).toHaveCount(0);
  const refused = await buyer.evaluate(async () => {
    const [proposal, download] = await Promise.all([fetch('/public/v1/proposal'), fetch('/public/v1/download')]);
    return [proposal.status, download.status];
  });
  expect(refused).toEqual([422, 422]);
  // A brand-new browser with the same link is refused the same way.
  const lateContext = await browser.newContext();
  const late = await lateContext.newPage();
  await late.goto(url);
  await expect(late.getByRole('heading', { name: 'This link has expired' })).toBeVisible();
  await lateContext.close();

  // The salesperson sees it as expired, and can open it again by removing the expiry.
  await page.reload();
  await expect(row.getByText(/^Link expired on /)).toBeVisible();
  await expect(row.getByText('v1 · expired')).toBeVisible();
  await row.getByRole('button', { name: 'Change expiry…' }).click();
  await dialog(page, 'Link expiry').getByRole('button', { name: 'Remove expiry' }).click();
  await expect(row.getByText('No link expiry — open until the proposal itself expires')).toBeVisible();
  expect((await linkNow()).expiresAt).toBeNull();
  await buyer.reload();
  await expect(buyer.frameLocator('iframe').getByText(companyA).first()).toBeVisible();

  // ── 3. Second version, then compare the two sent versions (BR-PRP-006) ───────────────────────────────────────────
  await page.getByRole('button', { name: 'Create new version' }).click();
  await expect(page.getByText('New draft version created')).toBeVisible();
  await expect(page.getByText('Version 2 (draft)')).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Scope of work', exact: true })
    .fill('Discovery, implementation and a second rollout phase for the {{company.name}} team.');
  await page.getByLabel('Quantity').fill('3');
  const later = day(12);
  await page.getByLabel('Valid until').fill(later);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await sendFromUi(page);
  await expect(page.getByText('Version 2 (sent)')).toBeVisible();

  await page.getByRole('button', { name: 'Compare versions' }).click();
  const compare = dialog(page, 'Compare versions');
  await expect(compare.getByLabel('From')).toHaveValue(before.currentVersion.id); // version 1 → version 2 by default
  const summary = compare.getByRole('region', { name: 'Summary' });
  await expect(summary.getByText('changed', { exact: true })).toHaveCount(2); // contract value and validity date; the term is unchanged
  await expect(summary.getByText('12 months (unchanged)')).toBeVisible();
  await expect(compare.getByRole('region', { name: 'Pricing changes' }).getByText('Quantity: 1 → 3')).toBeVisible();
  const text = compare.getByRole('region', { name: 'Text changes' });
  await expect(text.getByText('Scope of work')).toBeVisible();
  await expect(text.getByText('Discovery and implementation for the {{company.name}} team.', { exact: true })).toBeVisible(); // before
  await expect(text.getByText('Discovery, implementation and a second rollout phase for the {{company.name}} team.', { exact: true })).toBeVisible(); // after
  await expect(text.getByText('Introduction')).toHaveCount(0); // unchanged sections are not listed
  // The numbers on screen are the server's comparison of the two frozen versions.
  const versions = (await saved()).versions as { id: string; versionNumber: number; state: string }[];
  expect(versions.map((v) => [v.versionNumber, v.state])).toEqual([
    [2, 'sent'],
    [1, 'superseded'],
  ]);
  const diff = (await apiCall(page, 'GET', `${proposalUrl}/compare?from=${versions[1]!.id}&to=${versions[0]!.id}`)).json;
  expect(diff.validUntil).toEqual({ from: chosen, to: later });
  expect(Number(diff.totals.to)).toBeGreaterThan(Number(diff.totals.from));
  // Reversing the direction swaps before and after; choosing the same version twice compares nothing.
  await compare.getByLabel('From').selectOption(versions[0]!.id);
  await compare.getByLabel('To').selectOption(versions[1]!.id);
  await expect(compare.getByRole('region', { name: 'Pricing changes' }).getByText('Quantity: 3 → 1')).toBeVisible();
  await compare.getByLabel('To').selectOption(versions[0]!.id);
  await expect(compare.getByText('Choose two different versions to compare.')).toBeVisible();
  await compare.getByRole('button', { name: 'Close' }).click();

  // ── 4. Copy to another deal (BR-PRP-010) ─────────────────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Copy to another opportunity…' }).click();
  const copy = dialog(page, 'Copy to another deal');
  // Another owner's deal is not offered…
  await copy.getByLabel('Find an opportunity').fill(jordanDeal);
  await expect(copy.getByText('No matching opportunities')).toBeVisible();
  await expect(copy.getByRole('button', { name: 'Create copy' })).toBeDisabled();
  // …and the server refuses it even when asked directly.
  const sneaky = await apiCall(page, 'POST', `${proposalUrl}/copy`, { targetDealId: jordanDealId });
  expect([403, 404]).toContain(sneaky.status);
  await copy.getByLabel('Find an opportunity').fill(dealB);
  await copy.getByLabel('Target opportunity').selectOption(dealBId);
  await copy.getByRole('button', { name: 'Create copy' }).click();
  await expect(page.getByText(`Draft proposal created on ${dealB}`)).toBeVisible();
  await expect(page).not.toHaveURL(new RegExp(proposalId));
  await expect(page).toHaveURL(/\/proposals\/[0-9a-f-]{36}$/);
  const copyId = page.url().split('/').pop() as string;

  // A new draft on deal B with the same text and prices; nothing of the sent state came along.
  await expect(page.getByRole('link', { name: dealB })).toBeVisible();
  await expect(page.getByText('Version 1 (draft)')).toBeVisible();
  await expect(page.getByRole('heading', { name: `${template.name} — ${dealB}` })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Scope of work', exact: true })).toHaveValue(
    'Discovery, implementation and a second rollout phase for the {{company.name}} team.',
  );
  await expect(page.getByLabel('Quantity')).toHaveValue('3');
  await expect(page.getByText('Not shared yet. Each recipient gets their own tracked link.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Compare versions' })).toHaveCount(0);
  // Placeholders resolve to deal B's company and contact.
  await page.getByRole('button', { name: 'Preview' }).click();
  const copyPreview = page.frameLocator('iframe[title="Proposal preview"]');
  await expect(copyPreview.getByText(`for the ${companyB} team`)).toBeVisible();
  await expect(copyPreview.getByText('Dear Omar,')).toBeVisible();
  await expect(copyPreview.getByText(companyA)).toHaveCount(0);
  await dialog(page, 'Preview').getByRole('button', { name: 'Close' }).click();

  const copied = (await apiCall(page, 'GET', `/proposals/${copyId}`)).json;
  expect(copied).toMatchObject({ dealId: dealBId, status: 'draft', lastSentVersionId: null });
  expect(copied.versions).toHaveLength(1);
  expect((await apiCall(page, 'GET', `/proposals/${copyId}/links`)).json).toEqual([]);
  expect((await apiCall(page, 'GET', `/deals/${dealBId}/proposals`)).json.map((x: { id: string }) => x.id)).toContain(copyId);
  // The original is untouched: still sent, with both of its links.
  const original = await saved();
  expect(original.status).toMatch(/^(sent|viewed)$/);
  expect((await apiCall(page, 'GET', `${proposalUrl}/links`)).json).toHaveLength(2);
  // The other salesperson cannot see the copy or the original.
  const hidden = await asUser(browser, 'jordan@northwind.example', async (p) => [
    (await apiCall(p, 'GET', `/proposals/${copyId}`)).status,
    (await apiCall(p, 'POST', `/proposals/${proposalId}/copy`, { targetDealId: jordanDealId })).status,
  ]);
  expect(hidden[1]).not.toBe(201);
  expect([200, 404]).toContain(hidden[0]); // 200 only when the organization lets salespeople view each other's deals

  // ── 5. Revoke still works ────────────────────────────────────────────────────────────────────────────────────────
  await page.goto(proposalUrl);
  await row.getByRole('button', { name: 'Revoke' }).click();
  await dialog(page, 'Please confirm').getByRole('button', { name: 'Revoke' }).click();
  await expect(page.getByText('Link revoked')).toBeVisible();
  await expect(row.getByText('v1 · revoked')).toBeVisible();
  await expect(row.getByRole('button', { name: /expiry/ })).toHaveCount(0); // a revoked link cannot be re-opened
  await buyer.reload();
  await expect(buyer.getByRole('heading', { name: 'This proposal is not available' })).toBeVisible();
  await buyerContext.close();
});
