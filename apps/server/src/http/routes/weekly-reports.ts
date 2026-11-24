import { estimatesUploadInput, weeklyReportApproveInput, weeklyReportListQuery } from '@crm/shared';
import type { Context } from 'hono';
import { getEstimates, importEstimatesCsv } from '../../modules/weekly-reports/estimates.ts';
import * as weeklyReports from '../../modules/weekly-reports.ts';
import { notFound, requirePerm } from '../../platform/core.ts';
import type { Api, Env, RouteKit } from '../kit.ts';

/**
 * Routes for Weekly Report Agents: the estimates (scope) sheet per company and the weekly status report runs.
 * Mounted under /api/v1 (authenticated). The role permission is checked before any body or query is parsed; the
 * module checks it again and applies the record-level scope (company owner: own / team / organization).
 */
export function register(api: Api, kit: RouteKit): void {
  const { ctx } = kit;
  const as = (c: Context<Env>, perm: 'weekly_report.view' | 'weekly_report.manage') => {
    const actor = kit.actor(c);
    requirePerm(actor, perm);
    return actor;
  };

  api.post('/companies/:id/estimates', async (c) => {
    const actor = as(c, 'weekly_report.manage');
    return c.json(await importEstimatesCsv(ctx, actor, kit.id(c), await kit.body(c, estimatesUploadInput)), 201);
  });
  api.get('/companies/:id/estimates', async (c) => c.json(await getEstimates(ctx, as(c, 'weekly_report.view'), kit.id(c))));
  api.post('/companies/:id/weekly-reports', async (c) => c.json(await weeklyReports.requestWeeklyReport(ctx, as(c, 'weekly_report.manage'), kit.id(c)), 201));

  api.get('/weekly-reports', async (c) => {
    const actor = as(c, 'weekly_report.view');
    return c.json(await weeklyReports.listWeeklyReports(ctx, actor, kit.query(c, weeklyReportListQuery)));
  });
  api.get('/weekly-reports/:id', async (c) => c.json(await weeklyReports.getWeeklyReport(ctx, as(c, 'weekly_report.view'), kit.id(c))));
  api.post('/weekly-reports/:id/approve', async (c) => {
    const actor = as(c, 'weekly_report.manage');
    return c.json(await weeklyReports.approveWeeklyReport(ctx, actor, kit.id(c), await kit.body(c, weeklyReportApproveInput)));
  });
  api.get('/weekly-reports/:id/pptx/:kind', async (c) => {
    const actor = as(c, 'weekly_report.view');
    const kind = c.req.param('kind');
    if (kind !== 'draft' && kind !== 'final') throw notFound('Report file');
    return kit.file(await weeklyReports.downloadPptx(ctx, actor, kit.id(c), kind));
  });
}
