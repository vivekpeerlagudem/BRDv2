import { expect, test } from '@playwright/test';
import { login, publishedTemplate } from './helpers.ts';

/**
 * Phase 2 — documents dashboard (Papermark-style). A salesperson's sent proposal appears in /proposals with its deal,
 * status tabs and search narrow the list, and the proposal page shows sharing + engagement.
 */
const stamp = Date.now().toString(36);

test('proposals dashboard lists, filters and searches proposals; proposal page shows engagement', async ({ page }) => {
  test.setTimeout(120_000);
  await login(page, 'riley@northwind.example');
  const post = async (path: string, data?: unknown) => (await page.request.post(`/api/v1${path}`, data ? { data } : {})).json();
  const put = async (path: string, data: unknown) => (await page.request.put(`/api/v1${path}`, { data })).json();
  const get = async (path: string) => (await page.request.get(`/api/v1${path}`)).json();

  // A sent proposal on a fresh deal.
  const companyId = (await post('/companies', { name: `Docs Co ${stamp}`, domain: `docs-${stamp}.example` })).id;
  const contactId = (await post('/contacts', { firstName: 'Dora', lastName: `Docs${stamp}`, email: `dora@docs-${stamp}.example`, companyId })).id;
  const deal = await post('/deals', { name: `Docs deal ${stamp}`, companyId, amount: '9000', contactIds: [contactId] });
  const template = await publishedTemplate(page);
  const proposal = await post(`/deals/${deal.id}/proposals`, { templateId: template.id });
  const pv = await get(`/proposals/${proposal.id}`);
  const content = {
    ...pv.currentVersion.content,
    sections: pv.currentVersion.content.sections.map((s: { id: string; required?: boolean; body: string }) =>
      s.body?.trim() ? s : { ...s, body: 'Scope and delivery for the Docs team.' },
    ),
  };
  const pricing = {
    lines: [{ lineKey: 'p', name: 'Package', unit: 'project', quantity: '1', unitPrice: '9000', taxRatePercent: '0', billingType: 'one_time' }],
  };
  await put(`/proposals/${proposal.id}/draft`, { content, pricing, termMonths: 12, rowVersion: pv.currentVersion.rowVersion });
  let send = await post(`/proposals/${proposal.id}/send`, { recipientContactIds: [contactId] });
  if (send.code === 'CONFIRMATION_REQUIRED')
    send = await post(`/proposals/${proposal.id}/send`, {
      recipientContactIds: [contactId],
      confirm: send.meta.confirmations.map((c: { code: string }) => c.code),
    });

  // Dashboard via the sidebar.
  await page.goto('/');
  await page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'Proposals' }).click();
  await expect(page.getByRole('heading', { name: 'Proposals', level: 1 })).toBeVisible();
  const table = page.getByRole('table', { name: 'Proposals' });
  await page.getByLabel('Search proposals').fill(`Docs deal ${stamp}`);
  const row = table.getByRole('row').filter({ hasText: `Docs Co ${stamp}` });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('sent')).toBeVisible();
  await expect(row).toContainText('Not opened');

  // Status tabs narrow the list.
  await page.getByRole('tab', { name: 'Draft' }).click();
  await expect(table.getByRole('row').filter({ hasText: `Docs Co ${stamp}` })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Sent' }).click();
  await expect(table.getByRole('row').filter({ hasText: `Docs Co ${stamp}` })).toHaveCount(1);

  // Open it: sharing + engagement are on the proposal page.
  await table
    .getByRole('row')
    .filter({ hasText: `Docs Co ${stamp}` })
    .getByRole('link')
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/proposals/${proposal.id}`));
  await expect(page.getByRole('heading', { name: 'Sharing and engagement' })).toBeVisible();
  await expect(page.getByText('Not opened yet')).toBeVisible();
});
