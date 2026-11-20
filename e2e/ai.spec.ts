import { type Browser, expect, type Page, test } from '@playwright/test';
import { login, publishedTemplate } from './helpers.ts';

/**
 * The five AI capabilities through the real CRM screens, on the built-in simulator (no external or paid call):
 * drafting, rewrite of selected text, AI-assisted review, deal summary, follow-up email draft — each reviewed and
 * accepted or rejected by the user — plus the user's AI history and the Admin switch.
 *
 * Runs against the development database. It adds "E2E AI …" records. It temporarily raises the per-user daily AI
 * limit (repeated test runs would otherwise exhaust it) and always restores the original AI settings afterwards.
 */
const stamp = Date.now().toString(36);
const company = `E2E AI Company ${stamp}`;
let original: Record<string, unknown> | null = null;
let dealUrl = '';
let proposalUrl = '';

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
async function asAdmin<T>(browser: Browser, fn: (page: Page) => Promise<T>): Promise<T> {
  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await login(page, 'admin@northwind.example');
    return await fn(page);
  } finally {
    await context.close();
  }
}

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  await asAdmin(browser, async (page) => {
    const current = (await apiCall(page, 'GET', '/ai/settings')).json.settings;
    original = current;
    const raised = await apiCall(page, 'PUT', '/ai/settings', {
      ...current,
      enabled: true,
      perUserDailyCalls: 1000,
      features: { draft_section: true, presend_review: true, deal_summary: true, rewrite_text: true, follow_up_email: true },
    });
    expect(raised.status).toBe(200);
  });
});
test.afterAll(async ({ browser }) => {
  if (!original) return;
  await asAdmin(browser, async (page) => {
    expect((await apiCall(page, 'PUT', '/ai/settings', original)).status).toBe(200);
  });
});

