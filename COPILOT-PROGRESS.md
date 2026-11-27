# Kensium Copilot — build progress

Branch `feature/copilot` (from `main` at e12af59). Design: `deliverables/agentic-sa/Kensium-Agentic-SA-ClaudeCode.md`.
Resume rule: read this file, continue from the next unfinished milestone, update it after each milestone.

## Milestones

| # | Milestone | Status | Commit |
|---|---|---|---|
| M1 | Foundations: scope fix, AI port, adapters, migration 0010, demo seed, dependency rule | done | 65808d5 |
| M2 | Read-only Copilot: loop, read tools, playbooks, grounding, SSE API, side panel | done | (see git log) |
| M3 | Actions and human control: policy engine, tiers, ledger, scoring, cards | done | (see git log) |
| M4 | Role home cards | done | (see git log) |
| M5 | Accept-and-escalate | done | (see git log) |
| M6 | Background agents | done | (see git log) |
| M7 | Admin, budgets, operations | done | (see git log) |
| M8 | Evaluation and model ladder (fake, then live Gemini) | IN PROGRESS (harness + fake 100 % committed 22aa518; live runs) | 22aa518 |
| Final | Final gate, reseed crm_dev, report | IN PROGRESS: crm_dev reseeded twice (no duplicates), Playwright 3/3; verify after live eval | 4ceb70a |

## Test counts

- Before the build: 320 tests (all green on 2026-11-25).
- After M1: +16 adapter tests, +4 foundations (integration), +1 dependency rule, config test extended.
- After M2: +13 chat integration, +13 text unit, +3 web SSE unit.
- After M8 so far: +2 eval integration (50 tasks on fake, 100 %), +1 adapter regression test (fractional timeout).
- After M7: +4 admin integration.
- After M6: +6 agents integration. pnpm test: 413 green.
- After M5: +7 SLA integration (fake clock), +7 business-hours unit. pnpm verify: 407 tests green.
- After M4: +4 home integration.
- After M3: +11 actions integration (incl. policy matrix 3 roles x every tool), +8 scoring unit. pnpm verify: 389+ tests.

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
18. **Internal notes count as outside text** (as in the existing AI layer): a chat turn that has read a record's notes
    is tainted, so a free-text auto write (task title, AI note, score reason) in that turn becomes an approval card.
19. **Tasks and notes go on deals, companies or people only** (the schema has no lead tasks/notes); a lead's reason
    lives in record_score.reason.
20. **Scoring engagement** (activity in 14 days, proposal viewed) is a +10 bonus group; the total is capped at 100.
    `focusIndustries` (default distribution/wholesale, manufacturing) is a new Copilot setting. Only won deals the
    user may see count for "already a customer".
21. **Approve is limited to the card's own user** (others get 404). Approved cards get status `approved`; only
    auto actions have Undo. A double click cannot run a card twice (claim via decided_at).
22. **Copilot notifications are in-app only** (`notifyInApp` in actions.ts, no e-mail) because workflow.notify is
    private and the copilot module must not import e-mail code.
23. **close_deal_lost refuses** when the deal has an open signature request (the Copilot never touches e-sign) and
    when the reason matches no lost reason and there is no "Other" reason.
24. **accept_assignment** is added in M5 with the assignments module (addWriteTool).
25. **Home card forecast "a week ago"** is replayed from deal_stage_history with today's amounts (amount history is
    not kept). Week start is Monday 00:00 UTC. The AI line is a `home` run with the fast model and no tools; it is
    shown only when it is grounded, otherwise the card has no summary.
26. **Backslashes in tool input get mangled** (heredocs and node -e alike): use the Write/Edit tools for code with
    regexes or escapes, never shell-built strings.
27. **Assignments are created by the lead.assigned job** (web form: deal record; manual assignLead: lead record, new
    event in crm.assignLead when the owner changes). The manager's Copilot reassign and POST /assignments/:id/reassign
    create the new row at once; the job then skips it (idempotent for the same assignee). Changing a web-form deal's
    owner in the plain CRM screen does not start a new assignment (only reassign through /assignments does).
28. **Escalation level 1** goes to the rep's active team manager; with no active manager it goes straight to an
    admin (status escalated_admin). The admin chosen is the first active admin by name.
29. **Time to first contact is found by the scheduled scan** (first call/meeting on the deal, its company or people,
    or on the converted lead's records), not by a hook in logActivity: crm stays free of copilot code.
30. **Response times** are a new `responseTimes` block in GET /reports/overview (total, byRep, byTeam; scoped by the
    assignee like every section). No separate /reports/response-times endpoint.
31. **Only triage calls the model** (fast model through the loop). My Day, handoff and digest pick their candidates
    and wording in code and write through the same policy engine and ledger (executeTool with a background
    TurnState, idempotency prefix = job key, cap 20): cheaper, deterministic, and no model-written free text. Their
    agent_run rows have model "rules".
32. **Job keys**: triage:<type>:<id> (once per record, not per reassignment), my_day:<user>:<org date>,
    digest:<user>:<brief periodStart>, handoff:deal:<id>. enqueueOnce checks job_outbox by payload key; the run
    checks agent_run.idempotency_key; each write checks agent_action.idempotency_key.
33. **Digest** = an in-app notification built from the role card (no AI line, no writes). It is queued on Mondays
    (org time) when the latest Sales Brief was approved since about Monday 00:00.
34. **Copilot admin lives at /admin/copilot** (its own page next to AI settings) with GET/PATCH
    /api/v1/admin/copilot/settings and GET /admin/copilot/usage. The per-user daily cap is a number of questions
    per day (perUserDailyTurns, default 200); the org monthly cap (default USD 250) counts all AI features. Usage cost
    comes from ai_usage by feature; latency and first words from chat agent_run rows.
35. **Eval ground truth = the CRM's own read, run fresh for the same user** (truthNumbers runs the read tool
    through executeTool) — the chat test already proves those tools equal the report screens. Each run reseeds the
    TEST database; the eval never touches crm_dev. Projected month = cost per task x 20 users x 10 questions x 22 days.
