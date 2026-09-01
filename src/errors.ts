// --- Error kernel (ADR-011 step 2) ---
//
// Zero-dep module: the error surface for peta-hono. No imports from api.ts,
// openapi.ts, paths.ts or validation — it is the leaf that the validator can
// throw `APIError` from without creating a circular `api ↔ openapi ↔
// validation ↔ errors` dependency. Both `openapi.ts` (validator + OpenAPIHono
// default onError) and `api.ts` (createApi facade) import from here.

import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

/** Single error policy — shared by OpenAPIHono and createApi (via createErrorHandler). */
export type ErrorHandler = (err: Error, c: Context) => Response | Promise<Response>;

export function createErrorHandler(debug?: boolean): ErrorHandler {
  return (err, c) => {
    if (err instanceof APIError) {
      return c.json({ error: err.message }, err.status);
    }
    // ponytail: logs the full error server-side, sends generic message to client.
    console.error(err);
    const nodeEnv =
      typeof process !== "undefined"
        ? (process as unknown as { env?: Record<string, string> }).env?.NODE_ENV
        : undefined;
    // Debug is DEV-ONLY. Reveal details only under an explicit development (or
    // test) signal. In a production deploy where NODE_ENV is absent — Bun/Deno/
    // edge runtimes, or a Node process that forgets to set it — the safe default
    // is to WITHHOLD details rather than leak them (the old gate inverted this:
    // `isProd = NODE_ENV==="production"` leaked when NODE_ENV was unset).
    const effectiveDebug = !!debug && (nodeEnv === "development" || nodeEnv === "test");
    if (effectiveDebug) {
      const message = err instanceof Error ? err.message : String(err);
      const body: Record<string, unknown> = { error: message };
      if (err instanceof Error && err.stack) body.stack = err.stack;
      return c.json(body, 500);
    }
    if (debug && nodeEnv === "production") {
      console.warn("[peta-hono] debug enabled in production — redacting error details");
    }
    return c.json({ error: "Internal Server Error" }, 500);
  };
}

/**
 * Typed HTTP error. Thrown from handlers (and the validator) to route errors
 * through `app.onError` — the single chokepoint for all error responses.
 */
export class APIError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    message: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

// --- Named error helpers per HTTP status ---

export const fail = {
  badRequest: (msg = "Bad Request") => new APIError(400, msg),
  unauthorized: (msg = "Unauthorized") => new APIError(401, msg),
  forbidden: (msg = "Forbidden") => new APIError(403, msg),
  notFound: (msg = "Not Found") => new APIError(404, msg),
  conflict: (msg = "Conflict") => new APIError(409, msg),
  unprocessableEntity: (msg = "Unprocessable Entity") => new APIError(422, msg),
  tooManyRequests: (msg = "Too Many Requests") => new APIError(429, msg),
  internalServerError: (msg = "Internal Server Error") => new APIError(500, msg),
  badGateway: (msg = "Bad Gateway") => new APIError(502, msg),
  serviceUnavailable: (msg = "Service Unavailable") => new APIError(503, msg),
  gatewayTimeout: (msg = "Gateway Timeout") => new APIError(504, msg),
};

/**
 * @deprecated Use `fail` instead — `errors` is a pure synonym kept for callers
 * who prefer the noun form. The single canonical helper is `fail`.
 */
export const errors = fail;
/**
 * @deprecated Use `fail` instead — `httpErrors` is a pure synonym kept for
 * backward compatibility. The single canonical helper is `fail`.
 */
export const httpErrors = fail;
