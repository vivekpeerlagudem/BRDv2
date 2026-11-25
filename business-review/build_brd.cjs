/* Build the formal BRD .docx with docx-js. Run from repo root: node business-review/build_brd.cjs */
const fs = require('fs');
const path = require('path');
const D = require('docx');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, PageBreak, Header, Footer, PageNumber, TableOfContents,
  ImageRun, LevelFormat, PageOrientation, VerticalAlign, TabStopType, TabStopPosition,
} = D;

const BR = path.join(__dirname);
const data = JSON.parse(fs.readFileSync(path.join(BR, 'reqs.json'), 'utf8'));
const REQS = data.reqs, SUM = data.summary;

const NAVY = '1F4E79', INK = '1B2A41', MUT = '5A6B80', LINE = 'C9D6E5', LIGHT = 'F2F6FB', GREEN = '1F7A42', AMBER = '8A6D1A', RED = 'B4232B';
const FONT = 'Calibri';

// ---------- helpers ----------
const t = (text, o = {}) => new TextRun({ text, font: FONT, ...o });
const P = (children, o = {}) => new Paragraph({ children: Array.isArray(children) ? children : [children], ...o });
const body = (text, o = {}) => new Paragraph({ children: [t(text, o.run || {})], spacing: { after: 120, line: 276 }, ...o.p });
const bullet = (text, o = {}) => new Paragraph({ children: Array.isArray(text) ? text : [t(text)], numbering: { reference: o.ref || 'bullets', level: o.level || 0 }, spacing: { after: 60, line: 264 } });
const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [t(text)] });
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [t(text)] });
const h3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [t(text)] });
const spacer = (h = 120) => new Paragraph({ spacing: { after: h }, children: [t('')] });

const statusColor = (s) => s.startsWith('Implemented & tested') ? GREEN
  : s.startsWith('Implemented, UI') ? GREEN
  : s === 'Simulated' ? AMBER
  : s.startsWith('Blocked') ? AMBER
  : s.startsWith('Partially') ? AMBER
  : s.startsWith('Not applicable') ? MUT
  : RED;

const cell = (content, { w, head = false, shade, bold = false, color, size = 18, align } = {}) => new TableCell({
  width: { size: w, type: WidthType.DXA },
  margins: { top: 40, bottom: 40, left: 80, right: 80 },
  shading: shade ? { type: ShadingType.CLEAR, color: 'auto', fill: shade } : undefined,
  verticalAlign: VerticalAlign.CENTER,
  children: (Array.isArray(content) ? content : [content]).map((c) =>
    typeof c === 'string'
      ? new Paragraph({ children: [t(c, { bold: head || bold, color: head ? 'FFFFFF' : (color || INK), size })], alignment: align })
      : c),
});
const row = (cells) => new TableRow({ children: cells, cantSplit: true });
const table = (colWidths, rows) => new Table({
  columnWidths: colWidths,
  width: { size: colWidths.reduce((a, b) => a + b, 0), type: WidthType.DXA },
  borders: {
    top: { style: BorderStyle.SINGLE, size: 2, color: LINE }, bottom: { style: BorderStyle.SINGLE, size: 2, color: LINE },
    left: { style: BorderStyle.SINGLE, size: 2, color: LINE }, right: { style: BorderStyle.SINGLE, size: 2, color: LINE },
    insideHorizontal: { style: BorderStyle.SINGLE, size: 1, color: LINE }, insideVertical: { style: BorderStyle.SINGLE, size: 1, color: LINE },
  },
  rows,
});
const headRow = (labels, widths) => row(labels.map((l, i) => cell(l, { w: widths[i], head: true, shade: NAVY })));

// data table helper: first row header (navy), zebra striping
function dataTable(widths, headers, rows, opts = {}) {
  const trs = [headRow(headers, widths)];
  rows.forEach((r, i) => {
    trs.push(row(r.map((c, j) => {
      const conf = typeof c === 'object' && c.text !== undefined ? c : { text: c };
      return cell(conf.text, { w: widths[j], shade: i % 2 ? 'F4F8FC' : undefined, color: conf.color, bold: conf.bold, size: opts.size || 17, align: conf.align });
    })));
  });
  return table(widths, trs);
}

// ---------- document pieces ----------
const PAGE_W = 12240, MARGIN = 1080, CONTENT_W = PAGE_W - MARGIN * 2; // 10080

function cover() {
  const line = (txt, o) => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: o && o.after != null ? o.after : 60 }, children: [t(txt, (o && o.run) || {})] });
  return [
    new Paragraph({ spacing: { before: 1800 }, children: [t('')] }),
    new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: NAVY, space: 14 } }, spacing: { after: 40 }, children: [t('BUSINESS REQUIREMENTS DOCUMENT', { bold: true, size: 26, color: MUT, characterSpacing: 40 })] }),
    line('Sales CRM Platform', { run: { bold: true, size: 56, color: NAVY }, after: 80 }),
    line('Business Scope, Current Implementation & Future Requirements', { run: { size: 28, color: INK }, after: 420 }),
    line('Version 1.0', { run: { bold: true, size: 24, color: INK }, after: 40 }),
    line('Status: Draft for Business Review', { run: { size: 22, color: MUT }, after: 40 }),
    line('Date: 18 November 2026', { run: { size: 22, color: MUT }, after: 600 }),
    line('Prepared for business review by Aakash', { run: { size: 22, color: INK }, after: 40 }),
    line('Audience: Business Stakeholders · Product Owner · Solution Architect · Development Team', { run: { size: 20, color: MUT }, after: 1000 }),
    new Paragraph({ alignment: AlignmentType.CENTER, border: { top: { style: BorderStyle.SINGLE, size: 6, color: LINE, space: 10 } }, children: [t('Confidential — Internal Business Document', { italics: true, size: 18, color: MUT })] }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

function docControl() {
  const out = [h1('Document Control')];
  out.push(h2('Document Information'));
  out.push(dataTable([2600, 7480], ['Field', 'Detail'], [
    ['Document title', 'Business Requirements Document — Sales CRM Platform'],
    ['Version', '1.0'],
    ['Status', 'Draft for Business Review'],
    ['Classification', 'Confidential — Internal'],
    ['Author', 'Business Analysis & Solution Architecture'],
    ['Reviewer', 'Aakash (Product Owner / Solution Architect)'],
    ['Scope basis', 'Original BRD v2.0 (single-company deployment per Scope Reconciliation) and the current implemented application'],
    ['Evidence basis', 'Repository source code, automated test suite (198 unit/integration, 24 browser tests), QA report, implementation-status and requirement-traceability records'],
  ]));
  out.push(spacer());
  out.push(h2('Revision History'));
  out.push(dataTable([1400, 1700, 3200, 3780], ['Version', 'Date', 'Author', 'Summary of changes'], [
    ['0.1', '17 Nov 2026', 'Analysis team', 'Internal working draft (requirement extraction, scope reconciliation).'],
    ['1.0', '18 Nov 2026', 'Analysis team', 'First formal BRD for business review: scope, verified implementation status, gap analysis, decision register and delivery roadmap.'],
  ]));
  out.push(spacer());
  out.push(h2('Approval'));
  out.push(dataTable([3360, 3360, 3360], ['Role', 'Name', 'Decision / Date'], [
    ['Product Owner', 'Aakash', '____________________'],
    ['Solution Architect', '', '____________________'],
    ['Delivery Lead', '', '____________________'],
  ]));
  out.push(new Paragraph({ children: [new PageBreak()] }));
  return out;
}

function toc() {
  return [
    h1('Table of Contents'),
    new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }),
    new Paragraph({ children: [new PageBreak()] }),
  ];
}

