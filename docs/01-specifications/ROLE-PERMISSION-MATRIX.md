# Role and Permission Matrix — Internal Sales CRM (Phase 1)

| Item | Detail |
|---|---|
| Document | ROLE-PERMISSION-MATRIX.md — **authoritative** permission definition (foundation §8) |
| Applies to | BRD v2.0 BR-PLT-005 and §9.17, single-company internal deployment (IDD-01..IDD-16) |
| Binding inputs | Foundation §4 (OD-31, OD-32, OD-26, OD-30, OD-17..OD-25), §6 ADR-006, §8; DOMAIN-MODEL.md |
| Implementation rule | The matrix in §3 is encoded once in `packages/shared` (permission keys, role grants, scopes, flags) and consumed by the backend policy module **and** the frontend (`/api/v1/me/permissions`) — ADR-006. The backend is the only enforcement point; the frontend uses it for display only. |
| Status | Draft for review |

Source column values: a BR-ID, `§9.17` (BRD permission table), an `OD-NN` working assumption, an `IDD-NN` decision, or **Derived — pending confirmation** (abbreviated **DPC**).

---

## 1. BRD §9.17 Permissions (verbatim)

| Action | Admin | Sales Manager | Salesperson |
|---|---|---|---|
| Manage users, teams, billing, organization settings | ✓ | – | – |
| Configure pipelines, custom fields, automation, lead forms | ✓ | – | – |
| Import data, export all data | ✓ | – | – |
| Manage templates, content library, product catalog | ✓ | Optional (set by Admin) | – |
| View and edit records | All | Own team | Own; others' records view-only if allowed by Admin |
| Reassign deals | All | Within team | – |
| Create and send proposals, request signatures | ✓ | ✓ | Own deals |
| Revoke links, void signature requests | All | Own team | Own deals |
| View dashboards | Whole organization | Own team | Own performance |
| Turn AI features on or off | ✓ | – | – |

(Cell text reproduced verbatim from BRD §9.17; only a Markdown header separator row was added for rendering.)

