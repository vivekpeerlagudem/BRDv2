/**
 * Automation (BR-AUT-001..008, ADR-024 built-in rules), notifications (BR-NTF-001..003) and the job runner.
 * Jobs are written to job_outbox inside business transactions (ADR-022 fallback path) and executed here:
 * at-least-once delivery, so every handler is idempotent (unique idempotency / dedupe keys).
 */
import { and, asc, eq, inArray, isNull, lte, sql } from 'drizzle-orm';
import { type AppContext, conflict, loadDealFor, lockRow, notFound, SYSTEM, schema, type Uow, type UserActor, unitOfWork } from '../platform/core.ts';
import { applyClose, todayIso } from './crm.ts';
import { isStalled, reversalConflicts, shouldMoveToProposalStage } from './domain.ts';
import * as esign from './esign.ts';
import { applyProposalEvent, expireProposals } from './proposals.ts';
import * as weeklyReports from './weekly-reports.ts';

const {
  jobOutbox,
  automationExecution,
  notification,
  deal,
  pipelineStage,
  proposal,
  proposalVersion,
  task,
  dealFlag,
  organizationSettings,
  appUserProfile,
  dealStageHistory,
  viewSession,
  shareLink,
} = schema;
type Event = { name: string; dealId?: string; proposalId?: string; versionId?: string; [k: string]: unknown };

// ───────────── notifications ─────────────
async function notify(
  _ctx: AppContext,
  u: Uow,
  n: { userId: string; eventType: string; dealId?: string | null; title: string; body: string; linkPath: string; dedupeKey: string; email?: boolean },
) {
  const [user] = await u.tx
    .select({ status: appUserProfile.status, email: appUserProfile.email })
    .from(appUserProfile)
    .where(eq(appUserProfile.userId, n.userId));
  if (user?.status !== 'active') return;
  const inserted = await u.tx
    .insert(notification)
    .values({
      recipientUserId: n.userId,
      eventType: n.eventType,
      dealId: n.dealId ?? null,
      title: n.title,
      body: n.body,
      linkPath: n.linkPath,
      dedupeKey: n.dedupeKey,
      emailStatus: n.email ? 'queued' : 'not_sent',
    })
    .onConflictDoNothing()
    .returning();
  if (inserted.length && n.email) await u.enqueue('notify.email', { notificationId: inserted[0]!.id });
}
/** Recipient = the deal's CURRENT owner when the handler runs, so reassignment re-targets alerts. */
async function dealOwner(u: Uow, dealId: string) {
  const [d] = await u.tx.select({ ownerId: deal.ownerId, name: deal.name }).from(deal).where(eq(deal.id, dealId));
  return d!;
}

const fourHourBucket = (ctx: AppContext) => Math.floor(ctx.now().getTime() / (4 * 3_600_000));