// ---------- SECTIONS ----------
const S = [];
const MODMAP = { PLT: 'Platform & Accounts', MIG: 'Data Import / Migration', CRM: 'CRM Records', EML: 'Email & Calendar', LED: 'Leads', TPL: 'Templates', PRC: 'Pricing', PRP: 'Proposals', AIA: 'AI Assistance', SHR: 'Sharing & Engagement', NTF: 'Notifications', SIG: 'E-Signature', AUT: 'Automation', RPT: 'Reporting & Analytics', TIM: 'Timeline' };
const MOD_ORDER = ['PLT', 'CRM', 'LED', 'TPL', 'PRC', 'PRP', 'AIA', 'SHR', 'SIG', 'AUT', 'NTF', 'RPT', 'TIM', 'EML', 'MIG'];

// 1 Executive Summary
S.push(h1('1. Executive Summary'));
S.push(h2('1.1 Business problem'));
S.push(body('Our sales team manages companies, contacts, leads, deals, proposals and customer follow-ups across spreadsheets, documents, email inboxes and manual steps. Proposal creation is slow and inconsistent, deal information is incomplete, follow-ups are missed, and managers have little real-time visibility of the pipeline or of whether buyers have even opened a proposal. Preparing a proposal, tracking engagement and collecting a signature can take days of manual effort.'));
S.push(h2('1.2 Why we are building the Sales CRM'));
S.push(body('The Sales CRM Platform centralises the entire sales lifecycle in one internal application and automates the repetitive, error-prone steps — so salespeople spend less time on administration and more time selling, and managers get accurate, real-time insight. AI assistance drafts and reviews proposal content and summarises deals, while every external action (sending, sharing, signing) stays under human control.'));
S.push(h2('1.3 Product vision and objectives'));
S.push(bullet('A single internal system of record for companies, contacts, leads, deals, activities and proposals.'));
S.push(bullet('Faster, more consistent proposals generated from templates and CRM data, shared through secure tracked links.'));
S.push(bullet('AI assistance that reduces repetitive writing and checking, with humans always approving the result.'));
S.push(bullet('Clear visibility of pipeline, buyer engagement and sales performance for salespeople and managers.'));
S.push(bullet('Strong security: role-based and record-level access, a complete audit trail, and no silent external actions.'));
S.push(h2('1.4 Expected business outcomes'));
S.push(bullet('Shorter proposal turnaround and less manual follow-up effort.'));
S.push(bullet('More complete and trustworthy deal data.'));
S.push(bullet('Earlier, evidence-based insight into which deals are progressing and which need attention.'));
S.push(bullet('A repeatable, auditable sales process that scales with the team.'));
S.push(h2('1.5 Current development status'));
S.push(body('The platform is a working application that runs end to end. Of the 130 requirements in BRD v2.0 (101 Must, 25 Should, 4 Could), ' + (SUM.status['Implemented & tested'] + (SUM.status['Implemented & tested (mock AI)'] || 0)) + ' are implemented and verified by an automated test suite (198 unit and integration tests on a real database, plus 24 browser tests covering the full sales journey). The complete business journey — lead to company, contact, deal, proposal, AI assistance, human approval, sharing, buyer engagement, e-signature and closed-won — works in the browser. Three capabilities are deliberately running on stand-ins and are not production-ready: e-signature, the AI model, and outbound email. These are built behind clean interfaces so a real provider can be connected without re-architecting.'));
S.push(h2('1.6 Scope of this document'));
S.push(body('This document states the business vision and scope, documents the functional requirements using the original BRD v2.0 identifiers, assesses what is actually implemented (with evidence), analyses the remaining gaps, records the open business decisions for the Product Owner, and proposes a realistic delivery roadmap. It deliberately avoids low-level implementation detail such as source code, database schemas or API specifications.'));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 2 Background
S.push(h1('2. Business Background and Objectives'));
S.push(h2('2.1 How sales is managed today'));
S.push(body('Today the team keeps company and contact information in spreadsheets and personal inboxes. Leads arrive by email or web form and are assigned by hand. Deal stages and amounts are tracked informally, so pipeline reports must be assembled manually and are often out of date. Proposals are written in word processors by copying from previous documents, which is slow and leads to inconsistencies and occasional errors (wrong customer name, stale pricing). Once a proposal is emailed, the salesperson has no visibility of whether the buyer opened it. Signatures are collected by separate tools or printed and scanned. Follow-ups rely on individual memory.'));
S.push(h2('2.2 Manual work we want to reduce'));
S.push(dataTable([3400, 3340, 3340], ['Manual process today', 'Problem', 'CRM / AI improvement'], [
  ['Re-typing CRM data into proposals', 'Slow, inconsistent, error-prone', 'Templates auto-populated from CRM data'],
  ['Writing proposal sections from scratch', 'Time-consuming, variable quality', 'AI drafts sections; human edits and approves'],
  ['Checking a proposal before sending', 'Errors slip through', 'Rule-based + AI pre-send review'],
  ['Chasing buyers with no visibility', 'Wasted effort, poor timing', 'Tracked links show views and downloads'],
  ['Remembering follow-ups', 'Missed opportunities', 'Automated tasks and reminders'],
  ['Assembling pipeline reports', 'Manual, out of date', 'Live, permission-scoped dashboards and reports'],
  ['Collecting signatures separately', 'Fragmented, slow', 'In-platform e-signature workflow (provider pending)'],
]));
S.push(h2('2.3 Business objectives'));
S.push(bullet('Reduce the effort and time to produce and send a proposal.'));
S.push(bullet('Improve the completeness and accuracy of deal and customer data.'));
S.push(bullet('Give the team visibility of buyer engagement and pipeline health.'));
S.push(bullet('Keep humans in control of pricing, approvals and all external communication.'));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 3 Product Scope
S.push(h1('3. Product Scope'));
S.push(body('The platform covers the complete sales lifecycle. The table below lists each business capability area and whether it is in Phase 1 (this delivery) or a future enhancement, following the original BRD v2.0 and the agreed single-company deployment.'));
S.push(dataTable([3100, 4480, 2500], ['Capability area', 'What it covers', 'Phase'], [
  ['CRM & lead management', 'Web lead capture, assignment, qualification, conversion', { text: 'Phase 1' }],
  ['Company & contact management', 'Records, relationships, timelines, editing', { text: 'Phase 1' }],
  ['Deal & pipeline management', 'Deals, stages, probabilities, ownership, Kanban board', { text: 'Phase 1' }],
  ['Sales activities & follow-ups', 'Notes, calls, meetings, tasks, reminders', { text: 'Phase 1' }],
  ['Proposal & template management', 'Versioned templates, generation, preview, PDF/DOCX', { text: 'Phase 1' }],
  ['Pricing & approval workflows', 'Catalogue, pricing tables, discounts, discount-limit warnings', { text: 'Phase 1 (approval flow Phase 2)' }],
  ['AI-powered sales assistance', 'Drafting, review, summary, rewrite, follow-up email', { text: 'Phase 1' }],
  ['Document sharing & buyer engagement', 'Secure links, buyer portal, view/download tracking', { text: 'Phase 1' }],
  ['Email & calendar integration', 'Mailbox sync, send from CRM, calendar logging', { text: 'Future (Phase 2)' }],
  ['E-signature', 'Signature requests, signing, certificate', { text: 'Phase 1 (real provider pending)' }],
  ['Notifications', 'In-app and email alerts, preferences, digest', { text: 'Phase 1 (email + preferences partial)' }],
  ['Reporting & analytics', 'Pipeline, won/lost, rep performance, proposal metrics, CSV export', { text: 'Phase 1' }],
  ['Administration & security', 'Users, roles, pipeline, teams, settings, audit log', { text: 'Phase 1' }],
  ['Data migration', 'CSV import with validation and undo; external-CRM import', { text: 'Phase 1 (CSV); external CRMs Future' }],
]));
S.push(h2('3.1 Scope note — single-company deployment'));
S.push(body('BRD v2.0 was originally written as a commercial, multi-organization product. The agreed scope for this build is a single-company internal platform (one deployment and one database for our own sales team; external buyers and signers still receive and act on proposals through secure links). This decision was confirmed by the Product Owner on 18 November 2026. The multi-organization capabilities (self-service sign-up, per-organization data isolation, subscription billing) are therefore out of Phase 1 scope and recorded as such; a future move to a commercial product would be a separate, significant architectural initiative (see Section 10).'));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 4 Business Workflow
S.push(h1('4. Business Workflow'));
S.push(body('The platform supports one continuous sales journey. Each step below states the business process, who is responsible, where automation or AI helps, and the expected outcome. This journey has been verified working end to end in the application.'));
const steps = [
  ['Lead', 'A prospect submits the web form (or a lead is entered).', 'Marketing / System', 'Auto-create contact, company and deal; round-robin assignment; spam protection.', 'A qualified lead lands with an owner.'],
  ['Company & Contact', 'The salesperson confirms or enriches the company and contact.', 'Salesperson', 'Duplicate detection; relationships and timelines maintained automatically.', 'Clean, de-duplicated customer records.'],
  ['Deal', 'A deal is created with amount, stage, expected close and contacts.', 'Salesperson', 'Pipeline stages and win probabilities; Kanban board; owner scoping.', 'A tracked opportunity in the pipeline.'],
  ['Sales activities', 'Calls, meetings and notes are logged; tasks are set.', 'Salesperson', 'Reminders; overdue flags; automatic activity timeline.', 'A complete, auditable deal history.'],
  ['Proposal creation', 'A proposal is generated from a template.', 'Salesperson', 'CRM data and pricing auto-populate; placeholders resolved.', 'A consistent draft proposal in minutes.'],
  ['Pricing & approval', 'Line items, discounts and totals are set.', 'Salesperson / Manager', 'Automatic totals; discount-limit warnings by role.', 'Accurate, policy-aware pricing.'],
  ['AI assistance', 'AI drafts sections, rewrites text, reviews the proposal and can summarise the deal.', 'Salesperson', 'Context-aware drafting and a pre-send quality review; everything editable.', 'Faster, higher-quality content.'],
  ['Human approval', 'The salesperson reviews, edits and accepts the AI output.', 'Salesperson', 'AI content is clearly labelled and blocks sending until resolved.', 'Human-owned, approved content.'],
  ['Proposal sharing', 'The proposal is sent as a secure per-recipient link.', 'Salesperson', 'Version frozen and made immutable; link expiry and revoke.', 'A controlled, tracked share.'],
  ['Buyer engagement', 'The buyer opens, reads and downloads the proposal.', 'Buyer', 'Views, reading time and downloads tracked; owner notified.', 'Visibility of buyer interest and timing.'],
  ['E-signature', 'Signatures are requested and collected.', 'Salesperson / Buyer', 'Ordered signers, reminders, certificate (provider pending).', 'A completed agreement (simulated today).'],
  ['Closed Won', 'On completion the deal is closed automatically.', 'System', 'Deal set to Closed Won with amount and date from the proposal.', 'Accurate, automatic deal closure.'],
  ['Reporting', 'Pipeline, performance and proposal metrics update.', 'Manager / Salesperson', 'Live, permission-scoped dashboards and reports; CSV export.', 'Real-time, trustworthy sales reporting.'],
];
S.push(dataTable([1500, 2600, 1500, 2680, 1800], ['Step', 'Business process', 'Responsible', 'Automation / AI', 'Outcome'],
  steps.map((s) => [{ text: s[0], bold: true }, s[1], s[2], s[3], s[4]])));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 5 Functional Business Requirements
