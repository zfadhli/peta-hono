import type { Context } from "hono";
import { type CryptoKey, type JWK } from "jose";
import type { SecurityScheme } from "../openapi.js";
import { type RefreshTokenStore } from "./store.js";
/**
 * Built-in JWT access-token + refresh-token rotation strategy.
 *
 * Access tokens are compact JWTs signed with `jose` (HS256 by default; the
 * audited library handles JWS serialization, constant-time verification, and
 * `alg` pinning). `jose` also unlocks asymmetric signing (RS256/EdDSA) and JWKS
 * resolution for multi-service verification, plus key rotation via `keys`/`kid`.
 * Refresh tokens are opaque, server-stored (hashed), rotated on every refresh,
 * and revocation is family-wide on reuse (a replayed rotated token revokes the
 * whole family).
 *
 * ponytail: HS256 symmetric signing by default. Asymmetric (RS256/EdDSA)/JWKS and
 * key rotation are opt-in via `keys`/`jwks`/`algorithms` — `generateKey()` builds a
 * ready-to-wire asymmetric keypair so that happy path is a few lines instead of
 * hand-rolling `crypto.subtle.generateKey`+`exportKey`. The refresh store is
 * in-memory by default (supply a durable `store` for multi-replica deployments).
 * A 32+ byte random secret is recommended for `secret`.
 */
/** JWT signature algorithms accepted by the strategy (pins `alg` at verify time). */
export type JwtAlgorithm = "HS256" | "HS384" | "HS512" | "RS256" | "RS384" | "RS512" | "ES256" | "ES384" | "ES512" | "EdDSA";
/**
 * A signing/verification key: a symmetric HMAC `secret`, or an asymmetric
 * `CryptoKey` (private for signing, public for verification).
 */
export type JwtKey = {
    kid: string;
    secret: string;
} | {
    kid: string;
    key: CryptoKey;
};
/** Asymmetric signature algorithms `generateKey()` can produce (excludes the symmetric `HS*`). */
export type AsymmetricJwtAlgorithm = Exclude<JwtAlgorithm, "HS256" | "HS384" | "HS512">;
/** Options for `generateKey()`. */
export interface GenerateKeyOptions {
    /**
     * Signature algorithm to generate a keypair for (default `"RS256"`).
     * Wire the result into the strategy's `keys`/`jwks` (and set `algorithms` to
     * accept the signing alg).
     */
    algorithm?: AsymmetricJwtAlgorithm;
    /** Key id to stamp on the JWK and the JWT header. Default: a random value. */
    kid?: string;
}
/** A freshly generated asymmetric keypair, ready to wire into `keys`/`jwks`. */
export interface GeneratedJwtKey {
    /** Key id — stamped in the JWT header and on `publicJwk`. */
    kid: string;
    /** Signing key — pass as `keys: [{ kid, key: privateKey }]`. */
    privateKey: CryptoKey;
    /** Public JWK (with `kid` + `alg`) — pass as `jwks: { keys: [publicJwk] }`. */
    publicJwk: JWK;
}
/** The config for an HttpOnly refresh-token cookie transported via `CookieTransport`. */
export interface RefreshTransportOptions {
    /** Refresh-cookie options (HttpOnly by default). */
    cookie: {
        /** Refresh cookie name (default `"rt"`). */
        name: string;
        /** Cookie path (default `"/"`). */
        path?: string;
        /** Rename the cookie to `__Host-<name>` (forces `Path=/`). */
        hostPrefix?: boolean;
        /** `Secure` flag (default `true`). */
        secure?: boolean;
        /** `SameSite` attribute (default `"Lax"`). */
        sameSite?: "Lax" | "Strict" | "None";
        /** `HttpOnly` flag (default `true`). */
        httpOnly?: boolean;
    };
}
export interface JwtStrategyOptions {
    /**
     * HMAC signing secret (>= 32 random bytes recommended). Required unless
     * `keys` (or an asymmetric signing key) is provided. When only `secret` is
     * set, tokens are signed with HS256 and carry no `kid` (unchanged from v0.6.0).
     */
    secret?: string;
    /**
     * Key-rotation map. `keys[0]` signs and stamps its `kid`; verification selects
     * the key by the token's `kid` and rejects unknown/missing `kid`. Each entry
     * is a symmetric `secret` or an asymmetric `CryptoKey`.
     */
    keys?: JwtKey[];
    /**
     * JWK Set used to verify inbound tokens (asymmetric / multi-service). A `URL`
     * resolves a remote JWKS (`createRemoteJWKSet`); `{ keys: JWK[] }` resolves a
     * local one (`createLocalJWKSet`). Signing still uses `secret`/`keys`.
     */
    jwks?: URL | {
        keys: JWK[];
    };
    /**
     * Accepted JWT `alg` values (default `["HS256"]`); pins the algorithm. Must
     * include the signing alg so the strategy never rejects its own tokens —
     * validated at construction.
     */
    algorithms?: JwtAlgorithm[];
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
    /**
     * When set, `issue`/`refresh` also set the HttpOnly refresh cookie on the
     * supplied `Context` and `revoke` clears it (via `CookieTransport`). Without
     * it, tokens are returned only in the body as today.
     */
    refreshTransport?: RefreshTransportOptions;
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
    issue(sub: string, claims?: Record<string, unknown>, c?: Context): Promise<IssuedTokens>;
    /** Rotate a refresh token → new access + refresh. Reuse revokes the family. */
    refresh(refreshToken: string, c?: Context): Promise<IssuedTokens>;
    /** Revoke a single refresh token. */
    revoke(refreshToken: string, c?: Context): Promise<void>;
    /** Verify an access token; returns the payload or `null`. */
    verifyAccess(token: string): Promise<Record<string, unknown> | null>;
}
/**
 * Generate an asymmetric keypair for JWT signing/verification.
 *
 * Returns the signing `CryptoKey` and a public JWK (stamped with `kid` + `alg`)
 * that is directly accepted by the strategy's `jwks` option, so the asymmetric
 * (RS256/EdDSA) + JWKS + rotation happy path is a few lines instead of wiring
 * `crypto.subtle.generateKey` + `crypto.subtle.exportKey` by hand:
 *
 * ```ts
 * const { kid, privateKey, publicJwk } = await generateKey({ algorithm: "RS256" });
 * const jwt = auth.jwt("jwt", {
 *   keys: [{ kid, key: privateKey }],
 *   jwks: { keys: [publicJwk] },
 *   algorithms: ["RS256"], // must accept the signing alg
 * });
 * ```
 *
 * The keypair is generated `extractable` so the public JWK can be exported for
 * a JWKS endpoint; keep the private key in protected storage (it is only used
 * in-process to sign).
 */
export declare function generateKey(opts?: GenerateKeyOptions): Promise<GeneratedJwtKey>;
/**
 * Build a JWT strategy handle. The returned `middleware` is ready to be
 * registered as an auth gate (`{ auth: name }`); the helpers drive login /
 * refresh / logout flows.
 */
export declare function buildJwtStrategy(name: string, opts: JwtStrategyOptions): JwtStrategy;
//# sourceMappingURL=jwt.d.ts.map