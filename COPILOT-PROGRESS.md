# Kensium Copilot — build progress

Branch `feature/copilot` (from `main` at e12af59). Design: `deliverables/agentic-sa/Kensium-Agentic-SA-ClaudeCode.md`.
Resume rule: read this file, continue from the next unfinished milestone, update it after each milestone.

## Milestones

| # | Milestone | Status | Commit |
|---|---|---|---|
| M1 | Foundations: scope fix, AI port, adapters, migration 0010, demo seed, dependency rule | done | 65808d5 |
| M2 | Read-only Copilot: loop, read tools, playbooks, grounding, SSE API, side panel | IN PROGRESS (server written, uncommitted; web not started) | |
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

## Open issues

- None yet.

## Next step (resume here)

M2 is half done and NOT committed. Files on disk (uncommitted), all under apps/server/src:
modules/copilot/{settings,text,tools,playbooks,prompt,budget,policy,loop,conversations}.ts, http/routes/copilot.ts
(registered in app.ts), platform/mock-ai-planner.ts (full planner + gullible mode),
copilot-chat.integration.test.ts (13 tests: 11 pass, 2 fail), and an alias_map column added to 0010.

1. Fix the 2 failing tests in copilot-chat.integration.test.ts:
   - "outside text reaches the model…": the regex for the escaped source="lead notes" is wrong (test bug, check the
     real string in the tool_result content), then confirm taint + flags.
   - "rejects unknown tools…": converseCalls.at(-1).messages.at(-1) is not the tool-result message; search all messages.
2. Add unit tests for text.ts (cleanUntrusted, cleanAnswer, ungroundedNumbers) and run lint (biome) + typecheck.
3. Wire purgeExpiredConversations into runScheduledScans (workflow.ts), nightly.
4. Web: Copilot side panel (toggle next to NotificationBell in apps/web/src/main.tsx), SSE client, source chips;
   set the web app CSP to img-src 'self'.
5. Commit M2, then M3 (write tools register through policy.setWriteHandler; planner already knows the tool names
   create_task{related,title,due}, add_ai_note{related,text}, set_lead_score{record,tags}, move_deal_stage{deal,stage},
   patch_deal{deal,closeDate}, qualify_lead/convert_lead{lead}, disqualify_lead{lead,reason}, close_deal_lost{deal,reason},
   log_activity{related,kind,summary}, reassign{record,owner}, accept_assignment{assignment}, draft_follow_up{deal}).

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