S.push(h1('5. Functional Business Requirements'));
S.push(body('This section documents the business requirements for each module using the original BRD v2.0 identifiers and priorities. For readability the full per-requirement detail (business purpose, actor, expected behaviour and acceptance criteria) is summarised per module; the complete requirement-by-requirement status is listed in Appendix A (Requirement Traceability Matrix). Status values follow the assessment scale defined in Section 8.'));
const actorByMod = {
  PLT: 'Administrator', CRM: 'Salesperson / Sales Manager', LED: 'Administrator / Salesperson', TPL: 'Administrator / Content manager',
  PRC: 'Administrator / Salesperson', PRP: 'Salesperson', AIA: 'Salesperson', SHR: 'Salesperson / Buyer', SIG: 'Salesperson / Signer',
  AUT: 'System', NTF: 'All users', RPT: 'Sales Manager / Salesperson', TIM: 'All users', EML: 'Salesperson', MIG: 'Administrator',
};
const acByMod = {
  PLT: 'An administrator can manage users, roles, teams, organisation settings and view the audit log; a salesperson cannot.',
  CRM: 'A user can create, view and edit companies, contacts and deals they are permitted to see; cross-user access is refused; reassignment respects role.',
  LED: 'A valid web-form submission creates/updates records and assigns an owner; spam is rejected.',
  TPL: 'Authorised users create and version templates with placeholders and locked sections; proposals keep the version they used.',
  PRC: 'Pricing tables compute correct one-time and recurring totals; discounts above a role limit raise a warning.',
  PRP: 'A proposal is generated from a template with CRM data and pricing, previewed, and produced as PDF and DOCX; sent versions are immutable.',
  AIA: 'Each AI feature returns an editable, clearly-labelled suggestion that only takes effect after a human accepts it; AI never sends anything.',
  SHR: 'Each recipient gets a unique secure link; views and downloads are tracked; expired or revoked links are refused.',
  SIG: 'A signature can be requested on a specific version; the signed document and certificate are produced (simulated provider).',
  AUT: 'Documented automation rules (stage on send, closed-won on signing, follow-up tasks, stalled/overdue flags) run and are reversible.',
  NTF: 'The deal owner is notified of key proposal and assignment events; email delivery and preferences are pending.',
  RPT: 'Reports show correct, permission-scoped figures with date, team and owner filters and CSV export.',
  TIM: 'Each deal has one chronological timeline showing who did what and when.',
  EML: 'Mailbox and calendar integration (sync, send from CRM, meeting logging) — not built in Phase 1.',
  MIG: 'An administrator imports companies, contacts or deals from CSV with validation, duplicate handling and undo; external-CRM import is not built.',
};
MOD_ORDER.forEach((mod, idx) => {
  const list = REQS.filter((r) => r.mod === mod);
  if (!list.length) return;
  S.push(h2('5.' + (idx + 1) + ' ' + MODMAP[mod] + ' (BR-' + mod + ')'));
  S.push(new Paragraph({ spacing: { after: 80 }, children: [t('Primary actor: ', { bold: true, size: 18 }), t(actorByMod[mod], { size: 18 }), t('     Acceptance (summary): ', { bold: true, size: 18 }), t(acByMod[mod], { size: 18 })] }));
  S.push(dataTable([1500, 5380, 1000, 2200],
    ['Req ID', 'Requirement (BRD v2.0)', 'Priority', 'Status'],
    list.map((r) => [
      { text: r.id, bold: true },
      r.short || '(see BRD v2.0)',
      { text: r.priority },
      { text: r.statusNorm, color: statusColor(r.statusNorm) },
    ]), { size: 16 }));
  S.push(spacer(100));
});
S.push(new Paragraph({ children: [new PageBreak()] }));

