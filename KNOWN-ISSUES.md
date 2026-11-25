# Known issues and limitations

Last updated: 2026-11-18. Scope gaps per requirement are in REQUIREMENT-TRACEABILITY.md; this file lists what would surprise someone using or extending the build.

## Not production-ready
| # | Issue | Impact | What is needed |
|---|---|---|---|
| K-01 | E-signature is a simulator | Signed documents and certificates are placeholders with no legal value | Real provider (OD-03) |
| K-02 | No real email is sent | Users get in-app alerts only; buyers receive nothing automatically | Email provider (OD-14) |
| K-03 | AI runs on the built-in mock unless a real provider is configured | All five AI features work end to end, but the text is template output and says nothing about real model quality | `AI_PROVIDER=anthropic`, an API key, owner approval for paid calls (OD-05) |
| K-04 | No multi-factor or Google/Microsoft sign-in | Password-only accounts | BR-PLT-003/004 |
| K-05 | No password reset or change-password screen | An Admin must create a new account or the password must be changed in the database | Build the flow (needs email) |
| K-06 | Local-only secrets and storage | Encryption key and files live on this machine | Managed key service and cloud storage |
| K-07 | No production deployment, backup or monitoring set-up | Local development only | Hosting decision (OD-11) |
| K-08 | No independent security review or load test has been run | Security controls are covered by the automated tests listed in the traceability file, nothing more | Review before any real use |

## Functional gaps a user will notice
| # | Issue |
|---|---|
| K-10 | Companies, contacts and deal details cannot be edited or archived from the screens (the API supports it) |
| K-11 | No screens for: organization settings, pipeline stages, lost reasons, teams, audit log, notification preferences |
| K-12 | Web pages treat most API responses as untyped data; a server field rename would not be caught by the type checker |
| K-13 | Proposal text is plain text — no formatting, images or content-block library |
| K-14 | Proposal validity date cannot be changed; proposals cannot be copied to another deal |
| K-15 | Reports cover a fixed 90-day window with no filters or CSV export |
| K-16 | Lists load at most 100 rows; there is no paging control |
| K-17 | Data import, custom fields, multiple pipelines, bulk edit and saved views are not built |
| K-18 | The buyer page has not been checked on a phone or with a screen reader; no accessibility audit has been run on any screen |
| K-19 | In-app alerts refresh by polling (up to 30 seconds late) |

## Technical notes
| # | Issue |
|---|---|
| K-20 | Browser tests add `E2E …` companies, contacts, deals and leads to the development database on every run and do not remove them |
| K-21 | Browser tests need about 10 extra seconds when the sign-in rate limit is hit; the helper waits and retries |
| K-22 | The integration test file is one long ordered scenario; a failure early on fails the later steps too |
| K-23 | Approved documents still refer to `docs/02-hld/`; the HLD now sits in `docs/03-tld/02-hld/` |
| K-24 | PDF and DOCX are produced from the same data but were not compared visually; the PDF check in tests confirms a real PDF is produced, not its layout |
| K-25 | The separate worker process (`pnpm dev:worker`) exists but was never run in this build |
| K-26 | The project folder is inside OneDrive: installs are slow and files can be locked during sync |

## AI layer
| # | Issue |
|---|---|
| K-30 | The Anthropic driver has never made a live call. Its request shape and parsing are tested against fixtures written from the SDK types; a first real call may still surface a parameter the provider rejects |
| K-31 | No evaluation set, quality gate or prompt tuning exists (ADR-044). Prompts are first drafts that have never been read by a real model |
| K-32 | AI review categories "date conflict", "contradiction", "company name" and "product reference" are never produced by the mock, so only the plumbing for them is tested |
| K-33 | Answers are not streamed; the user waits for the whole response. Fine on the mock, possibly 10–40 seconds on a real model |
| K-34 | Cost figures are estimates from a price table in code (`modules/ai/engine.ts`), not provider invoices; simulator requests show no cost |
| K-35 | The monthly budget stops new requests once reached; there is no warning at 80 % |
| K-36 | Suggestions left undecided are not discarded automatically. An undecided section draft or rewrite blocks sending until the user accepts or rejects it (the editor shows it again after a reload) |
| K-37 | Linked emails and meetings are not part of AI context because mailbox integration is not built |
| K-38 | Refusals from the provider are shown to the user as "declined"; the provider's automatic fallback to another model is not enabled |
| K-39 | The AI browser tests temporarily raise the daily AI limit in the development database and restore the previous AI settings afterwards; if a run is killed midway the settings can be left changed (check **AI settings**) |

