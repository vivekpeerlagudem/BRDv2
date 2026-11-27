/**
 * pnpm copilot:eval --provider <fake|openai|anthropic> --models <comma list> --runs <n> [--only N01,L02]
 *
 * Runs the 50-task Copilot evaluation on the TEST database (reset and seeded with the Avengers demo data for every
 * run) and appends a table per model to deliverables/copilot-eval/<date>.md. A real provider reads its settings
 * (base URL, key, models) from .env.local through the config loader; the key is never printed or written.
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createKit, PASSWORD } from '../copilot-test-kit.ts';
import { markdownReport, runEval } from '../modules/copilot/evals/harness.ts';
import { testDbUrl } from '../test-db.ts';

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? (args[i + 1] as string) : fallback;
};
const provider = arg('provider', 'fake');
if (!['fake', 'openai', 'anthropic'].includes(provider)) throw new Error('--provider must be fake, openai or anthropic');
const runs = Math.max(1, Math.min(5, Number(arg('runs', '1')) || 1));
const only = arg('only', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
if (!testDbUrl()) throw new Error('The evaluation needs the test database (TEST_DATABASE_URL); it never runs on crm_dev.');

const live = provider !== 'fake';
const kit = createKit('Kensium Copilot Eval', { realAi: live, env: { AI_PROVIDER: provider, AI_RATE_PER_MINUTE: '1000', AI_TIMEOUT_MS: '60000' } });
const models = arg('models', live ? [kit.ctx.config.AI_MODEL_MAIN, kit.ctx.config.AI_MODEL_FAST].filter(Boolean).join(',') : 'default')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const started = Date.now();
let done = 0;
const total = models.length * runs * (only.length || 50);
const { summaries, results } = await runEval(kit, {
  models,
  runs,
  live,
  password: PASSWORD,
  only,
  onTask: (r) => {
    done++;
    console.log(
      `[${done}/${total}] ${r.model} run ${r.run} ${r.id} ${r.passed ? 'PASS' : `FAIL (${r.reasons.join('; ')})`}${r.retries ? ` retries=${r.retries}` : ''}`,
    );
  },
});
const date = new Date().toISOString().slice(0, 10);
const dir = fileURLToPath(new URL('../../../../deliverables/copilot-eval/', import.meta.url));
mkdirSync(dir, { recursive: true });
const title = `${live ? 'Live' : 'Fake'} evaluation (${provider}, runs=${runs}${only.length ? `, only ${only.join(',')}` : ''}) — ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, ${Math.round((Date.now() - started) / 1000)} s`;
appendFileSync(`${dir}${date}.md`, `${markdownReport(title, provider, summaries, results)}\n`);
for (const s of summaries)
  console.log(
    `${s.model}: correct ${s.correctPercent}% · pass^3 ${s.passHat3Percent ?? 'n/a'} · leaks ${s.leaks} · injection failures ${s.injectionFailures} · p90 first words ${s.p90FirstWordsMs ?? 'n/a'} ms · cost/task ${s.costPerTaskUsd ?? 'unknown'} · month ${s.projectedMonthlyUsd ?? 'unknown'}`,
  );
console.log(`report: deliverables/copilot-eval/${date}.md`);
await kit.pool.end();
