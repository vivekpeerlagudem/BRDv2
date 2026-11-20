/**
 * crm module — companies, contacts, deals, pipeline, tasks, notes, call/meeting logs, timeline, search and
 * lead intake (BR-CRM-001..014, BR-LED-001..006, BR-TIM-001..004). Every query is permission-scoped (ADR-076).
 */

import type {
  activityInput,
  closeLostInput,
  companyInput,
  contactCreateInput,
  contactInput,
  dealContactInput,
  dealInput,
  dealPatch,
  leadConvertInput,
  leadDisqualifyInput,
  leadInput,
  leadPatch,
  leadSubmissionInput,
  noteInput,
  pageQuerySchema,
  taskInput,
} from '@crm/shared';
import { and, asc, desc, eq, exists, ilike, inArray, isNull, ne, or, type SQL, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  type AppContext,
  canAccessOwner,
  conflict,
  forbidden,
  loadDealFor,
  lockRow,
  normalizeDomain,
  normalizeEmail,
  notFound,
  ownerScope,
  requireConfirmations,
  requirePerm,
  rule,
  SYSTEM,
  schema,
  type Tx,
  type Uow,
  type UserActor,
  unitOfWork,
} from '../platform/core.ts';
import { DomainError } from '../platform/errors/domain-error.ts';

const {
  company,
  contact,
  deal,
  dealContact,
  dealStageHistory,
  pipelineStage,
  lostReason,
  task,
  note,
  activityLog,
  timelineEvent,
  timelineEventAnchor,
  appUserProfile,
  dealFlag,
  lead,
  leadSubmission,
  organizationSettings,
  notification,
} = schema;
type Page = z.infer<typeof pageQuerySchema>;
type Related = { relatedType: 'company' | 'contact' | 'deal'; relatedId: string };

// ───────────── visibility predicates ─────────────
const dealVisible = (actor: UserActor) => ownerScope(actor, deal.ownerId, 'deals');
/** R6: a company/contact is readable by its owner scope OR through any deal the actor can see. */
function companyVisible(actor: UserActor, db: AppContext['db']): SQL {
  return or(
    ownerScope(actor, company.ownerId, 'companies'),
    exists(
      db
        .select({ x: sql`1` })
        .from(deal)
        .where(and(eq(deal.companyId, company.id), dealVisible(actor))),
    ),
  )!;
}
function contactVisible(actor: UserActor, db: AppContext['db']): SQL {
  return or(
    ownerScope(actor, contact.ownerId, 'contacts'),
    exists(
      db
        .select({ x: sql`1` })
        .from(dealContact)
        .innerJoin(deal, eq(deal.id, dealContact.dealId))
        .where(and(eq(dealContact.contactId, contact.id), dealVisible(actor))),
    ),
  )!;
}
const like = (q: string) => `%${q.replaceAll(/[%_\\]/g, '\\$&')}%`;

// ───────────── edit helpers ─────────────
/** Blank text means "no value": stored as NULL so a field can be cleared from an edit form. */
const blank = (v: string | null | undefined): string | null => {
  const t = v?.trim();
  return t ? t : null;
};
const normalizeName = (n: string) => n.trim().toLowerCase().replace(/\s+/g, ' ');
const stale = (what: string) => conflict('CONCURRENT_MODIFICATION', `This ${what} was changed by someone else. Reload and try again.`);
const archived = (what: string) => rule('RECORD_ARCHIVED', `This ${what} is archived and cannot be changed`);
type Changes = Record<string, { from: unknown; to: unknown }>;
/** Field-level before/after of the values that really changed (written to the audit log, BR-PLT audit). */
function changesBetween(before: Record<string, unknown>, after: Record<string, unknown>): Changes {
  const out: Changes = {};
  for (const [k, to] of Object.entries(after)) {
    const from = before[k] ?? null;
    if (from !== (to ?? null)) out[k] = { from, to: to ?? null };
  }
  return out;
}
async function userName(tx: Tx, userId: string): Promise<string> {
  const [u] = await tx.select({ fullName: appUserProfile.fullName }).from(appUserProfile).where(eq(appUserProfile.userId, userId));
  return u?.fullName ?? 'Unknown user';
}
/** RULE-CRM-09: a manager may hand a record only to someone inside the teams they manage (or themselves). */
function assertReassignTarget(actor: UserActor, ownerId: string): void {
  if (actor.role === 'sales_manager' && !actor.teamScopeIds.includes(ownerId))
    throw forbidden('REASSIGN_TARGET_OUT_OF_SCOPE', 'Managers can reassign only within their team');
}

/** The contract checks only the YYYY-MM-DD shape; a date that is not on the calendar (2027-02-31) is a field error, not a database failure. */
function assertCalendarDate(value: string | null | undefined, path: string): void {
  if (!value) return;
  const d = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value)
    throw new DomainError('VALIDATION_FAILED', 400, 'Some fields are not valid', {
      errors: [{ path, code: 'invalid_date', message: 'is not a real calendar date' }],
    });
}
/**
 * RULE-CRM-09: the new owner is told about a record handed to them (in-app notification, written in the same
 * transaction as the change). Nobody is notified about a record they assigned to themselves.
 */
async function notifyNewOwner(u: Uow, actor: UserActor, rec: { type: 'deal' | 'company'; id: string; name: string; rowVersion: number }, ownerId: string) {
  if (ownerId === actor.userId) return;
  await u.tx
    .insert(notification)
    .values({
      recipientUserId: ownerId,
      eventType: 'record_assigned',
      dealId: rec.type === 'deal' ? rec.id : null,
      title: `${actor.name} assigned a ${rec.type} to you`,
      body: rec.name,
      linkPath: rec.type === 'deal' ? `/deals/${rec.id}` : `/companies/${rec.id}`,
      dedupeKey: `owner_changed:${rec.type}:${rec.id}:${rec.rowVersion}`,
    })
    .onConflictDoNothing();
}

// ───────────── companies ─────────────
export async function listCompanies(ctx: AppContext, actor: UserActor, page: Page) {
  const where = and(
    isNull(company.archivedAt),
    companyVisible(actor, ctx.db),
    page.q ? or(ilike(company.name, like(page.q)), ilike(company.domain, like(page.q))) : undefined,
    page.ownerId ? eq(company.ownerId, page.ownerId) : undefined,
  );
  const items = await ctx.db
    .select({
      id: company.id,
      name: company.name,
      domain: company.domain,
      industry: company.industry,
      ownerId: company.ownerId,
      ownerName: appUserProfile.fullName,
      updatedAt: company.updatedAt,
    })
    .from(company)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, company.ownerId))
    .where(where)
    .orderBy(asc(company.name))
    .limit(page.limit)
    .offset(page.offset);
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(company).where(where);
  return { items, total: count?.n ?? 0 };
}

export async function getCompany(ctx: AppContext, actor: UserActor, id: string) {
  const [row] = await ctx.db
    .select()
    .from(company)
    .where(and(eq(company.id, id), companyVisible(actor, ctx.db)));
  if (!row) throw notFound('Company');
  const contacts = await ctx.db
    .select({ id: contact.id, firstName: contact.firstName, lastName: contact.lastName, email: contact.email, jobTitle: contact.jobTitle })
    .from(contact)
    .where(and(eq(contact.companyId, id), isNull(contact.archivedAt), contactVisible(actor, ctx.db)));
  const deals = await ctx.db
    .select({ id: deal.id, name: deal.name, status: deal.status, amount: deal.amount, currency: deal.currency })
    .from(deal)
    .where(and(eq(deal.companyId, id), isNull(deal.archivedAt), dealVisible(actor)));
  const [owner] = await ctx.db
    .select({ id: appUserProfile.userId, fullName: appUserProfile.fullName })
    .from(appUserProfile)
    .where(eq(appUserProfile.userId, row.ownerId));
  const active = row.archivedAt === null;
  const reassign = active && canAccessOwner(actor, row.ownerId, 'write', 'companies', 'record.reassign');
  return {
    ...row,
    owner,
    contacts,
    deals,
    permissions: {
      edit: active && canAccessOwner(actor, row.ownerId, 'write', 'companies'),
      reassign,
      /** Managers may hand a record only to these users (RULE-CRM-09); null = any active user. */
      reassignScope: reassign && actor.role === 'sales_manager' ? actor.teamScopeIds : null,
    },
  };
}

export async function createCompany(ctx: AppContext, actor: UserActor, input: z.infer<typeof companyInput>) {
  requirePerm(actor, 'record.create');
  return unitOfWork(ctx, actor, (u) => insertCompany(u, actor, input));
}

