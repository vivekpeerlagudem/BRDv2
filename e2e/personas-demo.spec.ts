import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * End-to-end role walkthrough (watchable demo, not an assertion suite): the SAME proposal flows through four people —
 *  Admin (owns the templates) → Salesperson (builds & sends the proposal) → Customer (reviews via secure link) →
 *  Sales Manager (sees the team result). Each persona logs in with their own account. Read-only-ish: it adds
 *  "Demo …" records on the dev database and changes nothing existing.
 */
const stamp = Date.now().toString(36);
const dir = 'test-results/personas';
let n = 0;
async function shot(p: Page, name: string, dwell = 2.5) {
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${dir}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  await p.waitForTimeout(dwell * 1000);
}

test('one proposal, four people — admin, salesperson, customer, manager', async ({ page, browser }) => {
  test.setTimeout(240_000);

  // ============ 1) ADMIN — owns the company template "shelf" ============
  await login(page, 'admin@northwind.example');
  await page.goto('/templates');
  await expect(page.getByRole('heading', { name: 'Proposal templates', level: 1 })).toBeVisible();
  await shot(page, 'admin-templates-shelf', 3);
  await page.getByRole('link', { name: 'Services proposal' }).click();
  await expect(page.getByRole('button', { name: 'Save draft' })).toBeVisible();
  await shot(page, 'admin-template-editor', 3); // the reusable blank form + versions

  // ============ 2) SALESPERSON — builds a proposal from the template and sends it ============
  await login(page, 'riley@northwind.example'); // same window, now signed in as the salesperson
  const api = {
    post: (path: string, data?: unknown) => page.request.post(`/api/v1${path}`, data ? { data } : {}),
    put: (path: string, data: unknown) => page.request.put(`/api/v1${path}`, { data }),
    get: (path: string) => page.request.get(`/api/v1${path}`),
  };
  const j = async (r: Awaited<ReturnType<typeof api.post>>) => r.json();
  const companyId = (await j(await api.post('/companies', { name: `Demo Customer ${stamp}`, domain: `demo-${stamp}.example` }))).id;
  const contactId = (await j(await api.post('/contacts', { firstName: 'Dana', lastName: `Buyer${stamp}`, email: `dana@demo-${stamp}.example`, companyId }))).id;
  const deal = await j(await api.post('/deals', { name: `Demo Deal ${stamp}`, companyId, amount: '12000', contactIds: [contactId] }));
  const template = (await j(await api.get('/templates'))).find((t: { name: string; published: boolean }) => t.name === 'Services proposal' && t.published);
  const proposal = await j(await api.post(`/deals/${deal.id}/proposals`, { templateId: template.id }));
  const pv = await j(await api.get(`/proposals/${proposal.id}`));
  const content = {
    ...pv.currentVersion.content,
    sections: pv.currentVersion.content.sections.map((s: { id: string }) =>
      s.id === 'scope' ? { ...s, body: 'Discovery, implementation and training for the Demo Customer team.' } : s,
    ),
  };
  const pricing = {
    lines: [
      { lineKey: 'impl', name: 'Implementation package', unit: 'project', quantity: '1', unitPrice: '12000', taxRatePercent: '0', billingType: 'one_time' },
    ],
  };
  await api.put(`/proposals/${proposal.id}/draft`, { content, pricing, termMonths: 12, rowVersion: pv.currentVersion.rowVersion });

  await page.goto(`/proposals/${proposal.id}`);
  await expect(page.getByRole('textbox', { name: 'Scope of work', exact: true })).toBeVisible();
  await shot(page, 'sales-proposal-autofilled', 3.5); // blanks filled with the customer's data + pricing

  // Send it to the customer (deal amount matches total, so no extra confirmation step).
  await page.getByRole('button', { name: 'Send…' }).click();
  const sendDialog = page.getByRole('dialog').filter({ hasText: 'Send proposal' });
  const recipient = sendDialog.getByRole('checkbox').first();
  if (!(await recipient.isChecked())) await recipient.check();
  await sendDialog.getByRole('button', { name: 'Send', exact: true }).click();
  const confirmBtn = sendDialog.getByRole('button', { name: 'Confirm and send' });
  const linkInput = page.getByLabel('Share link').first();
  await expect(confirmBtn.or(linkInput)).toBeVisible({ timeout: 30_000 });
  if (await confirmBtn.isVisible()) await confirmBtn.click();
  await expect(linkInput).toBeVisible({ timeout: 30_000 });
  const customerUrl = await linkInput.inputValue();
  await shot(page, 'sales-sent-share-link', 3);

  // ============ 3) CUSTOMER — opens the secure link (no login at all) ============
  const buyerCtx = await browser.newContext();
  const customer = await buyerCtx.newPage();
  await customer.goto(customerUrl);
  await customer.getByRole('button', { name: /Continue as Dana/ }).click();
  await expect(
    customer
      .frameLocator('iframe')
      .getByText(new RegExp(`Demo Customer ${stamp}`))
      .first(),
  ).toBeVisible();
  await shot(customer, 'customer-portal-review', 4); // what the customer sees — no CRM account needed
  await buyerCtx.close();

  // ============ 4) SALES MANAGER — sees the team's pipeline and this deal ============
  await login(page, 'morgan@northwind.example'); // now signed in as the manager
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible();
  await shot(page, 'manager-dashboard', 3);
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await shot(page, 'manager-reports-team', 3);
});