async function notificationsFor(ctx: AppContext, u: Uow, e: Event) {
  if (e.name === 'lead.assigned')
    return notify(ctx, u, {
      userId: e.userId as string,
      eventType: 'new_lead_assigned',
      dealId: e.dealId as string | null,
      title: 'New lead assigned to you',
      body: 'A website enquiry was assigned to you.',
      linkPath: e.dealId ? `/deals/${e.dealId}` : `/contacts/${e.contactId}`,
      dedupeKey: `lead:${e.submissionId}`,
      email: true,
    });
  if (e.name === 'task.assigned') {
    const [t] = await u.tx
      .select()
      .from(task)
      .where(eq(task.id, e.taskId as string));
    if (t)
      return notify(ctx, u, {
        userId: t.assigneeId,
        eventType: 'task_assigned',
        title: 'Task assigned to you',
        body: t.title,
        linkPath: '/tasks',
        dedupeKey: `task_assigned:${t.id}`,
      });
    return;
  }
  if (!e.dealId) return;
  const d = await dealOwner(u, e.dealId);
  const link = e.proposalId ? `/proposals/${e.proposalId}` : `/deals/${e.dealId}`;
  const base = { userId: d.ownerId, dealId: e.dealId, linkPath: link };
  switch (e.name) {
    case 'proposal.view_counted':
      if (e.isFirstOfVersion)
        return notify(ctx, u, {
          ...base,
          eventType: 'proposal_first_open',
          title: `${e.viewerName} opened your proposal`,
          body: d.name,
          dedupeKey: `first_open:${e.versionId}`,
          email: true,
        });
      if (e.isReopen)
        return notify(ctx, u, {
          ...base,
          eventType: 'proposal_reopen',
          title: `${e.viewerName} reopened your proposal`,
          body: d.name,
          dedupeKey: `reopen:${e.viewerIdentityId}:${fourHourBucket(ctx)}`,
        });
      return;
    case 'share.forwarded_viewer_identified':
      return notify(ctx, u, {
        ...base,
        eventType: 'proposal_forwarded_new_viewer',
        title: `New stakeholder: ${e.viewerName}`,
        body: `The proposal for ${d.name} was forwarded to a new viewer.`,
        dedupeKey: `fwd:${e.proposalId}:${e.contactId}`,
        email: true,
      });
    case 'proposal.downloaded':
      return notify(ctx, u, {
        ...base,
        eventType: 'proposal_downloaded',
        title: `${e.viewerName} downloaded your proposal`,
        body: d.name,
        dedupeKey: `dl:${e.viewerIdentityId}:${e.versionId}:${fourHourBucket(ctx)}`,
      });
    case 'proposal.accepted':
      return notify(ctx, u, {
        ...base,
        eventType: 'proposal_accepted',
        title: 'Proposal accepted',
        body: `${e.by} accepted the proposal for ${d.name}.`,
        dedupeKey: `accepted:${e.versionId}`,
        email: true,
      });
    case 'proposal.declined':
      return notify(ctx, u, {
        ...base,
        eventType: 'proposal_declined',
        title: 'Proposal declined',
        body: `${e.by} declined the proposal for ${d.name}: ${e.reason ?? ''}`,
        dedupeKey: `declined:${e.versionId}`,
        email: true,
      });
    case 'signature.signer_signed':
      return notify(ctx, u, { ...base, eventType: 'signer_signed', title: `${e.signerName} signed`, body: d.name, dedupeKey: `signer:${e.signerId}` });
    case 'signature_request.completed':
      return notify(ctx, u, {
        ...base,
        eventType: 'proposal_signed',
        title: 'Proposal fully signed',
        body: `All signers signed the proposal for ${d.name}.`,
        dedupeKey: `signed:${e.signatureRequestId}`,
        email: true,
      });
    case 'signature_request.stale_completion':
      return notify(ctx, u, {
        ...base,
        eventType: 'signed_on_stale_version',
        title: 'Signed on an outdated version — review required',
        body: d.name,
        dedupeKey: `stale:${e.signatureRequestId}`,
        email: true,
      });
    case 'proposal.expired':
      return notify(ctx, u, { ...base, eventType: 'proposal_expired', title: 'Proposal expired', body: d.name, dedupeKey: `expired:${e.proposalId}` });
    case 'deal.flagged':
      return notify(ctx, u, {
        ...base,
        eventType: 'deal_stalled',
        title: 'Deal stalled',
        body: `No activity on ${d.name}.`,
        dedupeKey: `stalled:${e.dealId}:${e.key}`,
      });
  }
}

// ───────────── automation rules ─────────────
/** Records an execution once per idempotency key; returns null if this trigger was already handled (RULE-AUT-03). */
async function beginExecution(u: Uow, ruleKey: string, idempotencyKey: string, target: { type: string; id: string }) {
  const [row] = await u.tx
    .insert(automationExecution)
    .values({ ruleKey, idempotencyKey, targetType: target.type, targetId: target.id, status: 'applied' })
    .onConflictDoNothing()
    .returning();
  return row ?? null;
}
const skip = (u: Uow, id: string, reason: string) =>
  u.tx.update(automationExecution).set({ status: 'skipped_precondition', skipReason: reason }).where(eq(automationExecution.id, id));