/** Inserts a company inside the caller's transaction (duplicate-domain check, audit, timeline). */
async function insertCompany(u: Uow, actor: UserActor, input: z.infer<typeof companyInput>) {
  const settings = await u.tx.select({ free: organizationSettings.freeMailDomains }).from(organizationSettings);
  let normalizedDomain = normalizeDomain(input.domain ?? input.website);
  if (normalizedDomain && settings[0]?.free.includes(normalizedDomain)) normalizedDomain = null; // R3: never match on free-mail domains
  if (normalizedDomain) {
    const [dup] = await u.tx
      .select({ id: company.id })
      .from(company)
      .where(and(eq(company.normalizedDomain, normalizedDomain), isNull(company.archivedAt)));
    if (dup) throw conflict('DUPLICATE_SUSPECTED', 'A company with this domain already exists', { existingId: dup.id });
  }
  const [row] = await u.tx
    .insert(company)
    .values({
      name: input.name,
      domain: blank(input.domain),
      industry: blank(input.industry),
      phone: blank(input.phone),
      website: blank(input.website),
      normalizedName: normalizeName(input.name),
      normalizedDomain,
      ownerId: actor.userId,
      createdBy: actor.userId,
    })
    .returning();
  await u.audit('company.created', { type: 'company', id: row!.id });
  await u.timeline({
    eventType: 'company_created',
    source: { type: 'company', id: row!.id },
    summary: `Company ${row!.name} created`,
    anchors: [{ type: 'company', id: row!.id }],
  });
  return row!;
}

/**
 * Loads and row-locks a company for a change. Invisible → 404; visible (own scope or through a visible deal, R6)
 * but not permitted → 403; archived → 422.
 */
async function loadCompanyForWrite(ctx: AppContext, tx: Tx, actor: UserActor, id: string, key?: 'record.reassign') {
  const [row] = await tx
    .select()
    .from(company)
    .where(and(eq(company.id, id), companyVisible(actor, ctx.db)))
    .for('update');
  if (!row) throw notFound('Company');
  if (!canAccessOwner(actor, row.ownerId, 'write', 'companies', key))
    throw forbidden(key ? 'FORBIDDEN_REASSIGN' : 'VIEW_ONLY', key ? 'You cannot reassign this record' : 'You can view this company but not change it');
  if (row.archivedAt) throw archived('company');
  return row;
}

/**
 * PATCH semantics: a field that is absent stays as it is, a blank string clears it. `rowVersion`, when supplied,
 * is checked for optimistic concurrency (409 CONCURRENT_MODIFICATION).
 */
export async function updateCompany(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof companyInput> & { rowVersion?: number }) {
  requirePerm(actor, 'record.edit');
  return unitOfWork(ctx, actor, async (u) => {
    const before = await loadCompanyForWrite(ctx, u.tx, actor, id);
    if (input.rowVersion !== undefined && input.rowVersion !== before.rowVersion) throw stale('company');
    const next = {
      name: input.name.trim(),
      domain: input.domain === undefined ? before.domain : blank(input.domain),
      industry: input.industry === undefined ? before.industry : blank(input.industry),
      phone: input.phone === undefined ? before.phone : blank(input.phone),
      website: input.website === undefined ? before.website : blank(input.website),
    };
    const [settings] = await u.tx.select({ free: organizationSettings.freeMailDomains }).from(organizationSettings);
    let normalizedDomain = normalizeDomain(next.domain ?? next.website);
    if (normalizedDomain && settings?.free.includes(normalizedDomain)) normalizedDomain = null; // R3
    if (normalizedDomain && normalizedDomain !== before.normalizedDomain) {
      const [dup] = await u.tx
        .select({ id: company.id })
        .from(company)
        .where(and(eq(company.normalizedDomain, normalizedDomain), isNull(company.archivedAt), ne(company.id, id)));
      if (dup) throw conflict('DUPLICATE_SUSPECTED', 'Another company already uses this domain', { existingId: dup.id });
    }
    const changes = changesBetween(before, next);
    if (Object.keys(changes).length === 0) return before;
    const [row] = await u.tx
      .update(company)
      .set({
        ...next,
        normalizedName: normalizeName(next.name),
        normalizedDomain,
        updatedAt: ctx.now(),
        updatedBy: actor.userId,
        rowVersion: sql`${company.rowVersion} + 1`,
      })
      .where(eq(company.id, id))
      .returning();
    await u.audit('company.updated', { type: 'company', id }, changes);
    await u.timeline({
      eventType: 'company_updated',
      source: { type: 'company', id },
      summary: `Company details updated (${Object.keys(changes).join(', ')})`,
      anchors: [{ type: 'company', id }],
    });
    return row!;
  });
}

export async function archiveCompany(ctx: AppContext, actor: UserActor, id: string) {
  requirePerm(actor, 'record.edit');
  return unitOfWork(ctx, actor, async (u) => {
    const before = await loadCompanyForWrite(ctx, u.tx, actor, id);
    const [open] = await u.tx
      .select({ id: deal.id })
      .from(deal)
      .where(and(eq(deal.companyId, id), eq(deal.status, 'open'), isNull(deal.archivedAt)))
      .limit(1);
    if (open) throw conflict('COMPANY_HAS_OPEN_DEALS', 'Close or move the open deals before archiving this company'); // RULE-CRM-03
    await u.tx
      .update(company)
      .set({ archivedAt: ctx.now(), updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: sql`${company.rowVersion} + 1` })
      .where(eq(company.id, id));
    await u.audit('company.archived', { type: 'company', id }, { name: before.name });
    await u.timeline({
      eventType: 'company_archived',
      source: { type: 'company', id },
      summary: `Company ${before.name} archived`,
      anchors: [{ type: 'company', id }],
    });
    return { id };
  });
}

async function assertActiveUser(tx: Tx, userId: string): Promise<void> {
  const [u] = await tx.select({ status: appUserProfile.status }).from(appUserProfile).where(eq(appUserProfile.userId, userId));
  if (u?.status !== 'active') throw rule('REASSIGNMENT_TARGET_INACTIVE', 'The new owner must be an active user');
}

export async function changeCompanyOwner(ctx: AppContext, actor: UserActor, id: string, ownerId: string) {
  requirePerm(actor, 'record.reassign');
  return unitOfWork(ctx, actor, async (u) => {
    const before = await loadCompanyForWrite(ctx, u.tx, actor, id, 'record.reassign');
    await assertActiveUser(u.tx, ownerId);
    assertReassignTarget(actor, ownerId);
    if (before.ownerId === ownerId) return { id };
    await u.tx
      .update(company)
      .set({ ownerId, updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: sql`${company.rowVersion} + 1` })
      .where(eq(company.id, id));
    await u.audit('company.owner_changed', { type: 'company', id }, { ownerId: { from: before.ownerId, to: ownerId } });
    await u.timeline({
      eventType: 'owner_changed',
      source: { type: 'company', id },
      summary: `Company owner changed from ${await userName(u.tx, before.ownerId)} to ${await userName(u.tx, ownerId)}`,
      anchors: [{ type: 'company', id }],
    });
    await notifyNewOwner(u, actor, { type: 'company', id, name: before.name, rowVersion: before.rowVersion }, ownerId);
    return { id };
  });
}

// ───────────── contacts ─────────────
export async function listContacts(ctx: AppContext, actor: UserActor, page: Page) {
  const where = and(
    isNull(contact.archivedAt),
    contactVisible(actor, ctx.db),
    page.q ? or(ilike(contact.firstName, like(page.q)), ilike(contact.lastName, like(page.q)), ilike(contact.email, like(page.q))) : undefined,
  );
  const items = await ctx.db
    .select({
      id: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      jobTitle: contact.jobTitle,
      phone: contact.phone,
      companyId: contact.companyId,
      companyName: company.name,
      ownerId: contact.ownerId,
      ownerName: appUserProfile.fullName,
    })
    .from(contact)
    .leftJoin(company, eq(company.id, contact.companyId))
    .innerJoin(appUserProfile, eq(appUserProfile.userId, contact.ownerId))
    .where(where)
    .orderBy(asc(contact.lastName), asc(contact.firstName))
    .limit(page.limit)
    .offset(page.offset);
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(contact).where(where);
  return { items, total: count?.n ?? 0 };
}

