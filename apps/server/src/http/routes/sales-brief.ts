import { salesBriefListQuery, salesBriefNarrativeUpdateInput, salesBriefSettingsInput, weeklyReportApproveInput } from '@crm/shared';
import type { Context } from 'hono';
import * as salesBrief from '../../modules/sales-brief.ts';
import { notFound, requirePerm } from '../../platform/core.ts';
import type { Api, Env, RouteKit } from '../kit.ts';

/**
 * Routes for the Weekly Sales Brief (leadership only). Mounted under /api/v1 (authenticated). The role permission
 * is checked before any body or query is parsed, so a sales manager or salesperson gets 403 on every route; the
 * module checks it again.
 */
export function register(api: Api, kit: RouteKit): void {
  const { ctx } = kit;
  const as = (c: Context<Env>, perm: 'sales_brief.view' | 'sales_brief.manage' | 'settings.manage') => {
    const actor = kit.actor(c);
    requirePerm(actor, perm);
    return actor;
  };
  const kindOf = (c: Context<Env>) => {
    const kind = c.req.param('kind');
    if (kind !== 'draft' && kind !== 'final') throw notFound('Sales brief file');
    return kind;
  };

  api.get('/admin/sales-brief-settings', async (c) => c.json(await salesBrief.getSalesBriefSettings(ctx, as(c, 'settings.manage'))));
  api.put('/admin/sales-brief-settings', async (c) => {
    const actor = as(c, 'settings.manage');
    return c.json(await salesBrief.updateSalesBriefSettings(ctx, actor, await kit.body(c, salesBriefSettingsInput)));
  });

  api.get('/sales-briefs', async (c) => {
    const actor = as(c, 'sales_brief.view');
    return c.json(await salesBrief.listSalesBriefs(ctx, actor, kit.query(c, salesBriefListQuery)));
  });
  api.post('/sales-briefs', async (c) => c.json(await salesBrief.requestSalesBrief(ctx, as(c, 'sales_brief.manage')), 201));
  api.get('/sales-briefs/:id', async (c) => c.json(await salesBrief.getSalesBrief(ctx, as(c, 'sales_brief.view'), kit.id(c))));
  api.patch('/sales-briefs/:id/narrative', async (c) => {
    const actor = as(c, 'sales_brief.manage');
    return c.json(await salesBrief.updateBriefNarrative(ctx, actor, kit.id(c), await kit.body(c, salesBriefNarrativeUpdateInput)));
  });
  api.post('/sales-briefs/:id/regenerate', async (c) => c.json(await salesBrief.regenerateBrief(ctx, as(c, 'sales_brief.manage'), kit.id(c))));
  api.post('/sales-briefs/:id/approve', async (c) => {
    const actor = as(c, 'sales_brief.manage');
    return c.json(await salesBrief.approveSalesBrief(ctx, actor, kit.id(c), await kit.body(c, weeklyReportApproveInput)));
  });
  api.get('/sales-briefs/:id/pptx/:kind', async (c) => {
    const actor = as(c, 'sales_brief.view');
    return kit.file(await salesBrief.downloadBriefFile(ctx, actor, kit.id(c), 'pptx', kindOf(c)));
  });
  api.get('/sales-briefs/:id/xlsx/:kind', async (c) => {
    const actor = as(c, 'sales_brief.view');
    return kit.file(await salesBrief.downloadBriefFile(ctx, actor, kit.id(c), 'xlsx', kindOf(c)));
  });
}
