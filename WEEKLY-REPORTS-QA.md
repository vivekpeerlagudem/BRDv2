# Weekly Report Agents — QA and workflow preview (2026-11-25)

Branch `feature/weekly-report-agents`. Everything below was run on this machine against the development database
(`crm_dev`, Marvel demo data) with the AI simulator. Nothing was sent to a real AI model or to Google.

## Environment
- API http://localhost:3000, web http://localhost:5273 (dev servers started by Playwright), Microsoft Edge.
- Microsoft PowerPoint (desktop, Office16) for the slide export.
- AI settings: AI on and "Weekly client report" on during the run; the previous AI settings were restored afterwards.
- Records created: companies named `Preview <timestamp> Acme Retail` and `Preview <timestamp> Fallback Co`, with
  their lead, person, opportunity, tasks, meeting, estimates and reports (one set per run; the spec was run 7 times while it was being written, 4 of them stopped partway).

## How to repeat it
```
pnpm exec playwright test e2e/weekly-workflow-preview.spec.ts     # screenshots + .pptx → demo-preview/weekly/
powershell -ExecutionPolicy Bypass -File scripts/export-slides.ps1 -Path demo-preview\weekly\<final>.pptx
```

## Workflow performed (real screens; what was clicked → what was seen)
1. Sign in as the admin (Tony Stark) → main navigation.
2. Leads → New lead "Preview <ts> – Acme Retail", company "Preview <ts> Acme Retail", email, job title, source, notes
   → "Lead created", status New.
3. Start working → Working. Qualify → Qualified. Convert… → the dialog offers "Create “Preview <ts> Acme Retail”",
   amount 48000 → "Lead converted", status Converted, link "Open opportunity".
4. Open opportunity → Tasks → Add ×4: `[S-001] Run the discovery workshop`, `[S-002] Write the solution design`,
   `[S-003] Build the integration` (due 5 days after the reported week), `[S-004] Set up test environment` (due inside
   the reported week = overdue). Done on S-001 and S-002. Log call / meeting → Meeting, outcome "Agreed the
   integration scope and the test plan".
   **Not through the UI:** the UI stamps "now" on completions and meetings, and the report covers last week. The helper
   `apps/server/src/cli/weekly-preview-backdate.ts` moved the 2 completions to Thursday and the meeting to Wednesday
   of 16–22 Nov 2026 (it accepts only companies named "Preview …" and refuses production).
5. Company page → Weekly reports card: "Generate now" is disabled with "Upload the estimates sheet first".
   Upload a broken CSV → red box "4 problems in the sheet. Nothing was imported." with the four row errors; still
   "No estimates sheet yet". Upload `e2e/fixtures/estimates-sample.csv` → "estimates-sample.csv · 8 scope items · 220 h".
6. Generate now → run appears; `POST /dev/jobs/run` → "Ready for review". Open → report page.
7. Report page: health "Health: needs attention — Some tasks on scope items are overdue"; six tiles; "Points to review"
   with one internal note; four text sections with source chips; scope progress by phase. Clicking the chip
   "S-001 · Requirements workshop and sign-off" opens the opportunity that holds the task.
8. Edit the first summary sentence → Save → label "Edited". Download draft (.pptx, 208,943 bytes). Approve → dialog →
   Approve report → green "Approved by Tony Stark …". Download final (.pptx, 204,105 bytes).
9. Sidebar → Weekly reports → tab Approved → the report is listed. Settings → Weekly reports → schedule (on, Monday,
   09:00, America/New_York) and "Template: Default (mock)".
10. Sign in as the salesperson (Spider-Man, does not own the company) → the report URL shows "This record does not
    exist or you do not have access to it."; their Weekly reports list does not contain it; the API answers 404.

## Numbers in the report, checked against the data created
Estimates sheet: 8 rows, 16+24+40+32+48+24+16+20 = **220 h**. CRM: S-001 and S-002 completed last week, S-003 open,
S-004 open and overdue, 1 meeting last week.

