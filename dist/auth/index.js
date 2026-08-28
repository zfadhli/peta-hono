/**
 * Built-in auth strategies for `peta-hono`.
 *
 * Three strategy builders are provided — session, JWT (+ refresh rotation), and
 * Google OAuth2 — each returning a handle that can be registered as an auth gate
 * (`{ auth: name }`) and/or drives a login/refresh/OAuth flow. They compose with
 * the existing `auth(name, mw, scheme?)` mechanism: a strategy's guard middleware
 * is registered through the same code path, so a `{ auth: name }` route still
 * emits a 401 + a `security` requirement + the matching `components.securitySchemes`
 * entry.
 */
import { buildJwtStrategy } from "./jwt.js";
import { buildOAuthStrategy } from "./oauth.js";
import { buildSessionStrategy, } from "./session.js";
export { cookieNameFor, createCookieTransport } from "./cookie.js";
export { buildJwtStrategy } from "./jwt.js";
export { buildOAuthStrategy } from "./oauth.js";
export { buildSessionStrategy } from "./session.js";
// Shared primitives (store adapters / crypto / cookie) are public so users can
// back the strategies with a durable store and reuse the low-level helpers.
export { createMemoryRefreshTokenStore, createMemorySessionStore } from "./store.js";
/**
 * Dispatch a discriminated strategy spec to the matching builder.
 * Convenience for `auth.strategy(name, spec)`; the named builders
 * (`auth.session/jwt/oauth`) call their own factory directly.
 */
export function buildAuthStrategy(name, spec) {
    switch (spec.type) {
        case "session":
            return buildSessionStrategy(name, spec);
        case "jwt":
            return buildJwtStrategy(name, spec);
        case "oauth":
            return buildOAuthStrategy(name, spec);
        default:
            // Exhaustive: spec.type is a closed 3-member union.
            throw new Error(`Unknown auth strategy: ${spec.type}`);
    }
}
//# sourceMappingURL=index.js.map