async function createAutomationTask(ctx: AppContext, u: Uow, execId: string, dealId: string, title: string, description: string | null, dueInDays: number) {
  const d = await dealOwner(u, dealId);
  const [t] = await u.tx
    .insert(task)
    .values({
      title,
      description,
      relatedType: 'deal',
      relatedId: dealId,
      assigneeId: d.ownerId,
      dueAt: new Date(ctx.now().getTime() + dueInDays * 86_400_000),
      source: 'automation',
      automationExecutionId: execId,
    })
    .returning();
  await u.tx.update(automationExecution).set({ createdTaskId: t!.id }).where(eq(automationExecution.id, execId));
  await u.timeline({
    eventType: 'automation_applied',
    source: { type: 'task', id: t!.id },
    summary: `Task created automatically: ${title}`,
    anchors: [{ type: 'deal', id: dealId }],
    isAutomated: true,
    automationExecutionId: execId,
  });
}

async function automationFor(ctx: AppContext, u: Uow, e: Event) {
  const [settings] = await u.tx.select({ a: organizationSettings.automationSettings }).from(organizationSettings);
  const cfg = settings!.a;
  if (e.name === 'proposal.version_sent' && e.dealId && e.versionId) {
    // BR-AUT-004: check for engagement after N days (delayed job).
    await u.enqueue(
      'automation.aut004',
      { versionId: e.versionId, proposalId: e.proposalId, dealId: e.dealId },
      new Date(ctx.now().getTime() + cfg.followUpAfterDays * 86_400_000),
    );
    if (!cfg.aut001Enabled) return;
    // BR-AUT-001: proposal sent → move the deal to the configured stage if it is at an earlier stage.
    const exec = await beginExecution(u, 'aut_001_stage_on_send', `AUT-001:${e.versionId}`, { type: 'deal', id: e.dealId });
    if (!exec) return;
    await lockRow(u.tx, 'deal', e.dealId);
    const [d] = await u.tx.select().from(deal).where(eq(deal.id, e.dealId));
    const stages = await u.tx.select().from(pipelineStage).where(eq(pipelineStage.pipelineId, d!.pipelineId));
    const current = stages.find((s) => s.id === d!.stageId)!;
    const target = stages.find((s) => s.isProposalSentTarget && s.kind === 'open');
    if (!shouldMoveToProposalStage({ status: d!.status, stageOrder: current.sortOrder }, target?.sortOrder ?? null))
      return skip(u, exec.id, 'ALREADY_AT_OR_PAST_TARGET');
    await u.tx
      .update(deal)
      .set({ stageId: target!.id, stageEnteredAt: ctx.now(), rowVersion: sql`${deal.rowVersion} + 1` })
      .where(eq(deal.id, d!.id));
    await u.tx.insert(dealStageHistory).values({ dealId: d!.id, fromStageId: d!.stageId, toStageId: target!.id, actorType: 'system' });
    await u.tx
      .update(automationExecution)
      .set({ beforeSnapshot: { stageId: d!.stageId }, afterSnapshot: { stageId: target!.id } })
      .where(eq(automationExecution.id, exec.id));
    await u.audit('automation.applied', { type: 'deal', id: d!.id }, { rule: 'AUT-001', to: target!.name });
    await u.timeline({
      eventType: 'automation_applied',
      source: { type: 'deal', id: d!.id },
      summary: `Stage moved to ${target!.name} because a proposal was sent`,
      anchors: [{ type: 'deal', id: d!.id }],
      isAutomated: true,
      automationExecutionId: exec.id,
    });
    return;
  }
  if (e.name === 'signature_request.completed' && e.dealId && cfg.aut002Enabled) {
    // BR-AUT-002: all signers signed → Closed Won, amount from the proposal (TCV excl. tax, OD-16), close date = signing date.
    const exec = await beginExecution(u, 'aut_002_won_on_signed', `AUT-002:${e.signatureRequestId}`, { type: 'deal', id: e.dealId });
    if (!exec) return;
    await lockRow(u.tx, 'deal', e.dealId);
    const [d] = await u.tx.select().from(deal).where(eq(deal.id, e.dealId));
    if (d!.status !== 'open') return skip(u, exec.id, d!.status === 'won' ? 'DEAL_ALREADY_WON' : 'DEAL_LOST'); // RULE-AUT-21
    const [v] = await u.tx
      .select({ totals: proposalVersion.totals })
      .from(proposalVersion)
      .where(eq(proposalVersion.id, e.versionId as string));
    const amount = (v!.totals as { tcvExclTax: string }).tcvExclTax;
    const closeDate = todayIso(ctx);
    const wonStage = await applyClose(
      ctx,
      u,
      d!,
      'won',
      { amount, closeDate, wonFromProposalId: e.proposalId as string, amountSource: 'automation' },
      { isAutomated: true, automationExecutionId: exec.id },
    );
    // OD-23: other open proposals of the deal are voided automatically (prior status kept so it can be reversed).
    const siblings = await u.tx
      .select()
      .from(proposal)
      .where(and(eq(proposal.dealId, d!.id), inArray(proposal.status, ['draft', 'sent', 'viewed', 'accepted'])));
    const related: { proposalId: string; priorStatus: string }[] = [];
    for (const s of siblings.filter((x) => x.id !== e.proposalId)) {
      await applyProposalEvent(ctx, u.tx, s.id, 'void', { voidReason: 'Another proposal was signed', voidKind: 'automation' });
      related.push({ proposalId: s.id, priorStatus: s.status });
    }
    await u.tx
      .update(automationExecution)
      .set({
        beforeSnapshot: { stageId: d!.stageId, amount: d!.amount, closeDate: d!.closeDate, amountSource: d!.amountSource },
        afterSnapshot: { stageId: wonStage.id, amount, closeDate },
        relatedChanges: related,
      })
      .where(eq(automationExecution.id, exec.id));
    return;
  }
  if ((e.name === 'proposal.declined' || e.name === 'proposal.accepted') && e.dealId) {
    // BR-AUT-003 / OD-17: a task for the owner — the deal is never closed automatically here.
    const declined = e.name === 'proposal.declined';
    const exec = await beginExecution(u, declined ? 'aut_003_task_on_decline' : 'od17_task_on_accept', `${declined ? 'AUT-003' : 'OD17'}:${e.versionId}`, {
      type: 'deal',
      id: e.dealId,
    });
    if (!exec) return;
    const [d] = await u.tx.select({ status: deal.status }).from(deal).where(eq(deal.id, e.dealId));
    if (d!.status !== 'open') return skip(u, exec.id, 'DEAL_CLOSED');
    await createAutomationTask(
      ctx,
      u,
      exec.id,
      e.dealId,
      declined ? 'Record outcome — proposal was declined' : 'Confirm Closed Won — proposal accepted',
      declined ? `Reason: ${e.reason ?? 'not given'}` : null,
      declined ? 1 : 0,
    );
  }
}