| Figure | Shown | Expected | Match |
|---|---|---|---|
| Health | amber ("needs attention"), reason: overdue tasks | 1 overdue task on a scope item (1–3 = amber) | yes |
| E-01 Scope items | 8 | 8 rows | yes |
| E-02 Total estimated hours | 220 | 220 | yes |
| E-03 Scope items completed | 2 | S-001, S-002 | yes |
| E-04 Estimated hours completed | 40 | 16 + 24 | yes |
| E-05 Complete by estimate | 18.2 % | 40 / 220 = 0.1818… → 18.2 % | yes |
| E-06 Completed this week | 2 | both completed inside 16–22 Nov | yes |
| E-07 Remaining estimated hours | 180 | 220 − 40 | yes |
| E-08 In progress | 1 | S-003 (open task). S-004 has an open task but the sheet says "Not started", so by the matching rule it is planned, not in progress | yes (by design) |
| A-01 Calls and meetings this week | 1 | the meeting | yes |
| A-02 Tasks due in the next 7 days | 1 | S-003 | yes |
| E-09 Actual vs estimate on completed items | 3.1 % | S-001: 16.5 / 16 = +3.1 % (below the 5 % warning) | yes |
| E-10 Overdue tasks on scope items | 1 | S-004 | yes |
| E-11 Rows without a CRM task (internal) | 4 | S-005…S-008 | yes |
| E-12 Sheet/CRM mismatches (internal) | 1 | S-002: sheet "In progress", CRM done | yes |

Scope progress by phase: Discovery 2 items, 40 h, 40 h done, 100.0 % · Build 3 / 120 / 0 / 0.0 % · Test 2 / 40 / 0 /
0.0 % · Launch 1 / 20 / 0 / 0.0 %. The same figures are on the report page, in the API and on slides 2 and 3.

## Report text (final, approved) with sources
| Section | Text | Written by | Sources |
|---|---|---|---|
| Summary | Preview <ts>: the team and Acme Retail agreed the integration scope and the test plan. | person (edited) | Scope items completed this week: 2; Complete by estimate: 18.2 (kept from the replaced AI sentence) |
| Summary | 180 estimated hours remain, with 1 scope item currently in progress. | AI simulator | Remaining estimated hours: 180; Scope items in progress: 1 |
| Completed | We completed Requirements workshop and sign-off. | AI simulator | S-001 · Requirements workshop and sign-off → opportunity |
| Completed | We completed Solution design document. | AI simulator | S-002 · Solution design document → opportunity |
| Next week | We will continue work on ERP connector for orders. | AI simulator | S-003 · ERP connector for orders → opportunity |
| Next week | We plan to start Inventory sync service. | AI simulator | S-004 · Inventory sync service → opportunity |
| Next week | We plan to start Customer portal pages. | AI simulator | S-005 · Customer portal pages (no CRM task, no link) |
| Risks | 1 task is overdue on scope items and we are prioritising it. | AI simulator | Overdue tasks on scope items: 1 |

Internal note on the page only (never on slides): "1 scope row differs between the sheet and the CRM; the CRM status
was used".

## PowerPoint preview (final deck, exported with PowerPoint)
`scripts/export-slides.ps1`: PowerPoint COM, `Presentations.Open(path, ReadOnly, , WithWindow = false)`, each slide
`Export(png, "PNG", 1920, 1080)`. The file opened without a repair prompt (a damaged file would fail at `Open`).

| Slide | What is on it | Problems found | Fixed |
|---|---|---|---|
| 1 Title | Brand-blue background, white Kensium logo, client name, "Weekly status report", "16–22 Nov 2026", "Kensium", footer "Kensium — Confidential", slide number | none | — |
| 2 Summary | Header bar with title and logo; client · week; amber badge "Needs attention" + reason; 2 summary sentences; 4 KPI tiles (18.2 %, 2, 180 h, 1); footer; number | none; tiles have empty space under the value when there is no week-over-week change (first report) | no (cosmetic) |
| 3 Scope progress | Phase table (4 rows) and bar chart "% complete by phase" | title and table text had stretched letters | yes |
| 4 Completed this week | 2 sentences; list "Completed items" (S-001, S-002) | title had stretched letters | yes |
| 5 Next week | 3 sentences; list "In progress and coming up" | the list showed a raw CRM task with its internal tag, "[S-003] Build the integration (due 2026-11-27)", which also repeated S-003 | yes: now only "S-003 · ERP connector for orders" |
| 6 Risks & support needed | 1 sentence | "…1 task is overdue… prioritising them" (grammar) | yes: "…prioritising it." |

Checked on every slide after the fixes: logo visible, brand colour, footer and slide number, no overlapping or cut-off
text, chart readable, numbers equal to the report page, no "DRAFT" on the final deck (the draft deck has
"DRAFT – not approved" on all 6 slides), none of `scope:`, `task:`, `metric:`, `mismatch`, `unmatched`, `E-11`,
`tracking`, `[S-`. Slides 4–6 are mostly empty below the text with this little content (layout of the mock template).

