/**
 * Path & method grammar — single source of truth for Hono token parsing.
 *
 * Hono tokens: :name, :name{regex}, :name?, :name{regex}?, * → {wildcard}
 * See ADR-010.
 */

// --- Method ---

export const SUPPORTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type HttpMethod = (typeof SUPPORTED_METHODS)[number];
/** Method string accepted by api() — supports any casing, autocomplete for known methods. */
export type Method = HttpMethod | Lowercase<HttpMethod> | (string & {});

export function normalizeMethod(m: string): string {
  const lower = m.toLowerCase();
  if (!(SUPPORTED_METHODS as readonly string[]).map((s) => s.toLowerCase()).includes(lower)) {
    throw new Error(`Unsupported method: ${m}. Use one of: ${SUPPORTED_METHODS.join(", ")}`);
  }
  return lower;
}

// --- Path tokens ---

/** Shared token regex — captures name + optional `?`. Global for matchAll. */
export const PARAM_TOKEN_RE = /:([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)?/g;
/** Non-global variant for .test / .match has-checks (avoids lastIndex state). */
export const PARAM_HAS_RE = /:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/;

export type ParamToken = { name: string; optional: boolean };

export function parseParamTokens(path: string): ParamToken[] {
  // Reset lastIndex for safety — PARAM_TOKEN_RE is global and may have been used via matchAll
  PARAM_TOKEN_RE.lastIndex = 0;
  return [...path.matchAll(PARAM_TOKEN_RE)].map((m) => ({ name: m[1]!, optional: !!m[2] }));
}

export function hasParamTokens(path: string): boolean {
  return PARAM_HAS_RE.test(path);
}

// --- OpenAPI path ---

/**
 * Convert Hono-style /:param → OpenAPI 3.0 /{param} for all Hono token shapes.
 * Handles :name, :name{regex}, :name?, :name{regex}? and wildcard *.
 * ponytail: edge path characters (//, *) are normalized deterministically — * becomes {wildcard}.
 * Header lowercasing is handled in OpenAPIHono._addObjectParams, not here (Fetch Headers ponytail).
 */
export function toOapiPath(path: string): string {
  let out = path.replace(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/g, "{$1}");
  out = out.replace(/\*/g, "{wildcard}");
  return out;
}
