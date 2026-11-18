/**
 * Shared helpers handed to route files under http/routes/. Each route file exports `register(api, kit)` and is
 * mounted once in http/app.ts, so feature areas can add endpoints without editing app.ts.
 */
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import type { AppContext, UserActor } from '../platform/core.ts';

export type Env = { Variables: { requestId: string; actor: UserActor } };
export interface RouteKit {
  ctx: AppContext;
  /** The signed-in user for this request (authentication already enforced for everything under /api/v1). */
  actor: (c: Context<Env>) => UserActor;
  /** Parses and validates the JSON body; throws 400 VALIDATION_FAILED with field errors. */
  body: <S extends z.ZodType>(c: Context, schema: S) => Promise<z.infer<S>>;
  /** Validates a query-string object the same way. */
  query: <S extends z.ZodType>(c: Context, schema: S) => z.infer<S>;
  /** Reads a UUID path parameter; throws 404 when it is not a UUID. */
  id: (c: Context, name?: string) => string;
  /** File download response (attachment, no-store). */
  file: (f: { bytes: Uint8Array; contentType: string; fileName: string }) => Response;
}
export type Api = Hono<Env>;