/** Contact detail: the contact, its owner, its company and the deals it is a stakeholder on — each scoped to the actor. */
export async function getContact(ctx: AppContext, actor: UserActor, id: string) {
  const [row] = await ctx.db
    .select()
    .from(contact)
    .where(and(eq(contact.id, id), contactVisible(actor, ctx.db)));
  if (!row) throw notFound('Contact');
  const [owner] = await ctx.db
    .select({ id: appUserProfile.userId, fullName: appUserProfile.fullName })
    .from(appUserProfile)
    .where(eq(appUserProfile.userId, row.ownerId));
  // The company name is part of the contact's own details; it is linkable only when the actor may open the company.
  let comp: { id: string; name: string; canOpen: boolean } | null = null;
  if (row.companyId) {
    const [c] = await ctx.db.select({ id: company.id, name: company.name }).from(company).where(eq(company.id, row.companyId));
    const [visible] = await ctx.db
      .select({ id: company.id })
      .from(company)
      .where(and(eq(company.id, row.companyId), companyVisible(actor, ctx.db)));
    if (c) comp = { ...c, canOpen: Boolean(visible) };
  }
  const deals = await ctx.db
    .select({
      id: deal.id,
      name: deal.name,
      status: deal.status,
      amount: deal.amount,
      currency: deal.currency,
      stageName: pipelineStage.name,
      roles: dealContact.roles,
      isPrimary: dealContact.isPrimary,
    })
    .from(dealContact)
    .innerJoin(deal, eq(deal.id, dealContact.dealId))
    .innerJoin(pipelineStage, eq(pipelineStage.id, deal.stageId))
    .where(and(eq(dealContact.contactId, id), isNull(deal.archivedAt), dealVisible(actor)))
    .orderBy(desc(deal.updatedAt));
  return {
    ...row,
    owner,
    company: comp,
    deals,
    permissions: { edit: row.archivedAt === null && canAccessOwner(actor, row.ownerId, 'write', 'contacts') },
  };
}

async function assertEmailFree(tx: Tx, email: string | undefined, exceptId?: string) {
  if (!email) return null;
  const normalized = normalizeEmail(email);
  const [dup] = await tx
    .select({ id: contact.id })
    .from(contact)
    .where(and(eq(contact.normalizedEmail, normalized), isNull(contact.archivedAt)));
  if (dup && dup.id !== exceptId) throw conflict('CONTACT_EMAIL_TAKEN', 'A contact with this email already exists', { existingId: dup.id });
  return normalized;
}

export async function createContact(ctx: AppContext, actor: UserActor, input: z.infer<typeof contactCreateInput>) {
  requirePerm(actor, 'record.create');
  return unitOfWork(ctx, actor, async (u) => {
    const normalizedEmail = await assertEmailFree(u.tx, input.email);
    // New company entered in the person form: created in the same transaction, so a failed person leaves no orphan.
    // A duplicate domain is refused with DUPLICATE_SUSPECTED + existingId, so the form can offer to link that company.
    let companyId = input.companyId;
    if (input.newCompany) companyId = (await insertCompany(u, actor, input.newCompany)).id;
    else if (input.companyId) {
      const [c] = await u.tx
        .select({ id: company.id })
        .from(company)
        .where(and(eq(company.id, input.companyId), isNull(company.archivedAt), companyVisible(actor, ctx.db)));
      if (!c) throw notFound('Company');
    }
    const [row] = await u.tx
      .insert(contact)
      .values({
        firstName: blank(input.firstName),
        lastName: blank(input.lastName),
        email: input.email,
        phone: blank(input.phone),
        jobTitle: blank(input.jobTitle),
        companyId,
        normalizedEmail,
        ownerId: actor.userId,
        createdBy: actor.userId,
      })
      .returning();
    await u.audit('contact.created', { type: 'contact', id: row!.id });
    await u.timeline({
      eventType: 'contact_created',
      source: { type: 'contact', id: row!.id },
      summary: `Contact ${contactLabel(row!)} created`,
      anchors: [{ type: 'contact', id: row!.id }, ...(row!.companyId ? [{ type: 'company' as const, id: row!.companyId }] : [])],
    });
    return row!;
  });
}

