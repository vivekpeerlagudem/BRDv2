import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

const dialog = (page: Page, title: string) => page.getByRole('dialog').filter({ hasText: title });

/**
 * Marvel demo, driven entirely through the UI (run after e2e/marvel-seed.spec.ts):
 *   1. Admin (Tony Stark) creates and publishes a "Wakanda partnership proposal" template.
 *   2. Salesperson (Spider-Man) builds a proposal from it on "Vibranium Supply Chain", previews it and sends it to T'Challa.
 *   3. Spider-Man downloads the sent PDF; T'Challa opens his link and downloads the same PDF.
 * Screenshots of every step go to DEMO_SHOTS (default: test-results/marvel-demo).
 *
 * Run:  pnpm exec playwright test e2e/marvel-proposal-demo.spec.ts
 */
const OUT = process.env.DEMO_SHOTS ?? 'test-results/marvel-demo';
const TEMPLATE = 'Wakanda partnership proposal';
const DEAL = 'Vibranium Supply Chain';

test('templates → proposal → preview → send → download (Marvel demo)', async ({ page, browser }) => {
  test.setTimeout(240_000);
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  let n = 0;
  const shot = async (p: Page, name: string, fullPage = false) => {
    await p.waitForLoadState('networkidle');
    await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage });
  };

  // ── 1. Admin creates and publishes a template ─────────────────────────────────────────────
  await login(page, 'admin@northwind.example');
  await page.goto('/templates');
  await shot(page, 'templates-list');
  const existing = page.getByRole('link', { name: TEMPLATE, exact: true });
  if (await existing.count()) await existing.click();
  else {
    await page.getByRole('button', { name: 'New template' }).first().click();
    const d = dialog(page, 'New template');
    await d.getByLabel('Name').fill(TEMPLATE);
    await d.getByLabel('Description').fill('Partnership proposal for Wakanda accounts: scope, pricing and signature');
    await shot(page, 'new-template-dialog');
    await d.getByRole('button', { name: 'Create template' }).click();
  }
  await expect(page.getByRole('heading', { name: TEMPLATE })).toBeVisible();
  await page
    .getByLabel('Scope of work content')
    .fill(
      '{{organization.name}} will deliver a vibranium-grade supply chain platform for {{company.name}}: ' +
        'sourcing and inventory tracking in phase 1, partner portal and analytics in phase 2. ' +
        '{{owner.full_name}} is your account lead.',
    );
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText(/saved/i).first()).toBeVisible();
  await shot(page, 'template-editor', true);
  const publish = page.getByRole('button', { name: 'Publish', exact: true });
  if (await publish.isEnabled()) {
    await publish.click();
    await dialog(page, 'Please confirm').getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText(/published/i).first()).toBeVisible();
  }
  await page.goto('/templates');
  await shot(page, 'template-published');

  // ── 2. Salesperson builds, previews and sends a proposal ──────────────────────────────────
  await login(page, 'riley@northwind.example');
  await page.goto('/deals?layout=list');
  await page.getByRole('link', { name: DEAL, exact: true }).first().click();
  await expect(page.getByRole('heading', { name: DEAL })).toBeVisible();
  await shot(page, 'opportunity');
  await page.getByRole('button', { name: 'New proposal' }).click();
  await dialog(page, 'New proposal').getByLabel('Template').selectOption({ label: TEMPLATE });
  await shot(page, 'new-proposal-dialog');
  await page.getByRole('button', { name: 'Create proposal' }).click();
  await expect(page).toHaveURL(/\/proposals\//);
  const proposalUrl = page.url();
  const catalogue = page.getByLabel('Add from catalogue');
  await expect(catalogue.locator('option', { hasText: 'Vibranium Module' })).toHaveCount(1); // wait for the catalogue to load
  const vibranium = (await catalogue.locator('option').allTextContents()).find((o) => o.includes('Vibranium Module'));
  await catalogue.selectOption(vibranium ? { label: vibranium } : { index: 1 });
  await expect(page.getByLabel('Item name').first()).toBeVisible();
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await shot(page, 'proposal-draft', true);

  await page.getByRole('button', { name: 'Preview' }).click();
  await expect(page.frameLocator('iframe[title="Proposal preview"]').getByText('Wakanda Design Group').first()).toBeVisible();
  await shot(page, 'proposal-preview');
  await dialog(page, 'Preview').getByRole('button', { name: 'Close' }).click();

  await page.getByRole('button', { name: 'Send…' }).click();
  const send = dialog(page, 'Send proposal');
  const recipient = send.getByRole('checkbox').first();
  if (!(await recipient.isChecked())) await recipient.check();
  await shot(page, 'send-dialog');
  await send.getByRole('button', { name: 'Send', exact: true }).click();
  const confirmSend = send.getByRole('button', { name: 'Confirm and send' });
  const shareLink = page.getByLabel('Share link').first();
  await expect(confirmSend.or(shareLink)).toBeVisible({ timeout: 60_000 });
  if (await confirmSend.isVisible()) await confirmSend.click();
  await expect(shareLink).toBeVisible({ timeout: 60_000 });
  const url = await shareLink.inputValue();
  await shot(page, 'sent-share-link');

  // ── 3a. Salesperson downloads the sent PDF ────────────────────────────────────────────────
  await page.goto(proposalUrl);
  const pdfHref = await page.getByRole('link', { name: 'PDF', exact: true }).first().getAttribute('href');
  const sellerPdf = await page.request.get(pdfHref ?? '');
  expect(sellerPdf.status()).toBe(200);
  const sellerBytes = await sellerPdf.body();
  expect(sellerBytes.subarray(0, 5).toString()).toBe('%PDF-');
  writeFileSync(`${OUT}/proposal-seller.pdf`, sellerBytes);
  await shot(page, 'proposal-sent', true);

  // ── 3b. Buyer (T'Challa) opens the link and downloads the PDF ─────────────────────────────
  const buyerContext = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const buyer = await buyerContext.newPage();
  await buyer.goto(url);
  await shot(buyer, 'buyer-gate');
  await buyer.getByRole('button', { name: /Continue as T.Challa/ }).click();
  await expect(buyer.frameLocator('iframe').getByText('Wakanda Design Group').first()).toBeVisible();
  await shot(buyer, 'buyer-proposal');
  // "Download PDF" is a plain link to /public/v1/download; fetch it from inside the buyer's page
  // (Node cannot resolve *.localhost on Windows; the browser can, and it carries the buyer cookie).
  const link = buyer.getByRole('link', { name: 'Download PDF' });
  await expect(link).toHaveAttribute('href', '/public/v1/download');
  const buyerPdf = await buyer.evaluate(async () => {
    const r = await fetch('/public/v1/download');
    const bytes = new Uint8Array(await r.arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return { status: r.status, type: r.headers.get('content-type'), b64: btoa(bin) };
  });
  expect(buyerPdf.status).toBe(200);
  const buyerBytes = Buffer.from(buyerPdf.b64, 'base64');
  expect(buyerBytes.subarray(0, 5).toString()).toBe('%PDF-');
  writeFileSync(`${OUT}/proposal-buyer.pdf`, buyerBytes);
  await buyerContext.close();

  await page.goto('/proposals');
  await shot(page, 'proposals-dashboard');
  console.log(`MARVEL_DEMO_DONE shots=${n} share=${url.split('#')[0]} out=${OUT}`);
});