Interpretation notes on the verbatim table:
- "billing" is out of scope (IDD-03); see PERM-017.
- "✓" for Sales Manager under "Create and send proposals, request signatures" is interpreted as **Team** scope (deals within the manager's edit scope), consistent with "View and edit records: Own team" (DPC).
- "✓" for Admin on record-bound actions means **All**.

---

## 2. Scope and value definitions

### 2.1 Cell values
| Value | Meaning |
|---|---|
| **All** | Every record of that type. |
| **Team** | Records whose owner ∈ TeamScope(user) (§2.2). |
| **Own** | Records whose owner = user; for child records, the owner of the visibility root (§4). |
| **Own + VO** | Own; plus **view-only** on all other records of that object type when `salespersonCrossVisibility.<objectType> = view_only` (OD-31). |
| **Assoc-R** | Read-only access to a company/contact because it is associated with a deal the user can edit (§4.4, DPC). |
| **✓** | Capability granted (not record-bound). |
| **Flag** | Granted to a Sales Manager only when the Admin-set flag is on: `canManageContent` (templates, content library, product catalog; §9.17 "Optional") or `canManageSharedEmailTemplates` (OD-31). |
| **Self** | Only the user's own user-level object (own profile, mailbox, preferences, personal templates, own tasks as assignee). |
| **–** | Denied. |
| **N/A** | Not provided in this deployment. |

### 2.2 Scope sets (precise)
```
OwnScope(u)        = { u }
TeamScope(u)       = { u } ∪ { m | TeamMembership(m, t) (active or inactive(*)) ∧ TeamManager(u, t) }
                         ∪ { c | TeamManager(c, t) ∧ TeamManager(u, t) }      -- co-managers (§12 R7)
AllScope           = every user id
ViewOnlyScope(u,T) = AllScope if role(u) = salesperson ∧ orgSettings.salespersonCrossVisibility[T] = view_only, else ∅
(*) a deactivated user's membership is retained and flagged inactive, so their records stay in the team scope (§12 resolution R7, OD-32)
```
- A Sales Manager's own records are included in "own team" (OD-31).
- Co-managers: manager A sees (and, within write scope, edits) the records owned by every co-manager B of a team A manages, even when B is not a member (§12 resolution R7, OD-32). Records of other teams B manages but A does not are not included.
- A user who is a member of a team but not its manager gets no team visibility from that membership.
- Admin scope is always All; Admins are not affected by team membership.

### 2.3 Read vs write scope
| Role | Read scope (records) | Write scope (records) |
|---|---|---|
| Admin | All | All |
| Sales Manager | TeamScope | TeamScope |
| Salesperson | OwnScope ∪ ViewOnlyScope ∪ Assoc-R | OwnScope |

Assoc-R (§4.4) applies to every role: whoever can view a deal can view (read-only) its company and deal contacts (§12 resolution R6).

"View-only means read-only": a view-only user cannot add notes, tasks, links, stakeholders or proposals on records outside their write scope (OD-31). Access history is the exception: anyone who can view the deal can view it (OD-31).

---

## 3. Derived permission matrix

### 3.1 Users, teams, organization settings (PLT)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-001 | Invite user (email + role + team) | ✓ | – | – | Capability | §9.17, BR-PLT-002, IDD-02 | Invitation token hashed; audit `user.invited` |
| PERM-002 | Revoke / resend invitation | ✓ | – | – | Capability | §9.17, DPC | Audit |
| PERM-003 | Change a user's role | ✓ | – | – | Not on self; ≥ 1 active Admin must remain | §9.17, BR-PLT-005 | Invalidate user's permission cache + sessions refresh; audit |
| PERM-004 | Grant/revoke Sales Manager content flag (`canManageContent`) | ✓ | – | – | Target role must be sales_manager | §9.17 "Optional" | Audit |
| PERM-005 | Grant/revoke shared email template flag (`canManageSharedEmailTemplates`) | ✓ | – | – | Target role sales_manager | OD-31 | Audit |
| PERM-006 | Deactivate / reactivate user | ✓ | – | – | Not on self; reassignment wizard (§6) | BR-PLT-011 | Sessions + OAuth mail tokens revoked; removed from round-robin; audit |
| PERM-007 | Reassign a deactivated (or any) user's records in bulk | ✓ | – | – | All | BR-PLT-011 | Writes owner_changed events per record; audit |
| PERM-008 | Create/edit/archive teams; set members and managers | ✓ | – | – | ≤ 1 team per user; ≥ 1 manager (OD-32) | §9.17, BR-PLT-006 | Invalidate permission caches of affected managers |
| PERM-009 | View user directory (name, email, role, team, status) | ✓ | ✓ | ✓ | All active users (needed for owner/assignee pickers) | DPC | Deactivated users listed only to Admin and in historical displays |
| PERM-010 | Edit own profile (name, title, phone, signature, time zone) | Self | Self | Self | Self | DPC | Role and email not editable by self |
| PERM-011 | Manage own credentials, OAuth links and MFA enrolment | Self | Self | Self | Self | BR-PLT-003, BR-PLT-004 | Better Auth flows; audit sign-in method changes |
| PERM-012 | Set login methods, allowed domains, MFA policy | ✓ | – | – | Capability | OD-12, OD-13, BR-PLT-004 | Must keep ≥ 1 login method; audit |
| PERM-013 | Edit organization settings (name, branding, currency list, time zone, fiscal year, defaults) | ✓ | – | – | Capability | §9.17, BR-PLT-012, BR-TPL-006 | Default currency locked once deals exist (DPC); audit |
| PERM-014 | Read organization settings (non-secret) | ✓ | ✓ | ✓ | Capability | DPC | Secrets never returned |
| PERM-015 | Set salesperson cross-visibility (view-only per companies/contacts/deals) | ✓ | – | – | Capability | §9.17, OD-31 | Invalidate all salesperson permission caches; audit |
| PERM-016 | Configure retention policies | ✓ | – | – | Within platform limits; exempt categories fixed | NFR-015, OD-36 | Audit |
| PERM-017 | Billing, plans, seats, payment | N/A | N/A | N/A | Out of scope | IDD-03 | Not implemented |
| PERM-018 | Execute governed erasure of a contact | ✓ | – | – | All | NFR-002, OD-36 | Two-step confirmation; signed documents/certificates/audit exempt; audit `erasure.completed` |
| PERM-019 | View setup (onboarding) checklist | ✓ (admin items) | Self items | Self items | Self | BR-PLT-008, IDD-04 | Items computed from data |

### 3.2 Pipelines and configuration lists (CRM, PRC)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-020 | Create/edit/archive pipelines | ✓ | – | – | Capability | §9.17, BR-CRM-005, BR-CRM-006 | Archive blocked with open deals |
| PERM-021 | Configure open stages, order, probabilities, stall thresholds | ✓ | – | – | System won/lost stages fixed | §9.17, BR-CRM-005, BR-AUT-005 | Stage with deals archived only after moving deals |
| PERM-022 | Create/edit/archive custom field definitions | ✓ | – | – | dataType immutable once values exist | §9.17, BR-CRM-007 | Archive keeps values; templates flagged (BR-TPL-008) |
| PERM-023 | Manage lost reasons list | ✓ | – | – | Capability | BR-CRM-014, OD-31 | Archive, not delete |
| PERM-024 | Manage contact roles list | ✓ | – | – | "Forwarded viewer" system role not deletable | OD-34 | — |
| PERM-025 | Manage exchange rates | ✓ | – | – | Capability | OD-15 | Audit |
| PERM-026 | View exchange rates | ✓ | ✓ | ✓ | Capability | OD-15, DPC | — |
| PERM-027 | Manage tax categories | ✓ | – | – | Capability | BR-PRC-001, DPC (not delegated with catalog flag) | Archive only |
| PERM-028 | Manage discount limits per role | ✓ | – | – | Capability | BR-PRC-007, OD-31, OD-39 | — |

### 3.3 Import and export (MIG, PLT-010)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-029 | Upload, map, validate and commit CSV/Excel import | ✓ | – | – | All | §9.17, BR-MIG-001, BR-MIG-004 | `Idempotency-Key` on commit; audit `import.committed` |
| PERM-030 | Import HubSpot/Pipedrive exports | ✓ | – | – | All | BR-MIG-002, OD-09 | As PERM-029 |
| PERM-031 | Resolve duplicates (skip/merge/create) during import | ✓ | – | – | All | BR-MIG-003 | Merge snapshots stored for undo |
| PERM-032 | Undo an import batch | ✓ | – | – | All | BR-MIG-005 | Rules in DOMAIN-MODEL §6.3 |
| PERM-033 | View import history and error reports | ✓ | – | – | All | BR-MIG-004 | Raw files contain personal data — Admin only |
| PERM-034 | Upload DOCX as a template starting point | ✓ | – | – | Capability | BR-MIG-006 ("Admins"), §12 R8 | Admin-only, also for Managers with `canManageContent` (§12 resolution R8) |
| PERM-035 | Start full organization data export and download it | ✓ | – | – | All | §9.17, BR-PLT-010, IDD-12 | Signed URL, short expiry; private email bodies excluded (OD-30); audit |
| PERM-036 | API import from HubSpot/Pipedrive | ✓ | – | – | All | BR-MIG-007 (Could), OD-09 | Deferred |

### 3.4 Companies, contacts, deals (CRM)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-037 | Create company | ✓ | ✓ | ✓ | Owner = creator by default; Admin any owner; Manager owner ∈ TeamScope; Salesperson owner = self | BR-CRM-001, DPC (owner rule) | Duplicate check on normalised domain/name (OD-27) |
| PERM-038 | View company | All | Team | Own + VO + Assoc-R | Read scope (§2.3) | §9.17, BR-CRM-001, OD-31 | Repository query scoping; 404 (not 403) outside scope |
| PERM-039 | Edit company (standard + custom fields) | All | Team | Own | Write scope | §9.17, BR-CRM-001 | rowVersion check |
| PERM-040 | Archive / restore company | All | Team | Own | Blocked while open deals exist | BR-CRM-001 | Audit |
| PERM-041 | Change company owner | All | Team (new owner ∈ TeamScope) | – | Reassign rule extended to companies | §9.17 (deals), OD-31, DPC | Audit; event `company.owner_changed` |
| PERM-042 | Create contact | ✓ | ✓ | ✓ | As PERM-037 | BR-CRM-002 | Duplicate check normalised email (OD-27) |
| PERM-043 | View contact | All | Team | Own + VO + Assoc-R | Read scope | §9.17, BR-CRM-002, OD-31 | Query scoping |
| PERM-044 | Edit contact; set primary company | All | Team | Own | Write scope; company must be readable by user | BR-CRM-002, OD-33 | rowVersion |
| PERM-045 | Archive / restore contact | All | Team | Own | Blocked while signer on open signature request | BR-CRM-002, DPC | Audit |
| PERM-046 | Change contact owner | All | Team | – | As PERM-041 | OD-31, DPC | Audit |
| PERM-047 | Merge duplicate companies/contacts outside import | ✓ | – | – | All | DPC (BR-MIG-003 covers import only) | Audit with before snapshots |
| PERM-048 | Create deal | ✓ | ✓ | ✓ | Owner rule as PERM-037; company must be readable by user | BR-CRM-003 | — |
| PERM-049 | View deal (incl. board, list, detail) | All | Team | Own + VO | Read scope | §9.17, BR-CRM-003, BR-CRM-011 | Query scoping; board columns filtered |
| PERM-050 | Edit open deal fields (name, amount, close date, currency, custom fields) | All | Team | Own | Write scope; currency/company locks (DOMAIN-MODEL §5.3) | §9.17, BR-CRM-003 | rowVersion |
| PERM-051 | Move deal between open stages (incl. board drag, pipeline change) | All | Team | Own | Write scope | BR-CRM-003, BR-CRM-011 | Writes DealStageHistory + timeline |
| PERM-052 | Close deal as Won manually | All | Team | Own | Write scope; closeDate required | BR-CRM-003, DPC | Prompt to void other open proposals (DPC) |
| PERM-053 | Close deal as Lost (lost reason required) | All | Team | Own | Write scope; open signature request voided after confirmation | BR-CRM-014, Foundation §9 | Validation error if no reason |
| PERM-054 | Edit a closed (won/lost) deal | All | Team | Own | Owner, team manager or Admin | OD-31 | Audit of every change on closed deals |
| PERM-055 | Reopen a closed deal (reason required) | All | Team | Own | Same as PERM-054 | OD-31 | Reason stored in DealStageHistory; audit |
| PERM-056 | Archive / restore deal | All | Team | Own | Blocked while open signature request (DPC) | ADR-005, DPC | Audit |
| PERM-057 | Reassign deal owner | All | Team (new owner ∈ TeamScope) | – | §9.17 "Within team" = both current and new owner ∈ TeamScope | §9.17, BR-CRM-004, OD-31 | Notifications retarget to new owner; audit |
| PERM-058 | Add/remove deal contacts and roles (stakeholders) | All | Team | Own | Write scope on deal; contact readable | BR-CRM-003, OD-34 | Cannot remove a signer on an open request |
| PERM-059 | Bulk edit records | All | Team | Own | Each record checked individually; partial failures reported | BR-CRM-013 | Max batch size (DPC: 500); one audit entry per record |
| PERM-060 | Bulk reassign records | All | Team | – | As PERM-057 per record | BR-CRM-013, OD-31 | As PERM-059 |
| PERM-061 | Create/edit/delete personal saved views | Self | Self | Self | Self | BR-CRM-011 | Views never widen scope |
| PERM-062 | Share saved view to team / organization | ✓ (org or team) | ✓ (managed teams) | – | Shared views filter by viewer's own scope | DPC | — |
| PERM-063 | Global search (companies, contacts, deals, proposals) | All | Team | Own + VO + Assoc-R | Results filtered by read scope | BR-CRM-012 | Scope predicate applied in SQL, not post-filtered |
| PERM-064 | Hard delete companies/contacts/deals | – | – | – | Only via PERM-018 or PERM-032 | ADR-005, OD-36 | No delete endpoint |

### 3.5 Tasks, notes, activity logs, My Day (CRM)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-065 | Create task on a record | All | Team | Own | Write scope on the related record (view-only ≠ write, OD-31) | BR-CRM-008, OD-31 | — |
| PERM-066 | Assign task to another user | Any active user | Users in TeamScope | Self only | Assignee must be able to read the related record (DPC) | DPC | — |
| PERM-067 | View task | All | Team | Own + assigned-to-self | Inherits related record; assignee always sees own tasks | BR-CRM-008, DPC | — |
| PERM-068 | Edit / complete / cancel / reopen task | All | Team | Own record or assignee | Assignee or write scope on related record | BR-CRM-008 | Automation-created tasks reversible (PERM-129) |
| PERM-069 | Add note | All | Team | Own | Write scope on related record | BR-CRM-010, OD-31 | — |
| PERM-070 | Edit note | Author only | Author only | Author only | Author ∧ write scope | DPC | Audit edits |
| PERM-071 | Delete note | ✓ (any, audited) | Author | Author | — | DPC | Soft delete + audit |
| PERM-072 | Log call / meeting manually | All | Team | Own | Write scope | BR-CRM-010 | — |
| PERM-073 | View My Day | Self | Self | Self | Self (own tasks + own deals needing attention) | BR-CRM-009 | Managers use dashboards for team view (DPC) |

### 3.6 Email and calendar (EML)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-074 | Connect / disconnect own mailbox and calendar | Self | Self | Self | Self only; nobody connects another user's mailbox | BR-EML-001, BR-EML-006 | OAuth tokens encrypted (ADR-012); audit |
| PERM-075 | Manage own sync exclusions (domains, addresses, contacts) | Self | Self | Self | Self | BR-EML-003 | Removes matching stored messages (DPC) |
| PERM-076 | Manage organization-wide sync exclusions | ✓ | – | – | Capability | DPC | Audit |
| PERM-077 | Mark / unmark email or meeting as private | Mailbox owner | Mailbox owner | Mailbox owner | Self (own mailbox items only) | BR-EML-003, OD-30 | Timeline redaction + AI exclusion |
| PERM-078 | View non-private email / meeting content | All linked | Team linked | Own linked + VO + mailbox owner | Visible if user is mailbox owner OR can read any linked record | BR-EML-002, §4 | Query scoping via EmailLink |
| PERM-079 | View private email/meeting **metadata** (date, direction, participants) | All linked | Team linked | Own linked + VO | Same as PERM-078 | OD-30 | Rendered "Private email" |
| PERM-080 | View private email/meeting **subject and body** | Mailbox owner only | Mailbox owner only | Mailbox owner only | Mailbox owner only — Admin included in the restriction | OD-30 | Excluded from AI context, report content, export bodies |
| PERM-081 | Add / remove email or meeting links (correct links) | All | Team | Own | Write scope on the target record AND (mailbox owner OR read on the email) | BR-EML-002, DPC | Audit; timeline re-anchor |
| PERM-082 | Send email from CRM / add-in through own mailbox | Self mailbox | Self mailbox | Self mailbox | Linking to records requires write scope on them | BR-EML-004, NFR-013 | `Idempotency-Key`; never another user's mailbox |
| PERM-083 | Enable open tracking organization-wide | ✓ | – | – | Capability | BR-EML-007, OD-37 | Off by default |
| PERM-084 | Turn on open tracking for one email | Self | Self | Self | Only when org-enabled | BR-EML-007, OD-37 | — |
| PERM-085 | Create/edit/archive personal email templates | Self | Self | Self | Self | OD-31, BR-EML-004 | — |
| PERM-086 | Create/edit/archive shared email templates | ✓ | Flag | – | `canManageSharedEmailTemplates` | OD-31 | Audit |
| PERM-087 | Use email templates | Own + shared | Own + shared | Own + shared | — | BR-EML-004 | Placeholders resolved within user read scope |
| PERM-088 | Use inbox add-in (lookup, create records, send proposals) | Same as web | Same as web | Same as web | Identical policy; bearer token session | BR-EML-005, OD-07 | Add-in endpoints use the same policy module |

### 3.7 Lead capture (LED)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-089 | Create/edit/publish/unpublish/archive lead forms | ✓ | – | – | Capability | §9.17, BR-LED-001 | Audit |
| PERM-090 | Configure assignment rules and pools | ✓ | – | – | Capability | §9.17, BR-LED-002 | Pools contain active users only |
| PERM-091 | Configure spam protection / CAPTCHA keys | ✓ | – | – | Capability | BR-LED-006, OD-46 | Secrets write-only |
| PERM-092 | Configure webhook lead intake | ✓ | – | – | Capability | BR-LED-007 (Could) | Signed secret per endpoint |
| PERM-093 | View lead form submissions | All | Team (resulting records in scope) | Own (resulting records owned) | Inherits resulting record | DPC | Spam-rejected submissions Admin only |
| PERM-094 | Be assigned leads | – (unless in pool) | If in pool | If in pool | Pool membership | BR-LED-002, BR-LED-003 | System actor `lead_intake` performs assignment |

### 3.8 Templates, content library, catalog (TPL, PRC)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-095 | Create/edit template drafts; publish template versions | ✓ | Flag | – | `canManageContent` | §9.17, BR-TPL-001, BR-TPL-004 | Published versions immutable |
| PERM-096 | Mark template sections locked/editable | ✓ | – | – | Capability | BR-TPL-003 ("Admins"), §12 R8 | Admin-only, also for Managers with `canManageContent` (§12 resolution R8). A Flag manager editing a template cannot change a section's lock state or the content of a locked section |
| PERM-097 | Archive / restore template | ✓ | Flag | – | — | §9.17 | Existing proposals unaffected |
| PERM-098 | View and select published templates | ✓ | ✓ | ✓ | All published, active | BR-PRP-001 | — |
| PERM-099 | Create/edit/archive content blocks | ✓ | Flag | – | `canManageContent` | §9.17, BR-TPL-005 | Revision increments |
| PERM-100 | Insert content blocks into a proposal | All | Team | Own | Write scope on the proposal's deal | BR-TPL-005 | Copy + revision recorded |
| PERM-101 | Create/edit/archive products | ✓ | Flag | – | `canManageContent` | §9.17, BR-PRC-001 | Snapshots unaffected |
| PERM-102 | View product catalog | ✓ | ✓ | ✓ | Active products | BR-PRC-001 | — |

### 3.9 Proposals (PRP, PRC)
Visibility root = Deal (§4). "Edit scope" = write scope on the proposal's deal.
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-103 | Create proposal from deal (select template) | All | Team | Own deals | Edit scope on deal | §9.17, BR-PRP-001 | Pins template version |
| PERM-104 | View proposal, versions, totals | All | Team | Own + VO (deals) | Read scope on deal | §9.17, BR-PRP-008 | — |
| PERM-105 | Edit draft version — editable sections, pricing, recipients, validity | All | Team | Own deals | Edit scope; draft only | BR-PRP-003, BR-PRC-002, BR-PRP-009 | Sent versions immutable (BR-SIG-011) |
| PERM-106 | Edit locked sections in a proposal | – | – | – | Nobody, Admin included; change the template | BR-TPL-003, §12 R8 | Server rejects changes to locked blocks |
| PERM-107 | Apply discount above role limit | All (warning) | Team (warning) | Own (warning) | Allowed with recorded warning; no approval | BR-PRC-007, OD-39 | Limit = DiscountLimit for actor's role |
| PERM-108 | Internal preview (exact buyer rendering) | All | Team | Own + VO | Read scope | BR-PRP-004 | Never creates tracking events (ADR-013) |
| PERM-109 | Generate / download PDF and DOCX internally | All | Team | Own + VO | Read scope | BR-PRP-005 | Server-mediated download; audit for sent versions (DPC) |
| PERM-110 | Send version (CRM email / add-in) or mark "link shared manually" | All | Team | Own deals | Edit scope; blocker findings resolved | §9.17, BR-SHR-002, BR-AIA-002 | `Idempotency-Key`; supersede confirmation (OD-21) |
| PERM-111 | Create a new version (from sent/viewed/accepted/declined/expired) | All | Team | Own deals | Edit scope; not from void/signed | BR-PRP-006, Foundation §9 | — |
| PERM-112 | Compare versions | All | Team | Own + VO | Read scope | BR-PRP-006 | — |
| PERM-113 | Copy proposal to another deal | All | Team | Own deals | Read on source deal ∧ edit on target deal | BR-PRP-010 | New proposal, new draft |
| PERM-114 | Void proposal | All | Team | Own deals | Edit scope; non-terminal only | BR-PRP-007, OD-18, DPC (aligned with §9.17 void row) | Voids open signature request; audit |
| PERM-115 | Delete a never-sent draft proposal | All | Team | Own deals | Only if no version was ever sent | DPC | Hard delete allowed (no external trace) |
| PERM-116 | Accept "update deal amount" prompt | All | Team | Own deals | Edit scope on deal | BR-PRC-004, OD-16 | Sets amountSource=proposal |

### 3.10 Sharing and tracking (SHR)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-117 | Choose intended recipients; require email verification | All | Team | Own deals | Edit scope; recipients must be deal contacts with email | BR-SHR-003, BR-SHR-006 | — |
| PERM-118 | Copy a recipient's share link (for manual sharing) | All | Team | Own deals | Edit scope | BR-SHR-001, Foundation §9, §12 R5, §16 S1 (ADR-034 wins) | SHA-256 hash stored for lookup AND the token stored envelope-encrypted (ADR-034), so an existing active link can be copied again at any time without re-issuing; each copy is audited (§12 resolution R5) |
| PERM-119 | Revoke share link | All | Team | Own deals | §9.17 | §9.17, BR-SHR-007 | Irreversible (issue new link); audit |
| PERM-120 | Set / change link expiry | All | Team | Own deals | §9.17 row "Revoke links" applied to expiry | BR-SHR-007 | — |
| PERM-121 | View access history (views, durations, downloads, forwards, responses) | All | Team | Own + VO | Anyone who can view the deal | BR-SHR-008, OD-31 | IP truncated in UI |
| PERM-122 | Add a forwarded viewer as recipient or signer | All | Team | Own deals | Edit scope | OD-26 | — |

### 3.11 E-signature (SIG)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-123 | Request signatures on the current sent version; set signers and order | All | Team | Own deals | Edit scope; signers ∈ deal contacts; ≤ 1 open request per deal | §9.17, BR-SIG-001, BR-SIG-002, OD-23 | `Idempotency-Key` |
| PERM-124 | Require SMS verification on a request | All | Team | Own deals | Only when org allows | BR-SIG-005 | Signer phone required |
| PERM-125 | Void a pending/sent/viewed signature request | All | Team | Own deals | §9.17 | §9.17, BR-SIG-013, OD-18 | Provider void call; audit |
| PERM-126 | Resend / send manual reminder | All | Team | Own deals | Same as PERM-123 | BR-SIG-008 | Rate-limited per signer (DPC) |
| PERM-127 | Set org default reminder schedule and request expiry | ✓ | – | – | Capability | BR-SIG-008, DPC | — |
| PERM-128 | View signing status; download signed PDF and completion certificate | All | Team | Own + VO | Read scope on deal | BR-SIG-009, BR-SIG-010 | Server-mediated download |

### 3.12 Automation (AUT)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-129 | Reverse an automated change | All | Team | Own | Write scope on the affected record | BR-AUT-008, OD-24 | Precondition: fields unchanged since execution; audit |
| PERM-130 | Enable/disable built-in rules; set AUT-001 target stage per pipeline, AUT-004 days | ✓ | – | – | Capability | §9.17, BR-AUT-001, BR-AUT-004 | Audit |
| PERM-131 | Configure custom rules (trigger, condition, action) | ✓ | – | – | Capability | BR-AUT-007 (Could) | Deferred unless capacity |
| PERM-132 | View automation execution history | All | Team (on visible records) | Own (on visible records) | Read scope on target record; full log Admin | BR-AUT-008 | — |

### 3.13 AI (AIA)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-133 | Turn AI on/off (org) and per feature; set AI budgets | ✓ | – | – | Capability | §9.17, BR-AIA-008, IDD-08, IDD-10 | Takes effect immediately; audit |
| PERM-134 | AI draft proposal sections | All | Team | Own deals | Edit scope ∧ feature enabled | BR-AIA-001 | Context = requester's read scope minus private emails (IDD-07, OD-30) |
| PERM-135 | Run AI pre-send check | All | Team | Own deals | Edit scope (also run automatically at send) | BR-AIA-002 | — |
| PERM-136 | AI summary of deal emails and history | All | Team | Own + VO | Read scope ∧ feature enabled | BR-AIA-003 | Private email content never included |
| PERM-137 | AI rewrite selected text | All | Team | Own deals | Edit scope on the edited object | BR-AIA-004 | — |
| PERM-138 | AI follow-up email draft | All | Team | Own deals | Edit scope; sending requires PERM-082 by the user | BR-AIA-005, BR-AIA-006 | AI never sends |
| PERM-139 | Accept / edit / reject AI output | Requester or editor | Requester or editor | Requester or editor | Write scope on target | BR-AIA-007 | Label removed only on acceptance |
| PERM-140 | View AI usage log (all users) | ✓ | – | – | All | BR-AIA-007, NFR-003 | Own usage visible to every user (DPC) |

### 3.14 Notifications (NTF)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-141 | Configure own notification preferences and daily digest | Self | Self | Self | Self | BR-NTF-002, BR-NTF-003 | — |
| PERM-142 | Receive proposal/deal notifications | As deal owner | As deal owner | As deal owner | Recipient = current deal owner (assignee for tasks; assigned user for leads) | BR-NTF-001, BR-LED-003, Foundation §9 | Notification content re-checked against recipient's read scope |
| PERM-143 | Read / mark notifications read | Self | Self | Self | Recipient only | BR-NTF-001 | SSE stream per user |
| PERM-144 | Set organization notification defaults | ✓ | – | – | Capability | DPC | Applies to new users |

### 3.15 Reporting and dashboards (RPT)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-145 | View dashboards (pipeline, won/lost, rep performance, proposals, activity, weighted pipeline, needing attention) | All (whole organization) | Team | Own performance | Deals owned within scope; view-only setting does **not** widen dashboards (DPC) | §9.17, BR-RPT-001..010 | Scope predicate applied in SQL views |
| PERM-146 | Filter dashboards by date, team, owner, pipeline | Any | Teams/owners in TeamScope | Self only | Filters cannot exceed scope | BR-RPT-007, BR-RPT-008 | Out-of-scope filter values rejected (400) |
| PERM-147 | Export report data to CSV | All | Team | Own | Same scope as PERM-145 | BR-RPT-009 | Audit `report.exported` (DPC); private email content excluded |

### 3.16 Timeline and audit (TIM, PLT-009)
| PERM ID | Action | Admin | Sales Manager | Salesperson | Scope rule | Source | Enforcement notes |
|---|---|---|---|---|---|---|---|
| PERM-148 | View deal/company/contact timeline | All | Team | Own + VO + Assoc-R | Each event visible iff its source record is readable; private emails as metadata | BR-TIM-001..004, OD-30 | Filter per event, not only per anchor |
| PERM-149 | Edit or delete timeline entries | – | – | – | Append-only; corrections via source record | ADR-022 | No endpoint |
| PERM-150 | View audit log | ✓ | – | – | All | BR-PLT-009, Foundation §9 (personal data) | Retention per OD-36 |
| PERM-151 | Export audit log | ✓ | – | – | All | BR-PLT-009, DPC | Audit of the export |
| PERM-152 | Edit or delete audit entries | – | – | – | Append-only | NFR-009 | DB grant prevents UPDATE/DELETE (DPC) |

---

## 4. Visibility inheritance and record ownership

### 4.1 Ownership rules
| Record | Owner attribute | Default on create | Allowed owners | Who may change |
|---|---|---|---|---|
| Company | ownerId | Creator; lead assignee (lead form); import mapping / importing Admin default | Active users of any role | PERM-041 |
| Contact | ownerId | As company | Active users | PERM-046 |
| Deal | ownerId (exactly one, BR-CRM-004) | Creator; lead assignee; import mapping | Active users | PERM-057 |
| Task | assigneeId (owner of the task's work) | Creator, or record owner for automation tasks | Active users able to read the related record | PERM-066 |
| Note / ActivityLog | authorId / loggedBy | Creator | — | Never changes |
| Proposal and all children | none — inherits deal owner | — | — | Follows deal reassignment |
| Email / calendar items | mailbox owner | Mailbox user | — | Never changes |
| Personal email template, saved view, preferences | ownerUserId | Creator | — | Never changes |

Ownership constraints: a Salesperson can only create records owned by self; a Sales Manager can set owners within TeamScope; Admin any active user. Owner must be active at assignment time.

### 4.2 Visibility roots (child → parent inheritance)
| Child record | Visibility root | Notes |
|---|---|---|
| DealContact, DealStageHistory, DealFlag | Deal | — |
| Proposal, ProposalVersion, GeneratedFile, AiCheckResult | Deal | Proposal has no owner of its own |
| Recipient, ShareLink, ViewerIdentity, ViewSession, DownloadEvent, BuyerResponse | Deal (via version → proposal) | Access history = read on deal (OD-31) |
| SignatureRequest, Signer, SignatureEvent, SignedDocument | Deal | — |
| Task, Note, ActivityLog | Related record (company, contact or deal) | Task also visible to its assignee |
| EmailMessage, CalendarEvent | Mailbox owner OR any linked record | Private: content to mailbox owner only (OD-30) |
| TimelineEvent | Source record | Shown on an anchor timeline only if the source is readable |
| AutomationExecution | Target record | — |
| AiGeneration | Target record AND requester | Pending outputs visible to requester only (DPC) |
| AiUsage | Requesting user; Admin all | — |
| Notification | Recipient user only | — |
| LeadFormSubmission | Resulting record(s) | Spam-rejected: Admin only |
| ImportBatch / ImportRow | Admin only | — |

### 4.3 Write inheritance
Write on a child requires write scope on its root, plus the state guards of the business rules (e.g. sent versions immutable, closed-deal edit per PERM-054). View-only access never grants writes on children (OD-31).

### 4.4 Associated read (Assoc-R) — §12 resolution R6
A user who can **view** a deal (any read scope, including view-only) can read (not edit) the deal's company and the deal's contacts, and their custom fields, regardless of their owner. A user with write scope on the deal can use those contacts as recipients and signers. Needed for placeholders, recipients and signers. Timelines of those records still filter events by source visibility. Without this rule a salesperson could not send a proposal on their own deal to a contact owned by a colleague (§9 item 1).

---

## 5. Non-human and external actors

### 5.1 System actors (`actorType = system`)
| Component | Authority | Limits | Recorded as |
|---|---|---|---|
| automation | Executes enabled built-in automation rule actions (AUT-001..006, OD-17, OD-23) regardless of any user's role | Only actions in the rule catalogue; precondition re-checked in transaction; optimistic lock; skips on conflict | TimelineEvent `isAutomated=true`, AutomationExecution, AuditLog |
| scheduler | Expiry clocks (OD-22), reminders, task due/overdue, digests, flags, retention | Only state transitions defined in the domain model | Timeline/audit as applicable |
| mail_sync | Creates EmailMessage/CalendarEvent/EmailLink for a mailbox | Only for its own mailbox; respects exclusions (BR-EML-003) and OD-29 | Actor = mailbox owner's connection (system) |
| esign_webhook | Updates the SignatureRequest identified by provider envelope id | HMAC/signature-verified; idempotent by providerEventId; cannot touch other aggregates directly (emits events) | SignatureEvent, audit |
| lead_intake | Creates/matches contacts, companies, deals from a published form; assigns owner | Only fields mapped on the form; fills empty fields only on matches; rate-limited | Submission, timeline, audit |
| import | Executes an Admin-committed batch | Acts with the committing Admin's authority (Admin All) | ImportRecordLink, audit with Admin as initiator |

### 5.2 AI actor (`actorType = ai`)
AI is never an independent principal. Every AI call runs **on behalf of** the requesting user: context reads are limited to that user's read scope minus private email content (IDD-07, OD-30); outputs are stored as pending AiGeneration visible to the requester; content takes effect only when a user with write scope accepts it (PERM-139); AI cannot send, sign, change stages or call any write endpoint (BR-AIA-006). When org AI or the feature is disabled, calls are refused (`blocked_disabled`) and logged.

### 5.3 External actors (no user account)
| Actor | Credential | Allowed | Denied |
|---|---|---|---|
| Recipient (buyer) | Share-link token (one ShareLink → one ProposalVersion), plus email code when `requireEmailVerification` | View the version (branded, mobile), heartbeat tracking, download PDF, accept or decline with reason when `signatureRequired=false` and status ∈ {sent, viewed} and no clock expired (BR-SHR-010, OD-17, OD-22); see "newer version available" banner on superseded version (OD-21) | Any other version, proposal, deal or CRM data; internal ids; other recipients' identities; access after revoke/expiry/void |
| Forwarded viewer | Same token + identity gate (name, email, privacy notice) (BR-SHR-005, OD-26) | View and download only | Accept, decline, sign (unless the user adds them as recipient/signer, PERM-122) |
| Signer | Provider-issued signing session (email verification, optional SMS) (BR-SIG-004, BR-SIG-005) | Consent, view, sign or decline in the provider UI (BR-SIG-006, BR-SIG-012) | Any CRM endpoint; signing a superseded/expired/voided request |
| Email recipient (open tracking) | Pixel token | Increment open counter | Anything else |
| Website visitor | Lead form public key | Submit a published form (spam protection, rate limits) | Reading any data |
| Provider (e-sign, mail) | Webhook signature / OAuth | See §5.1 | — |

Token scope rules: tokens are 32 random bytes, looked up by SHA-256 hash and additionally stored envelope-encrypted so authorised users can copy the link again (ADR-013, ADR-034, §12 R5); every public request re-evaluates link status, proposal status and the three clocks (OD-22) — no cached authorization; responses never include internal user data beyond the owner's display name, email and branding (DPC).

---

## 6. Deactivated owners

| Situation | Rule | Source |
|---|---|---|
| Deactivation precondition | Admin must reassign open deals, open tasks (as assignee) and non-terminal proposals' deals before the user can be deactivated; wizard proposes a target user | BR-PLT-011, Foundation §9 |
| Closed deals, companies, contacts | May stay owned by the deactivated user (history) or be bulk-reassigned (PERM-007) | DPC |
| Visibility of records still owned by a deactivated user | Admin: All. Sales Manager: if the user's (now inactive) membership is in a team they manage — memberships are retained and flagged inactive on deactivation. Salesperson: via view-only setting only. | §12 R7, OD-32 |
| Pending signature requests | Sender of record unchanged; notifications go to the new deal owner | Foundation §9 |
| Mailbox | Sync stopped, tokens revoked; already-synced items keep links and privacy flags; private items stay private (no one else gains content access) | Foundation §9, OD-30 |
| Round-robin | Removed from all assignment pools | Foundation §9 |
| Sessions / add-in tokens | Revoked immediately | ADR-006 |
| Reporting | Historical results stay attributed to the deactivated user; filterable | DPC |
| Reactivation | Restores role and team; does not restore previously reassigned records | DPC |

---

## 7. Permission resolution algorithm (shared definition)

The matrix is data in `packages/shared` (e.g. `PERMISSIONS: Record<PermKey, PermDef>`). Backend and frontend import the same definition. The backend evaluates it for every request (service layer) and for list queries (repository scoping); the frontend evaluates it only from the `/api/v1/me/permissions` payload plus the `allowedActions` returned on each resource (computed server-side by the same function). Pseudo-code (design specification, not application code):

```
PermDef {
  key: PermKey                      // e.g. "deal.reassign" ↔ PERM-057
  recordType?: RecordType           // absent for capabilities
  access: "read" | "write"
  grants: { admin: Grant, sales_manager: Grant, salesperson: Grant }
           // Grant = "all" | "team" | "own" | "own_vo" | "self" | "capability" | "flag:<name>" | "none"
  assocRead?: boolean               // Assoc-R applies (companies, contacts)
  feature?: AiFeature               // requires org AI + feature switch
  extraCheck?: CheckName            // e.g. "newOwnerInScope", "signerIsDealContact"
}

function decide(actor, permKey, resource?, input?) -> Decision:
  def = PERMISSIONS[permKey]
  if actor.type == "external": return decideExternal(actor.token, permKey, resource)   // §5.3
  if actor.type == "system":   return decideSystem(actor.component, permKey, resource) // §5.1
  if actor.type == "ai":       actor = actor.onBehalfOf                                  // §5.2
  if actor.status != "active": return DENY("inactive")
  if def.feature and not (org.ai.enabled and org.ai.features[def.feature]): return DENY("feature_disabled")

  grant = def.grants[actor.role]
  if grant == "none": return DENY("role")
  if grant startsWith "flag:":
      if actor.role == "admin": grant = "capability"
      elif actor.role == "sales_manager" and actor.flags[flagName(grant)]: grant = "capability"
      else: return DENY("flag")
  if grant == "capability": return checkExtra(def, actor, resource, input)
  if grant == "self":
      return resource == null or resource.userId == actor.id ? checkExtra(...) : DENY("not_self")

  root  = visibilityRoot(resource)              // §4.2: deal for proposals, related record for tasks, ...
  owner = root.ownerId
  inScope =
      grant == "all"    -> true
      grant == "team"   -> owner in TeamScope(actor)             // §2.2
      grant == "own"    -> owner == actor.id
      grant == "own_vo" -> owner == actor.id
                           or (def.access == "read" and org.crossVisibility[root.type] == "view_only")
  if not inScope and def.access == "read":
      inScope = specialReadPaths(actor, resource)
          // task assignee; mailbox owner of email; Assoc-R (def.assocRead and
          // exists deal d linked to root where decide(actor,"deal.edit",d) allowed)
  if not inScope: return DENY("scope", hide = (def.access == "read"))   // read → 404, write → 403 if readable else 404
  return checkExtra(def, actor, resource, input)   // e.g. new owner ∈ TeamScope, recipient is deal contact

function scopeFilter(actor, recordType, access) -> Predicate:   // repository query scoping
  role grant for "<recordType>.view" or ".edit" →
    all    -> TRUE
    team   -> owner_id IN TeamScope(actor)
    own    -> owner_id = actor.id
    own_vo -> owner_id = actor.id OR crossVisibility[recordType] = view_only
  OR assoc/assignee/mailbox paths expressed as EXISTS sub-queries
  // child record types join to their visibility root and reuse the root predicate

function redact(actor, resource):          // field-level rules applied after decide()
  if resource is Email/CalendarEvent and resource.isPrivate and resource.mailboxOwner != actor.id:
       strip subject, body, attachments                       // OD-30 (Admin included)
  if resource is Secret-bearing settings: strip secrets
```

Rules both sides must respect:
1. Business state guards (sent version immutable, closed-deal rules, one open signature request, clocks) are evaluated **after** `decide()` by the owning service and return `409`/`422`, never `403`.
2. Out-of-scope reads return `404` to avoid leaking existence; out-of-scope writes on readable records return `403` with problem code `permission_denied` (ADR-016).
3. Permission caches (TeamScope, flags, cross-visibility) are invalidated on `user.role_changed`, `team.membership_changed`, `organization.settings_updated`, `user.deactivated`.
4. `/api/v1/me/permissions` returns `{ role, flags, capabilities: PermKey[], scopes: Record<PermKey, Grant>, teamScopeUserIds, crossVisibility, aiFeatures }`; each resource representation carries `allowedActions: PermKey[]` computed by `decide()`.
5. Every `DENY` on a write and every privileged action listed with "audit" above is written to AuditLog (BR-PLT-009).

---

## 8. Mapping of §9.17 rows to PERM IDs
| §9.17 row | PERM IDs |
|---|---|
| Manage users, teams, billing, organization settings | PERM-001..019 (017 N/A) |
| Configure pipelines, custom fields, automation, lead forms | PERM-020..024, 089..092, 130, 131 |
| Import data, export all data | PERM-029..036 |
| Manage templates, content library, product catalog | PERM-095..102 |
| View and edit records | PERM-037..056, 058..059, 061..073, 078..081, 104..105 |
| Reassign deals | PERM-057, 060 (+041, 046 by extension, DPC) |
| Create and send proposals, request signatures | PERM-103, 105, 110, 111, 113, 117, 123, 124, 126 |
| Revoke links, void signature requests | PERM-119, 120, 125 (+114 by alignment, DPC) |
| View dashboards | PERM-145..147 |
| Turn AI features on or off | PERM-133 |

---

## 9. Items pending confirmation (candidate open decisions)
1. ~~Associated read~~ — resolved by §12 R6 (read scope on deal → read company and deal contacts). Still open: whether such users may edit those contacts' email/phone (WA: no).
2. ~~Ownership of companies and contacts~~ — resolved by §12 R6: companies and contacts have an owner; reassignment mirrors deals (PERM-041, PERM-046).
3. ~~Co-manager visibility~~ — resolved by §12 R7 (co-managers included in TeamScope).
4. ~~Deactivated owners~~ — resolved by §12 R7 (membership retained, flagged inactive).
5. **View-only setting and dashboards**: confirm that cross-visibility does not widen dashboards ("Own performance").
6. **Manager-assigned tasks**: managers may assign tasks to team members; salespeople only to themselves.
7. ~~Flag scope~~ — resolved by §12 R8: locking and DOCX upload stay Admin-only.
8. **Note deletion**: Admin may delete any note (audited); authors their own.
9. ~~Copying share links~~ — resolved by §12 R5 (ADR-034): SHA-256 hash for lookup plus envelope-encrypted token, so a user with write scope on the deal can copy an existing link again (PERM-118) without re-issuing it.
10. **Shared saved views** at team/organization level.
11. **Notifications to managers**: BR-NTF-001 targets the deal owner only; confirm managers get no proposal alerts by default.