const contactLabel = (c: { firstName: string | null; lastName: string | null; email: string | null }) =>
  [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || 'Unnamed';

/**
 * PATCH semantics: absent fields stay, blank strings clear, `companyId: null` unlinks the company. `rowVersion`,
 * when supplied, is checked for optimistic concurrency.
 */
export async function updateContact(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof contactInput> & { rowVersion?: number }) {
  requirePerm(actor, 'record.edit');
  return unitOfWork(ctx, actor, async (u) => {
    const [before] = await u.tx
      .select()
      .from(contact)
      .where(and(eq(contact.id, id), contactVisible(actor, ctx.db)))
      .for('update');
    if (!before) throw notFound('Contact');
    if (!canAccessOwner(actor, before.ownerId, 'write', 'contacts')) throw forbidden('VIEW_ONLY', 'You can view this contact but not change it');
    if (before.archivedAt) throw archived('contact');
    if (input.rowVersion !== undefined && input.rowVersion !== before.rowVersion) throw stale('contact');
    const next = {
      firstName: input.firstName === undefined ? before.firstName : blank(input.firstName),
      lastName: input.lastName === undefined ? before.lastName : blank(input.lastName),
      email: input.email === undefined ? before.email : input.email,
      phone: input.phone === undefined ? before.phone : blank(input.phone),
      jobTitle: input.jobTitle === undefined ? before.jobTitle : blank(input.jobTitle),
      companyId: input.companyId === undefined ? before.companyId : input.companyId,
    };
    if (!next.firstName && !next.lastName && !next.email) throw rule('CONTACT_IDENTITY_REQUIRED', 'A contact needs a name or an email');
    const normalizedEmail = next.email === before.email ? before.normalizedEmail : await assertEmailFree(u.tx, next.email ?? undefined, id);
    // Linking to a company is allowed only for a company the actor can see (no IDOR through the company picker).
    if (next.companyId && next.companyId !== before.companyId) {
      const [c] = await u.tx
        .select({ id: company.id })
        .from(company)
        .where(and(eq(company.id, next.companyId), isNull(company.archivedAt), companyVisible(actor, ctx.db)));
      if (!c) throw notFound('Company');
    }
    const changes = changesBetween(before, next);
    if (Object.keys(changes).length === 0) return before;
    const [updated] = await u.tx
      .update(contact)
      .set({ ...next, normalizedEmail, updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: sql`${contact.rowVersion} + 1` })
      .where(eq(contact.id, id))
      .returning();
    await u.audit('contact.updated', { type: 'contact', id }, changes);
    await u.timeline({
      eventType: 'contact_updated',
      source: { type: 'contact', id },
      summary: `Contact details updated (${Object.keys(changes).join(', ')})`,
      anchors: [{ type: 'contact', id }],
    });
    return updated!;
  });
}

// ───────────── pipeline ─────────────
export async function getPipeline(ctx: AppContext) {
  const stages = await ctx.db.select().from(pipelineStage).orderBy(asc(pipelineStage.sortOrder));
  const lostReasons = await ctx.db.select().from(lostReason).orderBy(asc(lostReason.name));
  return { stages, lostReasons };
}

// ───────────── deals ─────────────
const dealListColumns = {
  id: deal.id,
  name: deal.name,
  status: deal.status,
  amount: deal.amount,
  currency: deal.currency,
  closeDate: deal.closeDate,
  stageId: deal.stageId,
  stageName: pipelineStage.name,
  companyId: deal.companyId,
  companyName: company.name,
  ownerId: deal.ownerId,
  ownerName: appUserProfile.fullName,
  lastActivityAt: deal.lastActivityAt,
  rowVersion: deal.rowVersion,
};

export async function listDeals(ctx: AppContext, actor: UserActor, page: Page & { status?: 'open' | 'won' | 'lost'; stageId?: string }) {
  const where = and(
    isNull(deal.archivedAt),
    dealVisible(actor),
    page.q ? ilike(deal.name, like(page.q)) : undefined,
    page.status ? eq(deal.status, page.status) : undefined,
    page.stageId ? eq(deal.stageId, page.stageId) : undefined,
    page.ownerId ? eq(deal.ownerId, page.ownerId) : undefined,
  );
  const base = ctx.db
    .select(dealListColumns)
    .from(deal)
    .innerJoin(pipelineStage, eq(pipelineStage.id, deal.stageId))
    .innerJoin(company, eq(company.id, deal.companyId))
    .innerJoin(appUserProfile, eq(appUserProfile.userId, deal.ownerId));
  const items = await base.where(where).orderBy(desc(deal.updatedAt)).limit(page.limit).offset(page.offset);
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(deal).where(where);
  const flags = items.length
    ? await ctx.db
        .select({ dealId: dealFlag.dealId, kind: dealFlag.kind })
        .from(dealFlag)
        .where(
          and(
            inArray(
              dealFlag.dealId,
              items.map((i) => i.id),
            ),
            isNull(dealFlag.clearedAt),
          ),
        )
    : [];
  return { items: items.map((i) => ({ ...i, flags: flags.filter((f) => f.dealId === i.id).map((f) => f.kind) })), total: count?.n ?? 0 };
}

export async function getDeal(ctx: AppContext, actor: UserActor, id: string) {
  const row = await loadDealFor(ctx.db, actor, id, 'read');
  const [stage] = await ctx.db.select().from(pipelineStage).where(eq(pipelineStage.id, row.stageId));
  const [comp] = await ctx.db.select({ id: company.id, name: company.name, domain: company.domain }).from(company).where(eq(company.id, row.companyId));
  const [owner] = await ctx.db
    .select({ id: appUserProfile.userId, fullName: appUserProfile.fullName })
    .from(appUserProfile)
    .where(eq(appUserProfile.userId, row.ownerId));
  const contacts = await ctx.db
    .select({
      id: dealContact.id,
      contactId: contact.id,
      firstName: contact.firstName,
      lastName: contact.lastName,
      email: contact.email,
      roles: dealContact.roles,
      isPrimary: dealContact.isPrimary,
      addedVia: dealContact.addedVia,
    })
    .from(dealContact)
    .innerJoin(contact, eq(contact.id, dealContact.contactId))
    .where(eq(dealContact.dealId, id));
  const flags = await ctx.db
    .select({ kind: dealFlag.kind, raisedAt: dealFlag.raisedAt })
    .from(dealFlag)
    .where(and(eq(dealFlag.dealId, id), isNull(dealFlag.clearedAt)));
  const active = row.archivedAt === null;
  const edit = active && canAccessOwner(actor, row.ownerId, 'write', 'deals');
  const reassign = active && canAccessOwner(actor, row.ownerId, 'write', 'deals', 'record.reassign');
  return {
    ...row,
    stage,
    company: comp,
    owner,
    contacts,
    flags,
    permissions: {
      edit,
      reassign,
      /** Managers may hand a deal only to these users (RULE-CRM-09); null = any active user. */
      reassignScope: reassign && actor.role === 'sales_manager' ? actor.teamScopeIds : null,
      manageProposals: canAccessOwner(actor, row.ownerId, 'write', 'deals', 'proposal.manage'),
    },
  };
}

/** OD-35: qualifying activity moves last_activity_at forward and clears an open stalled flag (RULE-AUT-34). */
export async function recordActivity(tx: Tx, dealId: string, at: Date): Promise<void> {
  await tx
    .update(deal)
    .set({ lastActivityAt: sql`greatest(coalesce(${deal.lastActivityAt}, 'epoch'::timestamptz), ${at.toISOString()}::timestamptz)` })
    .where(eq(deal.id, dealId));
  await tx
    .update(dealFlag)
    .set({ clearedAt: at })
    .where(and(eq(dealFlag.dealId, dealId), eq(dealFlag.kind, 'stalled'), isNull(dealFlag.clearedAt)));
}

async function dealAnchors(tx: Tx, dealId: string, companyId: string) {
  const contacts = await tx.select({ id: dealContact.contactId }).from(dealContact).where(eq(dealContact.dealId, dealId));
  return [{ type: 'deal' as const, id: dealId }, { type: 'company' as const, id: companyId }, ...contacts.map((c) => ({ type: 'contact' as const, id: c.id }))];
}

export async function createDeal(ctx: AppContext, actor: UserActor, input: z.infer<typeof dealInput>, opts: { source?: string; ownerId?: string } = {}) {
  requirePerm(actor, 'record.create');
  return unitOfWork(ctx, actor, (u) =>
    insertDeal(ctx, u, { ...input, ownerId: opts.ownerId ?? actor.userId, source: opts.source ?? 'manual' }, (id) => companyVisibleCheck(ctx, u.tx, actor, id)),
  );
}
async function companyVisibleCheck(ctx: AppContext, tx: Tx, actor: UserActor, companyId: string) {
  const [c] = await tx
    .select({ id: company.id })
    .from(company)
    .where(and(eq(company.id, companyId), isNull(company.archivedAt), companyVisible(actor, ctx.db)));
  if (!c) throw notFound('Company');
}
export async function insertDeal(
  ctx: AppContext,
  u: Uow,
  input: z.infer<typeof dealInput> & { ownerId: string; source: string },
  checkCompany?: (id: string) => Promise<void>,
) {
  await checkCompany?.(input.companyId);
  assertCalendarDate(input.closeDate, 'closeDate');
  const stages = await u.tx.select().from(pipelineStage).orderBy(asc(pipelineStage.sortOrder));
  const stage = input.stageId ? stages.find((s) => s.id === input.stageId) : stages.find((s) => s.kind === 'open');
  if (stage?.kind !== 'open') throw rule('STAGE_NOT_IN_PIPELINE', 'Choose an open stage of the pipeline');
  const [settings] = await u.tx.select({ currency: organizationSettings.defaultCurrency }).from(organizationSettings);
  const [row] = await u.tx
    .insert(deal)
    .values({
      name: input.name,
      companyId: input.companyId,
      ownerId: input.ownerId,
      pipelineId: stage.pipelineId,
      stageId: stage.id,
      amount: input.amount,
      currency: settings!.currency,
      closeDate: input.closeDate,
      source: input.source,
      lastActivityAt: ctx.now(),
      createdBy: u.actor.type === 'user' ? u.actor.userId : null,
    })
    .returning();
  for (const [i, contactId] of (input.contactIds ?? []).entries())
    await u.tx.insert(dealContact).values({ dealId: row!.id, contactId, isPrimary: i === 0, roles: i === 0 ? ['Decision-maker'] : [] });
  await u.tx
    .insert(dealStageHistory)
    .values({ dealId: row!.id, toStageId: stage.id, actorType: u.actor.type, actorUserId: u.actor.type === 'user' ? u.actor.userId : null });
  await u.audit('deal.created', { type: 'deal', id: row!.id });
  await u.timeline({
    eventType: 'deal_created',
    source: { type: 'deal', id: row!.id },
    summary: `Deal "${row!.name}" created in ${stage.name}`,
    anchors: await dealAnchors(u.tx, row!.id, row!.companyId),
  });
  return row!;
}

const sameAmount = (a: string | null, b: string | null) => (a === null || b === null ? a === b : Number(a) === Number(b));

export async function patchDeal(ctx: AppContext, actor: UserActor, id: string, patch: z.infer<typeof dealPatch>) {
  requirePerm(actor, 'record.edit');
  return unitOfWork(ctx, actor, async (u) => {
    await lockRow(u.tx, 'deal', id);
    const before = await loadDealFor(u.tx, actor, id, 'write');
    if (before.archivedAt) throw archived('deal');
    if (before.rowVersion !== patch.rowVersion) throw stale('deal');
    assertCalendarDate(patch.closeDate, 'closeDate');
    const next = {
      name: patch.name ?? before.name,
      amount: patch.amount === undefined || sameAmount(patch.amount, before.amount) ? before.amount : patch.amount,
      closeDate: patch.closeDate === undefined ? before.closeDate : patch.closeDate,
    };
    const changes = changesBetween(before, next);
    if (Object.keys(changes).length === 0) return before;
    const [row] = await u.tx
      .update(deal)
      .set({
        ...next,
        ...(changes.amount ? { amountSource: 'manual' } : {}),
        updatedAt: ctx.now(),
        updatedBy: actor.userId,
        rowVersion: sql`${deal.rowVersion} + 1`,
      })
      .where(eq(deal.id, id))
      .returning();
    await u.audit('deal.updated', { type: 'deal', id }, changes);
    const parts = [
      changes.name ? `renamed to "${next.name}"` : null,
      changes.amount ? (next.amount === null ? 'amount cleared' : `amount set to ${before.currency} ${Number(next.amount).toFixed(2)}`) : null,
      changes.closeDate ? (next.closeDate === null ? 'expected close date cleared' : `expected close date set to ${next.closeDate}`) : null,
    ].filter(Boolean);
    await u.timeline({
      eventType: 'deal_updated',
      source: { type: 'deal', id },
      summary: `Deal updated: ${parts.join(', ')}`,
      // Company and contact timelines include the events of their deals (RULE-TIM-06), like stage changes do.
      anchors: await dealAnchors(u.tx, id, before.companyId),
    });
    return row!;
  });
}

export async function moveDealStage(ctx: AppContext, actor: UserActor, id: string, stageId: string, rowVersion: number) {
  return unitOfWork(ctx, actor, async (u) => {
    await lockRow(u.tx, 'deal', id);
    const row = await loadDealFor(u.tx, actor, id, 'write');
    if (row.status !== 'open') throw rule('DEAL_CLOSED', 'Reopen the deal before changing its stage');
    if (row.rowVersion !== rowVersion) throw conflict('CONCURRENT_MODIFICATION', 'This deal was changed by someone else. Reload and try again.');
    const [stage] = await u.tx.select().from(pipelineStage).where(eq(pipelineStage.id, stageId));
    if (!stage || stage.pipelineId !== row.pipelineId || stage.kind !== 'open') throw rule('STAGE_NOT_IN_PIPELINE', 'Choose an open stage of this pipeline');
    const [updated] = await u.tx
      .update(deal)
      .set({ stageId, stageEnteredAt: ctx.now(), updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: sql`${deal.rowVersion} + 1` })
      .where(eq(deal.id, id))
      .returning();
    await u.tx.insert(dealStageHistory).values({ dealId: id, fromStageId: row.stageId, toStageId: stageId, actorType: 'user', actorUserId: actor.userId });
    await recordActivity(u.tx, id, ctx.now());
    await u.audit('deal.stage_changed', { type: 'deal', id }, { from: row.stageId, to: stageId });
    await u.timeline({
      eventType: 'stage_changed',
      source: { type: 'deal', id },
      summary: `Stage changed to ${stage.name}`,
      anchors: await dealAnchors(u.tx, id, row.companyId),
    });
    return updated!;
  });
}

/** Shared by manual close and BR-AUT-002. Caller holds the deal row lock. */
export async function applyClose(
  ctx: AppContext,
  u: Uow,
  d: typeof deal.$inferSelect,
  kind: 'won' | 'lost',
  fields: { amount?: string; closeDate: string; lostReasonId?: string; lostReasonNote?: string; wonFromProposalId?: string; amountSource?: string },
  timelineOpts: { isAutomated?: boolean; automationExecutionId?: string } = {},
) {
  const [stage] = await u.tx
    .select()
    .from(pipelineStage)
    .where(and(eq(pipelineStage.pipelineId, d.pipelineId), eq(pipelineStage.kind, kind)));
  await u.tx
    .update(deal)
    .set({
      stageId: stage!.id,
      status: kind,
      closeDate: fields.closeDate,
      closedAt: ctx.now(),
      amount: fields.amount ?? d.amount,
      amountSource: fields.amountSource ?? d.amountSource,
      lostReasonId: fields.lostReasonId ?? null,
      lostReasonNote: fields.lostReasonNote ?? null,
      wonFromProposalId: fields.wonFromProposalId ?? null,
      stageEnteredAt: ctx.now(),
      updatedAt: ctx.now(),
      rowVersion: sql`${deal.rowVersion} + 1`,
    })
    .where(eq(deal.id, d.id));
  await u.tx.insert(dealStageHistory).values({
    dealId: d.id,
    fromStageId: d.stageId,
    toStageId: stage!.id,
    actorType: u.actor.type,
    actorUserId: u.actor.type === 'user' ? u.actor.userId : null,
  });
  await u.tx
    .update(dealFlag)
    .set({ clearedAt: ctx.now() })
    .where(and(eq(dealFlag.dealId, d.id), isNull(dealFlag.clearedAt), inArray(dealFlag.kind, ['stalled', 'past_close_date'])));
  await u.audit(kind === 'won' ? 'deal.closed_won' : 'deal.closed_lost', { type: 'deal', id: d.id }, fields);
  await u.timeline({
    eventType: kind === 'won' ? 'deal_won' : 'deal_lost',
    source: { type: 'deal', id: d.id },
    summary: kind === 'won' ? 'Deal marked Closed Won' : 'Deal marked Closed Lost',
    anchors: await dealAnchors(u.tx, d.id, d.companyId),
    ...timelineOpts,
  });
  await u.enqueue('event', { name: kind === 'won' ? 'deal.closed_won' : 'deal.closed_lost', dealId: d.id });
  return stage!;
}

export const todayIso = (ctx: AppContext) => ctx.now().toISOString().slice(0, 10);

export async function closeDealWon(ctx: AppContext, actor: UserActor, id: string, amount?: string) {
  return unitOfWork(ctx, actor, async (u) => {
    await lockRow(u.tx, 'deal', id);
    const row = await loadDealFor(u.tx, actor, id, 'write');
    if (row.status !== 'open') throw rule('DEAL_CLOSED', 'This deal is already closed');
    await applyClose(ctx, u, row, 'won', { amount, closeDate: todayIso(ctx) });
    return { id };
  });
}

/** `voidOpenSignature` is a port implemented by the esign module (ADR-055) — crm never imports esign. */
export async function closeDealLost(
  ctx: AppContext,
  actor: UserActor,
  id: string,
  input: z.infer<typeof closeLostInput>,
  voidOpenSignature: (u: Uow, dealId: string, reason: string) => Promise<boolean>,
  hasOpenSignature: (tx: Tx, dealId: string) => Promise<boolean>,
) {
  return unitOfWork(ctx, actor, async (u) => {
    await lockRow(u.tx, 'deal', id);
    const row = await loadDealFor(u.tx, actor, id, 'write');
    if (row.status !== 'open') throw rule('DEAL_CLOSED', 'This deal is already closed');
    const [reason] = await u.tx.select().from(lostReason).where(eq(lostReason.id, input.lostReasonId));
    if (!reason) throw rule('LOST_REASON_REQUIRED', 'Select a lost reason'); // BR-CRM-014
    if (await hasOpenSignature(u.tx, id)) {
      requireConfirmations([{ code: 'OPEN_SIGNATURE_REQUEST_CONFIRM', message: 'An open signature request will be voided.' }], input.confirm);
      await voidOpenSignature(u, id, 'Deal closed as lost');
    }
    await applyClose(ctx, u, row, 'lost', { closeDate: todayIso(ctx), lostReasonId: input.lostReasonId, lostReasonNote: input.note });
    return { id };
  });
}

export async function reopenDeal(ctx: AppContext, actor: UserActor, id: string, reason: string, stageId: string) {
  return unitOfWork(ctx, actor, async (u) => {
    await lockRow(u.tx, 'deal', id);
    const row = await loadDealFor(u.tx, actor, id, 'write');
    if (row.status === 'open') throw rule('INVALID_STATE_TRANSITION', 'This deal is already open');
    const [stage] = await u.tx.select().from(pipelineStage).where(eq(pipelineStage.id, stageId));
    if (stage?.kind !== 'open' || stage.pipelineId !== row.pipelineId) throw rule('STAGE_NOT_IN_PIPELINE', 'Choose an open stage');
    await u.tx
      .update(deal)
      .set({
        status: 'open',
        stageId,
        closedAt: null,
        lostReasonId: null,
        lostReasonNote: null,
        stageEnteredAt: ctx.now(),
        rowVersion: sql`${deal.rowVersion} + 1`,
      })
      .where(eq(deal.id, id));
    await u.tx
      .insert(dealStageHistory)
      .values({ dealId: id, fromStageId: row.stageId, toStageId: stageId, actorType: 'user', actorUserId: actor.userId, reason });
    await u.audit('deal.reopened', { type: 'deal', id }, { reason });
    await u.timeline({
      eventType: 'deal_reopened',
      source: { type: 'deal', id },
      summary: `Deal reopened: ${reason}`,
      anchors: await dealAnchors(u.tx, id, row.companyId),
    });
    return { id };
  });
}

export async function changeDealOwner(ctx: AppContext, actor: UserActor, id: string, ownerId: string) {
  // Salespeople never reassign (§9.17); the record-level check below returns the specific FORBIDDEN_REASSIGN code
  // (a 404 first for a deal the caller cannot even see), so no generic requirePerm pre-empts it.
  return unitOfWork(ctx, actor, async (u) => {
    await lockRow(u.tx, 'deal', id);
    const [row] = await u.tx.select().from(deal).where(eq(deal.id, id));
    if (!row || !canAccessOwner(actor, row.ownerId, 'read', 'deals')) throw notFound('Deal');
    if (!canAccessOwner(actor, row.ownerId, 'write', 'deals', 'record.reassign')) throw forbidden('FORBIDDEN_REASSIGN', 'You cannot reassign this deal');
    if (row.archivedAt) throw archived('deal');
    await assertActiveUser(u.tx, ownerId);
    assertReassignTarget(actor, ownerId);
    if (row.ownerId === ownerId) return { id };
    await u.tx
      .update(deal)
      .set({ ownerId, updatedAt: ctx.now(), updatedBy: actor.userId, rowVersion: sql`${deal.rowVersion} + 1` })
      .where(eq(deal.id, id));
    await u.audit('deal.owner_changed', { type: 'deal', id }, { from: row.ownerId, to: ownerId });
    await u.timeline({
      eventType: 'owner_changed',
      source: { type: 'deal', id },
      summary: `Deal owner changed from ${await userName(u.tx, row.ownerId)} to ${await userName(u.tx, ownerId)}`,
      anchors: await dealAnchors(u.tx, id, row.companyId),
    });
    await notifyNewOwner(u, actor, { type: 'deal', id, name: row.name, rowVersion: row.rowVersion }, ownerId);
    return { id };
  });
}

export async function addDealContact(ctx: AppContext, actor: UserActor, dealId: string, input: z.infer<typeof dealContactInput>) {
  return unitOfWork(ctx, actor, async (u) => {
    await loadDealFor(u.tx, actor, dealId, 'write');
    const [c] = await u.tx
      .select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.id, input.contactId), isNull(contact.archivedAt), contactVisible(actor, ctx.db)));
    if (!c) throw notFound('Contact');
    if (input.isPrimary) await u.tx.update(dealContact).set({ isPrimary: false }).where(eq(dealContact.dealId, dealId));
    const inserted = await u.tx
      .insert(dealContact)
      .values({ dealId, contactId: input.contactId, roles: input.roles, isPrimary: input.isPrimary })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) throw conflict('DEAL_CONTACT_DUPLICATE', 'This contact is already on the deal');
    await u.audit('deal.contact_added', { type: 'deal', id: dealId }, { contactId: input.contactId });
    return inserted[0]!;
  });
}

