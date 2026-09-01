import { createLocalJWKSet, createRemoteJWKSet, jwtVerify, SignJWT, } from "jose";
import { APIError } from "../errors.js";
import { createCookieTransport } from "./cookie.js";
import { randomToken, sha256Hex } from "./crypto.js";
import { createMemoryRefreshTokenStore } from "./store.js";
/** Sign a compact JWT via `jose` (HS256 by default, or the key-derived alg). */
async function signAccessToken(key, claims, ttlSeconds, issuer, audience, kid, alg) {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg, typ: "JWT" };
    if (kid)
        header.kid = kid;
    // A unique `jti` makes each access token distinguishable (needed so a rotated
    // token's claims differ even when issued in the same second as a prior one).
    let signer = new SignJWT({ ...claims })
        .setProtectedHeader(header)
        .setJti(randomToken(16))
        .setIssuedAt(now)
        .setExpirationTime(now + ttlSeconds);
    if (issuer)
        signer = signer.setIssuer(issuer);
    if (audience)
        signer = signer.setAudience(audience);
    const signMaterial = "secret" in key ? new TextEncoder().encode(key.secret) : key.key;
    return signer.sign(signMaterial);
}
/** Verify a compact JWT via `jose`, honoring the pinned `algorithms`; or `null`. */
async function verifyAccessToken(token, resolver, algorithms, issuer, audience) {
    const options = { algorithms, issuer, audience };
    try {
        const { payload } = resolver.kind === "single"
            ? await jwtVerify(token, resolver.key, options)
            : await jwtVerify(token, resolver.getKey, options);
        return payload;
    }
    catch {
        return null;
    }
}
/** Derive the JWS `alg` a signing key uses. Symmetric secrets are HS256. */
function deriveSigningAlg(key) {
    if ("secret" in key)
        return "HS256";
    const alg = key.key.algorithm.name;
    if (alg === "Ed25519")
        return "EdDSA";
    if (alg === "RSASSA-PKCS1-v1_5") {
        // RSA shares one algorithm name across RS256/384/512 — the hash disambiguates.
        const hash = key.key.algorithm.hash?.name;
        if (hash === "SHA-384")
            return "RS384";
        if (hash === "SHA-512")
            return "RS512";
        return "RS256";
    }
    if (alg === "ECDSA") {
        const curve = key.key.algorithm.namedCurve;
        if (curve === "P-384")
            return "ES384";
        if (curve === "P-521")
            return "ES512";
        return "ES256";
    }
    throw new Error(`Unsupported JWT signing key algorithm: ${alg}`);
}
/** Web Crypto `generateKey` parameters for an asymmetric JWT algorithm. */
function keyGenParams(alg) {
    switch (alg) {
        case "RS256":
            return {
                name: "RSASSA-PKCS1-v1_5",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-256",
            };
        case "RS384":
            return {
                name: "RSASSA-PKCS1-v1_5",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-384",
            };
        case "RS512":
            return {
                name: "RSASSA-PKCS1-v1_5",
                modulusLength: 2048,
                publicExponent: new Uint8Array([1, 0, 1]),
                hash: "SHA-512",
            };
        case "ES256":
            return { name: "ECDSA", namedCurve: "P-256" };
        case "ES384":
            return { name: "ECDSA", namedCurve: "P-384" };
        case "ES512":
            return { name: "ECDSA", namedCurve: "P-521" };
        case "EdDSA":
            return { name: "Ed25519" };
    }
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
export async function generateKey(opts = {}) {
    const algorithm = opts.algorithm ?? "RS256";
    const kid = opts.kid ?? randomToken(16);
    const keyPair = (await crypto.subtle.generateKey(keyGenParams(algorithm), true, [
        "sign",
        "verify",
    ]));
    const exported = await crypto.subtle.exportKey("jwk", keyPair.publicKey);
    const publicJwk = { ...exported, kid, alg: algorithm };
    return { kid, privateKey: keyPair.privateKey, publicJwk };
}
/**
 * Build a JWT strategy handle. The returned `middleware` is ready to be
 * registered as an auth gate (`{ auth: name }`); the helpers drive login /
 * refresh / logout flows.
 */
export function buildJwtStrategy(name, opts) {
    const keys = opts.keys;
    const hasKeys = !!keys && keys.length > 0;
    const secret = opts.secret;
    const signKey = hasKeys
        ? keys[0]
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
        throw new Error(`JWT algorithms must include the signing alg "${signingAlg}" (got: ${algorithms.join(", ")})`);
    }
    // Verification key: `jwks` (asymmetric/multi-service) > `keys` (kid lookup) > `secret`.
    let verifyResolver;
    if (opts.jwks instanceof URL) {
        verifyResolver = { kind: "keyset", getKey: createRemoteJWKSet(opts.jwks) };
    }
    else if (opts.jwks && "keys" in opts.jwks) {
        verifyResolver = { kind: "keyset", getKey: createLocalJWKSet(opts.jwks) };
    }
    else if (hasKeys) {
        const keyMap = new Map(keys.map((k) => [k.kid, k]));
        verifyResolver = {
            kind: "keyset",
            getKey: async (protectedHeader) => {
                const kid = protectedHeader.kid;
                if (!kid)
                    throw new Error("JWT token missing `kid`");
                const k = keyMap.get(kid);
                if (!k)
                    throw new Error(`JWT token has unknown kid: ${kid}`);
                return "secret" in k ? new TextEncoder().encode(k.secret) : k.key;
            },
        };
    }
    else if (secret) {
        verifyResolver = { kind: "single", key: new TextEncoder().encode(secret) };
    }
    else {
        throw new Error("JWT requires a `secret`, `keys`, or `jwks` for verification");
    }
    const accessTtl = opts.accessTtl ?? 900;
    const refreshTtl = opts.refreshTtl ?? 2592000;
    const issuer = opts.issuer;
    const audience = opts.audience;
    const store = opts.store ?? createMemoryRefreshTokenStore();
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
        async middleware(c) {
            const header = c.req.header("Authorization");
            if (!header?.startsWith("Bearer "))
                throw new APIError(401, "Unauthorized");
            const token = header.slice(7).trim();
            const payload = await verifyAccessToken(token, verifyResolver, algorithms, issuer, audience);
            if (!payload)
                throw new APIError(401, "Invalid or expired access token");
            return payload;
        },
        async issue(sub, claims = {}, c) {
            if (!sub)
                throw new APIError(400, "sub is required to issue a token");
            const accessToken = await signAccessToken(signKey, { sub, ...claims }, accessTtl, issuer, audience, signingKid, signingAlg);
            const refreshToken = randomToken(32);
            const familyId = randomToken(16);
            await store.save({
                tokenHash: await sha256Hex(refreshToken),
                sub,
                familyId,
                expiresAt: Date.now() + refreshTtl * 1000,
                used: false,
            });
            if (refreshTransport && c)
                refreshTransport.set(c, refreshToken);
            return { accessToken, refreshToken, expiresIn: accessTtl };
        },
        async refresh(refreshToken, c) {
            if (!refreshToken)
                throw new APIError(400, "Missing refresh token");
            const tokenHash = await sha256Hex(refreshToken);
            const record = await store.get(tokenHash);
            if (!record)
                throw new APIError(401, "Invalid refresh token");
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
            const accessToken = await signAccessToken(signKey, { sub: record.sub }, accessTtl, issuer, audience, signingKid, signingAlg);
            const newRefreshToken = randomToken(32);
            await store.save({
                tokenHash: await sha256Hex(newRefreshToken),
                sub: record.sub,
                familyId: record.familyId,
                expiresAt: Date.now() + refreshTtl * 1000,
                used: false,
            });
            if (refreshTransport && c)
                refreshTransport.set(c, newRefreshToken);
            return { accessToken, refreshToken: newRefreshToken, expiresIn: accessTtl };
        },
        async revoke(refreshToken, c) {
            if (!refreshToken)
                return;
            await store.delete(await sha256Hex(refreshToken));
            if (refreshTransport && c)
                refreshTransport.clear(c);
        },
        async verifyAccess(token) {
            return verifyAccessToken(token, verifyResolver, algorithms, issuer, audience);
        },
    };
}
//# sourceMappingURL=jwt.js.map