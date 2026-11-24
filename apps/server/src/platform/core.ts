/**
 * Platform core: database handle, unit of work, actor/authorization policy, crypto and errors.
 * (BACKEND-DESIGN §2, ADR-028 unit of work, ADR-076 mandatory scope filter, ADR-073 envelope encryption.)
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { ERROR_CODES, type PermKey, type Role, scopeFor } from '@crm/shared';
import { type ExtractTablesWithRelations, eq, inArray, type SQL, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgColumn, PgTransaction } from 'drizzle-orm/pg-core';
import type pg from 'pg';
import type { Config } from '../config/env.ts';
import * as schema from '../db/schema.ts';
import { DomainError } from './errors/domain-error.ts';
import type { Logger } from './logging/logger.ts';
import type { AiProvider, ESignatureProvider, EstimatesSource, ObjectStorage, PdfRenderer, TransactionalEmail } from './ports.ts';

export { schema };
export type Db = NodePgDatabase<typeof schema>;
export type Tx = PgTransaction<NodePgQueryResultHKT, typeof schema, ExtractTablesWithRelations<typeof schema>>;
export type DbOrTx = Db | Tx;

export function createDb(pool: pg.Pool): Db {
  return drizzle(pool, { schema });
}

// ───────────── errors ─────────────
export const notFound = (what = 'Record') => new DomainError(ERROR_CODES.NOT_FOUND, 404, `${what} not found`);
export const forbidden = (code = 'FORBIDDEN', title = 'You are not allowed to do this') => new DomainError(code, 403, title);
export const rule = (code: string, title: string, meta?: Record<string, unknown>) => new DomainError(code, 422, title, { meta });
export const conflict = (code: string, title: string, meta?: Record<string, unknown>) => new DomainError(code, 409, title, { meta });
/** Warnings that need explicit user confirmation (API-SPECIFICATION §1.3). */
export function requireConfirmations(needed: { code: string; message: string }[], confirmed: string[] | undefined): void {
  const missing = needed.filter((n) => !confirmed?.includes(n.code));
  if (missing.length) throw new DomainError('CONFIRMATION_REQUIRED', 409, 'Please confirm before continuing', { meta: { confirmations: missing } });
}

// ───────────── actors and authorization ─────────────
export interface UserActor {
  type: 'user';
  userId: string;
  name: string;
  role: Role;
  canManageContent: boolean;
  /** Self + members and co-managers of managed teams (R7). For salespeople: just self. */
  teamScopeIds: string[];
  crossVisibility: { companies: 'none' | 'view_only'; contacts: 'none' | 'view_only'; deals: 'none' | 'view_only' };
}
export type Actor = UserActor | { type: 'system'; name: string } | { type: 'buyer'; name: string } | { type: 'ai'; name: string; userId: string };
export const SYSTEM: Actor = { type: 'system', name: 'Automation' };

export async function buildUserActor(db: DbOrTx, userId: string): Promise<UserActor | null> {
  const [profile] = await db.select().from(schema.appUserProfile).where(eq(schema.appUserProfile.userId, userId));
  if (profile?.status !== 'active') return null;
  const scope = new Set<string>([userId]);
  if (profile.role === 'sales_manager') {
    const managed = await db.select({ teamId: schema.teamManager.teamId }).from(schema.teamManager).where(eq(schema.teamManager.userId, userId));
    const teamIds = managed.map((m) => m.teamId);
    if (teamIds.length) {
      for (const m of await db.select().from(schema.teamMembership).where(inArray(schema.teamMembership.teamId, teamIds))) scope.add(m.userId);
      for (const m of await db.select().from(schema.teamManager).where(inArray(schema.teamManager.teamId, teamIds))) scope.add(m.userId);
    }
  }
  const [settings] = await db.select({ cv: schema.organizationSettings.salespersonCrossVisibility }).from(schema.organizationSettings);
  return {
    type: 'user',
    userId,
    name: profile.fullName,
    role: profile.role,
    canManageContent: profile.canManageContent,
    teamScopeIds: [...scope],
    crossVisibility: settings?.cv ?? { companies: 'none', contacts: 'none', deals: 'none' },
  };
}

type OwnedKind = 'companies' | 'contacts' | 'deals';

/** Throws unless the role may attempt this action at all (role-level check). */
export function requirePerm(actor: UserActor, key: PermKey): void {
  const s = scopeFor(actor.role, key);
  if (s === 'none' || (s === 'flag' && !actor.canManageContent)) throw forbidden();
}

/** Record-level decision on an owned record. `write` excludes view-only grants. */
export function canAccessOwner(actor: UserActor, ownerId: string, access: 'read' | 'write', kind: OwnedKind, key?: PermKey): boolean {
  const s = scopeFor(actor.role, key ?? (access === 'read' ? 'record.view' : 'record.edit'));
  if (s === 'all') return true;
  if (s === 'team') return actor.teamScopeIds.includes(ownerId);
  if (s === 'own') return ownerId === actor.userId;
  if (s === 'own_or_view') return ownerId === actor.userId || (access === 'read' && actor.crossVisibility[kind] === 'view_only');
  return false;
}

/**
 * Mandatory SQL scope filter for lists, search and reports (ADR-076): returns a WHERE condition on the
 * owner column, so data outside the actor's scope is never selected.
 */