// 6 AI Business Requirements
S.push(h1('6. AI Business Requirements'));
S.push(body('AI assistance reduces repetitive sales writing and checking while keeping the salesperson responsible for the result. Every AI output is a suggestion: it is clearly labelled, fully editable, and only enters a proposal, note or email after a human explicitly accepts it. AI cannot send, share or sign anything, and it never sets or overrides pricing — those remain human and system responsibilities.'));
S.push(h2('6.1 AI capabilities'));
S.push(dataTable([2700, 4700, 2680], ['AI capability', 'Business purpose', 'Status'], [
  ['Proposal section drafting', 'Draft introduction, scope and similar sections from CRM data', { text: 'Implemented (mock model)', color: GREEN }],
  ['Proposal content review', 'Flag wrong names, mismatched figures, unsupported claims before sending', { text: 'Implemented (mock model)', color: GREEN }],
  ['Deal summary', 'Summarise a deal’s history and suggest next steps', { text: 'Implemented (mock model)', color: GREEN }],
  ['Text rewriting', 'Improve, shorten, re-tone or simplify selected text', { text: 'Implemented (mock model)', color: GREEN }],
  ['Follow-up email drafting', 'Draft a context-aware follow-up for the salesperson to send', { text: 'Implemented (mock model)', color: GREEN }],
  ['Context-aware CRM assistance', 'Permission-scoped context engine feeds only data the user may see', { text: 'Implemented', color: GREEN }],
  ['Human approval & acceptance', 'Accept / edit / reject on every AI result; pending content blocks send', { text: 'Implemented & tested', color: GREEN }],
  ['AI usage tracking', 'Every request logged with provider, model, tokens, cost estimate, outcome', { text: 'Implemented & tested', color: GREEN }],
  ['AI configuration & admin controls', 'Organisation on/off, per-feature switches, daily and budget limits', { text: 'Implemented & tested', color: GREEN }],
]));
S.push(h2('6.2 Implemented, simulated and missing'));
S.push(bullet([t('Implemented and functional: ', { bold: true }), t('all five AI features, the human-approval workflow, content labelling, usage and cost logging, and administrative controls — all exercised by automated tests through the real application.')]));
S.push(bullet([t('Simulated: ', { bold: true }), t('the AI model itself. Answers come from a deterministic built-in mock. A real Anthropic provider driver is written and tested against recorded fixtures but has never made a live call, so real output quality, latency and cost are unverified.')]));
S.push(bullet([t('Missing / pending decision: ', { bold: true }), t('selection of the AI provider and confirmation of data-handling terms (no training on customer data). This is the only AI requirement blocked on an external business decision.')]));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 7 Architecture
S.push(h1('7. High-Level Solution Architecture'));
S.push(body('The platform is a modular monolith: one well-structured application and one database, organised into clear layers, with every external service (e-signature, AI model, email, storage) placed behind an interface so it can be replaced without re-architecting. The diagram below shows the layers, the major data flows and which components are live, simulated or planned.'));
const png = fs.readFileSync(path.join(BR, 'Sales_CRM_HLD_Architecture.png'));
S.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60, after: 60 }, children: [new ImageRun({ data: png, type: 'png', transformation: { width: 648, height: 551 } })] }));
S.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 160 }, children: [t('Figure 1 — Sales CRM Platform high-level solution architecture', { italics: true, size: 16, color: MUT })] }));
S.push(h2('7.1 Layer responsibilities'));
S.push(bullet([t('User experience: ', { bold: true }), t('the internal web app for staff and a separate, secure buyer portal for external recipients.')]));
S.push(bullet([t('Application & API: ', { bold: true }), t('the API, authentication and authorization, request validation, and the automation/jobs engine.')]));
S.push(bullet([t('Core CRM platform: ', { bold: true }), t('companies, contacts, leads, deals, activities, reporting and administration.')]));
S.push(bullet([t('Proposal & document workflows: ', { bold: true }), t('templates, pricing, proposal generation, sharing and e-signature.')]));
S.push(bullet([t('AI intelligence layer: ', { bold: true }), t('permission-scoped context, versioned prompts, a provider abstraction, and human approval and governance.')]));
S.push(bullet([t('Integration & services: ', { bold: true }), t('email/calendar, transactional email, e-signature, object storage and notifications — each behind an adapter.')]));
S.push(bullet([t('Data & storage: ', { bold: true }), t('PostgreSQL for CRM data, audit log, timeline and AI usage, plus file storage for documents.')]));
S.push(bullet([t('Security & governance: ', { bold: true }), t('role and record-level authorization, an append-only audit log, immutable sent proposals, secure buyer links and human approval for external actions — applied across every layer.')]));
S.push(h2('7.2 Original design vs current implementation'));
S.push(dataTable([2600, 3740, 3740], ['Area', 'Original BRD v2.0 architecture', 'Current implementation'], [
  ['Tenancy', 'Multi-organization SaaS with per-tenant isolation', 'Single-company deployment (one app, one database) per agreed scope'],
  ['Core platform', 'CRM, proposals, sharing, automation, reporting', 'Built and tested as designed'],
  ['AI layer', 'Provider-backed assistance with governance', 'Built with governance; running on a deterministic mock (real provider pending)'],
  ['E-signature', 'Legally-valid provider integration', 'Provider interface built; simulator in place (not legally valid)'],
  ['Email & calendar', 'Mailbox sync and send; calendar logging', 'Not built; links shared manually; notifications logged, not emailed'],
  ['Storage', 'Cloud object storage', 'Local file storage behind the same interface (cloud pending)'],
]));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 8 Current Implementation Assessment
S.push(h1('8. Current Implementation Assessment'));
S.push(body('Each requirement was assessed against the actual application and its automated tests. The scale below is used throughout this document. The counts are evidence-based: "implemented and tested" means a passing automated test exercises the behaviour through the real application and database.'));
S.push(h2('8.1 Assessment scale'));
S.push(dataTable([3600, 6480], ['Status', 'Meaning'], [
  ['Implemented & tested', 'Built and verified by a passing automated test (unit, integration and/or browser).'],
  ['Implemented (mock AI)', 'Built and tested end to end, but on the deterministic AI mock — real model quality unverified.'],
  ['Implemented, UI not fully tested', 'Built and working; the server side is tested, the exact screen action is not yet covered by a browser test.'],
  ['Partially implemented', 'Part of the requirement is built; the gap is stated in Appendix A / Section 9.'],
  ['Simulated', 'Works end to end against a local stand-in, not a real external service (e-signature).'],
  ['Not implemented', 'Not built in this phase.'],
  ['Blocked (external decision)', 'Awaiting a business or contractual decision before it can be completed.'],
  ['Not applicable (single-tenant)', 'Removed by the agreed single-company scope.'],
]));
S.push(h2('8.2 Status summary (all 130 requirements)'));
const statusOrder = ['Implemented & tested', 'Implemented & tested (mock AI)', 'Implemented, UI not fully tested', 'Partially implemented', 'Simulated', 'Blocked (external decision)', 'Not applicable (single-tenant)', 'Not implemented'];
S.push(dataTable([5200, 1640, 3240], ['Status', 'Count', 'Share'], statusOrder.filter((k) => SUM.status[k]).map((k) => [
  { text: k, color: statusColor(k) }, { text: String(SUM.status[k]), align: AlignmentType.CENTER }, { text: Math.round((SUM.status[k] / SUM.total) * 100) + '%' },
])));
S.push(new Paragraph({ spacing: { before: 80, after: 120 }, children: [t('Must-priority requirements: ', { bold: true }), t((SUM.must['Implemented & tested'] + (SUM.must['Implemented & tested (mock AI)'] || 0)) + ' of 101 implemented and tested; the remainder are partial, simulated, blocked, not-applicable or not yet built (see Section 9).')] }));
S.push(h2('8.3 Module classification'));
S.push(dataTable([2500, 1100, 6480], ['Module', 'Reqs', 'Where it stands'], MOD_ORDER.map((mod) => {
  const list = REQS.filter((r) => r.mod === mod);
  if (!list.length) return null;
  const done = list.filter((r) => r.statusNorm.startsWith('Implemented')).length;
  const notes = {
    PLT: 'Users, roles, teams, settings, audit log built & tested; MFA/SSO and data export not built; multi-org N/A.',
    CRM: 'Companies, contacts, deals, editing, reassignment, pipeline built & tested; custom fields and saved views not built.',
    LED: 'Web form, round-robin, dedupe, spam protection built & tested; source tags and field-based routing partial.',
    TPL: 'Versioned templates, locked sections, placeholders built; rich text, content blocks and branding partial.',
    PRC: 'Catalogue, pricing, discounts, totals, currency built & tested; multi-currency per deal and approval flow pending.',
    PRP: 'Generation, pricing, preview, versions, send, validity, copy, compare, PDF+DOCX built & tested.',
    AIA: 'All five AI features + governance built & tested on the mock; real provider blocked on OD-05.',
    SHR: 'Secure links, buyer portal, tracking, expiry, revoke, accept/decline built & tested; email send and verification pending.',
    SIG: 'Full workflow built & tested on a simulator; a real, legally-valid provider is required (not built).',
    AUT: 'Stage-on-send, closed-won, follow-up tasks, stalled/overdue flags, reversal built & tested.',
    NTF: 'In-app alerts built & tested; email delivery, preferences and digest not built.',
    RPT: 'Dashboards, filters, pipeline, won/lost, rep performance, proposal metrics, CSV export built & tested.',
    TIM: 'Deal, company and contact timelines built & tested.',
    EML: 'Not built in Phase 1 (mailbox and calendar integration).',
    MIG: 'CSV import with mapping, validation, duplicate handling and undo built & tested; external-CRM import not built.',
  };
  return [{ text: MODMAP[mod], bold: true }, { text: done + ' / ' + list.length, align: AlignmentType.CENTER }, notes[mod]];
}).filter(Boolean)));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 9 Gap analysis
S.push(h1('9. Gap Analysis and Remaining Requirements'));
S.push(body('The gaps below are the requirements not yet fully delivered, grouped by priority. For each the business need, impact and the dependency or decision required are stated.'));
S.push(h2('9.1 Must-priority gaps'));
S.push(dataTable([2500, 3100, 2240, 2240], ['Area (IDs)', 'What is missing', 'Business impact', 'Dependency / decision'], [
  ['E-signature (BR-SIG-003/004/006/008/010)', 'A real, legally-valid signature provider; identity verification; reminders', 'Signatures are not legally valid today — cannot close real deals', 'Provider selection + legal review (OD-03)'],
  ['Email & calendar (BR-EML-001..006)', 'Mailbox sync, send-from-CRM, calendar logging', 'Manual emailing; no email history on deals', 'Gmail/Outlook decision + app registration (OD-08/09)'],
  ['Email notifications (BR-NTF-001 part)', 'Actual email delivery of alerts', 'Owners rely on in-app alerts only', 'Email provider (OD-14)'],
  ['Authentication (BR-PLT-003/004)', 'MFA and Google/Microsoft sign-in', 'Password-only security', 'Identity provider decision'],
  ['Custom fields (BR-CRM-007)', 'Admin-defined custom fields on records', 'Cannot capture org-specific data', 'Data-model decision'],
  ['Data export (BR-PLT-010)', 'Full organisation data export', 'No self-service backup/exit', 'Scope confirmation'],
  ['Proposal metrics & lists (BR-RPT-004 part)', 'A few advanced metrics and saved views', 'Minor reporting gaps', 'None (build)'],
]));
S.push(h2('9.2 Should-priority gaps'));
S.push(dataTable([2600, 4480, 3000], ['Area', 'What is missing', 'Dependency / decision'], [
  ['Templates', 'Rich-text editing, content-block library, branding controls', 'None (build)'],
  ['Notifications', 'Per-user preferences and daily digest', 'Email provider for some channels'],
  ['Sharing', 'Email verification before viewing; send from CRM', 'Email provider'],
  ['Pricing', 'Per-deal multi-currency', 'None (build)'],
  ['Reporting', 'CSV export refinements, additional activity breakdowns', 'None (build; mostly done)'],
  ['Data import', 'Guided HubSpot/Pipedrive import', 'External API access (OD-09)'],
  ['Leads', 'Lead-source/campaign tags, field-based routing', 'None (build)'],
]));
S.push(h2('9.3 Could-priority gaps'));
S.push(dataTable([2600, 7480], ['Area', 'What is missing'], [
  ['Automation', 'Fully admin-configurable rule builder (rules are built-in today)'],
  ['Notifications', 'Browser push notifications'],
  ['Data import', 'Direct API import from external CRMs'],
  ['Leads', 'Inbound webhook intake for third-party forms'],
]));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 10 Decisions
S.push(h1('10. Business Decisions and Open Questions'));
S.push(body('The following decisions are for the Product Owner and stakeholders. Recommendations are provided only where the evidence justifies one; the decisions themselves remain with the business.'));
S.push(dataTable([2550, 2850, 2550, 2130], ['Decision', 'Business impact', 'Recommendation', 'Owner / status'], [
  ['Internal CRM or commercial multi-organization platform?', 'Determines the entire architecture and data-isolation model', 'Keep single-company for Phase 1 (already built for it)', { text: 'Product Owner — DECIDED (single-company, 18 Nov 2026)', color: GREEN }],
  ['Organization-level data isolation', 'Only relevant if multi-org is chosen; large re-architecture', 'Not required under single-company; revisit only if commercialising', { text: 'Product Owner — closed for Phase 1' }],
  ['Gmail or Microsoft Outlook integration', 'Enables email sync, send-from-CRM, calendar logging', 'Choose per the team’s mailbox; single provider first', { text: 'OPEN (OD-08/09)', color: AMBER }],
  ['Email sending & approval workflow', 'Enables notifications, proposal emailing, password reset', 'Select a transactional email provider; keep human send for proposals', { text: 'OPEN (OD-14)', color: AMBER }],
  ['E-signature provider & legal validity', 'Required for legally binding signatures', 'Select a provider and complete a legal review before go-live', { text: 'OPEN (OD-03)', color: AMBER }],
  ['AI provider & data privacy', 'Enables real AI; governs customer-data handling', 'Select a provider with a no-training / data-retention agreement', { text: 'OPEN (OD-05/90)', color: AMBER }],
  ['AI approval & governance rules', 'Governs how AI is used and limited', 'Confirm the built-in rules and the daily/budget limits', { text: 'Mostly built — confirm thresholds', color: GREEN }],
  ['Data migration from existing CRM tools', 'Eases switching from current tools', 'CSV import is built; decide if HubSpot/Pipedrive import is needed', { text: 'OPEN (OD-09)', color: AMBER }],
  ['First-release priorities', 'Determines what ships first', 'See the roadmap in Section 11; confirm the minimum internal release', { text: 'OPEN — Product Owner', color: AMBER }],
  ['Ownership of pricing, discount & proposal-approval rules', 'Governs pricing policy and approvals', 'Confirm discount limits (currently placeholders) and whether an approval step is needed', { text: 'OPEN — Sales leadership', color: AMBER }],
]));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 11 Roadmap
S.push(h1('11. Delivery Roadmap and Timeline'));
S.push(body('The roadmap below is based on the actual remaining work. Effort is given as indicative person-day ranges for a small team, not as guaranteed dates — several items depend on the decisions in Section 10, and external provider integrations carry third-party and legal lead times outside our control.'));
S.push(h2('11.1 Workstreams and indicative effort'));
S.push(dataTable([3100, 1700, 5280], ['Workstream', 'Effort (person-days)', 'Notes / dependencies'], [
  ['Core CRM completion (custom fields, saved views, data export)', '12–20', 'Build; no external dependency'],
  ['Proposal & document refinements (branding, rich text, content blocks)', '10–18', 'Build'],
  ['Email & calendar integration', '25–40', 'Depends on Gmail/Outlook decision + app registration'],
  ['E-signature (real provider)', '15–25', 'Provider selection + legal review; third-party lead time'],
  ['AI (real provider + evaluation)', '8–15', 'Provider + key + output-quality evaluation (OD-05)'],
  ['Reporting & notifications completion (email, preferences, digest)', '10–16', 'Email provider for some channels'],
  ['Administration & security (MFA/SSO, hardening)', '12–20', 'Identity provider decision'],
  ['Integration, security review, performance & release readiness', '15–25', 'Independent security review + load testing'],
]));
S.push(h2('11.2 Release targets'));
S.push(dataTable([3000, 2000, 5080], ['Release', 'Indicative effort', 'Scope'], [
  [{ text: '1. Minimum usable internal release', bold: true }, '15–25 p-days', 'Current build plus the remaining Must CRM/reporting/notification gaps that do not need external providers; proposals shared manually; e-sign and AI remain stand-ins. Usable by the internal team for day-to-day selling.'],
  [{ text: '2. Complete BRD v2.0 Phase 1', bold: true }, '90–140 p-days', 'All Must and Should requirements including email/calendar integration, a real e-signature provider, a real AI provider, MFA/SSO and custom fields. Depends on the Section 10 decisions and provider lead times.'],
  [{ text: '3. Production-ready release', bold: true }, '140–200 p-days', 'Complete Phase 1 plus independent security review, load/performance testing, legal sign-off on e-signatures, cloud deployment, backup and monitoring.'],
]));
S.push(new Paragraph({ spacing: { before: 60 }, children: [t('Decisions that most affect dates: ', { bold: true }), t('e-signature provider & legal review, email/calendar provider, and AI provider. Until these are made, items 2 and 3 cannot be committed to a date.')] }));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 12 Risks
S.push(h1('12. Risks and Dependencies'));
S.push(dataTable([1500, 3100, 3100, 2380], ['Type', 'Risk', 'Mitigation', 'Owner'], [
  ['Legal', 'Simulated e-signature is not legally valid; using it for real deals is non-compliant', 'Connect a compliant provider and obtain legal sign-off before go-live; product refuses simulated providers in production', 'Product Owner / Legal'],
  ['External', 'AI output quality, cost and latency are unknown until a real provider is used', 'Run an evaluation pass on a real provider before enabling for the team', 'Solution Architect'],
  ['Integration', 'Email/calendar and e-signature depend on third-party approvals and lead times', 'Start provider selection and registrations early', 'Product Owner'],
  ['Security', 'Password-only auth; no MFA/SSO; no independent security review yet', 'Add MFA/SSO; commission an independent review before production', 'Solution Architect'],
  ['Business', 'Discount limits and approval rules are placeholders', 'Confirm pricing policy and whether an approval step is required', 'Sales leadership'],
  ['Delivery', 'Open decisions block committed dates for full Phase 1', 'Resolve Section 10 decisions to unlock planning', 'Product Owner'],
  ['Operational', 'Local-only storage and secrets; no production deployment/backup yet', 'Move to managed storage/secrets; set up deployment, backup, monitoring', 'Solution Architect'],
  ['Data', 'Only CSV import today; switching from other CRMs may need more', 'Decide if guided HubSpot/Pipedrive import is required', 'Product Owner'],
]));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 13 Benefits & metrics
S.push(h1('13. Business Benefits and Success Metrics'));
S.push(body('Success will be measured by reduced manual sales effort and improved visibility. The platform already records the data needed for most of these metrics. Baseline values should be measured before and after rollout — they are not assumed here.'));
S.push(dataTable([3100, 4480, 2500], ['KPI', 'How the platform enables measurement', 'Baseline'], [
  ['Time to create a proposal', 'Template generation + AI drafting replace manual writing', { text: 'To be measured' }],
  ['Time spent on manual follow-ups', 'Automated tasks, reminders and follow-up email drafts', { text: 'To be measured' }],
  ['Deal information completeness', 'Required fields, timelines and activity capture', { text: 'To be measured' }],
  ['Proposal turnaround time', 'Timestamps from deal creation to proposal sent', { text: 'To be measured' }],
  ['Buyer engagement visibility', 'View, reading-time and download tracking per link', { text: 'New capability' }],
  ['Signature turnaround time', 'Request-to-signed timestamps (once a real provider is live)', { text: 'To be measured' }],
  ['Sales pipeline reporting effort', 'Live dashboards and CSV export replace manual reports', { text: 'To be measured' }],
  ['CRM adoption & data quality', 'Active users, records created, audit completeness', { text: 'To be measured' }],
]));
S.push(new Paragraph({ children: [new PageBreak()] }));

