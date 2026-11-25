/**
 * Helper for e2e/weekly-workflow-preview.spec.ts (development only). The UI always records "now" when a task is
 * completed or a meeting is logged, but a weekly report covers LAST week. This moves, for one preview company:
 *   - `completed_at` of its completed tasks titled "[S-…" to Thursday 10:00 of the last full week,
 *   - `occurred_at` of its logged calls and meetings to Wednesday 15:00 of the last full week.
 * Only companies whose name starts with "Preview " are accepted. Refuses to run in production.
 *
 *   PREVIEW_COMPANY="<company name>" tsx src/cli/weekly-preview-backdate.ts   (or the name as the first argument)
 */
import { and, eq, inArray, like } from 'drizzle-orm';
import { buildContext } from '../composition.ts';
import { loadConfig } from '../config/env.ts';
import { lastFullWeek, periodInstants } from '../modules/weekly-reports/period.ts';
import { StubPdfRenderer } from '../platform/adapters.ts';
import { schema } from '../platform/core.ts';

const config = loadConfig();
if (config.NODE_ENV === 'production') throw new Error('This helper must not run in production.');
const name = (process.env.PREVIEW_COMPANY ?? process.argv[2] ?? '').trim();
if (!name.startsWith('Preview ')) throw new Error('Pass the name of a preview company (it must start with "Preview ").');

const { ctx, pool } = buildContext({ ...config, LOG_LEVEL: 'warn' }, { pdf: new StubPdfRenderer() });
try {
  const { company, deal, task, activityLog, organizationSettings } = schema;
  const [co] = await ctx.db.select({ id: company.id }).from(company).where(eq(company.name, name));
  if (!co) throw new Error(`No company is named "${name}".`);
  const dealIds = (await ctx.db.select({ id: deal.id }).from(deal).where(eq(deal.companyId, co.id))).map((d) => d.id);
  if (!dealIds.length) throw new Error('The company has no opportunities.');
  const [settings] = await ctx.db.select({ timeZone: organizationSettings.timeZone }).from(organizationSettings);
  const timeZone = settings?.timeZone ?? 'UTC';
  const week = lastFullWeek(ctx.now(), timeZone);
  const { startInstant } = periodInstants(week.periodStart, week.periodEnd, timeZone);
  const at = (day: number, hour: number) => new Date(startInstant.getTime() + (day * 24 + hour) * 3_600_000);

  const tasks = await ctx.db
    .update(task)
    .set({ completedAt: at(3, 10) })
    .where(and(eq(task.relatedType, 'deal'), inArray(task.relatedId, dealIds), eq(task.status, 'completed'), like(task.title, '[S-%')))
    .returning({ id: task.id });
  const activities = await ctx.db
    .update(activityLog)
    .set({ occurredAt: at(2, 15) })
    .where(and(eq(activityLog.relatedType, 'deal'), inArray(activityLog.relatedId, dealIds), inArray(activityLog.kind, ['call', 'meeting'])))
    .returning({ id: activityLog.id });
  console.log(JSON.stringify({ periodStart: week.periodStart, periodEnd: week.periodEnd, timeZone, tasks: tasks.length, activities: activities.length }));
} finally {
  await pool.end();
}
