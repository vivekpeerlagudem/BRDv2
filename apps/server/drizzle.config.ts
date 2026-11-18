import { defineConfig } from 'drizzle-kit';

// Used only to GENERATE reviewed SQL migrations from src/db/schema.ts (ADR-005). Applying them is done by
// `pnpm db:migrate` with the migrator role — never `drizzle-kit push` (ADR-030).
export default defineConfig({ dialect: 'postgresql', schema: './src/db/schema.ts', out: './drizzle' });