/** BR-AUT-004: no view and no answer N days after sending → follow-up task (RULE-AUT-61). */
async function aut004(ctx: AppContext, payload: { versionId: string; proposalId: string; dealId: string }) {
  await unitOfWork(ctx, SYSTEM, async (u) => {
    const exec = await beginExecution(u, 'aut_004_follow_up_unanswered', `AUT-004:${payload.versionId}`, { type: 'deal', id: payload.dealId });
    if (!exec) return;
    const [p] = await u.tx.select().from(proposal).where(eq(proposal.id, payload.proposalId));
    const [d] = await u.tx.select({ status: deal.status }).from(deal).where(eq(deal.id, payload.dealId));
    if (!p || p.lastSentVersionId !== payload.versionId) return skip(u, exec.id, 'SUPERSEDED');
    if (p.status !== 'sent' || d?.status !== 'open') return skip(u, exec.id, 'VIEWED_OR_ANSWERED');
    await createAutomationTask(ctx, u, exec.id, payload.dealId, `Follow up on "${p.title}" — not yet viewed`, null, 0);
  });
}

/** BR-AUT-008: users can reverse an automated change — only if the automated values are still in place (RULE-AUT-06). */
export async function reverseExecution(ctx: AppContext, actor: UserActor, id: string) {
  return unitOfWork(ctx, actor, async (u) => {
    const [exec] = await u.tx.select().from(automationExecution).where(eq(automationExecution.id, id));
    if (exec?.targetType !== 'deal') throw notFound('Automation');
    await lockRow(u.tx, 'deal', exec.targetId);
    const d = await loadDealFor(u.tx, actor, exec.targetId, 'write', 'automation.reverse');
    if (exec.status === 'reversed') throw conflict('AUTOMATION_ALREADY_REVERSED', 'This automated change was already reversed');
    if (exec.status !== 'applied') throw conflict('AUTOMATION_REVERSAL_STALE', 'This automation made no change');
    if (exec.createdTaskId) {
      const cancelled = await u.tx
        .update(task)
        .set({ status: 'cancelled' })
        .where(and(eq(task.id, exec.createdTaskId), eq(task.status, 'open')))
        .returning();
      if (!cancelled.length) throw conflict('AUTOMATION_REVERSAL_STALE', 'The task was already completed');
    }
    const after = (exec.afterSnapshot ?? {}) as Record<string, unknown>;
    const before = (exec.beforeSnapshot ?? {}) as Record<string, string | null>;
    if (Object.keys(after).length) {
      const conflicts = reversalConflicts(after, d as unknown as Record<string, unknown>);
      if (conflicts.length) throw conflict('AUTOMATION_REVERSAL_STALE', 'The record changed after the automation ran', { fields: conflicts });
      const [stage] = await u.tx
        .select()
        .from(pipelineStage)
        .where(eq(pipelineStage.id, before.stageId as string));
      await u.tx
        .update(deal)
        .set({
          stageId: stage!.id,
          status: stage!.kind,
          ...(exec.ruleKey === 'aut_002_won_on_signed'
            ? { amount: before.amount, closeDate: before.closeDate, amountSource: before.amountSource ?? 'manual', closedAt: null, wonFromProposalId: null }
            : {}),
          stageEnteredAt: ctx.now(),
          rowVersion: sql`${deal.rowVersion} + 1`,
        })
        .where(eq(deal.id, d.id));
      await u.tx.insert(dealStageHistory).values({
        dealId: d.id,
        fromStageId: d.stageId,
        toStageId: stage!.id,
        actorType: 'user',
        actorUserId: actor.userId,
        reason: 'Automated change reversed',
      });
      // OD-24: sibling proposals voided by the automation get their previous status back; the signed proposal stays signed.
      for (const r of exec.relatedChanges)
        await u.tx
          .update(proposal)
          .set({ status: r.priorStatus as 'draft', voidReason: null, voidKind: null, statusBeforeVoid: null })
          .where(and(eq(proposal.id, r.proposalId), eq(proposal.voidKind, 'automation')));
    }
    // The idempotency key is kept, so the same trigger can never fire this rule again (RULE-AUT-03).
    await u.tx.update(automationExecution).set({ status: 'reversed', reversedAt: ctx.now(), reversedBy: actor.userId }).where(eq(automationExecution.id, id));
    await u.audit('automation.reversed', { type: 'deal', id: d.id }, { rule: exec.ruleKey });
    await u.timeline({
      eventType: 'automation_reversed',
      source: { type: 'deal', id: d.id },
      summary: 'An automated change was reversed',
      anchors: [{ type: 'deal', id: d.id }],
    });
    return { id };
  });
}

