# Weekly Report Agents — summary of PR #1

Merged into `main` on 2026-11-25 from `feature/weekly-report-agents` (17 commits). This is the description of that pull request.

## What this adds

**Weekly Report Agents**: the CRM prepares a weekly status PowerPoint for each client company. A person reviews, edits and approves it, then downloads it and sends it. The CRM never sends anything itself.

- **Inputs:** existing CRM data (opportunities, tasks, calls and meetings) plus one estimates (scope) sheet per client, uploaded as CSV. A read-only Google Sheets reader is included but switched off by default (`ESTIMATES_SOURCE=csv`).
- **Pipeline:** collect (as the company owner) → snapshot (write-once, sha256) → match scope rows to tasks (`[S-001]` in the task title) → metrics and health in plain code → AI text with a source for every sentence → checks (2 retries, then placeholders) → draft PowerPoint.
- **Review:** edit, remove or add sentences, regenerate the text, approve (warnings must be acknowledged). Approval creates the final PowerPoint (write-once, sha256).
- **Screens:** Weekly reports card on the company page, Weekly reports list, report page, Settings → Weekly reports (schedule, template).
- **PowerPoint:** template "Default (mock)" with two slide masters, Kensium logo, brand colour, footer, slide number, Arial; 6 slides.
- **Permissions:** `weekly_report.view` and `weekly_report.manage`, scoped own / team / all by company owner; reports outside your scope return 404.
- **Tools:** `pnpm weekly:demo`, `scripts/export-slides.ps1`, `scripts/build-weekly-doc.ts`.

## Database

Two new migrations, both additive: `0007_weekly_reports.sql` (estimate_import, estimate_item, weekly_report_run, organization_settings.weekly_report_settings) and `0008_estimate_source.sql` (client_estimate_source). Run `pnpm db:migrate` after pulling `main`.

## Mocked / not done

- AI text comes from the built-in simulator; no real model has been called.
- The Google Sheets reader has never called Google (tested with a fake connection).
- The slide template is a mock, not the real company template.
- No email delivery, by design.

## Tests

- `pnpm verify`: typecheck, lint, 267 tests in 22 files, build — passing.
- Browser: `e2e/weekly-reports.spec.ts` and `e2e/weekly-workflow-preview.spec.ts` (lead → converted → tasks and meeting → estimates → generate → edit → approve → final PowerPoint → access check, plus error paths) — passing.
- PowerPoint decks exported with Microsoft PowerPoint and checked slide by slide; 7 defects found in QA were fixed (details in `WEEKLY-REPORTS-QA.md`).
- 10 older e2e specs fail on the Marvel demo database because they expect the standard seed data (KNOWN-ISSUES K-51); they were not changed.

## Read first

`WEEKLY-REPORTS-QA.md`, `ARCHITECTURE-DECISIONS.md` (sections G and H), `KNOWN-ISSUES.md` (K-40 to K-51), `LOCAL-SETUP.md` section 10.
