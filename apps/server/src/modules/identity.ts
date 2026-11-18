/**
 * identity module — authentication (Better Auth, ADR-006/027), users, teams, bootstrap.
 * BR-PLT-002/003/005/006/011/012. Accounts are created by an Admin only (invite-only, IDD-02): public sign-up is disabled.
 */
import { randomUUID } from 'node:crypto';
import type { Role } from '@crm/shared';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { hashPassword } from 'better-auth/crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Config } from '../config/env.ts';
import {
  type AppContext,
  conflict,
  type Db,
  normalizeEmail,
  notFound,
  requirePerm,
  rule,
  schema,
  type Tx,
  type UserActor,
  unitOfWork,
} from '../platform/core.ts';

const { appUserProfile, authAccount, authSession, authUser, authVerification, team, teamMembership, teamManager, organizationSettings } = schema;

export function createAuth(db: Db, config: Config) {
  return betterAuth({
    appName: 'Sales CRM',
    baseURL: config.APP_ORIGIN,
    basePath: '/auth',
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_ORIGIN],
    database: drizzleAdapter(db, { provider: 'pg', schema: { user: authUser, session: authSession, account: authAccount, verification: authVerification } }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 12, updateAge: 60 * 15 }, // 12 h absolute (OD-76)
    advanced: {
      database: { generateId: () => randomUUID() },
      cookiePrefix: 'crm',
      defaultCookieAttributes: { sameSite: 'lax', httpOnly: true, secure: config.NODE_ENV === 'production' },
    },
    rateLimit: { enabled: config.NODE_ENV !== 'test', window: 60, max: 20 },
  });
}
export type Auth = ReturnType<typeof createAuth>;

export interface NewUser {
  email: string;
  fullName: string;
  role: Role;
  password: string;
  teamId?: string;
}

/** Creates the Better Auth user + credential account + application profile in the caller's transaction. */
export async function insertUser(tx: Tx, input: NewUser, createdBy: string | null): Promise<string> {
  const email = normalizeEmail(input.email);
  const [existing] = await tx.select({ id: appUserProfile.userId }).from(appUserProfile).where(eq(appUserProfile.normalizedEmail, email));
  if (existing) throw conflict('USER_ALREADY_EXISTS', 'A user with this email already exists');
  const id = randomUUID();
  await tx.insert(authUser).values({ id, name: input.fullName, email, emailVerified: true });
  await tx.insert(authAccount).values({ id: randomUUID(), userId: id, accountId: id, providerId: 'credential', password: await hashPassword(input.password) });
  await tx
    .insert(appUserProfile)
    .values({ userId: id, email, normalizedEmail: email, fullName: input.fullName, role: input.role, status: 'active', createdBy });
  if (input.teamId) await tx.insert(teamMembership).values({ userId: id, teamId: input.teamId });
  return id;
}

export async function createUser(ctx: AppContext, actor: UserActor, input: NewUser) {
  requirePerm(actor, 'user.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const id = await insertUser(u.tx, input, actor.userId);
    await u.audit('user.invited', { type: 'user', id }, { role: input.role });
    return { id };
  });
}

export async function listUsers(ctx: AppContext, _actor: UserActor) {
  const rows = await ctx.db
    .select({
      id: appUserProfile.userId,
      email: appUserProfile.email,
      fullName: appUserProfile.fullName,
      role: appUserProfile.role,
      status: appUserProfile.status,
      canManageContent: appUserProfile.canManageContent,
      teamId: teamMembership.teamId,
      teamName: team.name,
    })
    .from(appUserProfile)
    .leftJoin(teamMembership, eq(teamMembership.userId, appUserProfile.userId))
    .leftJoin(team, eq(team.id, teamMembership.teamId))
    .orderBy(appUserProfile.fullName);
  return rows;
}

async function assertNotLastAdmin(tx: Tx, userId: string): Promise<void> {
  // Serialise admin changes so two concurrent demotions cannot remove the last Admin (RULE-PLT, LAST_ADMIN).
  await tx.execute(sql`select pg_advisory_xact_lock(727002)`);
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(appUserProfile)
    .where(and(eq(appUserProfile.role, 'admin'), eq(appUserProfile.status, 'active'), ne(appUserProfile.userId, userId)));
  if (!row || row.n === 0) throw rule('LAST_ADMIN', 'At least one active Admin is required');
}

export async function patchUser(ctx: AppContext, actor: UserActor, userId: string, patch: { role?: Role; canManageContent?: boolean; teamId?: string | null }) {
  requirePerm(actor, 'user.manage');
  return unitOfWork(ctx, actor, async (u) => {
    const [target] = await u.tx.select().from(appUserProfile).where(eq(appUserProfile.userId, userId));
    if (!target) throw notFound('User');
    if (patch.role && patch.role !== target.role) {
      if (userId === actor.userId) throw rule('FORBIDDEN', 'You cannot change your own role');
      if (target.role === 'admin') await assertNotLastAdmin(u.tx, userId);
      if (target.role === 'sales_manager') await u.tx.delete(teamManager).where(eq(teamManager.userId, userId));
    }
    await u.tx
      .update(appUserProfile)
      .set({
        role: patch.role ?? target.role,
        canManageContent: patch.canManageContent ?? target.canManageContent,
        updatedAt: ctx.now(),
        updatedBy: actor.userId,
      })
      .where(eq(appUserProfile.userId, userId));
    if (patch.teamId !== undefined) {
      await u.tx.delete(teamMembership).where(eq(teamMembership.userId, userId));
      if (patch.teamId) await u.tx.insert(teamMembership).values({ userId, teamId: patch.teamId });
    }
    await u.audit('user.updated', { type: 'user', id: userId }, { role: patch.role, canManageContent: patch.canManageContent, teamId: patch.teamId });
    return { id: userId };
  });
}

