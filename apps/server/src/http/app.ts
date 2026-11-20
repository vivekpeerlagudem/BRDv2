/**
 * HTTP layer (COMPONENT-ARCHITECTURE §2, API-SPECIFICATION.md). Routes are thin adapters: validate with the shared
 * Zod contracts, resolve the actor, call a module service. No business logic lives here (ADR-003, ADR-028).
 *
 * Surfaces: /auth (Better Auth) · /api/v1 (internal, session cookie) · /public/v1 (buyers and lead forms,
 * link-bound cookie) · /webhooks (provider, HMAC) · /dev (simulators, never in production).
 */
import { randomUUID } from 'node:crypto';
import * as C from '@crm/shared';
import { ERROR_CODES, type PermKey, permissionSummary } from '@crm/shared';
import { type Context, Hono, type Next } from 'hono';
import { getCookie, setCookie } from 'hono/cookie';
import type { z } from 'zod';
import * as ai from '../modules/ai.ts';
import * as crm from '../modules/crm.ts';
import * as esign from '../modules/esign.ts';
import * as identity from '../modules/identity.ts';
import * as proposals from '../modules/proposals.ts';
import * as reporting from '../modules/reporting.ts';
import * as sharing from '../modules/sharing.ts';
import * as workflow from '../modules/workflow.ts';
import { FakeESignProvider } from '../platform/adapters.ts';
import { type AppContext, buildUserActor, requirePerm, sha256Hex } from '../platform/core.ts';
import { DomainError } from '../platform/errors/domain-error.ts';
import type { Env, RouteKit } from './kit.ts';
import { problemResponse, toProblem } from './problem-response.ts';
import { register as registerAdminRoutes } from './routes/admin.ts';
import { register as registerImportRoutes } from './routes/imports.ts';
import { register as registerProposalExtRoutes } from './routes/proposals-ext.ts';
import { register as registerReportRoutes } from './routes/reports.ts';

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Zod parse → 400 VALIDATION_FAILED with field errors (ERROR-HANDLING-AND-VALIDATION §1). */
function parse<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data);
  if (r.success) return r.data;
  throw new DomainError(ERROR_CODES.VALIDATION_FAILED, 400, 'Some fields are not valid', {
    errors: r.error.issues.map((i) => ({ path: i.path.join('.'), code: i.code.toUpperCase(), message: i.message })),
  });
}
const body = async <S extends z.ZodType>(c: Context, schema: S) => parse(schema, await c.req.json().catch(() => ({})));
const id = (c: Context, name = 'id') => {
  const v = c.req.param(name) ?? '';
  if (!UUID.test(v)) throw new DomainError(ERROR_CODES.NOT_FOUND, 404, 'Not found');
  return v;
};
const file = (f: { bytes: Uint8Array; contentType: string; fileName: string }) =>
  new Response(Buffer.from(f.bytes), {
    headers: { 'content-type': f.contentType, 'content-disposition': `attachment; filename="${f.fileName}"`, 'cache-control': 'no-store' },
  });

