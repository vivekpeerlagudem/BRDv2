import type { Context } from 'hono';
import * as imports from '../../modules/imports.ts';
import { requirePerm } from '../../platform/core.ts';
import type { Api, Env, RouteKit } from '../kit.ts';

/**
 * Routes for: CSV import (BR-MIG-001/003/004/005). Mounted under /api/v1 (authenticated). Admin-only (RULE-MIG-01):
 * the role is checked BEFORE the body or the id is read, so a caller without the permission always gets 403 and
 * learns nothing about imports; the module checks it again.
 */
export function register(api: Api, kit: RouteKit): void {
  const { ctx } = kit;
  const admin = (c: Context<Env>) => {
    const actor = kit.actor(c);
    requirePerm(actor, 'settings.manage');
    return actor;
  };

  api.get('/imports', async (c) => c.json(await imports.listBatches(ctx, admin(c))));
  api.post('/imports', async (c) => {
    const actor = admin(c);
    return c.json(await imports.uploadCsv(ctx, actor, await kit.body(c, imports.uploadInput)), 201);
  });
  api.get('/imports/:id', async (c) => c.json(await imports.getBatch(ctx, admin(c), kit.id(c))));
  api.delete('/imports/:id', async (c) => c.json(await imports.discardBatch(ctx, admin(c), kit.id(c))));
  api.put('/imports/:id/mapping', async (c) => {
    const actor = admin(c);
    return c.json(await imports.saveMapping(ctx, actor, kit.id(c), await kit.body(c, imports.mappingInput)));
  });
  // Validation run: writes the result to the import rows only, never to CRM tables.
  api.post('/imports/:id/preview', async (c) => c.json(await imports.previewBatch(ctx, admin(c), kit.id(c))));
  api.get('/imports/:id/rows', async (c) => {
    const actor = admin(c);
    return c.json(await imports.listRows(ctx, actor, kit.id(c), kit.query(c, imports.rowsQuery)));
  });
  api.get('/imports/:id/error-report', async (c) => kit.file(await imports.errorReport(ctx, admin(c), kit.id(c))));
  api.post('/imports/:id/commit', async (c) => {
    const actor = admin(c);
    return c.json(await imports.commitBatch(ctx, actor, kit.id(c), await kit.body(c, imports.commitInput)));
  });
  api.get('/imports/:id/undo-preview', async (c) => c.json(await imports.undoPreview(ctx, admin(c), kit.id(c))));
  api.post('/imports/:id/undo', async (c) => c.json(await imports.undoBatch(ctx, admin(c), kit.id(c))));
}