/** Scheduled scans: stalled deals (BR-AUT-005), overdue deals (BR-AUT-006), proposal expiry, e-sign reconciliation, task reminders. */
export async function runScheduledScans(ctx: AppContext) {
  const now = ctx.now();
  const open = await ctx.db
    .select({
      id: deal.id,
      status: deal.status,
      lastActivityAt: deal.lastActivityAt,
      createdAt: deal.createdAt,
      closeDate: deal.closeDate,
      threshold: pipelineStage.stallThresholdDays,
    })
    .from(deal)
    .innerJoin(pipelineStage, eq(pipelineStage.id, deal.stageId))
    .where(and(eq(deal.status, 'open'), isNull(deal.archivedAt)));
  let flagged = 0;
  for (const d of open) {
    const kinds: ('stalled' | 'past_close_date')[] = [];
    if (isStalled(d, d.threshold, now)) kinds.push('stalled');
    if (d.closeDate && d.closeDate < now.toISOString().slice(0, 10)) kinds.push('past_close_date');
    for (const kind of kinds) {
      await unitOfWork(ctx, SYSTEM, async (u) => {
        const inserted = await u.tx.insert(dealFlag).values({ dealId: d.id, kind }).onConflictDoNothing().returning();
        if (!inserted.length) return;
        flagged++;
        await u.timeline({
          eventType: 'automation_applied',
          source: { type: 'deal', id: d.id },
          summary: kind === 'stalled' ? 'Flagged as stalled — no recent activity' : 'Flagged — past expected close date',
          anchors: [{ type: 'deal', id: d.id }],
          isAutomated: true,
        });
        if (kind === 'stalled') await u.enqueue('event', { name: 'deal.flagged', dealId: d.id, key: (d.lastActivityAt ?? d.createdAt).toISOString() });
      });
    }
  }
  const expired = await expireProposals(ctx, { voidOpenSignature: esign.voidOpenSignature });
  const reconciled = await esign.reconcile(ctx);
  // Task reminders (BR-CRM-008): notify once when an open task becomes due.
  const due = await ctx.db
    .select()
    .from(task)
    .where(and(eq(task.status, 'open'), lte(task.dueAt, now), isNull(task.reminderSentAt)))
    .limit(200);
  for (const t of due) {
    await unitOfWork(ctx, SYSTEM, async (u) => {
      await u.tx.update(task).set({ reminderSentAt: now }).where(eq(task.id, t.id));
      await notify(ctx, u, {
        userId: t.assigneeId,
        eventType: 'task_due',
        title: 'Task due',
        body: t.title,
        linkPath: '/tasks',
        dedupeKey: `task_due:${t.id}`,
        email: true,
      });
    });
  }
  // Weekly Report Agents: queue one run per company with an estimates sheet once the weekly run time has passed.
  const weekly = await weeklyReports.scheduleWeeklyReports(ctx);
  return { flagged, expired, reconciled, reminders: due.length, weeklyReports: weekly };
}