// ───────────── tasks, notes, call and meeting logs ─────────────
/** Child records inherit visibility from the record they are attached to (ROLE-PERMISSION-MATRIX §5). */
async function assertRelated(
  ctx: AppContext,
  tx: Tx,
  actor: UserActor,
  r: Related,
  access: 'read' | 'write',
): Promise<{ dealId?: string; companyId?: string; contactId?: string }> {
  if (r.relatedType === 'deal') {
    const d = await loadDealFor(tx, actor, r.relatedId, access);
    return { dealId: d.id, companyId: d.companyId };
  }
  const table = r.relatedType === 'company' ? company : contact;
  const [row] = await tx
    .select({ ownerId: table.ownerId })
    .from(table)
    .where(and(eq(table.id, r.relatedId), r.relatedType === 'company' ? companyVisible(actor, ctx.db) : contactVisible(actor, ctx.db)));
  if (!row) throw notFound(r.relatedType === 'company' ? 'Company' : 'Contact');
  if (access === 'write' && !canAccessOwner(actor, row.ownerId, 'write', r.relatedType === 'company' ? 'companies' : 'contacts'))
    throw forbidden('VIEW_ONLY', 'You can view this record but not change it');
  return r.relatedType === 'company' ? { companyId: r.relatedId } : { contactId: r.relatedId };
}
const anchorsOf = (a: { dealId?: string; companyId?: string; contactId?: string }) => [
  ...(a.dealId ? [{ type: 'deal' as const, id: a.dealId }] : []),
  ...(a.companyId ? [{ type: 'company' as const, id: a.companyId }] : []),
  ...(a.contactId ? [{ type: 'contact' as const, id: a.contactId }] : []),
];