// 14 Recommendations
S.push(h1('14. Final Recommendations'));
S.push(h2('14.1 What has been achieved'));
S.push(body('A working, tested Sales CRM covering the full internal sales journey: CRM records, leads, deals and pipeline, activities, proposals with pricing and PDF/DOCX output, secure sharing and a buyer portal, five AI assistance features with human approval, automation, reporting with export, administration and a complete audit trail. The whole journey runs end to end in the browser and is backed by 198 unit/integration tests and 24 browser tests.'));
S.push(h2('14.2 What remains'));
S.push(body('Real external integrations (e-signature, AI model, email/calendar), stronger authentication (MFA/SSO), a few CRM and reporting refinements, and production hardening (security review, performance, deployment, backup).'));
S.push(h2('14.3 What needs stakeholder approval'));
S.push(bullet('Confirm the single-company scope (recorded as decided) and the minimum internal release contents.'));
S.push(bullet('Select the e-signature, AI and email/calendar providers and approve the e-signature legal review.'));
S.push(bullet('Confirm pricing/discount limits and whether a proposal-approval step is required.'));
S.push(h2('14.4 What to prioritise next'));
S.push(bullet('Close the remaining Must CRM/reporting/notification gaps to reach a minimum usable internal release.'));
S.push(bullet('Begin provider selection for e-signature, AI and email in parallel (they have external lead times).'));
S.push(h2('14.5 Required before real sales operations'));
S.push(bullet('A legally-valid e-signature provider with legal sign-off.'));
S.push(bullet('A real AI provider with a data-handling agreement and an output-quality evaluation.'));
S.push(bullet('Real email delivery, MFA/SSO, an independent security review, and a production deployment with backup and monitoring.'));
S.push(new Paragraph({ children: [new PageBreak()] }));