test('salesperson uses AI drafting, rewriting and review inside the proposal editor', async ({ page }) => {
  await login(page, 'riley@northwind.example');
  // Test data through the API (the UI for creating these is covered by journey.spec.ts).
  const companyId = (await apiCall(page, 'POST', '/companies', { name: company, domain: `e2e-ai-${stamp}.example` })).json.id;
  const contactId = (
    await apiCall(page, 'POST', '/contacts', { firstName: 'Erin', lastName: `Buyer${stamp}`, email: `erin@e2e-ai-${stamp}.example`, companyId })
  ).json.id;
  const deal = await apiCall(page, 'POST', '/deals', { name: `E2E AI Deal ${stamp}`, companyId, amount: '12000', contactIds: [contactId] });
  expect(deal.status).toBe(201);
  dealUrl = `/deals/${deal.json.id}`;
  await apiCall(page, 'POST', '/notes', { relatedType: 'deal', relatedId: deal.json.id, body: 'Erin wants to start with a pilot in Q1.' });
  await apiCall(page, 'POST', '/tasks', {
    title: 'Send the security questionnaire',
    relatedType: 'deal',
    relatedId: deal.json.id,
    dueAt: new Date(Date.now() + 2 * 86_400_000).toISOString(),
  });
  const template = await publishedTemplate(page);
  const proposal = await apiCall(page, 'POST', `/deals/${deal.json.id}/proposals`, { templateId: template.id });
  expect(proposal.status).toBe(201);
  proposalUrl = `/proposals/${proposal.json.id}`;

  // ── A. Draft a section with AI: labelled, editable, and not part of the proposal until accepted ──
  await page.goto(proposalUrl);
  const scope = page.getByRole('textbox', { name: 'Scope of work', exact: true });
  await expect(scope).toHaveValue('');
  const scopeCard = page.locator('section').filter({ has: page.getByRole('heading', { name: /Scope of work/ }) });
  await scopeCard.getByRole('button', { name: 'Draft with AI' }).click();
  const draft = page.getByRole('region', { name: 'AI draft for Scope of work' });
  await expect(draft.getByText('AI-generated — not yet part of the proposal (simulator)')).toBeVisible();
  const draftText = draft.getByRole('textbox');
  await expect(draftText).toHaveValue(new RegExp(company));
  await expect(draft.getByText(/Built-in simulator, not a real AI model/)).toBeVisible(); // provenance
  await page.screenshot({ path: 'test-results/screens/ai-draft.png', fullPage: true });
  await expect(scope).toHaveValue(''); // still empty: nothing was inserted
  await expect(page.getByText('AI-generated content is waiting for your review')).toBeVisible(); // and it blocks sending
  // Regenerate replaces the suggestion; then the user edits it and accepts.
  await scopeCard.getByRole('button', { name: 'Regenerate' }).click();
  await expect(page.getByText('AI draft ready for your review').first()).toBeVisible();
  await draftText.fill(`We will run a pilot for ${company} first. Then we will utilize our team in order to roll out the Implementation package.`);
  await draft.getByRole('button', { name: 'Accept edited text into section' }).click();
  await expect(scope).toHaveValue(/We will run a pilot/);
  await expect(page.getByRole('region', { name: 'AI draft for Scope of work' })).toHaveCount(0);

  // ── D. Rewrite only the selected text ──
  const full = await scope.inputValue();
  const selected = 'Then we will utilize our team in order to roll out the Implementation package.';
  await scope.evaluate((el: HTMLTextAreaElement, text) => {
    el.focus();
    el.setSelectionRange(el.value.indexOf(text), el.value.indexOf(text) + text.length);
  }, selected);
  await scope.press('Shift'); // a key-up makes the editor read the current selection
  await expect(page.getByText(`${selected.length} characters selected`)).toBeVisible();
  await page.getByLabel('Rewrite selected text in Scope of work').selectOption('simplify');
  await scopeCard.getByRole('button', { name: 'Rewrite selection' }).click();
  const rewrite = page.getByRole('region', { name: 'AI rewrite for Scope of work' });
  await expect(rewrite.getByText(selected, { exact: true })).toBeVisible(); // original shown beside the proposal
  await expect(rewrite.getByLabel('Proposed replacement')).toHaveValue('Then we will use our team to roll out the Implementation package.');
  await expect(scope).toHaveValue(full); // unchanged until the user decides
  await scopeCard.screenshot({ path: 'test-results/screens/ai-rewrite.png' });
  await rewrite.getByRole('button', { name: 'Replace selection' }).click();
  await expect(scope).toHaveValue(`We will run a pilot for ${company} first. Then we will use our team to roll out the Implementation package.`);

  // Rejecting a rewrite keeps the original text.
  await scope.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, el.value.indexOf(' first.') + 7);
  });
  await scope.press('Shift');
  await page.getByLabel('Rewrite selected text in Scope of work').selectOption('custom');
  await scopeCard.getByRole('textbox', { name: 'Instructions' }).fill('mention speed');
  await scopeCard.getByRole('button', { name: 'Rewrite selection' }).click();
  await expect(rewrite.getByLabel('Proposed replacement')).toHaveValue(/\[mention speed\]/);
  await rewrite.getByRole('button', { name: 'Keep original' }).click();
  await expect(scope).toHaveValue(/^We will run a pilot for .* first\. Then we will use our team/);

  // ── B. AI-assisted review: rule findings and AI findings, each for the salesperson to decide ──
  const intro = page.getByRole('textbox', { name: 'Introduction', exact: true });
  await intro.fill('Dear Bob,\n\nWe guarantee results for $15,000.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(page.getByText('Draft saved')).toBeVisible();
  await page.getByRole('button', { name: 'Review with AI' }).click();
  const review = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Proposal review' }) });
  const claim = review.getByRole('listitem').filter({ hasText: 'Unsupported claim' });
  await expect(claim.getByText('AI finding (simulator)')).toBeVisible();
  await expect(claim.getByText('“guarantee”')).toBeVisible(); // evidence quoted from the proposal
  await expect(claim.getByText(/Suggested:/)).toBeVisible();
  await review.screenshot({ path: 'test-results/screens/ai-review.png' });
  await expect(
    review
      .getByRole('listitem')
      .filter({ hasText: 'Person name' })
      .getByText(/"Bob" is not a contact on this deal/),
  ).toBeVisible();
  await expect(review.getByRole('listitem').filter({ hasText: '“$15,000”' }).getByText('AI finding (simulator)')).toBeVisible();
  // Rule findings come from the database, are labelled as rules, and sit beside the AI findings.
  await expect(review.getByRole('listitem').filter({ hasText: 'Opportunity amount' }).getByText('Rule', { exact: true })).toBeVisible();
  await claim.getByRole('button', { name: 'Not an issue' }).click();
  await expect(review.getByText('1 finding(s) reviewed by you.')).toBeVisible();
  await expect(review.getByRole('listitem').filter({ hasText: 'Unsupported claim' })).toHaveCount(0);
  // Fixing the text makes the review out of date until it is run again.
  await intro.fill('Dear Erin,\n\nThank you for your time.');
  await page.getByRole('button', { name: 'Save draft' }).click();
  await expect(review.getByText('The draft changed after this review.')).toBeVisible();
  await page.getByRole('button', { name: 'Review again' }).click();
  await expect(review.getByText('The draft changed after this review.')).toHaveCount(0);
  await expect(review.getByRole('listitem').filter({ hasText: 'Person name' })).toHaveCount(0);
});