// ───────────── job runner ─────────────
async function handle(ctx: AppContext, queue: string, payload: Record<string, unknown>) {
  switch (queue) {
    case 'event':
      return unitOfWork(ctx, SYSTEM, async (u) => {
        await notificationsFor(ctx, u, payload as Event);
        await automationFor(ctx, u, payload as Event);
      });
    case 'automation.aut004':
      return aut004(ctx, payload as { versionId: string; proposalId: string; dealId: string });
    case 'esign.dispatch':
      return esign.dispatch(ctx, payload.signatureRequestId as string);
    case 'esign.webhook':
      return esign.processWebhook(ctx, payload.envelopeId as string, payload.inboxId as string | undefined);
    case 'esign.fetch-signed':
      return esign.fetchSigned(ctx, payload.signatureRequestId as string);
    case 'weekly_report.run':
      // A scheduled report nobody asked for by hand: tell the person it ran as (the company owner) that it is ready.
      return weeklyReports.runJob(ctx, payload.runId as string, {
        onDraftReady: async (u, info) => {
          if (info.run.trigger !== 'schedule') return;
          await notify(ctx, u, {
            userId: info.run.runAsUserId,
            eventType: 'weekly_report_ready',
            title: `Weekly report ready for ${info.clientName}`,
            body: info.status === 'ready' ? 'The draft is ready for your review.' : 'The draft needs your attention before it can be approved.',
            linkPath: `/weekly-reports/${info.run.id}`,
            dedupeKey: `weekly_report_ready:${info.run.id}`,
          });
        },
      });
    case 'weekly_report.redraft':
      return weeklyReports.redraftJob(ctx, payload.runId as string);
    case 'esign.void':
      return ctx.esign.voidEnvelope(payload.envelopeId as string, payload.reason as string);
    case 'notify.email': {
      const [n] = await ctx.db
        .select({ n: notification, email: appUserProfile.email })
        .from(notification)
        .innerJoin(appUserProfile, eq(appUserProfile.userId, notification.recipientUserId))
        .where(eq(notification.id, payload.notificationId as string));
      if (n?.n.emailStatus !== 'queued') return;
      await ctx.email.send({ to: n.email, subject: n.n.title, text: `${n.n.body}\n\n${ctx.config.APP_ORIGIN}${n.n.linkPath}` });
      await ctx.db.update(notification).set({ emailStatus: 'sent' }).where(eq(notification.id, n.n.id));
      return;
    }
    default:
      throw new Error(`Unknown queue ${queue}`);
  }
}

