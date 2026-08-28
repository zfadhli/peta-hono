import type { Context } from "hono";
import { type SecurityScheme } from "../openapi.js";
import { type RefreshTokenStore } from "./store.js";
/**
 * Built-in JWT access-token + refresh-token rotation strategy.
 *
 * Access tokens are HS256 JWTs signed with a shared secret; refresh tokens are
 * opaque, server-stored (hashed), rotated on every refresh, and revocation is
 * family-wide on reuse (a replayed rotated token revokes the whole family).
 *
 * ponytail: HS256 symmetric signing only — no asymmetric (RS256/EdDSA) key
 * support or JWKS yet, and the refresh store is in-memory by default (supply a
 * durable `store` for multi-replica deployments). A 32+ byte random secret is
 * strongly recommended for `secret`.
 */
export interface JwtStrategyOptions {
    /** HMAC signing secret (>= 32 random bytes recommended). Required. */
    secret: string;
    /** Access-token TTL in seconds (default 900 = 15 minutes). */
    accessTtl?: number;
    /** Refresh-token TTL in seconds (default 2592000 = 30 days). */
    refreshTtl?: number;
    /** Optional JWT `iss` claim — set and verify it if provided. */
    issuer?: string;
    /** Optional JWT `aud` claim — set and verify it if provided. */
    audience?: string;
    /** Refresh-token store (default in-memory). Supply a durable store in prod. */
    store?: RefreshTokenStore;
}
export interface IssuedTokens {
    accessToken: string;
    refreshToken: string;
    /** Access-token TTL in seconds. */
    expiresIn: number;
}
export interface JwtStrategy {
    /** The auth-gate name (used as `{ auth: name }`). */
    name: string;
    /** OpenAPI security scheme (bearer). */
    scheme: SecurityScheme;
    /** Guard middleware — verifies the bearer access token, yields `req.auth`. */
    middleware: (c: Context) => Promise<Record<string, unknown>>;
    /** Issue an access token + a fresh refresh token (usually at login). */
    issue(sub: string, claims?: Record<string, unknown>): Promise<IssuedTokens>;
    /** Rotate a refresh token → new access + refresh. Reuse revokes the family. */
    refresh(refreshToken: string): Promise<IssuedTokens>;
    /** Revoke a single refresh token. */
    revoke(refreshToken: string): Promise<void>;
    /** Verify an access token; returns the payload or `null`. */
    verifyAccess(token: string): Promise<Record<string, unknown> | null>;
}
/**
 * Build a JWT strategy handle. The returned `middleware` is ready to be
 * registered as an auth gate (`{ auth: name }`); the helpers drive login /
 * refresh / logout flows.
 */
export declare function buildJwtStrategy(name: string, opts: JwtStrategyOptions): JwtStrategy;
//# sourceMappingURL=jwt.d.ts.map