## Weekly reports
| # | Issue |
|---|---|
| K-40 | The Google Sheets reader has never called Google. Token exchange, request shape and error mapping are tested with a fake `fetch` and a throw-away key; a first real call may still surface a difference (sharing, API not enabled, range format) |
| K-41 | Report text comes from the AI simulator. It says nothing about what a real model would write; prompt `weekly_report/v1` has never been read by a real model and there is no evaluation set |
| K-42 | The AI call for a report counts against the company owner's per-user daily AI limit. An owner with many clients can reach the limit on Monday morning; the remaining reports then fall back to placeholder text that a person must write |
| K-43 | One schedule (weekday and time) for the whole organization. No per-client or per-owner schedule, and no per-client switch to skip a week |
| K-44 | Reports are not emailed, by design: a person downloads the approved PowerPoint and sends it. The only message is an in-app notification to the company owner when a scheduled draft is ready |
| K-45 | The PowerPoint files were checked by reading their contents in tests (slide count, texts, draft label), not by opening them in PowerPoint. Layout, fonts (Inter is named; PowerPoint substitutes where it is not installed) and overflow of long text have not been checked visually |
| K-46 | The slide design is a plain built-in layout; the real Kensium template is not used |
| K-47 | Progress comes from CRM tasks matched to scope rows by `[scope id]` in the task title or an identical title. Scope rows without a matching task count as not started; there is no screen to match them by hand |
| K-48 | Each Google sync and each CSV upload stores a full new import; old imports are kept and never cleaned up |
| K-49 | A linked Google Sheet cannot be unlinked in the UI (link a different sheet, or switch `ESTIMATES_SOURCE` back to `csv`) |
| K-50 | The weekly-report browser test switches the weekly-report AI feature on in the development database and restores the previous AI settings afterwards; if a run is killed midway the settings can be left changed (same as K-39) |
| K-51 | Older e2e specs expect the standard `pnpm db:seed` data; run them on a freshly seeded database, not the Marvel demo. On the Marvel demo database 10 of them fail (renamed users, no "Services proposal" template); `e2e/weekly-reports.spec.ts` passes on both |
| K-52 | Running the e2e specs against `crm_dev` adds test records ("E2E …", "Preview …") to the demo data again. Run them on `crm_test`, or run `pnpm db:seed:avengers` afterwards to get the clean demo back |

## Weekly sales brief
| # | Issue |
|---|---|
| K-60 | The analysis text comes from the AI simulator; prompt `sales_brief/v1` has never been read by a real model. Real quality, cost and speed are unknown |
| K-61 | The Google Sheets publisher has never called Google (tested with a fake `fetch`). It rewrites whole tabs and does not format the Google Sheet |
| K-62 | Sentences written by the simulator show money as stored ("37000.00 USD"); tables and tiles show "USD 37,000". Numbers in text must be copied exactly from the facts |
| K-63 | Open pipeline and deals needing attention are "as of now", not as of the end of the reported week; a brief generated later for the same week shows the current pipeline |
| K-64 | Sales velocity uses quarter-to-date averages; early in a quarter it is empty or based on very few deals |
| K-65 | Completed tasks count for the person a task is assigned to, as on the Reports page |
| K-66 | "Proposals sent but not viewed" is covered by unit tests only; the demo data has no such proposal |
| K-67 | The run-as admin's daily AI limit applies; one brief uses 1 to 3 AI calls |
| K-68 | Chart axis numbers follow the PC's regional format when PowerPoint renders them (for example 1,40,000) |
| K-69 | The sales brief is not emailed: admins get an in-app notification and download the files |
