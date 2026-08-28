import type { Context } from "hono";
import {
  type CompactJWSHeaderParameters,
  type CryptoKey,
  createLocalJWKSet,
  createRemoteJWKSet,
  type FlattenedJWSInput,
  type JWK,
  type JWTHeaderParameters,
  type JWTVerifyGetKey,
  jwtVerify,
  type KeyInput,
  SignJWT,
} from "jose";
import { APIError, type SecurityScheme } from "../openapi.js";
import { createCookieTransport } from "./cookie.js";
import { randomToken, sha256Hex } from "./crypto.js";
import { createMemoryRefreshTokenStore, type RefreshTokenStore } from "./store.js";

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
 * key rotation are opt-in via `keys`/`jwks`/`algorithms`; the refresh store is
 * in-memory by default (supply a durable `store` for multi-replica deployments).
 * A 32+ byte random secret is recommended for `secret`.
 */

/** JWT signature algorithms accepted by the strategy (pins `alg` at verify time). */
export type JwtAlgorithm =
  | "HS256"
  | "HS384"
  | "HS512"
  | "RS256"
  | "RS384"
  | "RS512"
  | "ES256"
  | "ES384"
  | "ES512"
  | "EdDSA";

/**
 * A signing/verification key: a symmetric HMAC `secret`, or an asymmetric
 * `CryptoKey` (private for signing, public for verification).
 */
export type JwtKey = { kid: string; secret: string } | { kid: string; key: CryptoKey };

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
  jwks?: URL | { keys: JWK[] };
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

/** A single `KeyInput` (symmetric secret / asymmetric CryptoKey) or a jose `getKey` resolver. */
type VerifyResolver =
  | { kind: "single"; key: Uint8Array | CryptoKey }
  | {
      kind: "keyset";
      getKey: (
        protectedHeader: CompactJWSHeaderParameters,
        token: FlattenedJWSInput,
      ) => Promise<KeyInput>;
    };

/** Sign a compact JWT via `jose` (HS256 by default, or the key-derived alg). */
async function signAccessToken(
  key: JwtKey,
  claims: Record<string, unknown>,
  ttlSeconds: number,
  issuer: string | undefined,
  audience: string | undefined,
  kid: string | undefined,
  alg: JwtAlgorithm,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header: JWTHeaderParameters = { alg, typ: "JWT" };
  if (kid) header.kid = kid;
  // A unique `jti` makes each access token distinguishable (needed so a rotated
  // token's claims differ even when issued in the same second as a prior one).
  let signer = new SignJWT({ ...claims })
    .setProtectedHeader(header)
    .setJti(randomToken(16))
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds);
  if (issuer) signer = signer.setIssuer(issuer);
  if (audience) signer = signer.setAudience(audience);
  const signMaterial = "secret" in key ? new TextEncoder().encode(key.secret) : key.key;
  return signer.sign(signMaterial);
}