## Error paths
| Case | Expected | Actual |
|---|---|---|
| Generate now without estimates | refused with an explanation | UI: button disabled, "Upload the estimates sheet first". API: 422 `NO_ESTIMATES` "Upload the estimates sheet for this company first" |
| Broken CSV | nothing imported, row errors shown | "4 problems in the sheet. Nothing was imported." + Row 2 Estimate hours, Row 3 Task, Row 3 Status, Row 4 Estimate hours |
| AI feature switched off | report still produced, placeholders, cannot be approved until written | status "Needs attention", "AI fallback", 4 placeholders, Approve disabled, "Must fix: No AI text: AI is switched off for weekly reports. Write the text yourself, or regenerate." After writing the 4 sentences → Approve enabled → approved |
| Second Generate now while one is running | 409 | UI: button disabled while a run is queued. API: 409 `WEEKLY_REPORT_IN_PROGRESS` "A report for this week is already being generated" |
| Approve from a stale page | conflict | API with the old `rowVersion`: 409 `CONCURRENT_MODIFICATION` "This report changed since you opened it" (tested through the API, not by clicking in a second tab) |
| Salesperson who does not own the company | not found | page "This record does not exist or you do not have access to it.", API 404, not in their list |

## Bugs found and fixed
| # | Symptom | Cause | Fix | Test |
|---|---|---|---|---|
| 1 | Source chips on the report page could not be clicked (scope rows), and task chips opened the general task list | scope sources had no link; task sources were hard-coded to `/tasks` | the snapshot now stores which record a task belongs to; scope and task sources link to that opportunity / company / person (`taskLink`, `sourceIndex`) | integration test (link format, never `/tasks`); preview spec clicks a chip |
| 2 | Stretched letters on slides 3 and 4 in PowerPoint | the deck named the font "Inter", which is not installed with PowerPoint; the substitute kept Inter's spacing on some slides | template font is now Arial | `deck-unit.test.ts` |
| 3 | Slide 5 showed "[S-003] Build the integration (due 2026-11-27)": internal tag, ISO date, and a duplicate of S-003 | upcoming CRM tasks were listed with their raw title | tag removed, date as "27 Nov", tasks of items already listed as in progress are skipped | `deck-unit.test.ts` |
| 4 | "Ready for review" and "Needs attention" side by side on a report | the amber health badge had the same words as the report status "Needs attention" | health badges read "Health: on track / needs attention / at risk" | preview spec |
| 5 | Reviewer message showed an error code: "The AI text could not be used (AI_DISABLED)" | the code was put into the message | plain-word reasons (`fallbackMessage`) | `weekly-narrative-unit.test.ts`; 2 integration assertions updated to the exact new message |
| 6 | "1 task is overdue … prioritising them" | simulator text had no singular form | "it" / "them" | `weekly-narrative-unit.test.ts` |
| 7 | "1 scope row(s) differ", "4 problem(s)" | no singular/plural | proper singular and plural | seen in the preview run |

## Issues outside this feature (not changed)
- Company page, Opportunities card: a long opportunity name pushes the amount out of the card ("$4…" is cut off).
- Converting a lead uses the lead's name as the person's name, so a lead called "Preview … – Acme Retail" becomes a
  person with that name.
- Completing a task or logging a meeting always records the current time; there is no way to enter work done earlier,
  which is why the preview needs the backdating helper.
- 10 older e2e specs fail on the Marvel demo database (KNOWN-ISSUES K-51).

## Still not verified
- A real AI model (text quality, cost, latency) and a live Google Sheets read.
- The automatic Monday run on the real clock (covered by integration tests with a controlled clock only), and the
  in-app notification in the browser.
- PowerPoint on macOS, PowerPoint Online, Keynote, Google Slides; printing; very long client names or many phases
  (overflow) in the real PowerPoint.
- "Regenerate" and "Add sentence" in the browser (covered by integration tests, not by this preview).
- Stale-page approval by clicking in two browser tabs (tested through the API).
- The public tunnel build was not clicked through.

## Test results (2026-11-25)
- `pnpm verify`: exit 0 — Biome 153 files (3 older warnings), **267 tests in 22 files passed**, web and server build done. The run before it failed to load one unrelated test file (`imports.integration.test.ts`: "EBUSY: resource busy or locked" on a file in `node_modules`, the OneDrive folder issue K-26); the rerun passed.
- `e2e/weekly-workflow-preview.spec.ts`: 2 passed. `e2e/weekly-reports.spec.ts`: 1 passed. (`3 passed (1.3m)` when run together.)
- The full `pnpm test:e2e` was not run again (see K-51).
