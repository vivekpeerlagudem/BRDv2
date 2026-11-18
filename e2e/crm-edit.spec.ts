import { expect, type Page, test } from '@playwright/test';
import { login } from './helpers.ts';

/**
 * CRM record workflows through the real screens: edit a company, a contact and a deal, archive a company, change
 * owners, sort the list views — and the refusals (another salesperson, duplicate domain, stale edit, open deals).
 *
 * Runs against the development database. Every record it touches is one it created ("E2E Edit … <stamp>").
 */
const stamp = Date.now().toString(36);
const companyName = `E2E Edit Company ${stamp}`;
const renamedCompany = `E2E Edit Company ${stamp} Renamed`;
const otherCompany = `E2E Edit Other ${stamp}`;
const lastName = `Editable${stamp}`;
const dealName = `E2E Edit Deal ${stamp}`;
const renamedDeal = `E2E Edit Deal ${stamp} Renamed`;
const smallDeal = `E2E Edit Deal ${stamp} Small`;
const ids = { company: '', other: '', contact: '', deal: '' };

/** JSON API call from inside the signed-in page (same cookies and Origin as the app). */
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
const dialog = (page: Page, title: string) => page.getByRole('dialog').filter({ hasText: title });
const card = (page: Page, title: string) => page.locator('section').filter({ has: page.getByRole('heading', { name: title, exact: true }) });
const timeline = (page: Page) => page.getByRole('list', { name: 'Timeline' });

test.describe.configure({ mode: 'serial' });

