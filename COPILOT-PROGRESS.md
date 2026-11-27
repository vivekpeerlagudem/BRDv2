# Kensium Copilot — build progress

Branch `feature/copilot` (from `main` at e12af59). Design: `deliverables/agentic-sa/Kensium-Agentic-SA-ClaudeCode.md`.
Resume rule: read this file, continue from the next unfinished milestone, update it after each milestone.

## Milestones

| # | Milestone | Status | Commit |
|---|---|---|---|
| M1 | Foundations: scope fix, AI port, adapters, migration 0010, demo seed, dependency rule | done | see `git log` (M1) |
| M2 | Read-only Copilot: loop, read tools, playbooks, grounding, SSE API, side panel | next | |
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

## Next step

M2.1: the loop (`modules/copilot/loop.ts`) with caps and one `agent_run` row per turn, test-first through the SSE
endpoint with scripted mock steps.