// Glossary
S.push(h1('Glossary and Abbreviations'));
S.push(dataTable([2400, 7680], ['Term', 'Meaning'], [
  ['BRD', 'Business Requirements Document'],
  ['CRM', 'Customer Relationship Management'],
  ['HLD', 'High-Level Design (architecture)'],
  ['Must / Should / Could', 'Business priority of a requirement (MoSCoW)'],
  ['BR-XXX-NNN', 'Original BRD v2.0 requirement identifier (e.g. BR-PRP-001)'],
  ['OD', 'Open Decision recorded in the project’s decision register'],
  ['Single-tenant', 'One company/organisation per deployment and database'],
  ['Pipeline', 'The set of open deals by stage'],
  ['Buyer portal', 'External, secure web page where a recipient views a proposal'],
  ['E-signature', 'Electronic signature workflow and certificate'],
  ['Mock / Simulated', 'A built-in stand-in used in place of a real external service'],
  ['Immutable version', 'A sent proposal version that can no longer be changed'],
  ['Audit log', 'Append-only record of who changed what and when'],
  ['PDF / DOCX', 'Portable Document Format / Microsoft Word document'],
  ['MFA / SSO', 'Multi-factor authentication / single sign-on'],
]));
S.push(new Paragraph({ children: [new PageBreak()] }));