test('salesperson edits their company, contact and deal; duplicates and stale edits are refused', async ({ page }) => {
  await login(page, 'riley@northwind.example');
  // Starting records through the API (creating them through the UI is covered by journey.spec.ts).
  const co = await apiCall(page, 'POST', '/companies', { name: companyName, domain: `e2e-edit-${stamp}.example`, industry: 'Logistics' });
  expect(co.status).toBe(201);
  ids.company = co.json.id;
  ids.other = (await apiCall(page, 'POST', '/companies', { name: otherCompany, domain: `e2e-edit-other-${stamp}.example` })).json.id;
  ids.contact = (
    await apiCall(page, 'POST', '/contacts', { firstName: 'Casey', lastName, email: `casey@e2e-edit-${stamp}.example`, companyId: ids.company })
  ).json.id;
  const deal = await apiCall(page, 'POST', '/deals', { name: dealName, companyId: ids.company, amount: '12000', contactIds: [ids.contact] });
  expect(deal.status).toBe(201);
  ids.deal = deal.json.id;
  expect((await apiCall(page, 'POST', '/deals', { name: smallDeal, companyId: ids.company, amount: '100' })).status).toBe(201);

  // ── Company: edit, clear a field, persisted after reload, shown on the timeline ──
  await page.goto(`/companies/${ids.company}`);
  await expect(page.getByRole('heading', { name: companyName })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change owner' })).toHaveCount(0); // salespeople never reassign
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  let edit = dialog(page, 'Edit company');
  await expect(edit.getByLabel('Industry')).toHaveValue('Logistics');
  await edit.getByLabel('Name').fill(renamedCompany);
  await edit.getByLabel('Industry').fill('Robotics');
  await edit.getByLabel('Phone').fill('555 0101');
  await edit.getByLabel('Website').fill('https://example.org/e2e');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: renamedCompany })).toBeVisible();
  await expect(card(page, 'Details')).toContainText('Robotics');
  await expect(card(page, 'Details')).toContainText('555 0101');

  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  edit = dialog(page, 'Edit company');
  await edit.getByLabel('Phone').fill('');
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(card(page, 'Details')).not.toContainText('555 0101');
  await page.reload();
  await expect(page.getByRole('heading', { name: renamedCompany })).toBeVisible();
  await expect(card(page, 'Details')).toContainText('Robotics');
  await expect(timeline(page).getByText(/Company details updated \(name, industry, phone, website\)/)).toBeVisible();
  const saved = (await apiCall(page, 'GET', `/companies/${ids.company}`)).json;
  expect(saved).toMatchObject({ name: renamedCompany, industry: 'Robotics', phone: null, website: 'https://example.org/e2e' });

  // ── Company: a domain that belongs to another company is refused with a clear message ──
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  edit = dialog(page, 'Edit company');
  await edit.getByLabel('Domain').fill(`e2e-edit-other-${stamp}.example`);
  await edit.getByRole('button', { name: 'Save changes' }).click();
  await expect(edit.getByRole('alert')).toContainText('Possible duplicate');
  await expect(edit.getByRole('link', { name: 'Open the existing company' })).toBeVisible();
  await edit.getByRole('button', { name: 'Cancel' }).click();
  expect((await apiCall(page, 'GET', `/companies/${ids.company}`)).json.domain).toBe(`e2e-edit-${stamp}.example`);

  // ── Company: cannot be archived while it has open deals ──
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await dialog(page, 'Please confirm').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: 'Close or move the open deals' })).toBeVisible();
  expect((await apiCall(page, 'GET', `/companies/${ids.company}`)).json.archivedAt).toBeNull();

  // ── Contact: list row → contact page → edit ──
  await page.goto('/contacts');
  await page.getByLabel('Filter contacts').fill(lastName);
  await page.getByRole('link', { name: `Casey ${lastName}` }).click();
  await expect(page).toHaveURL(new RegExp(`/contacts/${ids.contact}$`));
  await expect(page.getByRole('heading', { name: `Casey ${lastName}` })).toBeVisible();
  await expect(card(page, 'Details').getByRole('link', { name: renamedCompany })).toBeVisible();
  await expect(card(page, 'Deals').getByRole('link', { name: dealName })).toBeVisible();
  await expect(timeline(page).getByText(`Contact Casey ${lastName} created`)).toBeVisible();
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const contactEdit = dialog(page, 'Edit contact');
  await expect(contactEdit.getByLabel('Email')).toHaveValue(`casey@e2e-edit-${stamp}.example`);
  await contactEdit.getByLabel('First name').fill('Cameron');
  await contactEdit.getByLabel('Job title').fill('Head of Procurement');
  await contactEdit.getByLabel('Phone').fill('555 0102');
  await contactEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: `Cameron ${lastName}` })).toBeVisible();
  await page.reload();
  await expect(card(page, 'Details')).toContainText('Head of Procurement');
  await expect(card(page, 'Details')).toContainText('555 0102');
  await expect(timeline(page).getByText('Contact details updated (firstName, phone, jobTitle)')).toBeVisible();
  const contact = (await apiCall(page, 'GET', `/contacts/${ids.contact}`)).json;
  expect(contact).toMatchObject({ firstName: 'Cameron', lastName, jobTitle: 'Head of Procurement', companyId: ids.company });

  // ── Deal: edit name, amount and close date ──
  await page.goto(`/deals/${ids.deal}`);
  await expect(page.getByRole('heading', { name: dealName })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change owner' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit deal' }).click();
  let dealEdit = dialog(page, 'Edit deal');
  await expect(dealEdit.getByLabel(/Amount/)).toHaveValue('12000.00');
  await dealEdit.getByLabel('Deal name').fill(renamedDeal);
  await dealEdit.getByLabel(/Amount/).fill('not a number');
  await dealEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(dealEdit.getByRole('alert')).toContainText('must be an amount'); // server validation shown on the field
  await dealEdit.getByLabel(/Amount/).fill('34500');
  await dealEdit.getByLabel('Expected close').fill('2027-06-30');
  await dealEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: renamedDeal })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: renamedDeal })).toBeVisible();
  await expect(card(page, 'Summary')).toContainText('$34,500');
  await expect(
    timeline(page).getByText(/Deal updated: renamed to ".*Renamed", amount set to [A-Z]{3} 34500\.00, expected close date set to 2027-06-30/),
  ).toBeVisible();
  const afterEdit = (await apiCall(page, 'GET', `/deals/${ids.deal}`)).json;
  expect(afterEdit).toMatchObject({ name: renamedDeal, amount: '34500.00', closeDate: '2027-06-30' });

  // ── Deal: an edit started before someone else's change is refused (optimistic concurrency) ──
  await page.getByRole('button', { name: 'Edit deal' }).click();
  dealEdit = dialog(page, 'Edit deal');
  await expect(dealEdit.getByLabel('Deal name')).toHaveValue(renamedDeal);
  const other = await apiCall(page, 'PATCH', `/deals/${ids.deal}`, { amount: '40000', rowVersion: afterEdit.rowVersion });
  expect(other.status).toBe(200);
  await dealEdit.getByLabel('Deal name').fill(`${renamedDeal} stale`);
  await dealEdit.getByRole('button', { name: 'Save changes' }).click();
  await expect(dealEdit.getByRole('alert')).toContainText('Someone else changed this record');
  await dealEdit.getByRole('button', { name: 'Cancel' }).click();
  const afterConflict = (await apiCall(page, 'GET', `/deals/${ids.deal}`)).json;
  expect(afterConflict).toMatchObject({ name: renamedDeal, amount: '40000.00' }); // the stale write changed nothing
});