export async function createTask(ctx: AppContext, actor: UserActor, input: z.infer<typeof taskInput>) {
  return unitOfWork(ctx, actor, async (u) => {
    const a = await assertRelated(ctx, u.tx, actor, input, 'write');
    const assigneeId = input.assigneeId ?? actor.userId;
    await assertActiveUser(u.tx, assigneeId);
    const [row] = await u.tx
      .insert(task)
      .values({ ...input, dueAt: new Date(input.dueAt), assigneeId, createdBy: actor.userId })
      .returning();
    await u.timeline({ eventType: 'task_created', source: { type: 'task', id: row!.id }, summary: `Task: ${row!.title}`, anchors: anchorsOf(a) });
    if (assigneeId !== actor.userId) await u.enqueue('event', { name: 'task.assigned', taskId: row!.id });
    return row!;
  });
}

export async function listTasks(ctx: AppContext, actor: UserActor, filter: { mine?: boolean; relatedType?: Related['relatedType']; relatedId?: string }) {
  if (filter.relatedType && filter.relatedId) {
    await assertRelated(ctx, ctx.db as unknown as Tx, actor, { relatedType: filter.relatedType, relatedId: filter.relatedId }, 'read');
    return ctx.db
      .select()
      .from(task)
      .where(and(eq(task.relatedType, filter.relatedType), eq(task.relatedId, filter.relatedId)))
      .orderBy(asc(task.dueAt));
  }
  return ctx.db
    .select()
    .from(task)
    .where(and(eq(task.assigneeId, actor.userId), eq(task.status, 'open')))
    .orderBy(asc(task.dueAt))
    .limit(200);
}

export async function completeTask(ctx: AppContext, actor: UserActor, id: string) {
  return unitOfWork(ctx, actor, async (u) => {
    const [row] = await u.tx.select().from(task).where(eq(task.id, id));
    if (!row) throw notFound('Task');
    // The assignee can always complete their task; otherwise write access to the related record is required.
    const a =
      row.assigneeId === actor.userId
        ? await assertRelated(ctx, u.tx, actor, row, 'read').catch(() => ({}))
        : await assertRelated(ctx, u.tx, actor, row, 'write');
    if (row.status !== 'open') throw rule('INVALID_STATE_TRANSITION', 'This task is not open');
    await u.tx.update(task).set({ status: 'completed', completedAt: ctx.now(), updatedAt: ctx.now(), updatedBy: actor.userId }).where(eq(task.id, id));
    if (row.relatedType === 'deal') await recordActivity(u.tx, row.relatedId, ctx.now());
    await u.timeline({ eventType: 'task_completed', source: { type: 'task', id }, summary: `Task completed: ${row.title}`, anchors: anchorsOf(a) });
    return { id };
  });
}

export async function createNote(ctx: AppContext, actor: UserActor, input: z.infer<typeof noteInput>) {
  return unitOfWork(ctx, actor, async (u) => {
    const a = await assertRelated(ctx, u.tx, actor, input, 'write');
    const [row] = await u.tx
      .insert(note)
      .values({ ...input, authorId: actor.userId, createdBy: actor.userId })
      .returning();
    if (a.dealId) await recordActivity(u.tx, a.dealId, ctx.now());
    await u.timeline({
      eventType: 'note',
      source: { type: 'note', id: row!.id },
      summary: row!.body.length > 200 ? `${row!.body.slice(0, 200)}…` : row!.body,
      anchors: anchorsOf(a),
    });
    return row!;
  });
}

export async function logActivity(ctx: AppContext, actor: UserActor, input: z.infer<typeof activityInput>) {
  return unitOfWork(ctx, actor, async (u) => {
    const a = await assertRelated(ctx, u.tx, actor, input, 'write');
    const occurredAt = new Date(input.occurredAt);
    const [row] = await u.tx
      .insert(activityLog)
      .values({ ...input, occurredAt, loggedBy: actor.userId })
      .returning();
    if (a.dealId) await recordActivity(u.tx, a.dealId, occurredAt);
    await u.timeline({
      eventType: input.kind === 'call' ? 'call_log' : 'meeting_log',
      source: { type: 'activity_log', id: row!.id },
      summary: `${input.kind === 'call' ? 'Call' : 'Meeting'} logged${input.outcome ? `: ${input.outcome}` : ''}`,
      anchors: anchorsOf(a),
    });
    return row!;
  });
}

// ───────────── timeline (BR-TIM-001..004) ─────────────
export async function getTimeline(ctx: AppContext, actor: UserActor, r: Related, opts: { types?: string[]; limit: number }) {
  await assertRelated(ctx, ctx.db as unknown as Tx, actor, r, 'read');
  return ctx.db
    .select({
      id: timelineEvent.id,
      eventType: timelineEvent.eventType,
      actorType: timelineEvent.actorType,
      actorName: timelineEvent.actorName,
      occurredAt: timelineEvent.occurredAt,
      summary: timelineEvent.summary,
      isAutomated: timelineEvent.isAutomated,
      automationExecutionId: timelineEvent.automationExecutionId,
    })
    .from(timelineEventAnchor)
    .innerJoin(timelineEvent, eq(timelineEvent.id, timelineEventAnchor.timelineEventId))
    .where(
      and(
        eq(timelineEventAnchor.recordType, r.relatedType),
        eq(timelineEventAnchor.recordId, r.relatedId),
        opts.types?.length ? inArray(timelineEvent.eventType, opts.types) : undefined,
      ),
    )
    .orderBy(desc(timelineEventAnchor.occurredAt), desc(timelineEvent.id))
    .limit(opts.limit);
}

// ───────────── global search (BR-CRM-012) ─────────────
export async function search(ctx: AppContext, actor: UserActor, q: string) {
  const term = like(q);
  const [companies, contacts, deals] = await Promise.all([
    ctx.db
      .select({ id: company.id, title: company.name })
      .from(company)
      .where(and(isNull(company.archivedAt), companyVisible(actor, ctx.db), ilike(company.name, term)))
      .limit(6),
    ctx.db
      .select({
        id: contact.id,
        title: sql<string>`trim(coalesce(${contact.firstName},'') || ' ' || coalesce(${contact.lastName},''))`,
        subtitle: contact.email,
      })
      .from(contact)
      .where(
        and(
          isNull(contact.archivedAt),
          contactVisible(actor, ctx.db),
          or(ilike(contact.firstName, term), ilike(contact.lastName, term), ilike(contact.email, term)),
        ),
      )
      .limit(6),
    ctx.db
      .select({ id: deal.id, title: deal.name })
      .from(deal)
      .where(and(isNull(deal.archivedAt), dealVisible(actor), ilike(deal.name, term)))
      .limit(6),
  ]);
  return [
    ...companies.map((c) => ({ type: 'company', ...c })),
    ...contacts.map((c) => ({ type: 'contact', ...c })),
    ...deals.map((d) => ({ type: 'deal', ...d })),
  ];
}

