import { serve } from '@hono/node-server';
import { buildContext } from './composition.ts';
import { loadConfig } from './config/env.ts';
import { createApp } from './http/app.ts';
import { runDueJobs, runScheduledScans } from './modules/workflow.ts';

/** `server` role: HTTP API. Background work runs in the `worker` role (src/worker.ts). */
const config = loadConfig();
const { ctx, pool, auth } = buildContext(config);
const app = createApp(ctx, auth);

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => ctx.logger.info({ port: info.port, env: config.NODE_ENV }, 'server listening'));

// Development convenience only: process jobs in-process so alerts appear without starting the worker.
const devJobs =
  config.NODE_ENV === 'development' && config.RUN_JOBS_IN_PROCESS !== 'true'
    ? setInterval(() => void runDueJobs(ctx).catch((e) => ctx.logger.error({ err: e }, 'job loop failed')), 1500)
    : null;

// RUN_JOBS_IN_PROCESS=true: this process also does the worker's job (same cadence as src/worker.ts):
// drain the job outbox every second and run the scheduled scans every 5 minutes. One pass at a time.
let jobsBusy = false;
let lastScan = 0;
const inProcessJobs =
  config.RUN_JOBS_IN_PROCESS === 'true'
    ? setInterval(() => {
        if (jobsBusy) return;
        jobsBusy = true;
        void (async () => {
          try {
            await runDueJobs(ctx);
            if (Date.now() - lastScan > 5 * 60_000) {
              lastScan = Date.now();
              ctx.logger.info(await runScheduledScans(ctx), 'scheduled scans done');
            }
          } catch (error) {
            ctx.logger.error({ err: error }, 'in-process job loop error');
          } finally {
            jobsBusy = false;
          }
        })();
      }, 1000)
    : null;
if (inProcessJobs) ctx.logger.info('jobs run in the API process (RUN_JOBS_IN_PROCESS=true)');

async function shutdown(signal: string): Promise<void> {
  ctx.logger.info({ signal }, 'shutting down');
  if (devJobs) clearInterval(devJobs);
  if (inProcessJobs) clearInterval(inProcessJobs);
  server.close();
  await ctx.pdf.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