test('another salesperson cannot open or change the records', async ({ page }) => {
  await login(page, 'jordan@northwind.example');
  const seen = await apiCall(page, 'GET', `/companies/${ids.company}`);
  // Depending on the Admin cross-visibility setting the record is hidden (404) or view-only (200) — never editable.
  expect([200, 404]).toContain(seen.status);
  const refused = seen.status === 404 ? 404 : 403;
  for (const r of [
    await apiCall(page, 'PATCH', `/companies/${ids.company}`, { name: 'E2E Hijacked' }),
    await apiCall(page, 'POST', `/companies/${ids.company}/archive`),
  ])
    expect(r.status).toBe(refused);
  expect((await apiCall(page, 'POST', `/companies/${ids.company}/owner`, { ownerId: seen.json?.ownerId ?? ids.company })).status).toBe(403);
  const contact = await apiCall(page, 'PATCH', `/contacts/${ids.contact}`, { firstName: 'Hijacked' });
  expect([403, 404]).toContain(contact.status);
  const deal = await apiCall(page, 'PATCH', `/deals/${ids.deal}`, { name: 'E2E Hijacked', rowVersion: 1 });
  expect([403, 404]).toContain(deal.status);
  expect((await apiCall(page, 'POST', `/deals/${ids.deal}/owner`, { ownerId: ids.company })).status).toBe(403);

  for (const path of [`/companies/${ids.company}`, `/contacts/${ids.contact}`, `/deals/${ids.deal}`]) {
    await page.goto(path);
    if (seen.status === 404) await expect(page.getByRole('alert')).toContainText('does not exist or you do not have access');
    else await expect(page.getByText('View only')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Edit/ })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Change owner' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Archive' })).toHaveCount(0);
  }
});