export function ownerScope(actor: UserActor, ownerColumn: PgColumn, kind: OwnedKind, key: PermKey = 'record.view'): SQL {
  const s = scopeFor(actor.role, key);
  if (s === 'all') return sql`true`;
  if (s === 'team') return inArray(ownerColumn, actor.teamScopeIds);
  if (s === 'own_or_view' && actor.crossVisibility[kind] === 'view_only') return sql`true`;
  if (s === 'own' || s === 'own_or_view') return eq(ownerColumn, actor.userId);
  return sql`false`;
}

/**
 * Loads a deal the actor may access, or throws 404 (not visible) / 403 VIEW_ONLY (visible, not editable).
 * Proposals, share links, signature requests, tasks and notes inherit visibility from their deal.
 */
export async function loadDealFor(db: DbOrTx, actor: UserActor, dealId: string, access: 'read' | 'write', key?: PermKey) {
  const [row] = await db.select().from(schema.deal).where(eq(schema.deal.id, dealId));
  if (!row || !canAccessOwner(actor, row.ownerId, 'read', 'deals')) throw notFound('Deal');
  if (access === 'write' && !canAccessOwner(actor, row.ownerId, 'write', 'deals', key))
    throw forbidden('VIEW_ONLY', 'You can view this deal but not change it');
  return row;
}

// ───────────── unit of work (one transaction + audit + timeline + in-transaction job enqueue) ─────────────
export interface AppContext {
  db: Db;
  config: Config;
  logger: Logger;
  storage: ObjectStorage;
  esign: ESignatureProvider;
  ai: AiProvider;
  email: TransactionalEmail;
  estimates: EstimatesSource;
  pdf: PdfRenderer;
  now: () => Date;
}

export interface Uow {
  tx: Tx;
  actor: Actor;
  audit(action: string, target: { type: string; id: string } | null, changes?: unknown): Promise<void>;
  timeline(entry: {
    eventType: string;
    source: { type: string; id: string };
    summary: string;
    anchors: { type: 'company' | 'contact' | 'deal'; id: string }[];
    isAutomated?: boolean;
    automationExecutionId?: string;
  }): Promise<void>;
  /** Jobs are inserted in the same transaction as the change (ADR-022): rolled back together. */
  enqueue(queue: string, payload: Record<string, unknown>, runAfter?: Date): Promise<void>;
}

export async function unitOfWork<T>(ctx: AppContext, actor: Actor, fn: (uow: Uow) => Promise<T>, requestId?: string): Promise<T> {
  return ctx.db.transaction(async (tx) => {
    const actorUserId = actor.type === 'user' ? actor.userId : actor.type === 'ai' ? actor.userId : null;
    const uow: Uow = {
      tx,
      actor,
      async audit(action, target, changes) {
        await tx
          .insert(schema.auditLog)
          .values({ actorType: actor.type, actorUserId, action, targetType: target?.type, targetId: target?.id, changes: changes ?? null, requestId });
      },
      async timeline(entry) {
        const occurredAt = ctx.now();
        const [ev] = await tx
          .insert(schema.timelineEvent)
          .values({
            eventType: entry.eventType,
            sourceType: entry.source.type,
            sourceId: entry.source.id,
            actorType: actor.type,
            actorName: actor.name,
            occurredAt,
            summary: entry.summary,
            isAutomated: entry.isAutomated ?? false,
            automationExecutionId: entry.automationExecutionId,
          })
          .returning({ id: schema.timelineEvent.id });
        const seen = new Set<string>();
        const anchors = entry.anchors.filter((a) => !seen.has(a.type + a.id) && seen.add(a.type + a.id));
        if (anchors.length)
          await tx.insert(schema.timelineEventAnchor).values(anchors.map((a) => ({ timelineEventId: ev!.id, recordType: a.type, recordId: a.id, occurredAt })));
      },
      async enqueue(queue, payload, runAfter) {
        await tx.insert(schema.jobOutbox).values({ queue, payload, runAfter: runAfter ?? ctx.now() });
      },
    };
    return fn(uow);
  });
}

/** Row lock helper — lock order is always deal → proposal → version → signature request (DATABASE-DESIGN §17). */
export async function lockRow(
  tx: Tx,
  table: 'deal' | 'proposal' | 'proposal_version' | 'signature_request' | 'organization_settings',
  id: string | number,
): Promise<void> {
  await tx.execute(sql`select 1 from ${sql.identifier(table)} where id = ${id} for update`);
}

// ───────────── crypto ─────────────
export const sha256Hex = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** AES-256-GCM envelope with key id (ADR-073). Dev key comes from KEYRING_LOCAL_MASTER_KEY; production wraps via KMS. */
export function encryptSecret(masterKeyHex: string, plaintext: string, aad: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(masterKeyHex, 'hex'), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return JSON.stringify({ v: 1, kid: 'local-1', iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') });
}
export function decryptSecret(masterKeyHex: string, envelope: string, aad: string): string {
  const e = JSON.parse(envelope) as { iv: string; ct: string; tag: string };
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(masterKeyHex, 'hex'), Buffer.from(e.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(e.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(e.ct, 'base64')), decipher.final()]).toString('utf8');
}

export const normalizeEmail = (email: string) => email.trim().toLowerCase();
export function normalizeDomain(input: string | undefined | null): string | null {
  if (!input) return null;
  const d =
    input
      .trim()
      .toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .split('/')[0] ?? '';
  return d.includes('.') ? d : null;
}
