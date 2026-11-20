import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * QA demo (not an assertion suite — a guided, watchable walkthrough) of two capabilities that ALREADY exist in the
 * CRM today: (A) template versioning — edit a company template and publish a new version; (B) the in-CRM e-signature
 * workflow — request signatures on a proposal and complete signing (current built-in simulated provider).
 * Runs against the dev database; it only adds records named "E2E …" and publishes a new template version (additive).
 */
const stamp = Date.now().toString(36);
const dir = 'test-results/qa-demo';
let n = 0;
async function shot(page: Page, name: string, dwell = 2.5) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${dir}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  await page.waitForTimeout(dwell * 1000);
}

test('A. Template versioning — admin edits a template and publishes a new version', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'admin@northwind.example');
  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: 'Proposal templates', level: 1 })).toBeVisible();
  await shot(page, 'templates-list', 2);

  await page.getByRole('link', { name: 'Services proposal' }).click();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();
  const versionsBefore = Number((await page.getByText(/version\(s\)/).textContent())?.match(/(\d+) version/)?.[1] ?? '0');
  await shot(page, 'template-editor', 3);

  // Edit the Introduction section, save a draft, then publish → this creates a NEW version.
  const intro = page.getByRole('textbox', { name: 'Introduction content' });
  await intro.fill(`Dear {{contact.first_name}},\n\nThank you for considering {{organization.name}}. (Template revision ${stamp}.)`);
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Template draft saved')).toBeVisible();
  await shot(page, 'template-draft-saved', 2);

  await page.getByRole('button', { name: 'Publish' }).click();
  await page.getByRole('dialog').filter({ hasText: 'Please confirm' }).getByRole('button', { name: 'Publish' }).click();
  await expect(page.getByText('Template published as a new version')).toBeVisible();
  await page.waitForTimeout(500);
  // Re-open to show the version count increased.
  await page.goto('/templates');
  await page.getByRole('link', { name: 'Services proposal' }).click();
  await expect(page.getByText(new RegExp(`${versionsBefore + 1} version`))).toBeVisible();
  await shot(page, 'template-new-version', 3);
});

test('B. E-signature inside the CRM — request, sign and complete (built-in simulator)', async ({ page }) => {
  test.setTimeout(150_000);
  await login(page, 'riley@northwind.example');
  const post = (path: string, data?: unknown) => page.request.post(`/api/v1${path}`, data ? { data } : {});
  const put = (path: string, data: unknown) => page.request.put(`/api/v1${path}`, { data });
  const get = (path: string) => page.request.get(`/api/v1${path}`);
  const json = async (r: Awaited<ReturnType<typeof post>>) => r.json();

  // --- Setup the deal + proposal via the API (fast), so the demo focuses on the e-signature UI ---
  const companyId = (await json(await post('/companies', { name: `E2E Sign Co ${stamp}`, domain: `e2e-sign-${stamp}.example` }))).id;
  const contactId = (await json(await post('/contacts', { firstName: 'Erin', lastName: `Signer${stamp}`, email: `erin@e2e-sign-${stamp}.example`, companyId })))
    .id;
  const deal = await json(await post('/deals', { name: `E2E Sign Deal ${stamp}`, companyId, amount: '12000', contactIds: [contactId] }));
  const template = (await json(await get('/templates'))).find((t: { name: string; published: boolean }) => t.name === 'Services proposal' && t.published);
  const proposal = await json(await post(`/deals/${deal.id}/proposals`, { templateId: template.id }));
  const p = await json(await get(`/proposals/${proposal.id}`));
  const content = {
    ...p.currentVersion.content,
    sections: p.currentVersion.content.sections.map((s: { id: string }) =>
      s.id === 'scope' ? { ...s, body: 'Implementation and rollout for the customer team.' } : s,
    ),
  };
  const pricing = {
    lines: [
      { lineKey: 'impl', name: 'Implementation package', unit: 'project', quantity: '1', unitPrice: '12000', taxRatePercent: '0', billingType: 'one_time' },
    ],
  };
  await put(`/proposals/${proposal.id}/draft`, { content, pricing, termMonths: 12, rowVersion: p.currentVersion.rowVersion });
  let send = await json(await post(`/proposals/${proposal.id}/send`, { recipientContactIds: [contactId] }));
  if (send.code === 'CONFIRMATION_REQUIRED')
    send = await json(
      await post(`/proposals/${proposal.id}/send`, { recipientContactIds: [contactId], confirm: send.meta.confirmations.map((c: { code: string }) => c.code) }),
    );

  // --- The e-signature workflow, driven through the CRM UI ---
  await page.goto(`/proposals/${proposal.id}`);
  await expect(page.getByRole('button', { name: 'Request signatures…' })).toBeVisible();
  await shot(page, 'proposal-sent', 2.5);

  await page.getByRole('button', { name: 'Request signatures…' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Request signatures' });
  await dialog.getByRole('checkbox').first().check();
  await shot(page, 'request-signatures-dialog', 2);
  await dialog.getByRole('button', { name: 'Request signatures' }).click();
  await expect(page.getByText('Signature request created')).toBeVisible();

  await post('/dev/jobs/run'); // hand the envelope to the provider
  await page.goto(`/proposals/${proposal.id}`);
  await expect(page.getByText(/Simulated e-signature provider/)).toBeVisible();
  await expect(page.getByText(/Signing 0 of 1/)).toBeVisible();
  await shot(page, 'signature-pending', 3);

  await page.getByRole('button', { name: 'Simulate sign' }).click();
  await expect(page.getByText('Simulated signer action delivered')).toBeVisible();
  await post('/dev/jobs/run'); // webhook → completed → auto-close
  await page.goto(`/proposals/${proposal.id}`);
  await expect(page.getByText('Signing 1 of 1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Signed PDF' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Completion certificate' })).toBeVisible();
  await shot(page, 'signed-complete', 3);

  // The signed document and audit are stored on the deal, which auto-closed Won.
  await page.goto(`/deals/${deal.id}`);
  await expect(page.getByText(/Closed Won/i).first()).toBeVisible();
  await shot(page, 'deal-closed-won', 3);
});
