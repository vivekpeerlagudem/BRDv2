import { buildContext } from './composition.ts';
import { loadConfig } from './config/env.ts';
import { runDueJobs, runScheduledScans } from './modules/workflow.ts';

/**
 * `worker` role: drains the transactional job outbox every second and runs the scheduled scans
 * (stalled/overdue deals, proposal expiry, e-sign reconciliation, task reminders) every 5 minutes.
 */
const config = loadConfig();
const { ctx, pool } = buildContext({ ...config, PROCESS_ROLE: 'worker' });
let stopping = false;
ctx.logger.info('worker started');

async function loop(): Promise<void> {
  let lastScan = 0;
  while (!stopping) {
    try {
      await runDueJobs(ctx);
      if (Date.now() - lastScan > 5 * 60_000) {
        lastScan = Date.now();
        ctx.logger.info(await runScheduledScans(ctx), 'scheduled scans done');
      }
    } catch (error) {
      ctx.logger.error({ err: error }, 'worker loop error');
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await ctx.pdf.close();
  await pool.end();
}
process.on('SIGINT', () => (stopping = true));
process.on('SIGTERM', () => (stopping = true));
await loop();
