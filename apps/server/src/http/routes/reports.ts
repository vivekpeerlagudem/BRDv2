import type { Context } from 'hono';
import * as reporting from '../../modules/reporting.ts';
import { notFound, requirePerm } from '../../platform/core.ts';
import type { Api, Env, RouteKit } from '../kit.ts';

/**
 * Routes for: filtered reports and CSV export (BR-RPT-001..010). Mounted under /api/v1 (authenticated).
 * The role permission is checked before the query string is parsed; the module checks it again and applies the
 * record-level scope (own / team / organization) in SQL for every figure, list and export.
 */
export function register(api: Api, kit: RouteKit): void {
  const { ctx } = kit;
  const viewer = (c: Context<Env>) => {
    const actor = kit.actor(c);
    requirePerm(actor, 'report.view');
    return actor;
  };

  api.get('/reports/filters', async (c) => c.json(await reporting.reportFilters(ctx, viewer(c))));
  api.get('/reports/overview', async (c) => {
    const actor = viewer(c);
    return c.json(await reporting.reportOverview(ctx, actor, kit.query(c, reporting.reportQuery)));
  });
  api.get('/reports/export/:section', async (c) => {
    const actor = viewer(c);
    const section = reporting.reportSection.safeParse(c.req.param('section').replace(/\.csv$/, ''));
    if (!section.success) throw notFound('Report');
    return kit.file(await reporting.exportReportCsv(ctx, actor, section.data, kit.query(c, reporting.reportQuery)));
  });
}
