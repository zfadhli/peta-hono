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
import { type JwtStrategy, type JwtStrategyOptions } from "./jwt.js";
import { type OAuthStrategy, type OAuthStrategyOptions } from "./oauth.js";
import { type SessionStrategy, type SessionStrategyOptions } from "./session.js";
export type { CookieSerializeOptions, CookieTransport, CookieTransportOptions, } from "./cookie.js";
export { cookieNameFor, createCookieTransport } from "./cookie.js";
export type { IssuedTokens, JwtKey, JwtStrategy, JwtStrategyOptions, RefreshTransportOptions, } from "./jwt.js";
export { buildJwtStrategy } from "./jwt.js";
export type { FlowApp, OAuthStateCookieOptions, OAuthStrategy, OAuthStrategyOptions, OAuthSuccessEvent, } from "./oauth.js";
export { buildOAuthStrategy } from "./oauth.js";
export type { SessionCookieOptions, SessionCsrf, SessionStrategy, SessionStrategyOptions, } from "./session.js";
export { buildSessionStrategy } from "./session.js";
export type { RefreshTokenRecord, RefreshTokenStore, SessionStore } from "./store.js";
export { createMemoryRefreshTokenStore, createMemorySessionStore } from "./store.js";
/** Discriminated strategy spec for `auth.strategy(name, spec)`. */
export type AuthStrategySpec = ({
    type: "session";
} & SessionStrategyOptions) | ({
    type: "jwt";
} & JwtStrategyOptions) | ({
    type: "oauth";
} & OAuthStrategyOptions);
/** Map a `type` discriminator to its strategy handle. */
export type StrategyFor<S extends AuthStrategySpec> = S extends {
    type: "session";
} ? SessionStrategy : S extends {
    type: "jwt";
} ? JwtStrategy : S extends {
    type: "oauth";
} ? OAuthStrategy : never;
/**
 * Dispatch a discriminated strategy spec to the matching builder.
 * Convenience for `auth.strategy(name, spec)`; the named builders
 * (`auth.session/jwt/oauth`) call their own factory directly.
 */
export declare function buildAuthStrategy<S extends AuthStrategySpec>(name: string, spec: S): StrategyFor<S>;
//# sourceMappingURL=index.d.ts.map