const MAX_ATTEMPTS = 5;
/**
 * Claims due jobs with FOR UPDATE SKIP LOCKED (safe with several workers), runs each, and retries failures with
 * exponential backoff. After MAX_ATTEMPTS a job is parked as `failed` (dead letter) for an Admin to inspect.
 * Loops until no due job is left, so chained jobs (event → automation → notification email) finish in one call.
 */
export async function runDueJobs(ctx: AppContext, maxRounds = 20): Promise<number> {
  let processed = 0;
  for (let round = 0; round < maxRounds; round++) {
    const claimed = await ctx.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(jobOutbox)
        .where(and(eq(jobOutbox.status, 'pending'), lte(jobOutbox.runAfter, ctx.now())))
        .orderBy(asc(jobOutbox.createdAt))
        .limit(25)
        .for('update', { skipLocked: true });
      // Lease: push run_after forward so a crashed worker's jobs become visible again after a minute.
      if (rows.length)
        await tx
          .update(jobOutbox)
          .set({ runAfter: new Date(ctx.now().getTime() + 60_000), attempts: sql`${jobOutbox.attempts} + 1` })
          .where(
            inArray(
              jobOutbox.id,
              rows.map((r) => r.id),
            ),
          );
      return rows;
    });
    if (!claimed.length) break;
    for (const job of claimed) {
      try {
        await handle(ctx, job.queue, job.payload as Record<string, unknown>);
        await ctx.db.update(jobOutbox).set({ status: 'done' }).where(eq(jobOutbox.id, job.id));
      } catch (error) {
        const attempts = job.attempts + 1;
        ctx.logger.error({ err: error, queue: job.queue, jobId: job.id, attempts }, 'job failed');
        await ctx.db
          .update(jobOutbox)
          .set({
            status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending',
            lastError: String(error).slice(0, 500),
            runAfter: new Date(ctx.now().getTime() + 30_000 * 2 ** attempts),
          })
          .where(eq(jobOutbox.id, job.id));
      }
      processed++;
    }
  }
  return processed;
}

// ───────────── notification reads ─────────────
export async function listNotifications(ctx: AppContext, actor: UserActor, since: number) {
  const items = await ctx.db
    .select()
    .from(notification)
    .where(and(eq(notification.recipientUserId, actor.userId), sql`${notification.seq} > ${since}`))
    .orderBy(sql`${notification.seq} desc`)
    .limit(50);
  const [unread] = await ctx.db
    .select({ n: sql<number>`count(*)::int` })
    .from(notification)
    .where(and(eq(notification.recipientUserId, actor.userId), isNull(notification.readAt)));
  return { items, unreadCount: unread?.n ?? 0 };
}
export async function markNotificationsRead(ctx: AppContext, actor: UserActor) {
  await ctx.db
    .update(notification)
    .set({ readAt: ctx.now() })
    .where(and(eq(notification.recipientUserId, actor.userId), isNull(notification.readAt)));
}
export async function listExecutions(ctx: AppContext, actor: UserActor, dealId: string) {
  await loadDealFor(ctx.db, actor, dealId, 'read');
  return ctx.db
    .select()
    .from(automationExecution)
    .where(and(eq(automationExecution.targetType, 'deal'), eq(automationExecution.targetId, dealId)))
    .orderBy(sql`${automationExecution.executedAt} desc`);
}
/** Engagement summary for a deal: who viewed, for how long, which sections (BR-SHR-004/008). */
export async function engagementForDeal(ctx: AppContext, actor: UserActor, dealId: string) {
  await loadDealFor(ctx.db, actor, dealId, 'read');
  const [row] = await ctx.db
    .select({
      views: sql<number>`count(*)::int`,
      seconds: sql<number>`coalesce(sum(${viewSession.activeSeconds}),0)::int`,
      viewers: sql<number>`count(distinct ${viewSession.viewerIdentityId})::int`,
      last: sql<Date | null>`max(${viewSession.startedAt})`,
    })
    .from(viewSession)
    .innerJoin(shareLink, eq(shareLink.id, viewSession.shareLinkId))
    .where(and(eq(viewSession.dealId, dealId), eq(viewSession.counted, true)));
  return row!;
}