/** BR-PLT-011: deactivate and reassign owned records in one transaction; all sessions are revoked. */
export async function deactivateUser(ctx: AppContext, actor: UserActor, userId: string, reassignToUserId: string) {
  requirePerm(actor, 'user.manage');
  if (userId === reassignToUserId) throw rule('REASSIGNMENT_TARGET_REQUIRED', 'Choose a different user to receive the records');
  return unitOfWork(ctx, actor, async (u) => {
    const [target] = await u.tx.select().from(appUserProfile).where(eq(appUserProfile.userId, userId));
    const [to] = await u.tx.select().from(appUserProfile).where(eq(appUserProfile.userId, reassignToUserId));
    if (!target) throw notFound('User');
    if (to?.status !== 'active') throw rule('REASSIGNMENT_TARGET_INACTIVE', 'The receiving user must be active');
    if (target.role === 'admin') await assertNotLastAdmin(u.tx, userId);
    await u.tx.update(schema.deal).set({ ownerId: reassignToUserId }).where(eq(schema.deal.ownerId, userId));
    await u.tx.update(schema.company).set({ ownerId: reassignToUserId }).where(eq(schema.company.ownerId, userId));
    await u.tx.update(schema.contact).set({ ownerId: reassignToUserId }).where(eq(schema.contact.ownerId, userId));
    await u.tx
      .update(schema.task)
      .set({ assigneeId: reassignToUserId })
      .where(and(eq(schema.task.assigneeId, userId), eq(schema.task.status, 'open')));
    await u.tx
      .update(appUserProfile)
      .set({ status: 'deactivated', deactivatedAt: ctx.now(), roundRobinEligible: false })
      .where(eq(appUserProfile.userId, userId));
    await u.tx.update(teamMembership).set({ isActive: false }).where(eq(teamMembership.userId, userId)); // R7: membership retained
    await u.tx.delete(authSession).where(eq(authSession.userId, userId));
    await u.audit('user.deactivated', { type: 'user', id: userId }, { reassignedTo: reassignToUserId });
    return { id: userId };
  });
}

export async function listTeams(ctx: AppContext) {
  return ctx.db.select({ id: team.id, name: team.name }).from(team).orderBy(team.name);
}

/** One-time bootstrap (IDD-02): organization settings, default pipeline, lost reasons and the first Admin. */
export async function bootstrap(ctx: AppContext, input: { organizationName: string; currency: string; timeZone: string; admin: NewUser }) {
  return ctx.db.transaction(async (tx) => {
    const [existing] = await tx.select({ id: organizationSettings.id }).from(organizationSettings);
    if (existing) throw conflict('BOOTSTRAP_ALREADY_DONE', 'This deployment is already bootstrapped');
    const adminId = await insertUser(tx, { ...input.admin, role: 'admin' }, null);
    await tx.insert(organizationSettings).values({
      organizationName: input.organizationName,
      defaultCurrency: input.currency,
      timeZone: input.timeZone,
      branding: { primaryColor: '#1f4e79', footerText: `${input.organizationName} — Confidential` },
      salespersonCrossVisibility: { companies: 'none', contacts: 'none', deals: 'none' },
      aiSettings: { enabled: true, perUserDailyCalls: 50 },
      proposalDefaults: { defaultTermMonths: 12, defaultValidityDays: 30 },
      automationSettings: { followUpAfterDays: 3, aut001Enabled: true, aut002Enabled: true },
      defaultLeadOwnerId: adminId,
      freeMailDomains: ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com', 'aol.com', 'proton.me'],
      privacyNoticeText: 'Your name and email are recorded so the sender knows who viewed this proposal.',
      leadFormKey: randomUUID().replaceAll('-', ''),
    });
    const [p] = await tx.insert(schema.pipeline).values({ name: 'Sales pipeline', isDefault: true }).returning();
    const stages: [string, 'open' | 'won' | 'lost', number, number | null, boolean][] = [
      ['Qualification', 'open', 20, 14, false],
      ['Discovery', 'open', 40, 14, false],
      ['Proposal sent', 'open', 60, 10, true],
      ['Negotiation', 'open', 80, 10, false],
      ['Closed Won', 'won', 100, null, false],
      ['Closed Lost', 'lost', 0, null, false],
    ];
    await tx.insert(schema.pipelineStage).values(
      stages.map(([name, kind, probability, stall, target], i) => ({
        pipelineId: p!.id,
        name,
        kind,
        sortOrder: i + 1,
        probability: String(probability),
        stallThresholdDays: stall,
        isProposalSentTarget: target,
      })),
    );
    await tx.insert(schema.lostReason).values(['Price', 'Chose a competitor', 'No decision', 'Timing', 'Other'].map((name) => ({ name })));
    return { adminId, pipelineId: p!.id };
  });
}

export async function getSettings(ctx: AppContext) {
  const [s] = await ctx.db.select().from(organizationSettings);
  if (!s) throw notFound('Organization settings');
  return s;
}