// Appendix A — traceability
S.push(h1('Appendix A — Requirement Traceability Matrix'));
S.push(body('All 130 BRD v2.0 requirements with priority and current implementation status (evidence basis: automated test suite and QA assessment). Status values follow Section 8.'));
S.push(dataTable([1400, 1700, 4300, 1000, 1680],
  ['Req ID', 'Module', 'Requirement (BRD v2.0, abbreviated)', 'Priority', 'Status'],
  REQS.map((r) => [
    { text: r.id, bold: true },
    MODMAP[r.mod] || r.mod,
    (r.short || '').slice(0, 150),
    { text: r.priority, align: AlignmentType.CENTER },
    { text: r.statusNorm, color: statusColor(r.statusNorm) },
  ]), { size: 14 }));
S.push(new Paragraph({ children: [new PageBreak()] }));

// Appendix B — decision register (compact restatement)
S.push(h1('Appendix B — Decision Register (summary)'));
S.push(body('A compact register of the open and decided business questions for tracking. Full context is in Section 10.'));
S.push(dataTable([1200, 4400, 1600, 2880], ['Ref', 'Decision', 'Status', 'Owner'], [
  ['D-01', 'Internal CRM vs commercial multi-organization platform', { text: 'Decided — single-company', color: GREEN }, 'Product Owner'],
  ['D-02', 'Organization-level data isolation', { text: 'Closed for Phase 1', color: MUT }, 'Product Owner'],
  ['D-03', 'Gmail or Microsoft Outlook integration', { text: 'Open', color: AMBER }, 'Product Owner'],
  ['D-04', 'Email sending & approval workflow / provider', { text: 'Open', color: AMBER }, 'Product Owner'],
  ['D-05', 'E-signature provider & legal validity', { text: 'Open', color: AMBER }, 'Product Owner / Legal'],
  ['D-06', 'AI provider & data privacy terms', { text: 'Open', color: AMBER }, 'Product Owner'],
  ['D-07', 'AI approval & governance thresholds', { text: 'Confirm', color: GREEN }, 'Product Owner'],
  ['D-08', 'Data migration from external CRM tools', { text: 'Open', color: AMBER }, 'Product Owner'],
  ['D-09', 'First-release priorities', { text: 'Open', color: AMBER }, 'Product Owner'],
  ['D-10', 'Pricing / discount / approval ownership', { text: 'Open', color: AMBER }, 'Sales leadership'],
]));
S.push(spacer(200));
S.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [t('— End of Document —', { italics: true, color: MUT, size: 18 })] }));