test('salesperson gets a deal summary and a follow-up email draft, and nothing is sent', async ({ page }) => {
  await login(page, 'riley@northwind.example');
  await page.goto(dealUrl);

  // ── C. Deal summary: recorded facts and AI interpretation are shown separately ──
  await page.getByRole('button', { name: 'Summarise this opportunity with AI' }).click();
  const summary = page.getByRole('region', { name: 'AI opportunity summary' });
  await expect(summary.getByText('Recorded in the CRM (facts)')).toBeVisible();
  await expect(summary.getByText('AI-generated summary (simulator)')).toBeVisible();
  await expect(summary.getByText(new RegExp(`E2E AI Deal ${stamp} with ${company}`))).toBeVisible();
  await expect(summary.getByText('— AI interpretation').first()).toBeVisible();
  await expect(summary.getByText(/Complete the open task "Send the security questionnaire"/)).toBeVisible();
  await expect(summary.getByText(/Based on 1 note\(s\)/)).toBeVisible();
  await summary.screenshot({ path: 'test-results/screens/ai-summary.png' });
  await summary.getByRole('button', { name: 'Save as note' }).click();
  await expect(page.getByRole('region', { name: 'AI opportunity summary' })).toHaveCount(0);
  await expect(page.getByText(/AI-assisted summary \(reviewed\)/).first()).toBeVisible(); // on the timeline, attributed to the user

  // ── E. Follow-up email: a draft the user edits and approves; the CRM never sends it ──
  await page.getByRole('button', { name: 'Follow-up email…' }).click();
  const dialog = page.getByRole('dialog').filter({ hasText: 'Draft a follow-up email' });
  await dialog.getByLabel('Situation').selectOption('gone_quiet');
  await dialog.getByLabel('Your instructions (optional)').fill('offer a call on Thursday');
  await dialog.getByRole('button', { name: 'Generate draft' }).click();
  const email = dialog.getByRole('region', { name: 'Email draft' });
  await expect(email.getByText('AI-generated draft — not sent (simulator)')).toBeVisible();
  await expect(email.getByLabel('Message')).toHaveValue(/Hi Erin,[\s\S]*Offer a call on Thursday[\s\S]*Riley Chen$/);
  await expect(email.getByText(new RegExp(`erin@e2e-ai-${stamp}\\.example`))).toBeVisible();
  await email.getByLabel('Subject').fill('Quick check-in');
  await dialog.screenshot({ path: 'test-results/screens/ai-follow-up.png' });
  await email.getByRole('button', { name: 'Approve draft' }).click();
  await expect(page.getByText('Draft approved. Nothing was sent — copy it into your email.')).toBeVisible();
  await expect(email.getByText('The CRM does not send email. Send it yourself from your mail program.')).toBeVisible();
  await expect(email.getByRole('link', { name: 'Open in my email app' })).toHaveAttribute('href', /^mailto:.*subject=Quick%20check-in/);
  await expect(email.getByLabel('Message')).not.toBeEditable();
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByText(/Follow-up email draft approved: “Quick check-in” \(not sent by the CRM\)/)).toBeVisible();
  // Nothing was shared or sent as a side effect: the proposal is still an unsent draft with no links.
  const proposalId = proposalUrl.split('/').pop();
  expect((await apiCall(page, 'GET', `/proposals/${proposalId}`)).json.status).toBe('draft');
  expect((await apiCall(page, 'GET', `/proposals/${proposalId}/links`)).json).toEqual([]);

  // ── AI usage history for the user ──
  await page.goto('/ai');
  await expect(page.getByRole('heading', { name: 'AI activity', level: 1 })).toBeVisible();
  await expect(page.getByText(/Running on the built-in simulator/)).toBeVisible();
  const rows = page.getByRole('row');
  await expect(rows.filter({ hasText: 'Follow-up email draft' }).filter({ hasText: 'Edited, then accepted' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Opportunity summary' }).filter({ hasText: 'Accepted' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Rewrite selected text' }).filter({ hasText: 'Rejected' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Proposal drafting' }).filter({ hasText: 'Replaced by a newer suggestion' }).first()).toBeVisible();
  await expect(rows.filter({ hasText: 'Pre-send review' }).filter({ hasText: 'Completed' }).first()).toBeVisible();
  // A salesperson has no access to AI administration.
  await expect(page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: 'AI settings' })).toHaveCount(0);
  expect((await apiCall(page, 'GET', '/ai/settings')).status).toBe(403);
});

