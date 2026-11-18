import { z } from 'zod';
import * as proposals from '../../modules/proposals.ts';
import * as sharing from '../../modules/sharing.ts';
import type { Api, RouteKit } from '../kit.ts';

/** BR-SHR-007: a date-time with offset, or null to remove the expiry. `confirm` carries accepted warning codes. */
const linkExpiryInput = z.object({
  expiresAt: z.iso.datetime({ offset: true }).nullable(),
  confirm: z.array(z.string().max(100)).max(10).optional(),
});
/** BR-PRP-010: copy a proposal to a target deal (which may be the same deal — an alternative proposal). */
const proposalCopyInput = z.object({
  targetDealId: z.uuid(),
  title: z.string().trim().min(1).max(200).optional(),
  copyPricing: z.boolean().default(true),
});
const copyTargetsQuery = z.object({ q: z.string().trim().max(100).optional() });

/**
 * Routes for: link expiry, copy to another deal, currency review after a copy. Mounted under /api/v1 (authenticated).
 * Role permission and record-level access are enforced inside the module functions (requirePerm + loadDealFor /
 * ownerScope), every change runs in one unit of work with an audit entry.
 */
export function register(api: Api, kit: RouteKit): void {
  const { ctx } = kit;
  api.put('/share-links/:id/expiry', async (c) => c.json(await sharing.setLinkExpiry(ctx, kit.actor(c), kit.id(c), await kit.body(c, linkExpiryInput))));
  api.get('/proposal-copy-targets', async (c) => c.json(await proposals.listCopyTargets(ctx, kit.actor(c), kit.query(c, copyTargetsQuery).q)));
  api.post('/proposals/:id/copy', async (c) => {
    const input = await kit.body(c, proposalCopyInput);
    return c.json(await proposals.copyProposal(ctx, kit.actor(c), kit.id(c), input), 201);
  });
  api.post('/proposals/:id/currency-review/confirm', async (c) => c.json(await proposals.confirmCurrencyReview(ctx, kit.actor(c), kit.id(c))));
}