/** Verify a compact JWT via `jose`, honoring the pinned `algorithms`; or `null`. */
async function verifyAccessToken(
  token: string,
  resolver: VerifyResolver,
  algorithms: string[],
  issuer: string | undefined,
  audience: string | undefined,
): Promise<Record<string, unknown> | null> {
  const options = { algorithms, issuer, audience };
  try {
    const { payload } =
      resolver.kind === "single"
        ? await jwtVerify(token, resolver.key, options)
        : await jwtVerify(token, resolver.getKey as unknown as JWTVerifyGetKey, options);
    return payload as unknown as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Derive the JWS `alg` a signing key uses. Symmetric secrets are HS256. */
function deriveSigningAlg(key: JwtKey): JwtAlgorithm {
  if ("secret" in key) return "HS256";
  const alg = key.key.algorithm.name;
  if (alg === "Ed25519") return "EdDSA";
  if (alg === "RSASSA-PKCS1-v1_5") return "RS256";
  if (alg === "ECDSA") {
    const curve = (key.key.algorithm as { namedCurve?: string }).namedCurve;
    if (curve === "P-384") return "ES384";
    if (curve === "P-521") return "ES512";
    return "ES256";
  }
  throw new Error(`Unsupported JWT signing key algorithm: ${alg}`);
}

/**
 * Build a JWT strategy handle. The returned `middleware` is ready to be
 * registered as an auth gate (`{ auth: name }`); the helpers drive login /
 * refresh / logout flows.
 */
export function buildJwtStrategy(name: string, opts: JwtStrategyOptions): JwtStrategy {
  const keys = opts.keys;
  const hasKeys = !!keys && keys.length > 0;
  const secret = opts.secret;
  const signKey: JwtKey | undefined = hasKeys
    ? keys![0]
    : secret
      ? { kid: "k1", secret }
      : undefined;
  if (!signKey) {
    throw new Error("JWT requires a `secret` or `keys` signing key");
  }
  const signingKid = hasKeys ? signKey.kid : undefined;
  const signingAlg = deriveSigningAlg(signKey);

  const algorithms = opts.algorithms ?? ["HS256"];
  if (algorithms.length === 0) {
    throw new Error("JWT algorithms must not be empty");
  }
  if (!algorithms.includes(signingAlg)) {
    throw new Error(
      `JWT algorithms must include the signing alg "${signingAlg}" (got: ${algorithms.join(", ")})`,
    );
  }

  // Verification key: `jwks` (asymmetric/multi-service) > `keys` (kid lookup) > `secret`.
  let verifyResolver: VerifyResolver;
  if (opts.jwks instanceof URL) {
    verifyResolver = { kind: "keyset", getKey: createRemoteJWKSet(opts.jwks) };
  } else if (opts.jwks && "keys" in opts.jwks) {
    verifyResolver = { kind: "keyset", getKey: createLocalJWKSet(opts.jwks) };
  } else if (hasKeys) {
    const keyMap = new Map(keys!.map((k) => [k.kid, k]));
    verifyResolver = {
      kind: "keyset",
      getKey: async (protectedHeader) => {
        const kid = protectedHeader.kid;
        if (!kid) throw new Error("JWT token missing `kid`");
        const k = keyMap.get(kid);
        if (!k) throw new Error(`JWT token has unknown kid: ${kid}`);
        return "secret" in k ? new TextEncoder().encode(k.secret) : k.key;
      },
    };
  } else if (secret) {
    verifyResolver = { kind: "single", key: new TextEncoder().encode(secret) };
  } else {
    throw new Error("JWT requires a `secret`, `keys`, or `jwks` for verification");
  }

  const accessTtl = opts.accessTtl ?? 900;
  const refreshTtl = opts.refreshTtl ?? 2592000;
  const issuer = opts.issuer;
  const audience = opts.audience;
  const store: RefreshTokenStore = opts.store ?? createMemoryRefreshTokenStore();

  const refreshTransport = opts.refreshTransport
    ? createCookieTransport({
        name: opts.refreshTransport.cookie.name,
        path: opts.refreshTransport.cookie.path ?? "/",
        hostPrefix: opts.refreshTransport.cookie.hostPrefix ?? false,
        secure: opts.refreshTransport.cookie.secure ?? true,
        sameSite: opts.refreshTransport.cookie.sameSite ?? "Lax",
        httpOnly: opts.refreshTransport.cookie.httpOnly ?? true,
      })
    : undefined;

  return {
    name,
    scheme: { type: "http", scheme: "bearer" },
    async middleware(c: Context) {
      const header = c.req.header("Authorization");
      if (!header?.startsWith("Bearer ")) throw new APIError(401, "Unauthorized");
      const token = header.slice(7).trim();
      const payload = await verifyAccessToken(token, verifyResolver, algorithms, issuer, audience);
      if (!payload) throw new APIError(401, "Invalid or expired access token");
      return payload;
    },
    async issue(sub, claims = {}, c) {
      if (!sub) throw new APIError(400, "sub is required to issue a token");
      const accessToken = await signAccessToken(
        signKey,
        { sub, ...claims },
        accessTtl,
        issuer,
        audience,
        signingKid,
        signingAlg,
      );
      const refreshToken = randomToken(32);
      const familyId = randomToken(16);
      await store.save({
        tokenHash: await sha256Hex(refreshToken),
        sub,
        familyId,
        expiresAt: Date.now() + refreshTtl * 1000,
        used: false,
      });
      if (refreshTransport && c) refreshTransport.set(c, refreshToken);
      return { accessToken, refreshToken, expiresIn: accessTtl };
    },
    async refresh(refreshToken, c) {
      if (!refreshToken) throw new APIError(400, "Missing refresh token");
      const tokenHash = await sha256Hex(refreshToken);
      const record = await store.get(tokenHash);
      if (!record) throw new APIError(401, "Invalid refresh token");
      if (record.expiresAt < Date.now()) {
        await store.delete(tokenHash);
        throw new APIError(401, "Refresh token expired");
      }
      if (record.used) {
        // Reuse of an already-rotated token ⇒ token-theft signal. Revoke the
        // entire family and reject. 401 (not 403) keeps the reason opaque.
        await store.deleteFamily(record.familyId);
        throw new APIError(401, "Refresh token reuse detected");
      }
      // Rotate: mark this token single-use, issue a fresh one in the same family.
      record.used = true;
      await store.save(record);
      const accessToken = await signAccessToken(
        signKey,
        { sub: record.sub },
        accessTtl,
        issuer,
        audience,
        signingKid,
        signingAlg,
      );
      const newRefreshToken = randomToken(32);
      await store.save({
        tokenHash: await sha256Hex(newRefreshToken),
        sub: record.sub,
        familyId: record.familyId,
        expiresAt: Date.now() + refreshTtl * 1000,
        used: false,
      });
      if (refreshTransport && c) refreshTransport.set(c, newRefreshToken);
      return { accessToken, refreshToken: newRefreshToken, expiresIn: accessTtl };
    },
    async revoke(refreshToken, c) {
      if (!refreshToken) return;
      await store.delete(await sha256Hex(refreshToken));
      if (refreshTransport && c) refreshTransport.clear(c);
    },
    async verifyAccess(token) {
      return verifyAccessToken(token, verifyResolver, algorithms, issuer, audience);
    },
  };
}
