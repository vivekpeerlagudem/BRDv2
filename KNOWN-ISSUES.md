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
