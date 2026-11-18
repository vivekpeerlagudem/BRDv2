import { serve } from '@hono/node-server';
import { buildContext } from './composition.ts';
import { loadConfig } from './config/env.ts';
import { createApp } from './http/app.ts';
import { runDueJobs } from './modules/workflow.ts';

/** `server` role: HTTP API. Background work runs in the `worker` role (src/worker.ts). */
const config = loadConfig();
const { ctx, pool, auth } = buildContext(config);
const app = createApp(ctx, auth);

const server = serve({ fetch: app.fetch, port: config.PORT }, (info) => ctx.logger.info({ port: info.port, env: config.NODE_ENV }, 'server listening'));

// Development convenience only: process jobs in-process so alerts appear without starting the worker.
const devJobs =
  config.NODE_ENV === 'development' ? setInterval(() => void runDueJobs(ctx).catch((e) => ctx.logger.error({ err: e }, 'job loop failed')), 1500) : null;

async function shutdown(signal: string): Promise<void> {
  ctx.logger.info({ signal }, 'shutting down');
  if (devJobs) clearInterval(devJobs);
  server.close();
  await ctx.pdf.close();
  await pool.end();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
