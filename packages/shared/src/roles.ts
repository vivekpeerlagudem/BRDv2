import { z } from 'zod';

/**
 * The three internal roles (BR-PLT-005, ROLE-PERMISSION-MATRIX.md).
 * Single source of truth for server (authorization) and web (permission-aware UI).
 */
export const ROLES = ['admin', 'sales_manager', 'salesperson'] as const;

export const roleSchema = z.enum(ROLES);

export type Role = z.infer<typeof roleSchema>;
