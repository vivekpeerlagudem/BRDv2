import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * The core sales journey, through the real UI:
 * login → company → contact → deal → stage change → proposal → send → buyer opens link → engagement shows
 * → signature request → (simulated provider) signer signs → deal is Closed Won automatically (BR-AUT-002).
 */
const stamp = Date.now().toString(36);
const company = `E2E Company ${stamp}`;
const contactEmail = `buyer.${stamp}@e2e.example`;
const dealName = `E2E Deal ${stamp}`;

const dialog = (page: Page, title: string) => page.getByRole('dialog').filter({ hasText: title });
const runJobs = (page: Page) => page.request.post('/dev/jobs/run');

test('salesperson takes a deal from first contact to Closed Won', async ({ page, browser }) => {
  // --- Login -------------------------------------------------------------------------------------------------------
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to Sales CRM' })).toBeVisible(); // not signed in → login page
  await login(page, 'riley@northwind.example');

  // --- Company -----------------------------------------------------------------------------------------------------
  await page.goto('/companies');
  await page.getByRole('button', { name: 'New company' }).first().click();
  await dialog(page, 'New company').getByLabel('Name').fill(company);
  await dialog(page, 'New company').getByLabel('Domain').fill(`e2e-${stamp}.example`);
  await page.getByRole('button', { name: 'Create company' }).click();
  await expect(page.getByRole('link', { name: company })).toBeVisible();

  // --- Contact -----------------------------------------------------------------------------------------------------
  await page.goto('/contacts');
  await page.getByRole('button', { name: 'New contact' }).first().click();
  const contactDialog = dialog(page, 'New contact');
  await contactDialog.getByLabel('First name').fill('Erin');
  await contactDialog.getByLabel('Last name').fill(`Buyer${stamp}`);
  await contactDialog.getByLabel('Email').fill(contactEmail);
  await contactDialog.getByLabel('Company').selectOption({ label: company });
  await page.getByRole('button', { name: 'Create contact' }).click();
  await expect(page.getByRole('cell', { name: contactEmail })).toBeVisible();

  // --- Deal --------------------------------------------------------------------------------------------------------
  await page.goto('/deals');
  await page.getByRole('button', { name: 'New deal' }).first().click();
  const dealDialog = dialog(page, 'New deal');
  await dealDialog.getByLabel('Deal name').fill(dealName);
  await dealDialog.getByLabel('Company').selectOption({ label: company });
  await dealDialog.getByLabel('Amount').fill('20000');
  await page.getByRole('button', { name: 'Create deal' }).click();
  await expect(page.getByRole('heading', { name: dealName })).toBeVisible();
  const dealUrl = page.url();

  // --- Stage update ------------------------------------------------------------------------------------------------
  const stage = page.getByLabel('Stage', { exact: true });
  const secondStage = await stage.locator('option').nth(1).textContent();
  await stage.selectOption({ index: 1 });
  await expect(page.getByText(`${secondStage}`, { exact: true }).first()).toBeVisible();
  await expect(stage).toHaveValue(
    await stage
      .locator('option')
      .nth(1)
      .getAttribute('value')
      .then((v) => v ?? ''),
  );

  // --- Stakeholder (the proposal recipient and signer must be a contact on the deal) ----------------------------------
  await page.getByRole('button', { name: 'Add stakeholder' }).click();
  const stakeholder = dialog(page, 'Add stakeholder');
  await stakeholder.getByLabel('Contact').selectOption({ label: `Erin Buyer${stamp} (${contactEmail})` });
  await page.getByRole('button', { name: 'Add to deal' }).click();
  await expect(page.getByText('Contact added to deal')).toBeVisible();

  // --- Proposal: generate from template, price it, save ------------------------------------------------------------
  await page.getByRole('button', { name: 'New proposal' }).click();
  await dialog(page, 'New proposal').getByLabel('Template').selectOption({ label: 'Services proposal' });
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page).toHaveURL(/\/proposals\//);
  const proposalUrl = page.url();
  await expect(page.getByText('Required section "Scope of work" is empty')).toBeVisible(); // pre-send check blocks sending
  await page.getByLabel('Add from catalogue').selectOption({ index: 1 });
  await expect(page.getByLabel('Item name')).toHaveCount(1);
  await page.getByRole('textbox', { name: 'Scope of work', exact: true }).fill('Discovery, implementation and training for the {{company.name}} team.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();

  // Preview is the buyer's document, rendered from the saved draft.
  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.frameLocator('iframe[title="Proposal preview"]').getByText(company).first()).toBeVisible();
  await dialog(page, 'Preview').getByRole('button', { name: 'Close' }).click();

  // --- Send: freezes the version, renders the PDF, creates one tracked link per recipient ----------------------------
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
  expect(url).toMatch(/^http:\/\/proposals\.localhost:5273\/p#.+/); // the token lives only in the URL fragment

  // --- Buyer: separate browser context, no CRM session -------------------------------------------------------------
  const buyerContext = await browser.newContext();
  const buyer = await buyerContext.newPage();
  await buyer.goto(url);
  await buyer.getByRole('button', { name: /Continue as Erin/ }).click();
  await expect(buyer.frameLocator('iframe').getByText(company).first()).toBeVisible();
  expect(buyer.url()).not.toContain('#'); // token removed from the address bar after the exchange
  const heartbeat = buyer.waitForResponse((r) => r.url().includes('/public/v1/views/heartbeat') && r.ok(), { timeout: 30_000 });
  await heartbeat; // the view is only counted once the page has really been open
  // Checked from inside the buyer's page: Node cannot resolve *.localhost on Windows, browsers can.
  const pdf = await buyer.evaluate(async () => {
    const r = await fetch('/public/v1/download');
    return { status: r.status, head: new TextDecoder().decode((await r.arrayBuffer()).slice(0, 5)) };
  });
  expect(pdf).toEqual({ status: 200, head: '%PDF-' }); // rendered by the real Edge PDF renderer
  // The buyer cookie gives no access to the internal API.
  expect(await buyer.evaluate(async () => (await fetch('/api/v1/deals')).status)).toBe(401);
  await buyerContext.close();

  // --- Engagement appears for the salesperson ----------------------------------------------------------------------
  await runJobs(page);
  await page.goto(proposalUrl);
  await expect(page.getByText(/1 view\(s\)/)).toBeVisible();
  await expect(page.getByText(/1 download\(s\)/)).toBeVisible();

  // --- Signature request and (simulated) signing -------------------------------------------------------------------
  await page.getByRole('button', { name: 'Request signatures…' }).click();
  const sign = dialog(page, 'Request signatures');
  await sign.getByRole('checkbox').first().check();
  await sign.getByRole('button', { name: 'Request signatures' }).click();
  await expect(page.getByText('Signature request created')).toBeVisible();
  await runJobs(page); // the outbox job hands the envelope to the provider
  await page.goto(proposalUrl);
  await expect(page.getByText(/Simulated e-signature provider/)).toBeVisible();
  await page.getByRole('button', { name: 'Simulate sign' }).click();
  await expect(page.getByText('Simulated signer action delivered')).toBeVisible();
  await runJobs(page); // webhook → signature completed → automation
  await page.goto(proposalUrl);
  await expect(page.getByText('Signing 1 of 1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Signed PDF' })).toBeVisible();

  // --- Deal closed automatically, with the change visible and attributed on the timeline ---------------------------
  await page.goto(dealUrl);
  await expect(page.getByText(/Closed Won/i).first()).toBeVisible();
  const wonEvent = page.getByRole('listitem').filter({ hasText: 'Deal marked Closed Won' });
  await expect(wonEvent.getByText('Automated', { exact: true })).toBeVisible();
  await expect(wonEvent.getByRole('button', { name: 'Reverse' })).toBeVisible(); // BR-AUT-008
});

test('a wrong password is rejected and unauthenticated API calls are refused', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Email').fill('riley@northwind.example');
  await page.getByLabel('Password').fill('definitely-not-the-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect((await page.request.get('/api/v1/deals')).status()).toBe(401);
});

test('an invalid share link shows a neutral message', async ({ page }) => {
  await page.goto('http://proposals.localhost:5273/p#not-a-real-token');
  await expect(page.getByRole('heading', { name: 'This proposal is not available' })).toBeVisible();
});
