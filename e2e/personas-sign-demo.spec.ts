import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * The e-signature leg, person-by-person (watchable demo):
 *   Salesperson requests signatures → Customer signs → Salesperson sees it completed → Sales Manager sees the won deal.
 * Today the customer's signing action is the built-in SIMULATOR (the "Simulate sign" control stands in for the
 * customer); the planned native build replaces that with a real customer signing page. Adds only "Demo …" records.
 */
const stamp = Date.now().toString(36);
const dir = 'test-results/personas-sign';
let n = 0;
async function shot(p: Page, name: string, dwell = 3) {
  await p.waitForTimeout(300);
  await p.screenshot({ path: `${dir}/${String(++n).padStart(2, '0')}-${name}.png`, fullPage: true });
  await p.waitForTimeout(dwell * 1000);
}

test('e-signature across people — request, sign, complete, close', async ({ page }) => {
  test.setTimeout(200_000);
  await login(page, 'riley@northwind.example');
  const api = {
    post: (path: string, data?: unknown) => page.request.post(`/api/v1${path}`, data ? { data } : {}),
    put: (path: string, data: unknown) => page.request.put(`/api/v1${path}`, { data }),
    get: (path: string) => page.request.get(`/api/v1${path}`),
  };
  const j = async (r: Awaited<ReturnType<typeof api.post>>) => r.json();

  // --- Setup: a sent proposal ready for signature (plumbing via API) ---
  const companyId = (await j(await api.post('/companies', { name: `Demo Sign Co ${stamp}`, domain: `demo-sign-${stamp}.example` }))).id;
  const contactId = (
    await j(await api.post('/contacts', { firstName: 'Dana', lastName: `Buyer${stamp}`, email: `dana@demo-sign-${stamp}.example`, companyId }))
  ).id;
  const deal = await j(await api.post('/deals', { name: `Demo Sign Deal ${stamp}`, companyId, amount: '12000', contactIds: [contactId] }));
  const template = (await j(await api.get('/templates'))).find((t: { name: string; published: boolean }) => t.name === 'Services proposal' && t.published);
  const proposal = await j(await api.post(`/deals/${deal.id}/proposals`, { templateId: template.id }));
  const pv = await j(await api.get(`/proposals/${proposal.id}`));
  const content = {
    ...pv.currentVersion.content,
    sections: pv.currentVersion.content.sections.map((s: { id: string }) =>
      s.id === 'scope' ? { ...s, body: 'Implementation and rollout for the Demo Customer team.' } : s,
    ),
  };
  const pricing = {
    lines: [
      { lineKey: 'impl', name: 'Implementation package', unit: 'project', quantity: '1', unitPrice: '12000', taxRatePercent: '0', billingType: 'one_time' },
    ],
  };
  await api.put(`/proposals/${proposal.id}/draft`, { content, pricing, termMonths: 12, rowVersion: pv.currentVersion.rowVersion });
  const send = await j(await api.post(`/proposals/${proposal.id}/send`, { recipientContactIds: [contactId] }));
  if (send.code === 'CONFIRMATION_REQUIRED')
    await api.post(`/proposals/${proposal.id}/send`, {
      recipientContactIds: [contactId],
      confirm: send.meta.confirmations.map((c: { code: string }) => c.code),
    });

  // ============ SALESPERSON — requests the customer's signature ============
  await page.goto(`/proposals/${proposal.id}`);
  await page.getByRole('button', { name: 'Request signatures…' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Request signatures' });
  await dialog.getByRole('checkbox').first().check(); // Dana (the customer) is the signer
  await shot(page, 'salesperson-requests-signature', 2.5);
  await dialog.getByRole('button', { name: 'Request signatures' }).click();
  await expect(page.getByText('Signature request created')).toBeVisible();
  await api.post('/dev/jobs/run'); // the signing invitation is dispatched to the signer

  // ============ Waiting on the CUSTOMER ============
  await page.goto(`/proposals/${proposal.id}`);
  await expect(page.getByText(/Signing 0 of 1/)).toBeVisible();
  await expect(page.getByText(/Simulated e-signature provider/)).toBeVisible();
  await shot(page, 'pending-waiting-on-customer', 3);

  // ============ CUSTOMER signs (today: simulator stands in for Dana) ============
  await page.getByRole('button', { name: 'Simulate sign' }).click();
  await expect(page.getByText('Simulated signer action delivered')).toBeVisible();
  await shot(page, 'customer-signs', 2.5);
  await api.post('/dev/jobs/run'); // signature completed → document sealed → deal auto-closes

  // ============ SALESPERSON — sees it completed, signed PDF + certificate on the deal ============
  await page.goto(`/proposals/${proposal.id}`);
  await expect(page.getByText('Signing 1 of 1')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Signed PDF' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Completion certificate' })).toBeVisible();
  await shot(page, 'salesperson-sees-completed', 3);

  // ============ The deal — signed document stored, auto-closed Won ============
  await page.goto(`/deals/${deal.id}`);
  await expect(page.getByText(/Closed Won/i).first()).toBeVisible();
  const wonEvent = page.getByRole('listitem').filter({ hasText: /Closed Won/ });
  await expect(wonEvent.first()).toBeVisible();
  await shot(page, 'deal-signed-and-won', 3);

  // ============ SALES MANAGER — sees the completed, won deal in the team view ============
  await login(page, 'morgan@northwind.example');
  await page.goto('/reports');
  await expect(page.getByRole('heading', { name: 'Reports', level: 1 })).toBeVisible();
  await shot(page, 'manager-sees-won', 3);
});