export function createApp(ctx: AppContext, auth: identity.Auth): Hono<Env> {
  const app = new Hono<Env>();
  const buyerHost = new URL(ctx.config.BUYER_ORIGIN).host;
  const appHost = new URL(ctx.config.APP_ORIGIN).host;
  const prod = ctx.config.NODE_ENV === 'production';
  const BUYER_COOKIE = prod ? '__Host-bs' : 'bs';
  const sendPorts: proposals.SendPorts = {
    createLinks: (u, args) => sharing.createLinks(ctx, u, args),
    voidOpenSignature: esign.voidOpenSignature,
    hasOpenSignature: esign.hasOpenSignature,
  };

  app.use('*', async (c, next) => {
    const incoming = c.req.header('x-request-id');
    const requestId = incoming !== undefined && REQUEST_ID_PATTERN.test(incoming) ? incoming : randomUUID();
    c.set('requestId', requestId);
    const started = performance.now();
    await next();
    c.header('x-request-id', requestId);
    // Baseline security headers (SECURITY-ARCHITECTURE SC-APP). The API returns JSON/files only.
    c.header('x-content-type-options', 'nosniff');
    c.header('referrer-policy', 'no-referrer');
    c.header('x-frame-options', 'DENY');
    c.header('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
    // Route template only — never the raw URL — so nothing secret can reach the logs.
    ctx.logger.info(
      { requestId, method: c.req.method, route: c.req.routePath, status: c.res.status, latencyMs: Math.round(performance.now() - started) },
      'request',
    );
  });

  // ADR-075: internal surfaces are never served on the buyer host.
  app.use('*', async (c, next) => {
    const host = c.req.header('host');
    if (host === buyerHost && buyerHost !== appHost && !c.req.path.startsWith('/public/') && c.req.path !== '/healthz')
      throw new DomainError(ERROR_CODES.NOT_FOUND, 404, 'Not found');
    await next();
  });

  app.get('/healthz', (c) => c.json({ status: 'ok' }));
  app.get('/readyz', async (c) => {
    try {
      await ctx.db.execute('select 1');
      return c.json({ status: 'ready' });
    } catch {
      throw new DomainError(ERROR_CODES.TEMPORARILY_UNAVAILABLE, 503, 'Database is not reachable');
    }
  });

  app.on(['GET', 'POST'], '/auth/*', (c) => auth.handler(c.req.raw));

  // ───────────── /api/v1 — authenticated internal API ─────────────
  const api = new Hono<Env>();
  api.use('*', async (c, next) => {
    // CSRF: cookies are SameSite=Lax; additionally every unsafe request must come from the app origin (ADR-016).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
      const origin = c.req.header('origin');
      if (origin !== undefined && origin !== ctx.config.APP_ORIGIN) throw new DomainError('CSRF_ORIGIN_MISMATCH', 403, 'Request origin not allowed');
    }
    // Per-user, session-scoped responses (role, permissions, records) must never be stored by the browser or a
    // proxy: otherwise a refresh — or signing in as another user on the same machine — can serve a stale /me and
    // show the wrong role. (ADR-016 companion; the browser always re-fetches the authenticated user's state.)
    c.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    c.header('Pragma', 'no-cache');
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    const actor = session ? await buildUserActor(ctx.db, session.user.id) : null;
    if (!actor) throw new DomainError(ERROR_CODES.UNAUTHENTICATED, 401, 'Sign in to continue'); // also covers deactivated users
    c.set('actor', actor);
    await next();
  });
  const A = (c: Context<Env>) => c.get('actor');
  /** Correlation id for AI calls: ties ai_usage rows to the HTTP request log line. */
  const T = (c: Context<Env>) => ({ correlationId: c.get('requestId') });
  // Role permission is checked BEFORE the body is parsed, so a caller without the permission always gets 403
  // and never learns the input schema from validation errors. The modules re-check it (defence in depth).
  const guard = (perm: PermKey) => async (c: Context<Env>, next: Next) => {
    if (c.req.method !== 'GET') requirePerm(A(c), perm);
    await next();
  };
  for (const path of ['/users', '/users/*']) api.use(path, guard('user.manage'));
  for (const path of ['/templates', '/templates/*', '/products', '/products/*']) api.use(path, guard('content.manage'));

  api.get('/me', async (c) => {
    const a = A(c);
    const s = await identity.getSettings(ctx);
    return c.json({
      user: { id: a.userId, fullName: a.name, role: a.role },
      permissions: permissionSummary(a.role, a.canManageContent),
      settings: {
        organizationName: s.organizationName,
        currency: s.defaultCurrency,
        aiEnabled: s.aiSettings.enabled,
        leadFormKey: a.role === 'admin' ? s.leadFormKey : undefined,
        esignSimulated: ctx.esign.name === 'fake',
        aiSimulated: ctx.ai.simulated,
      },
    });
  });
  api.get('/users', async (c) => c.json(await identity.listUsers(ctx, A(c))));
  api.post('/users', async (c) => c.json(await identity.createUser(ctx, A(c), await body(c, C.inviteUserInput)), 201));
  api.patch('/users/:id', async (c) => c.json(await identity.patchUser(ctx, A(c), id(c), await body(c, C.userPatchInput))));
  api.post('/users/:id/deactivate', async (c) => c.json(await identity.deactivateUser(ctx, A(c), id(c), (await body(c, C.deactivateInput)).reassignToUserId)));
  api.get('/teams', async (c) => c.json(await identity.listTeams(ctx)));

  api.get('/search', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    return c.json(q.length < 2 ? [] : await crm.search(ctx, A(c), q.slice(0, 100)));
  });
  api.get('/pipeline', async (c) => c.json(await crm.getPipeline(ctx)));

  api.get('/companies', async (c) => c.json(await crm.listCompanies(ctx, A(c), parse(C.pageQuerySchema, c.req.query()))));
  api.post('/companies', async (c) => c.json(await crm.createCompany(ctx, A(c), await body(c, C.companyInput)), 201));
  api.get('/companies/:id', async (c) => c.json(await crm.getCompany(ctx, A(c), id(c))));
  api.patch('/companies/:id', async (c) => c.json(await crm.updateCompany(ctx, A(c), id(c), await body(c, C.companyInput))));
  api.post('/companies/:id/archive', async (c) => c.json(await crm.archiveCompany(ctx, A(c), id(c))));
  api.post('/companies/:id/owner', async (c) => c.json(await crm.changeCompanyOwner(ctx, A(c), id(c), (await body(c, C.ownerInput)).ownerId)));

  api.get('/contacts', async (c) => c.json(await crm.listContacts(ctx, A(c), parse(C.pageQuerySchema, c.req.query()))));
  api.post('/contacts', async (c) => c.json(await crm.createContact(ctx, A(c), await body(c, C.contactInput)), 201));
  api.get('/contacts/:id', async (c) => c.json(await crm.getContact(ctx, A(c), id(c))));
  api.patch('/contacts/:id', async (c) => c.json(await crm.updateContact(ctx, A(c), id(c), await body(c, C.contactInput))));

  api.get('/deals', async (c) => {
    const q = c.req.query();
    const status = ['open', 'won', 'lost'].includes(q.status ?? '') ? (q.status as 'open') : undefined;
    return c.json(
      await crm.listDeals(ctx, A(c), { ...parse(C.pageQuerySchema, q), status, stageId: q.stageId && UUID.test(q.stageId) ? q.stageId : undefined }),
    );
  });
  api.post('/deals', async (c) => c.json(await crm.createDeal(ctx, A(c), await body(c, C.dealInput)), 201));
  api.get('/deals/:id', async (c) => c.json(await crm.getDeal(ctx, A(c), id(c))));
  api.patch('/deals/:id', async (c) => c.json(await crm.patchDeal(ctx, A(c), id(c), await body(c, C.dealPatch))));
  api.post('/deals/:id/stage', async (c) => {
    const b = await body(c, C.stageMoveInput);
    return c.json(await crm.moveDealStage(ctx, A(c), id(c), b.stageId, b.rowVersion));
  });
  api.post('/deals/:id/won', async (c) => c.json(await crm.closeDealWon(ctx, A(c), id(c), (await body(c, C.closeWonInput)).amount)));
  api.post('/deals/:id/lost', async (c) =>
    c.json(await crm.closeDealLost(ctx, A(c), id(c), await body(c, C.closeLostInput), esign.voidOpenSignature, esign.hasOpenSignature)),
  );
  api.post('/deals/:id/reopen', async (c) => {
    const b = await body(c, C.reopenInput);
    return c.json(await crm.reopenDeal(ctx, A(c), id(c), b.reason, b.stageId));
  });
  api.post('/deals/:id/owner', async (c) => c.json(await crm.changeDealOwner(ctx, A(c), id(c), (await body(c, C.ownerInput)).ownerId)));
  api.post('/deals/:id/contacts', async (c) => c.json(await crm.addDealContact(ctx, A(c), id(c), await body(c, C.dealContactInput)), 201));
  api.get('/deals/:id/proposals', async (c) => c.json(await proposals.listProposals(ctx, A(c), id(c))));
  api.post('/deals/:id/proposals', async (c) => c.json(await proposals.createProposal(ctx, A(c), id(c), await body(c, C.proposalCreateInput)), 201));
  api.get('/deals/:id/automation', async (c) => c.json(await workflow.listExecutions(ctx, A(c), id(c))));
  api.get('/deals/:id/engagement', async (c) => c.json(await workflow.engagementForDeal(ctx, A(c), id(c))));
  api.post('/deals/:id/ai-summary', async (c) => c.json(await ai.dealSummary(ctx, A(c), id(c), T(c))));

  api.get('/timeline/:type/:id', async (c) => {
    const relatedType = parse(C.noteInput.shape.relatedType, c.req.param('type'));
    return c.json(await crm.getTimeline(ctx, A(c), { relatedType, relatedId: id(c) }, { types: c.req.queries('type'), limit: 100 }));
  });
  api.get('/tasks', async (c) => {
    const q = c.req.query();
    const scoped = q.relatedType && q.relatedId && UUID.test(q.relatedId);
    return c.json(
      await crm.listTasks(ctx, A(c), scoped ? { relatedType: parse(C.noteInput.shape.relatedType, q.relatedType), relatedId: q.relatedId } : { mine: true }),
    );
  });
  api.post('/tasks', async (c) => c.json(await crm.createTask(ctx, A(c), await body(c, C.taskInput)), 201));
  api.post('/tasks/:id/complete', async (c) => c.json(await crm.completeTask(ctx, A(c), id(c))));
  api.post('/notes', async (c) => c.json(await crm.createNote(ctx, A(c), await body(c, C.noteInput)), 201));
  api.post('/activities', async (c) => c.json(await crm.logActivity(ctx, A(c), await body(c, C.activityInput)), 201));
  // Managed leads (BR-LED). /leads/inbox is registered before /leads/:id so it is not captured as an id.
  api.get('/leads', async (c) => {
    const q = c.req.query();
    const status = ['new', 'working', 'qualified', 'unqualified', 'converted'].includes(q.status ?? '') ? (q.status as 'new') : undefined;
    return c.json(await crm.listLeads(ctx, A(c), { ...parse(C.pageQuerySchema, q), status }));
  });
  api.get('/leads/inbox', async (c) => c.json(await crm.listLeadInbox(ctx, A(c))));
  api.post('/leads', async (c) => c.json(await crm.createLead(ctx, A(c), await body(c, C.leadInput)), 201));
  api.get('/leads/:id', async (c) => c.json(await crm.getLead(ctx, A(c), id(c))));
  api.patch('/leads/:id', async (c) => c.json(await crm.updateLead(ctx, A(c), id(c), await body(c, C.leadPatch))));
  api.delete('/leads/:id', async (c) => c.json(await crm.deleteLead(ctx, A(c), id(c))));
  api.post('/leads/:id/assign', async (c) => c.json(await crm.assignLead(ctx, A(c), id(c), (await body(c, C.leadAssignInput)).ownerId)));
  api.post('/leads/:id/qualify', async (c) => c.json(await crm.qualifyLead(ctx, A(c), id(c))));
  api.post('/leads/:id/disqualify', async (c) => c.json(await crm.disqualifyLead(ctx, A(c), id(c), await body(c, C.leadDisqualifyInput))));
  api.post('/leads/:id/convert', async (c) => c.json(await crm.convertLead(ctx, A(c), id(c), await body(c, C.leadConvertInput))));

  api.get('/templates', async (c) => c.json(await proposals.listTemplates(ctx, A(c))));
  api.post('/templates', async (c) => c.json(await proposals.createTemplate(ctx, A(c), await body(c, C.templateInput)), 201));
  api.get('/templates/:id', async (c) => c.json(await proposals.getTemplate(ctx, A(c), id(c))));
  api.put('/templates/:id/draft', async (c) => c.json(await proposals.saveTemplateDraft(ctx, A(c), id(c), (await body(c, C.templateDraftInput)).content)));
  api.post('/templates/:id/publish', async (c) => c.json(await proposals.publishTemplate(ctx, A(c), id(c))));
  api.get('/products', async (c) => c.json(await proposals.listProducts(ctx)));
  api.post('/products', async (c) => c.json(await proposals.createProduct(ctx, A(c), await body(c, C.productInput)), 201));

  api.get('/proposals/:id', async (c) => c.json(await proposals.getProposal(ctx, A(c), id(c))));
  api.put('/proposals/:id/draft', async (c) => c.json(await proposals.saveDraft(ctx, A(c), id(c), await body(c, C.proposalDraftInput))));
  api.get('/proposals/:id/presend-check', async (c) => c.json(await proposals.presend(ctx, A(c), id(c))));
  api.get('/proposals/:id/preview', async (c) => {
    const v = c.req.query('versionId');
    return c.json({ html: await proposals.previewHtml(ctx, A(c), id(c), v && UUID.test(v) ? v : undefined) }); // internal preview: never tracked
  });
  api.post('/proposals/:id/send', async (c) => c.json(await proposals.sendProposal(ctx, A(c), id(c), await body(c, C.proposalSendInput), sendPorts)));
  api.post('/proposals/:id/versions', async (c) => c.json(await proposals.createVersion(ctx, A(c), id(c)), 201));
  api.get('/proposals/:id/compare', async (c) =>
    c.json(
      await proposals.compareVersions(
        ctx,
        A(c),
        id(c),
        parse(C.ownerInput.shape.ownerId, c.req.query('from')),
        parse(C.ownerInput.shape.ownerId, c.req.query('to')),
      ),
    ),
  );
  api.post('/proposals/:id/void', async (c) => c.json(await proposals.voidProposal(ctx, A(c), id(c), (await body(c, C.voidInput)).reason, sendPorts)));
  api.post('/proposals/:id/deal-amount', async (c) => c.json(await proposals.syncDealAmount(ctx, A(c), id(c))));
  api.get('/proposals/:id/versions/:versionId/:format', async (c) => {
    const format = c.req.param('format');
    if (format !== 'pdf' && format !== 'docx') throw new DomainError(ERROR_CODES.NOT_FOUND, 404, 'Not found');
    return file(await proposals.downloadFile(ctx, A(c), id(c), id(c, 'versionId'), format));
  });
  api.get('/proposals/:id/links', async (c) => c.json(await sharing.listLinks(ctx, A(c), id(c))));
  api.post('/share-links/:id/revoke', async (c) => c.json(await sharing.revokeLink(ctx, A(c), id(c))));
  api.post('/share-links/:id/copy', async (c) => c.json(await sharing.copyLink(ctx, A(c), id(c))));

  api.get('/proposals/:id/signature-requests', async (c) => c.json(await esign.listForProposal(ctx, A(c), id(c))));
  api.post('/proposals/:id/signature-requests', async (c) => c.json(await esign.createRequest(ctx, A(c), id(c), await body(c, C.signatureRequestInput)), 201));
  api.post('/signature-requests/:id/void', async (c) => c.json(await esign.voidRequest(ctx, A(c), id(c), (await body(c, C.voidInput)).reason)));
  api.get('/signature-requests/:id/documents/:kind', async (c) => {
    const kind = c.req.param('kind');
    if (kind !== 'signed-pdf' && kind !== 'certificate') throw new DomainError(ERROR_CODES.NOT_FOUND, 404, 'Not found');
    return file(await esign.downloadSigned(ctx, A(c), id(c), kind));
  });

  // AI assistance. Every route returns a suggestion for a person to review; none of them sends or changes anything
  // except `decision`, which applies a suggestion the signed-in user explicitly accepted.
  api.get('/ai/status', async (c) => c.json(await ai.status(ctx, A(c))));
  api.post('/ai/draft-section', async (c) => c.json(await ai.draftSection(ctx, A(c), await body(c, C.aiDraftInput), T(c))));
  api.post('/ai/draft-sections', async (c) => c.json(await ai.draftSections(ctx, A(c), await body(c, C.aiDraftSectionsInput), T(c))));
  api.post('/ai/review', async (c) => c.json(await ai.reviewProposal(ctx, A(c), (await body(c, C.aiReviewInput)).proposalId, T(c))));
  api.get('/proposals/:id/ai-review', async (c) => c.json(await ai.latestReview(ctx, A(c), id(c))));
  api.post('/ai/reviews/:id/findings/:findingId/decision', async (c) =>
    c.json(await ai.decideFinding(ctx, A(c), id(c), c.req.param('findingId').slice(0, 40), (await body(c, C.aiFindingDecisionInput)).decision)),
  );
  api.post('/ai/rewrite', async (c) => c.json(await ai.rewriteText(ctx, A(c), await body(c, C.aiRewriteInput), T(c))));
  api.post('/ai/follow-up-email', async (c) => c.json(await ai.followUpDraft(ctx, A(c), await body(c, C.aiFollowUpInput), T(c))));
  api.post('/ai/generations/:id/decision', async (c) => c.json(await ai.decide(ctx, A(c), id(c), await body(c, C.aiDecisionInput))));
  api.get('/ai/usage', async (c) => c.json(await ai.usageReport(ctx, A(c))));
  api.get('/ai/usage/mine', async (c) => c.json(await ai.myUsage(ctx, A(c))));
  api.get('/ai/settings', async (c) => c.json(await ai.getSettings(ctx, A(c))));
  api.put('/ai/settings', async (c) => c.json(await ai.updateSettings(ctx, A(c), await body(c, C.aiSettingsInput))));

  api.get('/notifications', async (c) => c.json(await workflow.listNotifications(ctx, A(c), Number(c.req.query('since') ?? 0) || 0)));
  api.post('/notifications/read', async (c) => {
    await workflow.markNotificationsRead(ctx, A(c));
    return c.json({ ok: true });
  });
  api.post('/automation/executions/:id/reverse', async (c) => c.json(await workflow.reverseExecution(ctx, A(c), id(c))));
  api.get('/reports/dashboard', async (c) => c.json(await reporting.dashboard(ctx, A(c), Math.min(Math.max(Number(c.req.query('days') ?? 90) || 90, 1), 730))));
  // Feature route files (http/routes/*): each adds its own endpoints with the shared kit.
  const kit: RouteKit = { ctx, actor: A, body, query: (c, schema) => parse(schema, c.req.query()), id, file };
  for (const register of [registerAdminRoutes, registerReportRoutes, registerImportRoutes, registerProposalExtRoutes]) register(api, kit);
  app.route('/api/v1', api);

  // ───────────── /public/v1 — buyers and lead forms (no internal account) ─────────────
  const pub = new Hono<Env>();
  const buyer = (c: Context) => sharing.resolveBuyer(ctx, getCookie(c, BUYER_COOKIE));
  pub.post('/session/exchange', async (c) => {
    const { token } = await body(c, C.buyerExchangeInput);
    const { session } = await sharing.exchangeToken(ctx, token);
    // Link-bound session cookie; the token itself never appears in a URL path, query or log (ADR-071).
    setCookie(c, BUYER_COOKIE, session, { httpOnly: true, secure: prod, sameSite: 'Lax', path: '/', maxAge: 30 * 86_400 });
    return c.json({ ok: true });
  });
  pub.get('/session', async (c) => c.json(await sharing.buyerState(ctx, await buyer(c))));
  pub.post('/identity/continue', async (c) => c.json(await sharing.identify(ctx, await buyer(c), { continueAsRecipient: true })));
  pub.post('/identity', async (c) => c.json(await sharing.identify(ctx, await buyer(c), await body(c, C.buyerIdentityInput))));
  pub.get('/proposal', async (c) => c.json(await sharing.buyerProposal(ctx, await buyer(c))));
  pub.post('/views/start', async (c) => c.json(await sharing.startView(ctx, await buyer(c))));
  pub.post('/views/heartbeat', async (c) => c.json(await sharing.heartbeat(ctx, await buyer(c), await body(c, C.buyerHeartbeatInput))));
  pub.get('/download', async (c) => file({ ...(await sharing.download(ctx, await buyer(c))), contentType: 'application/pdf' }));
  pub.post('/response', async (c) =>
    c.json(
      await sharing.respond(ctx, await buyer(c), await body(c, C.buyerResponseInput), {
        ip: c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? '0.0.0.0',
        userAgent: c.req.header('user-agent') ?? '',
      }),
    ),
  );
  pub.post('/forms/:key/submissions', async (c) => {
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
    await crm.submitLead(ctx, c.req.param('key'), await body(c, C.leadSubmissionInput), sha256Hex(ip));
    return c.json({ accepted: true }, 202);
  });
  app.route('/public/v1', pub);

  // ───────────── /webhooks — verified, persisted, acknowledged (ADR-053) ─────────────
  app.post('/webhooks/esign/:provider', async (c) => {
    const raw = await c.req.text();
    const ok = c.req.param('provider') === ctx.esign.name && (await esign.ingestWebhook(ctx, raw, c.req.header('x-signature')));
    return ok ? c.json({ received: true }) : c.json({ error: 'invalid' }, 401);
  });

  // ───────────── /dev — e-signature SIMULATOR controls (never mounted in production) ─────────────
  if (!prod && ctx.esign instanceof FakeESignProvider) {
    const fake = ctx.esign;
    app.post('/dev/esign/:envelopeId/:signerKey/:action', async (c) => {
      const action = c.req.param('action');
      if (action !== 'sign' && action !== 'decline') throw new DomainError(ERROR_CODES.NOT_FOUND, 404, 'Not found');
      const { body: raw, signature } = await fake
        .simulateSignerAction(c.req.param('envelopeId'), c.req.param('signerKey'), action, c.req.query('reason'))
        .catch((e: Error) => {
          throw new DomainError('SIGNER_CANNOT_ACT', 422, e.message);
        });
      await esign.ingestWebhook(ctx, raw, signature); // delivered exactly like a real provider webhook
      await workflow.runDueJobs(ctx);
      return c.json({ simulated: true });
    });
    app.post('/dev/jobs/run', async (c) => c.json({ processed: await workflow.runDueJobs(ctx), scans: await workflow.runScheduledScans(ctx) }));
  }

  app.notFound((c) => problemResponse(toProblem(new DomainError(ERROR_CODES.NOT_FOUND, 404, 'Not found'), c.get('requestId'))));
  app.onError((error, c) => {
    const pg = error as { code?: string; message?: string };
    // Database guards map to stable domain codes (ERROR-HANDLING-AND-VALIDATION §3).
    const mapped =
      pg.code === 'P0001' && pg.message?.includes('VERSION_IMMUTABLE')
        ? new DomainError('VERSION_IMMUTABLE', 409, 'A sent version cannot be changed')
        : pg.code === '23505'
          ? new DomainError('CONCURRENT_MODIFICATION', 409, 'This record was changed at the same time. Reload and try again.')
          : error;
    const problem = toProblem(mapped, c.get('requestId'));
    if (problem.status >= 500) ctx.logger.error({ err: error, requestId: c.get('requestId') }, 'unhandled error');
    return problemResponse(problem);
  });
  return app;
}