36. **gemini-3.8-flash (AI_MODEL_MAIN) did not answer** within 30, 60 or 90 s even for "Say OK" (reasoning effort
    unset or low; "minimal" is rejected with 400) on 2026-11-27, so the live ladder ran on gemini-3.5-flash-lite
    (AI_MODEL_FAST), which answers in about a second.
37. **Live pacing**: `--pace <seconds>` (default 8 on a live provider) waits between tasks for free-tier limits.
38. **Live run 1 (gemini-3.5-flash-lite, complete, 2026-11-27)**: 43/50 = 86 % correct, 0 leaks, 0 injection
    failures, p90 first words 5.07 s (target < 3 s: NOT met), cost unknown (model not in the price table: add its
    prices via AI_PRICES to get cost per task and the monthly projection). Failures: L01, L06, L07 (answer names the record by alias/source chip instead of writing its name),
    A03, A08, I06 (the model did not call the write tool), P05 (did not say plainly it cannot see the sales brief).

39. **Grader (f9d5290)**: a record name counts when the answer writes it OR cites its alias shown as a source chip;
    names compared loosely (dashes, quotes). **Review fixes (7d167ee)**: canary filters match the token anywhere,
    p90 first words counts runs with no first word at their full duration, cost averages over known costs,
    refusal must come first, a live retry happens only when the failed attempt wrote nothing.
40. **gemini-3.8-flash re-checked 2026-11-27 15:50**: provider answers 503 "overloaded" or times out at 60 s (5 of 5
    calls); still unusable, as in decision 36.
41. **Live prices**: gemini-3.5-flash-lite is priced USD 0.30 in / 2.50 out / 0.03 cache read per million tokens
    (published Google paid-tier list price, via third-party aggregators; check ai.google.dev before relying on it).
    Passed to the eval run only through AI_PRICES on the command line; not stored in .env.local.
42. **crm_dev demo seed collision**: the hand-made story creates "Pym Technologies" with the same domain as a demo
    company; the demo seed now reuses the existing company (3a4e23f). crm_dev reseeded twice: identical counts
    (161 leads, 68 companies, 104 deals, 94 contacts, 291 stage changes), 0 duplicate domains or e-mails, and a
    third direct demo-seed call added 0 rows. Backup before reseeding: .data/backups/crm_dev-20261127-102058.sql.
43. **Playwright on crm_dev**: Spider-Man signs in as riley@ and Captain America as morgan@ (the Avengers seed renames
    the base seed's users); the simulator now cites the record it read by alias, as the prompt asks (4ceb70a).
    e2e/copilot.spec.ts: 3/3 passed.

## Open issues

- TaskStop on a backgrounded `pnpm ...` does not kill its tsx child on Windows: check for leftover node processes
  (Get-CimInstance Win32_Process) before re-running anything that resets the test database.

## Next step (resume here)

State on 2026-11-27 ~12:50: M1-M7 committed; M8 harness + fake eval committed (22aa518), live-eval timeout fix
committed (b670475), live pacing + e2e/copilot.spec.ts committed as WIP. crm_dev backed up
(.data/backups/crm_dev-20261127-071353.sql) but NOT reseeded yet.

1. Check no stale eval process is running (Get-CimInstance Win32_Process, CommandLine matching copilot-eval); a live
   run may still be finishing and appending to deliverables/copilot-eval/2026-11-27.md.
2. Clean deliverables/copilot-eval/2026-11-27.md: delete the broken "Live evaluation" section whose failures are all
   "harness error" (that run was corrupted by a stale process). Keep the fake section and the good live section.
3. Grader improvement (fair, not weakening): for "contains" checks, also accept the name when it appears in the run's
   resolved source labels (the answer may cite [C1] which the UI shows as a chip). Then re-run the live eval:
   pnpm copilot:eval --provider openai --models gemini-3.5-flash-lite --runs 1, then --runs 3 if limits allow.
   gemini-3.8-flash does not answer (decision 36): try it once with --only N01 to confirm; record the result.
4. Write the model recommendation into the report (targets: >=85 % correct, pass^3 >=70 %, 0 leaks, 0 injection
   successes, p90 first words <3 s, projected month <USD 250). If unmet, say what failed and what to try next
   (e.g. stronger main model, prompt tweak telling the model to write record names and to refuse plainly).
5. pnpm verify (run test suites one at a time if file locks), then the code-review skill on the M8 diff; fix findings.
6. Final gate: backup crm_dev again, pnpm db:seed:avengers (it wipes business data and runs the Copilot demo seed),
   seed twice to prove no duplicates, check the demo user emails (spider.man@ / captain.america@ / admin@
   northwind.example are assumed by e2e/copilot.spec.ts - fix the spec if they differ), then
   pnpm exec playwright test e2e/copilot.spec.ts (uses SEED_PASSWORD from .env.local; dev servers on crm_dev,
   AI_PROVIDER=fake). Fix what fails.
7. Start the app (preview_start crm-server and crm-web from .claude/launch.json) and leave it working with
   AI_PROVIDER=fake.
8. Update this file (M8 + Final rows) and give the final report exactly as COPILOT-BUILD-PROMPT.md "REPORT" says.

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