test('list views sort by column, and a company without open deals can be archived', async ({ page }) => {
  await login(page, 'riley@northwind.example');
  // Nothing was changed by the other salesperson.
  expect((await apiCall(page, 'GET', `/companies/${ids.company}`)).json.name).toBe(renamedCompany);
  expect((await apiCall(page, 'GET', `/contacts/${ids.contact}`)).json.firstName).toBe('Cameron');

  // ── Companies: click a header to sort, click again to reverse ──
  await page.goto('/companies');
  await page.getByLabel('Filter companies').fill(`${stamp}.example`); // both companies share the stamp in their domain
  const companies = page.getByRole('table', { name: 'Companies' });
  const companyNames = companies.locator('tbody tr td:first-child');
  await expect(companyNames).toHaveText([renamedCompany, otherCompany]); // default: name ascending
  await expect(companies.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'ascending');
  await companies.getByRole('button', { name: 'Name', exact: true }).click();
  await expect(companyNames).toHaveText([otherCompany, renamedCompany]);
  await expect(companies.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'descending');
  await companies.getByRole('button', { name: 'Industry', exact: true }).click(); // only the first has an industry; empty sorts last
  await expect(companyNames).toHaveText([renamedCompany, otherCompany]);

  // ── Contacts ──
  const second = await apiCall(page, 'POST', '/contacts', { firstName: 'Aaron', lastName, email: `aaron@e2e-edit-${stamp}.example` });
  expect(second.status).toBe(201);
  await page.goto('/contacts');
  await page.getByLabel('Filter contacts').fill(lastName);
  const contacts = page.getByRole('table', { name: 'Contacts' });
  const contactNames = contacts.locator('tbody tr td:first-child');
  await expect(contactNames).toHaveText([`Aaron ${lastName}`, `Cameron ${lastName}`]);
  await contacts.getByRole('button', { name: 'Email', exact: true }).click();
  await contacts.getByRole('button', { name: 'Email', exact: true }).click();
  await expect(contacts.getByRole('columnheader', { name: 'Email' })).toHaveAttribute('aria-sort', 'descending');
  await expect(contactNames).toHaveText([`Cameron ${lastName}`, `Aaron ${lastName}`]); // casey@… after aaron@…

  // ── Deals (list layout): sort by amount ──
  await page.goto('/deals');
  await page.getByRole('button', { name: 'list' }).click();
  const deals = page.getByRole('table', { name: 'Deals' });
  await expect(deals.getByRole('link', { name: renamedDeal })).toBeVisible();
  const order = async () => {
    const names = await deals.locator('tbody tr td:first-child a').allTextContents();
    return [names.indexOf(smallDeal), names.indexOf(renamedDeal)];
  };
  await deals.getByRole('button', { name: 'Amount', exact: true }).click();
  await expect(deals.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'ascending');
  let [small, big] = await order();
  expect(small).toBeGreaterThanOrEqual(0);
  expect(small).toBeLessThan(big); // 100 before 40,000
  await deals.getByRole('button', { name: 'Amount', exact: true }).click();
  await expect(deals.getByRole('columnheader', { name: 'Amount' })).toHaveAttribute('aria-sort', 'descending');
  [small, big] = await order();
  expect(big).toBeGreaterThanOrEqual(0);
  expect(big).toBeLessThan(small);

  // ── Archive the company that has no deals: confirmation, then gone from the list and locked ──
  await page.goto(`/companies/${ids.other}`);
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  const confirm = dialog(page, 'Please confirm');
  await expect(confirm).toContainText(`Archive ${otherCompany}?`);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  expect((await apiCall(page, 'GET', `/companies/${ids.other}`)).json.archivedAt).toBeNull(); // cancelling archives nothing
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  await dialog(page, 'Please confirm').getByRole('button', { name: 'Archive', exact: true }).click();
  await expect(page).toHaveURL(/\/companies$/);
  await page.getByLabel('Filter companies').fill(`${stamp}.example`);
  await expect(page.getByRole('table', { name: 'Companies' }).locator('tbody tr td:first-child')).toHaveText([renamedCompany]);
  await page.goto(`/companies/${ids.other}`);
  await expect(page.getByText('Archived', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await expect(timeline(page).getByText(`Company ${otherCompany} archived`)).toBeVisible();
  expect((await apiCall(page, 'PATCH', `/companies/${ids.other}`, { name: 'E2E Zombie' })).status).toBe(422);
});

test('manager reassigns a deal and a company inside their team; the timeline shows it', async ({ page }) => {
  await login(page, 'morgan@northwind.example');
  await page.goto(`/deals/${ids.deal}`);
  await expect(page.getByText('Owner Riley Chen')).toBeVisible();
  await page.getByRole('button', { name: 'Change owner' }).click();
  let owner = dialog(page, 'Change deal owner');
  const options = await owner.getByLabel('New owner').locator('option').allTextContents();
  expect(options).toContain('Jordan Patel');
  expect(options).not.toContain('Riley Chen'); // the current owner is not offered
  expect(options).not.toContain('Avery Admin'); // outside the manager's team
  await owner.getByLabel('New owner').selectOption({ label: 'Jordan Patel' });
  await owner.getByRole('button', { name: 'Change owner' }).click();
  await expect(page.getByText('Owner Jordan Patel')).toBeVisible();
  await page.reload();
  await expect(page.getByText('Owner Jordan Patel')).toBeVisible();
  const event = timeline(page).getByRole('listitem').filter({ hasText: 'Deal owner changed from Riley Chen to Jordan Patel' });
  await expect(event).toBeVisible();
  await expect(event).toContainText('Morgan Lee'); // who did it
  // The server refuses a target outside the team even when the request is forged.
  const admin = (await apiCall(page, 'GET', '/users')).json.find((u: { fullName: string }) => u.fullName === 'Avery Admin');
  const forged = await apiCall(page, 'POST', `/deals/${ids.deal}/owner`, { ownerId: admin.id });
  expect(forged.status).toBe(403);
  expect(forged.json.code).toBe('REASSIGN_TARGET_OUT_OF_SCOPE');

  await page.goto(`/companies/${ids.company}`);
  await page.getByRole('button', { name: 'Change owner' }).click();
  owner = dialog(page, 'Change company owner');
  await owner.getByLabel('New owner').selectOption({ label: 'Jordan Patel' });
  await owner.getByRole('button', { name: 'Change owner' }).click();
  await expect(card(page, 'Details')).toContainText('Jordan Patel');
  await expect(timeline(page).getByText('Company owner changed from Riley Chen to Jordan Patel')).toBeVisible();
  expect((await apiCall(page, 'GET', `/companies/${ids.company}`)).json.owner.fullName).toBe('Jordan Patel');
});
