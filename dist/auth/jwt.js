import { APIError } from "../openapi.js";
import { base64urlUtf8, hmacSign, hmacVerify, randomToken, sha256Hex, utf8FromBase64url, } from "./crypto.js";
import { createMemoryRefreshTokenStore } from "./store.js";
/** Sign a compact JWS (HS256). */
async function signAccessToken(secret, claims, ttlSeconds, issuer, audience) {
    const now = Math.floor(Date.now() / 1000);
    // A unique `jti` makes each access token distinguishable (needed so a rotated
    // token's claims differ even when issued in the same second as a prior one).
    const payload = {
        ...claims,
        jti: randomToken(16),
        iat: now,
        exp: now + ttlSeconds,
    };
    if (issuer)
        payload.iss = issuer;
    if (audience)
        payload.aud = audience;
    const header = base64urlUtf8(JSON.stringify({ alg: "HS256", typ: "JWT" }));
    const body = base64urlUtf8(JSON.stringify(payload));
    const input = `${header}.${body}`;
    const signature = await hmacSign(secret, input);
    return `${input}.${signature}`;
}
/** Verify a compact JWS (HS256) and return its payload, or `null`. */
async function verifyAccessToken(token, secret, issuer, audience) {
    const parts = token.split(".");
    if (parts.length !== 3)
        return null;
    const [header, body, sig] = parts;
    if (!(await hmacVerify(secret, `${header}.${body}`, sig)))
        return null;
    let payload;
    try {
        const parsed = JSON.parse(utf8FromBase64url(body));
        if (!parsed || typeof parsed !== "object")
            return null;
        payload = parsed;
    }
    catch {
        return null;
    }
    const exp = payload.exp;
    if (typeof exp !== "number" || exp < Math.floor(Date.now() / 1000))
        return null;
    if (issuer && payload.iss !== issuer)
        return null;
    if (audience && payload.aud !== audience)
        return null;
    return payload;
}
/**
 * Build a JWT strategy handle. The returned `middleware` is ready to be
 * registered as an auth gate (`{ auth: name }`); the helpers drive login /
 * refresh / logout flows.
 */
export function buildJwtStrategy(name, opts) {
    const secret = opts.secret;
    const accessTtl = opts.accessTtl ?? 900;
    const refreshTtl = opts.refreshTtl ?? 2592000;
    const issuer = opts.issuer;
    const audience = opts.audience;
    const store = opts.store ?? createMemoryRefreshTokenStore();
    return {
        name,
        scheme: { type: "http", scheme: "bearer" },
        async middleware(c) {
            const header = c.req.header("Authorization");
            if (!header?.startsWith("Bearer "))
                throw new APIError(401, "Unauthorized");
            const token = header.slice(7).trim();
            const payload = await verifyAccessToken(token, secret, issuer, audience);
            if (!payload)
                throw new APIError(401, "Invalid or expired access token");
            return payload;
        },
        async issue(sub, claims = {}) {
            if (!sub)
                throw new APIError(400, "sub is required to issue a token");
            const accessToken = await signAccessToken(secret, { sub, ...claims }, accessTtl, issuer, audience);
            const refreshToken = randomToken(32);
            const familyId = randomToken(16);
            await store.save({
                tokenHash: await sha256Hex(refreshToken),
                sub,
                familyId,
                expiresAt: Date.now() + refreshTtl * 1000,
                used: false,
            });
            return { accessToken, refreshToken, expiresIn: accessTtl };
        },
        async refresh(refreshToken) {
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
            const accessToken = await signAccessToken(secret, { sub: record.sub }, accessTtl, issuer, audience);
            const newRefreshToken = randomToken(32);
            await store.save({
                tokenHash: await sha256Hex(newRefreshToken),
                sub: record.sub,
                familyId: record.familyId,
                expiresAt: Date.now() + refreshTtl * 1000,
                used: false,
            });
            return { accessToken, refreshToken: newRefreshToken, expiresIn: accessTtl };
        },
        async revoke(refreshToken) {
            if (!refreshToken)
                return;
            await store.delete(await sha256Hex(refreshToken));
        },
        async verifyAccess(token) {
            return verifyAccessToken(token, secret, issuer, audience);
        },
    };
}
//# sourceMappingURL=jwt.js.map