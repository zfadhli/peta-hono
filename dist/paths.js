/**
 * Path & method grammar — single source of truth for Hono token parsing.
 *
 * Hono tokens: :name, :name{regex}, :name?, :name{regex}?, * → {wildcard}
 * See ADR-010.
 */
// --- Method ---
export const SUPPORTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
export function normalizeMethod(m) {
    const lower = m.toLowerCase();
    if (!SUPPORTED_METHODS.map((s) => s.toLowerCase()).includes(lower)) {
        throw new Error(`Unsupported method: ${m}. Use one of: ${SUPPORTED_METHODS.join(", ")}`);
    }
    return lower;
}
// --- Path tokens ---
/** Shared token regex — captures name + optional `?`. Global for matchAll. */
export const PARAM_TOKEN_RE = /:([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)?/g;
/** Non-global variant for .test / .match has-checks (avoids lastIndex state). */
export const PARAM_HAS_RE = /:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/;
export function parseParamTokens(path) {
    // Reset lastIndex for safety — PARAM_TOKEN_RE is global and may have been used via matchAll
    PARAM_TOKEN_RE.lastIndex = 0;
    return [...path.matchAll(PARAM_TOKEN_RE)].map((m) => ({ name: m[1], optional: !!m[2] }));
}
export function hasParamTokens(path) {
    return PARAM_HAS_RE.test(path);
}
// --- OpenAPI path ---
/**
 * Convert Hono-style /:param → OpenAPI 3.0 /{param} for all Hono token shapes.
 * Handles :name, :name{regex}, :name?, :name{regex}? and wildcard *.
 * ponytail: edge path characters (//, *) are normalized deterministically — * becomes {wildcard}.
 * Header lowercasing is handled in OpenAPIHono._addObjectParams, not here (Fetch Headers ponytail).
 */
export function toOapiPath(path) {
    let out = path.replace(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/g, "{$1}");
    out = out.replace(/\*/g, "{wildcard}");
    return out;
}
//# sourceMappingURL=paths.js.map