import type { PermKey } from '@crm/shared';
import type { Context } from 'hono';
import * as admin from '../../modules/admin.ts';
import { requirePerm } from '../../platform/core.ts';
import type { Api, Env, RouteKit } from '../kit.ts';

/**
 * Routes for: organization settings, pipeline, lost reasons, teams, audit log. Mounted under /api/v1 (authenticated).
 * All of it is Admin-only. The role is checked BEFORE the body is parsed, so a caller without the permission always
 * gets 403 and never learns the input schema from validation errors; the module checks it again.
 */
export function register(api: Api, kit: RouteKit): void {
  const { ctx } = kit;
  const as = (c: Context<Env>, perm: PermKey) => {
    const actor = kit.actor(c);
    requirePerm(actor, perm);
    return actor;
  };
  const settings = (c: Context<Env>) => as(c, 'settings.manage');

  // Organization settings (BR-PLT-012)
  api.get('/settings/organization', async (c) => c.json(await admin.getOrganizationSettings(ctx, settings(c))));
  api.put('/settings/organization', async (c) => {
    const actor = settings(c);
    return c.json(await admin.updateOrganizationSettings(ctx, actor, await kit.body(c, admin.organizationSettingsInput)));
  });

  // Pipeline stages (BR-CRM-005)
  api.get('/admin/pipeline/stages', async (c) => c.json(await admin.listStages(ctx, settings(c))));
  api.post('/admin/pipeline/stages', async (c) => {
    const actor = settings(c);
    return c.json(await admin.createStage(ctx, actor, await kit.body(c, admin.stageCreateInput)), 201);
  });
  api.put('/admin/pipeline/stage-order', async (c) => {
    const actor = settings(c);
    return c.json(await admin.reorderStages(ctx, actor, (await kit.body(c, admin.stageOrderInput)).stageIds));
  });
  api.patch('/admin/pipeline/stages/:id', async (c) => {
    const actor = settings(c);
    return c.json(await admin.updateStage(ctx, actor, kit.id(c), await kit.body(c, admin.stagePatchInput)));
  });
  api.post('/admin/pipeline/stages/:id/proposal-sent-target', async (c) => c.json(await admin.setProposalSentTarget(ctx, settings(c), kit.id(c))));
  api.delete('/admin/pipeline/stages/:id', async (c) => c.json(await admin.deleteStage(ctx, settings(c), kit.id(c))));

  // Lost reasons (BR-CRM-014)
  api.get('/admin/lost-reasons', async (c) => c.json(await admin.listLostReasons(ctx, settings(c))));
  api.post('/admin/lost-reasons', async (c) => {
    const actor = settings(c);
    return c.json(await admin.createLostReason(ctx, actor, await kit.body(c, admin.lostReasonCreateInput)), 201);
  });
  api.patch('/admin/lost-reasons/:id', async (c) => {
    const actor = settings(c);
    return c.json(await admin.updateLostReason(ctx, actor, kit.id(c), await kit.body(c, admin.lostReasonPatchInput)));
  });
  api.delete('/admin/lost-reasons/:id', async (c) => c.json(await admin.deleteLostReason(ctx, settings(c), kit.id(c))));
  api.delete('/admin/teams/:id', async (c) => c.json(await admin.deleteTeam(ctx, settings(c), kit.id(c))));

  // Teams and managers (BR-PLT-006)
  api.get('/admin/teams', async (c) => c.json(await admin.listTeams(ctx, settings(c))));
  api.post('/admin/teams', async (c) => {
    const actor = settings(c);
    return c.json(await admin.createTeam(ctx, actor, await kit.body(c, admin.teamCreateInput)), 201);
  });
  api.patch('/admin/teams/:id', async (c) => {
    const actor = settings(c);
    return c.json(await admin.renameTeam(ctx, actor, kit.id(c), await kit.body(c, admin.teamPatchInput)));
  });
  api.post('/admin/teams/:id/members', async (c) => {
    const actor = settings(c);
    return c.json(await admin.addTeamMember(ctx, actor, kit.id(c), await kit.body(c, admin.teamMemberInput)));
  });
  api.delete('/admin/teams/:id/members/:userId', async (c) => c.json(await admin.removeTeamMember(ctx, settings(c), kit.id(c), kit.id(c, 'userId'))));
  api.post('/admin/teams/:id/managers', async (c) => {
    const actor = settings(c);
    return c.json(await admin.addTeamManager(ctx, actor, kit.id(c), await kit.body(c, admin.teamManagerInput)));
  });
  api.delete('/admin/teams/:id/managers/:userId', async (c) => c.json(await admin.removeTeamManager(ctx, settings(c), kit.id(c), kit.id(c, 'userId'))));

  // Audit log viewer (BR-PLT-009) — read-only: there is no route that writes, edits or deletes an entry.
  api.get('/audit-log', async (c) => {
    const actor = as(c, 'audit.view');
    return c.json(await admin.listAuditLog(ctx, actor, kit.query(c, admin.auditLogQuery)));
  });
  api.get('/audit-log/filters', async (c) => c.json(await admin.auditLogFilters(ctx, as(c, 'audit.view'))));
}