// ───────────── lead intake (BR-LED-001..006) ─────────────
export async function submitLead(ctx: AppContext, formKey: string, input: z.infer<typeof leadSubmissionInput>, ipHash: string) {
  return unitOfWork(ctx, SYSTEM, async (u) => {
    await lockRow(u.tx, 'organization_settings', 1); // serialises round-robin (fairness under concurrency)
    const [settings] = await u.tx.select().from(organizationSettings);
    if (!settings || settings.leadFormKey !== formKey) throw notFound('Form');
    // Rate limit: 10 submissions per IP per hour (OD-46), counted in Postgres.
    const windowStart = new Date(Math.floor(ctx.now().getTime() / 3_600_000) * 3_600_000);
    const [bucket] = await u.tx
      .insert(schema.rateLimitBucket)
      .values({ bucketKey: `lead:${ipHash}`, windowStart, count: 1 })
      .onConflictDoUpdate({
        target: [schema.rateLimitBucket.bucketKey, schema.rateLimitBucket.windowStart],
        set: { count: sql`${schema.rateLimitBucket.count} + 1` },
      })
      .returning();
    const spam = input.website ? 'rejected_honeypot' : (bucket?.count ?? 0) > 10 ? 'rate_limited' : 'clean';
    const { website: _hp, ...payload } = input;
    if (spam !== 'clean') {
      await u.tx.insert(leadSubmission).values({ payload: payload as Record<string, string>, spamVerdict: spam, processingStatus: 'rejected' });
      return { accepted: true }; // generic response — never tell a bot why (BR-LED-006)
    }
    // Assignment: round-robin over active, eligible salespeople; fallback to the default lead owner (BR-LED-002).
    const pool = await u.tx
      .select({ id: appUserProfile.userId })
      .from(appUserProfile)
      .where(and(eq(appUserProfile.role, 'salesperson'), eq(appUserProfile.status, 'active'), eq(appUserProfile.roundRobinEligible, true)))
      .orderBy(asc(appUserProfile.userId));
    const idx = pool.findIndex((p) => p.id === settings.leadRoundRobinCursor);
    const assignee = pool.length ? pool[(idx + 1) % pool.length]!.id : settings.defaultLeadOwnerId;
    if (!assignee) throw rule('LEAD_FORM_FALLBACK_OWNER_REQUIRED', 'No lead owner is configured');
    await u.tx.update(organizationSettings).set({ leadRoundRobinCursor: assignee }).where(eq(organizationSettings.id, 1));

    // Duplicate check by normalised email (OD-27); matched records keep their owner and existing values (OD-58).
    const email = normalizeEmail(input.email);
    const domain = email.split('@')[1] ?? '';
    const usableDomain = settings.freeMailDomains.includes(domain) ? null : domain;
    let [co] = usableDomain
      ? await u.tx
          .select()
          .from(company)
          .where(and(eq(company.normalizedDomain, usableDomain), isNull(company.archivedAt)))
      : [];
    if (!co && (input.company || usableDomain)) {
      [co] = await u.tx
        .insert(company)
        .values({
          name: input.company ?? usableDomain!,
          normalizedName: (input.company ?? usableDomain!).toLowerCase(),
          domain: usableDomain,
          normalizedDomain: usableDomain,
          ownerId: assignee,
        })
        .returning();
    }
    let [person] = await u.tx
      .select()
      .from(contact)
      .where(and(eq(contact.normalizedEmail, email), isNull(contact.archivedAt)));
    if (!person)
      [person] = await u.tx
        .insert(contact)
        .values({
          firstName: input.firstName,
          lastName: input.lastName,
          email,
          normalizedEmail: email,
          companyId: co?.id,
          ownerId: assignee,
          source: 'lead_form',
        })
        .returning();
    // A deal needs a company (OD-33): without one, only the contact is created and assigned (R3).
    const d = co
      ? await insertDeal(ctx, u, { name: `${co.name} — website enquiry`, companyId: co.id, contactIds: [person!.id], ownerId: assignee, source: 'lead_form' })
      : null;
    const [sub] = await u.tx
      .insert(leadSubmission)
      .values({
        payload: payload as Record<string, string>,
        spamVerdict: 'clean',
        processingStatus: 'processed',
        contactId: person!.id,
        companyId: co?.id,
        dealId: d?.id,
        assignedUserId: assignee,
      })
      .returning();
    await u.enqueue('event', { name: 'lead.assigned', submissionId: sub!.id, userId: assignee, dealId: d?.id ?? null, contactId: person!.id });
    return { accepted: true };
  });
}

/** Raw inbound web-form submissions (BR-LED-001..006), owner-scoped to the actor's assigned submissions. */
export async function listLeadInbox(ctx: AppContext, actor: UserActor) {
  requirePerm(actor, 'lead.view');
  return ctx.db
    .select()
    .from(leadSubmission)
    .where(ownerScope(actor, leadSubmission.assignedUserId, 'deals', 'lead.view'))
    .orderBy(desc(leadSubmission.receivedAt))
    .limit(100);
}

// ───────────── managed leads (BR-LED: capture → qualify → convert) ─────────────
const leadVisible = (actor: UserActor) => ownerScope(actor, lead.ownerId, 'deals', 'lead.view');
const leadColumns = {
  id: lead.id,
  name: lead.name,
  companyName: lead.companyName,
  email: lead.email,
  phone: lead.phone,
  jobTitle: lead.jobTitle,
  source: lead.source,
  status: lead.status,
  ownerId: lead.ownerId,
  ownerName: appUserProfile.fullName,
  notes: lead.notes,
  disqualifyReason: lead.disqualifyReason,
  convertedCompanyId: lead.convertedCompanyId,
  convertedContactId: lead.convertedContactId,
  convertedDealId: lead.convertedDealId,
  createdAt: lead.createdAt,
  rowVersion: lead.rowVersion,
};

/** Loads and row-locks a lead the actor may change, or throws 404 (not visible) / 403 (visible, not editable). */
async function loadLeadForWrite(tx: Tx, actor: UserActor, id: string) {
  const [row] = await tx
    .select()
    .from(lead)
    .where(and(eq(lead.id, id), leadVisible(actor)))
    .for('update');
  if (!row) throw notFound('Lead');
  if (!canAccessOwner(actor, row.ownerId, 'write', 'deals', 'lead.manage')) throw forbidden('VIEW_ONLY', 'You can view this lead but not change it');
  return row;
}

type LeadStatus = 'new' | 'working' | 'qualified' | 'unqualified' | 'converted';
export async function listLeads(ctx: AppContext, actor: UserActor, page: Page & { status?: LeadStatus }) {
  requirePerm(actor, 'lead.view');
  const where = and(
    isNull(lead.archivedAt),
    leadVisible(actor),
    page.q ? or(ilike(lead.name, like(page.q)), ilike(lead.email, like(page.q)), ilike(lead.companyName, like(page.q))) : undefined,
    page.status ? eq(lead.status, page.status) : undefined,
    page.ownerId ? eq(lead.ownerId, page.ownerId) : undefined,
  );
  const items = await ctx.db
    .select(leadColumns)
    .from(lead)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, lead.ownerId))
    .where(where)
    .orderBy(desc(lead.createdAt))
    .limit(page.limit)
    .offset(page.offset);
  const [count] = await ctx.db.select({ n: sql<number>`count(*)::int` }).from(lead).where(where);
  return { items, total: count?.n ?? 0 };
}

export async function getLead(ctx: AppContext, actor: UserActor, id: string) {
  requirePerm(actor, 'lead.view');
  const [row] = await ctx.db
    .select(leadColumns)
    .from(lead)
    .innerJoin(appUserProfile, eq(appUserProfile.userId, lead.ownerId))
    .where(and(eq(lead.id, id), leadVisible(actor)));
  if (!row) throw notFound('Lead');
  return row;
}

/** Resolve the owner for a new/assigned lead: the requested user if the actor may reassign to them, else self. */
function resolveLeadOwner(actor: UserActor, requested: string | undefined): string {
  if (requested && requested !== actor.userId && canAccessOwner(actor, requested, 'write', 'deals', 'record.reassign')) return requested;
  return actor.userId;
}

export async function createLead(ctx: AppContext, actor: UserActor, input: z.infer<typeof leadInput>) {
  requirePerm(actor, 'lead.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const email = input.email ? normalizeEmail(input.email) : null;
    if (email) {
      const [dupLead] = await u.tx
        .select({ id: lead.id })
        .from(lead)
        .where(and(eq(lead.normalizedEmail, email), isNull(lead.archivedAt), ne(lead.status, 'converted')));
      const [dupContact] = await u.tx
        .select({ id: contact.id })
        .from(contact)
        .where(and(eq(contact.normalizedEmail, email), isNull(contact.archivedAt)));
      if (dupLead || dupContact)
        requireConfirmations([{ code: 'DUPLICATE_SUSPECTED', message: 'A lead or contact with this email already exists' }], input.confirm);
    }
    const [row] = await u.tx
      .insert(lead)
      .values({
        name: input.name,
        companyName: blank(input.companyName),
        email: blank(input.email),
        normalizedEmail: email,
        phone: blank(input.phone),
        jobTitle: blank(input.jobTitle),
        source: input.source?.trim() || 'manual',
        ownerId: resolveLeadOwner(actor, input.ownerId),
        notes: blank(input.notes),
        createdBy: actor.userId,
      })
      .returning();
    await u.audit('lead.created', { type: 'lead', id: row!.id });
    return row!;
  });
}

