import type { Role } from './roles.ts';

/**
 * Shared permission matrix — one definition used by the server (decide + SQL scope filter) and the
 * web app (permission-aware UI). Source: ROLE-PERMISSION-MATRIX.md (PERM ids in comments), BRD §9.17.
 *
 * Scope meanings: all = every record · team = records owned by the actor's team scope (self, team members,
 * co-managers, R7) · own = records the actor owns · own_or_view = own, plus read-only access to others when
 * the Admin cross-visibility setting allows (OD-31) · flag = Admin-granted canManageContent · none = denied.
 */
export type Scope = 'all' | 'team' | 'own' | 'own_or_view' | 'flag' | 'none';

export const PERMISSIONS = {
  'user.manage': { admin: 'all', sales_manager: 'none', salesperson: 'none' }, // PERM-001..008
  'user.list': { admin: 'all', sales_manager: 'all', salesperson: 'all' }, // PERM-009
  'settings.manage': { admin: 'all', sales_manager: 'none', salesperson: 'none' }, // PERM-012..016
  'audit.view': { admin: 'all', sales_manager: 'none', salesperson: 'none' }, // PERM-150
  'record.view': { admin: 'all', sales_manager: 'team', salesperson: 'own_or_view' }, // PERM-038/043/049
  'record.create': { admin: 'all', sales_manager: 'all', salesperson: 'all' }, // PERM-037/042/048
  'record.edit': { admin: 'all', sales_manager: 'team', salesperson: 'own' }, // PERM-039/044/050
  'record.reassign': { admin: 'all', sales_manager: 'team', salesperson: 'none' }, // PERM-041/046/057
  'content.manage': { admin: 'all', sales_manager: 'flag', salesperson: 'none' }, // PERM-095/099/101
  'template.lockSections': { admin: 'all', sales_manager: 'none', salesperson: 'none' }, // PERM-096 (R8)
  'proposal.manage': { admin: 'all', sales_manager: 'team', salesperson: 'own' }, // PERM-103..126
  'automation.manage': { admin: 'all', sales_manager: 'none', salesperson: 'none' }, // PERM-130
  'automation.reverse': { admin: 'all', sales_manager: 'team', salesperson: 'own' }, // PERM-129
  'report.view': { admin: 'all', sales_manager: 'team', salesperson: 'own' }, // PERM-145 (BR-RPT-008)
  'ai.use': { admin: 'all', sales_manager: 'all', salesperson: 'all' }, // PERM-134..139
  'lead.view': { admin: 'all', sales_manager: 'team', salesperson: 'own' }, // PERM-093 (managed leads, owner-scoped)
  'lead.manage': { admin: 'all', sales_manager: 'team', salesperson: 'own' }, // create/edit/assign/qualify/convert managed leads
} as const satisfies Record<string, Record<Role, Scope>>;

export type PermKey = keyof typeof PERMISSIONS;

export function scopeFor(role: Role, key: PermKey): Scope {
  return PERMISSIONS[key][role];
}

/** Payload for the UI: which actions the user may attempt at all. */
export function permissionSummary(role: Role, canManageContent: boolean): Record<PermKey, boolean> {
  const out = {} as Record<PermKey, boolean>;
  for (const key of Object.keys(PERMISSIONS) as PermKey[]) {
    const s = scopeFor(role, key);
    out[key] = s === 'flag' ? canManageContent : s !== 'none';
  }
  return out;
}