test('admin sees organization usage and can turn AI off; the server enforces it', async ({ page }) => {
  await login(page, 'admin@northwind.example');
  await page.goto('/admin/ai');
  await expect(page.getByRole('heading', { name: 'AI settings and usage', level: 1 })).toBeVisible();
  await expect(page.getByText(/Built-in simulator: deterministic template text/)).toBeVisible();
  await expect(page.getByText(/never in this screen or in the database/)).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Riley Chen' }).first()).toBeVisible(); // usage by user
  await expect(page.getByRole('cell', { name: 'presend_review/v1' })).toBeVisible();
  await page.screenshot({ path: 'test-results/screens/ai-admin.png', fullPage: true });

  // Turn one feature off, then everything off.
  await page.getByLabel('Follow-up email draft').uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('AI settings saved')).toBeVisible();
  await page.goto(dealUrl);
  await expect(page.getByRole('button', { name: 'Summarise this opportunity with AI' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Follow-up email…' })).toHaveCount(0);

  await page.goto('/admin/ai');
  await page.getByLabel('AI features are on for the organization').uncheck();
  await page.getByRole('button', { name: 'Save settings' }).click();
  await expect(page.getByText('AI settings saved').first()).toBeVisible();
  await page.goto(dealUrl);
  await expect(page.getByRole('heading', { name: 'Activity timeline' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Summarise this opportunity with AI' })).toHaveCount(0);
  // Hiding the button is not the control: the API itself refuses.
  const refused = await apiCall(page, 'POST', `/deals/${dealUrl.split('/').pop()}/ai-summary`);
  expect([refused.status, refused.json.code]).toEqual([403, 'AI_DISABLED']);
  // Proposal checks that do not need AI still work.
  await page.goto(proposalUrl);
  await expect(page.getByRole('button', { name: 'Draft with AI' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Review again' }).click();
  await expect(page.getByText('AI review is turned off — only the rule checks ran.')).toBeVisible();

  await page.goto('/ai');
  await expect(page.getByText('Turned off by your administrator')).toBeVisible();
  await expect(page.getByRole('row').filter({ hasText: 'Blocked: AI off' }).first()).toBeVisible();
});