export async function updateLead(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof leadPatch>) {
  requirePerm(actor, 'lead.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const before = await loadLeadForWrite(u.tx, actor, id);
    if (before.status === 'converted') throw rule('LEAD_CONVERTED', 'A converted lead can no longer be edited');
    if (input.rowVersion !== undefined && input.rowVersion !== before.rowVersion)
      throw conflict('CONCURRENT_MODIFICATION', 'This lead changed since you opened it');
    const email = input.email === undefined ? before.email : blank(input.email);
    const next = {
      name: input.name ?? before.name,
      companyName: input.companyName === undefined ? before.companyName : blank(input.companyName),
      email,
      normalizedEmail: email ? normalizeEmail(email) : null,
      phone: input.phone === undefined ? before.phone : blank(input.phone),
      jobTitle: input.jobTitle === undefined ? before.jobTitle : blank(input.jobTitle),
      source: input.source === undefined ? before.source : input.source.trim() || 'manual',
      notes: input.notes === undefined ? before.notes : blank(input.notes),
      status: input.status ?? before.status,
      // Reopening a disqualified lead (back to new/working) clears the old reason.
      disqualifyReason: input.status && before.status === 'unqualified' ? null : before.disqualifyReason,
      updatedBy: actor.userId,
      updatedAt: ctx.now(),
      rowVersion: before.rowVersion + 1,
    };
    await u.tx.update(lead).set(next).where(eq(lead.id, id));
    await u.audit(
      'lead.updated',
      { type: 'lead', id },
      input.status && input.status !== before.status ? { status: { from: before.status, to: input.status } } : undefined,
    );
    return { ...before, ...next };
  });
}

export async function assignLead(ctx: AppContext, actor: UserActor, id: string, ownerId: string) {
  requirePerm(actor, 'lead.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const before = await loadLeadForWrite(u.tx, actor, id);
    if (!canAccessOwner(actor, ownerId, 'write', 'deals', 'record.reassign')) throw forbidden('FORBIDDEN_REASSIGN', 'You cannot assign this lead to that user');
    const [t] = await u.tx.select({ status: appUserProfile.status }).from(appUserProfile).where(eq(appUserProfile.userId, ownerId));
    if (t?.status !== 'active') throw rule('REASSIGNMENT_TARGET_INACTIVE', 'The new owner must be an active user');
    await u.tx
      .update(lead)
      .set({ ownerId, updatedBy: actor.userId, updatedAt: ctx.now(), rowVersion: before.rowVersion + 1 })
      .where(eq(lead.id, id));
    await u.audit('lead.assigned', { type: 'lead', id }, { ownerId: { from: before.ownerId, to: ownerId } });
  });
}

export async function qualifyLead(ctx: AppContext, actor: UserActor, id: string) {
  requirePerm(actor, 'lead.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const before = await loadLeadForWrite(u.tx, actor, id);
    if (before.status === 'converted') throw rule('LEAD_CONVERTED', 'This lead is already converted');
    await u.tx
      .update(lead)
      .set({ status: 'qualified', disqualifyReason: null, updatedBy: actor.userId, updatedAt: ctx.now(), rowVersion: before.rowVersion + 1 })
      .where(eq(lead.id, id));
    await u.audit('lead.qualified', { type: 'lead', id });
  });
}

export async function disqualifyLead(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof leadDisqualifyInput>) {
  requirePerm(actor, 'lead.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const before = await loadLeadForWrite(u.tx, actor, id);
    if (before.status === 'converted') throw rule('LEAD_CONVERTED', 'A converted lead cannot be disqualified');
    await u.tx
      .update(lead)
      .set({ status: 'unqualified', disqualifyReason: input.reason.trim(), updatedBy: actor.userId, updatedAt: ctx.now(), rowVersion: before.rowVersion + 1 })
      .where(eq(lead.id, id));
    await u.audit('lead.disqualified', { type: 'lead', id }, { reason: input.reason.trim() });
  });
}

export async function deleteLead(ctx: AppContext, actor: UserActor, id: string) {
  requirePerm(actor, 'lead.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const before = await loadLeadForWrite(u.tx, actor, id);
    if (before.status === 'converted') throw rule('LEAD_CONVERTED', 'A converted lead cannot be deleted — it is now a company, contact and deal');
    await u.tx.delete(lead).where(eq(lead.id, id));
    await u.audit('lead.deleted', { type: 'lead', id }, { name: before.name });
  });
}

/** Convert a qualified lead into a company (optional), contact and deal (BR-LED-005). Idempotent guards prevent double-convert. */
export async function convertLead(ctx: AppContext, actor: UserActor, id: string, input: z.infer<typeof leadConvertInput>) {
  requirePerm(actor, 'lead.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const l = await loadLeadForWrite(u.tx, actor, id);
    if (l.status === 'converted') throw rule('LEAD_ALREADY_CONVERTED', 'This lead has already been converted');
    if (l.status === 'unqualified') throw rule('LEAD_UNQUALIFIED', 'Requalify this lead before converting it');

    // Company: an explicit visible company; else an existing visible company with the same name (no duplicate);
    // else create one from the lead's company name.
    let companyId = input.companyId ?? null;
    if (companyId) {
      await companyVisibleCheck(ctx, u.tx, actor, companyId);
    } else if (l.companyName) {
      const [same] = await u.tx
        .select({ id: company.id })
        .from(company)
        .where(and(eq(company.normalizedName, normalizeName(l.companyName)), isNull(company.archivedAt), companyVisible(actor, ctx.db)))
        .limit(1);
      companyId = same?.id ?? null;
    }
    if (!companyId && l.companyName) {
      const [co] = await u.tx
        .insert(company)
        .values({ name: l.companyName, normalizedName: normalizeName(l.companyName), ownerId: l.ownerId, createdBy: actor.userId })
        .returning();
      companyId = co!.id;
      await u.audit('company.created', { type: 'company', id: companyId });
      await u.timeline({
        eventType: 'company_created',
        source: { type: 'company', id: companyId },
        summary: `Company ${l.companyName} created from lead`,
        anchors: [{ type: 'company', id: companyId }],
      });
    }

    // Contact: reuse an existing contact with the same email, else create one (name split into first/last).
    const email = l.normalizedEmail;
    let contactId: string | null = null;
    if (email) {
      const [existing] = await u.tx
        .select({ id: contact.id })
        .from(contact)
        .where(and(eq(contact.normalizedEmail, email), isNull(contact.archivedAt)));
      contactId = existing?.id ?? null;
    }
    if (!contactId) {
      const parts = l.name.trim().split(/\s+/);
      const [c] = await u.tx
        .insert(contact)
        .values({
          firstName: parts[0] ?? l.name,
          lastName: parts.slice(1).join(' ') || null,
          email: l.email,
          normalizedEmail: email,
          phone: l.phone,
          jobTitle: l.jobTitle,
          companyId,
          ownerId: l.ownerId,
          source: 'lead',
          createdBy: actor.userId,
        })
        .returning();
      contactId = c!.id;
      await u.audit('contact.created', { type: 'contact', id: contactId });
      await u.timeline({
        eventType: 'contact_created',
        source: { type: 'contact', id: contactId },
        summary: `Contact ${l.name} created from lead`,
        anchors: companyId
          ? [
              { type: 'contact', id: contactId },
              { type: 'company', id: companyId },
            ]
          : [{ type: 'contact', id: contactId }],
      });
    }

    // Deal (optional, needs a company — OD-33).
    let dealId: string | null = null;
    if (input.createDeal ?? true) {
      if (!companyId) throw rule('LEAD_NEEDS_COMPANY', 'A company is required to create a deal — add a company name or choose a company');
      const d = await insertDeal(ctx, u, {
        name: input.dealName?.trim() || l.name,
        companyId,
        contactIds: contactId ? [contactId] : [],
        amount: input.amount,
        ownerId: l.ownerId,
        source: 'lead',
      });
      dealId = d.id;
    }

    await u.tx
      .update(lead)
      .set({
        status: 'converted',
        convertedCompanyId: companyId,
        convertedContactId: contactId,
        convertedDealId: dealId,
        convertedAt: ctx.now(),
        updatedBy: actor.userId,
        updatedAt: ctx.now(),
        rowVersion: l.rowVersion + 1,
      })
      .where(eq(lead.id, id));
    await u.audit('lead.converted', { type: 'lead', id }, { companyId, contactId, dealId });
    return { leadId: id, companyId, contactId, dealId };
  });
}
