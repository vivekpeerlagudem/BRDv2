# Kensium Copilot — build progress

Branch `feature/copilot` (from `main` at e12af59). Design: `deliverables/agentic-sa/Kensium-Agentic-SA-ClaudeCode.md`.
Resume rule: read this file, continue from the next unfinished milestone, update it after each milestone.

## Milestones

| # | Milestone | Status | Commit |
|---|---|---|---|
| M1 | Foundations: scope fix, AI port, adapters, migration 0010, demo seed, dependency rule | done | 65808d5 |
| M2 | Read-only Copilot: loop, read tools, playbooks, grounding, SSE API, side panel | done | (see git log) |
| M3 | Actions and human control: policy engine, tiers, ledger, scoring, cards | | |
| M4 | Role home cards | | |
| M5 | Accept-and-escalate | | |
| M6 | Background agents | | |
| M7 | Admin, budgets, operations | | |
| M8 | Evaluation and model ladder (fake, then live Gemini) | | |
| Final | Final gate, reseed crm_dev, report | | |

## Test counts

- Before the build: 320 tests (all green on 2026-11-25).
- After M1: +16 adapter tests, +4 foundations (integration), +1 dependency rule, config test extended.
- After M2: +13 chat integration, +13 text unit, +3 web SSE unit.

## Decisions (made without asking)

1. **Test seams.** (a) HTTP API with the mock AI injected at the `AiProvider` port and a controllable clock
   (`apps/server/src/copilot-test-kit.ts`) for behaviour; (b) small unit seams for pure code (provider drivers,
   scoring, business hours, grounding, policy). No test reaches inside the loop.
2. **One internal conversation format** in `platform/ports.ts` (`AiMessage`, `AiContentBlock`, `AiToolSpec`,
   `converse()`). Streaming is a callback (`onTextDelta`), so the loop does not depend on a provider stream type.
   Tool calls carry an opaque `meta` so provider extras (for example Gemini thought signatures) are echoed back.
3. **No new dependency.** The OpenAI-compatible driver uses plain `fetch` (`platform/openai-compatible.ts`).
4. **Copilot features are separate from the seven existing AI feature switches.** `CopilotFeature` values
   (`copilot_chat`, `copilot_triage`, `copilot_background`) are gated by `organization_settings.copilot_settings`, so
   existing AI settings screens and contracts are unchanged.
5. **`agent_run` is written once, at the end of a run** (append-only for the app role, like `ai_usage`).
   Idempotency of background writes is enforced by `agent_action.idempotency_key` (unique) and
   `agent_run.idempotency_key` (unique).
6. **Lead field lists are fixed in code** (`packages/shared/src/copilot.ts`), not admin-editable in v1. The prompt
   names the column `timeline` (the SA said `timeline_band`); the prompt wins.
7. **Web-form leads** carry the six answers in the submission payload; `industry` is also copied to the company.
8. **Demo seed** lives in `modules/copilot/demo-seed.ts` (a function usable on crm_dev and crm_test) and is called at
   the end of `db:seed:avengers`, after the Sales Brief, so the brief keeps describing the small hand-made story.
   It adds team Guardians (Star-Lord manager; Gamora, Rocket), Hawkeye (Avengers) and Loki (deactivated Avenger).
9. **Injection text 3** ("fake system tag in a buyer decline reason") sits in a lost deal's `lost_reason_note`
   (the buyer's stated reason), not in `buyer_response`, which needs a full sent-proposal chain.
10. **Models unknown to the price table** get a cost of `null`; `AI_PRICES` (JSON env) can supply prices.
11. **PostgreSQL on this machine is 19**, not 18 (user's earlier choice). `uuidv7()` works on both.
12. The mock's planner and gullible modes are completed in M2/M3, when the tools they plan with exist; M1 ships the
    scripted and slow modes and the mode switches.

13. **COPILOT-BUILD-PROMPT.md was missing on disk** after the account switch; it was restored word for word from the
    earlier session transcript and is excluded from git (.git/info/exclude).
14. **Conversation purge runs on every scheduled scan** (`modules/copilot/scheduled.ts`, called at the end of
    `runScheduledScans`), not once a night: it is one indexed delete, so "nightly" is met and simpler to test.
15. **Schema changes after M2 go into a new migration (0011+)**, not into 0010, because crm_dev already has 0010
    applied (see the open issue below).
16. **Web CSP** is a `<meta http-equiv>` with `img-src 'self'` only in `apps/web/index.html`; a stricter script-src would
    break the Vite dev server, and img-src is what blocks pixel exfiltration.
17. **UI checks** are done by the Playwright flows at the final gate (crm_dev seed passwords are random per seed).

## Open issues

- None yet.

## Next step (resume here)

M3: write tools register through policy.setWriteHandler (modules/copilot/actions.ts); the planner already knows the
tool names create_task{related,title,due}, add_ai_note{related,text}, set_lead_score{record,tags},
move_deal_stage{deal,stage}, patch_deal{deal,closeDate}, qualify_lead/convert_lead{lead}, disqualify_lead{lead,reason},
close_deal_lost{deal,reason}, log_activity{related,kind,summary}, reassign{record,owner}, accept_assignment{assignment},
draft_follow_up{deal}. Web ActionCard + pages exist in apps/web/src/pages/copilot-actions.tsx (routes not yet added);
they call POST /copilot/actions/:id/{approve,reject,undo} and GET /copilot/actions?view=pending|done.

Notes for whoever resumes:
- The tool pipeline turns \uXXXX escapes into literal characters when writing files. Never write such escapes; build
  characters from code points (see text.ts, demo-seed.ts).
- Never put backticks inside a shell command string: the shell runs them (see the open issue below).
- To re-create the test schema after changing 0010: drop and recreate schema public on crm_test as the migrator, then
  run the server db:migrate script with --test.
- Run one test file at a time with vitest (pnpm exec vitest run apps/server/src/FILE).

## Open issue to know about

- 2026-11-27: migration 0010 was applied to crm_dev BY ACCIDENT (a shell quoting slip ran db:migrate without --test)
  and without a pg_dump first. It is additive only (new tables, new nullable lead columns, one settings column); no
  existing data was changed and nothing was reseeded. If 0010 changes again before release, crm_dev needs the new
  columns added by hand or a restore + re-migrate. Take a pg_dump of crm_dev before any further step on it.
