/**
 * Path & method grammar — single source of truth for Hono token parsing.
 *
 * Hono tokens: :name, :name{regex}, :name?, :name{regex}?, * → {wildcard}
 * See ADR-010.
 */
export declare const SUPPORTED_METHODS: readonly ["GET", "POST", "PUT", "PATCH", "DELETE"];
export type HttpMethod = (typeof SUPPORTED_METHODS)[number];
/** Method string accepted by api() — supports any casing, autocomplete for known methods. */
export type Method = HttpMethod | Lowercase<HttpMethod> | (string & {});
export declare function normalizeMethod(m: string): string;
/** Shared token regex — captures name + optional `?`. Global for matchAll. */
export declare const PARAM_TOKEN_RE: RegExp;
/** Non-global variant for .test / .match has-checks (avoids lastIndex state). */
export declare const PARAM_HAS_RE: RegExp;
export type ParamToken = {
    name: string;
    optional: boolean;
};
export declare function parseParamTokens(path: string): ParamToken[];
export declare function hasParamTokens(path: string): boolean;
/**
 * Convert Hono-style /:param → OpenAPI 3.0 /{param} for all Hono token shapes.
 * Handles :name, :name{regex}, :name?, :name{regex}? and wildcard *.
 * ponytail: edge path characters (//, *) are normalized deterministically — * becomes {wildcard}.
 * Header lowercasing is handled in OpenAPIHono._addObjectParams, not here (Fetch Headers ponytail).
 */
export declare function toOapiPath(path: string): string;
//# sourceMappingURL=paths.d.ts.map