// ---------- assemble ----------
const numbering = {
  config: [{
    reference: 'bullets', levels: [
      { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 420, hanging: 220 } }, run: { font: FONT } } },
      { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 820, hanging: 220 } } } },
    ],
  }],
};
const styles = {
  default: {
    document: { run: { font: FONT, size: 21, color: INK }, paragraph: { spacing: { line: 276 } } },
    heading1: { run: { font: FONT, size: 30, bold: true, color: NAVY }, paragraph: { spacing: { before: 280, after: 140 }, keepNext: true, outlineLevel: 0 } },
    heading2: { run: { font: FONT, size: 24, bold: true, color: '2E5E86' }, paragraph: { spacing: { before: 200, after: 100 }, keepNext: true, outlineLevel: 1 } },
    heading3: { run: { font: FONT, size: 21, bold: true, color: INK }, paragraph: { spacing: { before: 140, after: 80 }, keepNext: true, outlineLevel: 2 } },
  },
};
const header = new Header({ children: [new Paragraph({ tabStops: [{ type: TabStopType.RIGHT, position: CONTENT_W }], border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } }, children: [t('Sales CRM Platform — Business Requirements Document', { size: 15, color: MUT }), t('\tv1.0 · Confidential', { size: 15, color: MUT })] })] });
const footer = new Footer({ children: [new Paragraph({ tabStops: [{ type: TabStopType.CENTER, position: CONTENT_W / 2 }, { type: TabStopType.RIGHT, position: CONTENT_W }], border: { top: { style: BorderStyle.SINGLE, size: 4, color: LINE, space: 4 } }, children: [t('Draft for Business Review', { size: 15, color: MUT }), new TextRun({ children: ['\tPage ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: FONT, size: 15, color: MUT }), t('\t18 Nov 2026', { size: 15, color: MUT })] })] });

const doc = new Document({
  creator: 'Sales CRM Business Analysis', title: 'Sales CRM Platform — Business Requirements Document', description: 'BRD v1.0',
  styles, numbering,
  sections: [
    { properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1080, bottom: 1080, left: 1080, right: 1080 } } }, children: cover() },
    {
      properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1320, bottom: 1200, left: 1080, right: 1080 } } },
      headers: { default: header }, footers: { default: footer },
      children: [...docControl(), ...toc(), ...S],
    },
  ],
});

Packer.toBuffer(doc).then((buf) => {
  const out = path.join(BR, 'Sales_CRM_Business_Requirements_Document_v1.0.docx');
  fs.writeFileSync(out, buf);
  console.log('DOCX written:', out, Math.round(buf.length / 1024) + 'KB', '| reqs:', REQS.length);
}).catch((e) => { console.error('BUILD ERROR', e); process.exit(1); });
