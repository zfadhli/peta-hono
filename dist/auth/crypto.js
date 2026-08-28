/**
 * Shared Web Crypto primitives for the built-in auth strategies.
 *
 * Portable across Node (>=18 Web Crypto), Bun, Deno, and Cloudflare Workers —
 * depends only on `globalThis.crypto` / `TextEncoder` / `btoa` / `atob`, never
 * on `node:crypto`. Mirrors the Web Crypto usage already present in
 * `src/openapi.ts` (`sha1Hex`), keeping the library dependency-tree-light and
 * runnable anywhere Hono runs.
 *
 * ponytail: no symmetric-key derivation / KDF sophistication here — the signing
 * secret is used raw as an HMAC key. Ceiling: support `iron-webcrypto` or argon2
 * for at-rest key handling, or an asymmetric (RS256/EdDSA) JWT scheme.
 */
const te = new TextEncoder();
/** ASCII bytes → base64url (no padding). */
export function base64urlEncode(bytes) {
    let bin = "";
    for (const b of bytes)
        bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
/** base64url string → bytes. */
export function base64urlDecode(s) {
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        bytes[i] = bin.charCodeAt(i);
    return bytes;
}
/** utf-8 string → base64url. */
export function base64urlUtf8(data) {
    return base64urlEncode(te.encode(data));
}
/** base64url → utf-8 string. */
export function utf8FromBase64url(s) {
    return new TextDecoder().decode(base64urlDecode(s));
}
async function hmacKey(secret) {
    // Normalize to an exact ArrayBuffer-backed view (TS 5.7 `Uint8Array` default
    // generic is ArrayBufferLike, which `BufferSource` rejects).
    const keyMaterial = te.encode(secret);
    return crypto.subtle.importKey("raw", keyMaterial, { name: "HMAC", hash: "SHA-256" }, false, [
        "sign",
        "verify",
    ]);
}
/** HMAC-SHA256 sign → base64url signature. */
export async function hmacSign(secret, data) {
    const key = await hmacKey(secret);
    const sig = await crypto.subtle.sign("HMAC", key, te.encode(data));
    return base64urlEncode(new Uint8Array(sig));
}
/** Constant-time HMAC-SHA256 verify against a base64url signature. */
export async function hmacVerify(secret, data, signature) {
    const key = await hmacKey(secret);
    const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, te.encode(data)));
    return timingSafeEqual(expected, decodeOrEmpty(signature));
}
/** Constant-time string/buffer comparison — prevents timing side-channels. */
export function timingSafeEqual(a, b) {
    if (a.length !== b.length)
        return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++)
        diff |= a[i] ^ b[i];
    return diff === 0;
}
/** Cryptographically random base64url token (default 32 bytes ≈ 43 chars). */
export function randomToken(bytes = 32) {
    const buf = new Uint8Array(bytes);
    crypto.getRandomValues(buf);
    return base64urlEncode(buf);
}
/** SHA-256 hex digest of utf-8 data. */
export async function sha256Hex(data) {
    const digest = await crypto.subtle.digest("SHA-256", te.encode(data));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}
/** SHA-256 → base64url (used for PKCE S256 code-challenge derivation). */
export async function sha256Base64url(data) {
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", te.encode(data)));
    return base64urlEncode(digest);
}
/** Decode a base64url signature to bytes, returning empty array on malformed input. */
function decodeOrEmpty(s) {
    try {
        return base64urlDecode(s);
    }
    catch {
        return new Uint8Array(0);
    }
}
//# sourceMappingURL=crypto.js.map