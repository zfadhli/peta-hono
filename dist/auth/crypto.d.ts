/**
 * Shared crypto primitives for the built-in auth strategies.
 *
 * The hard primitives (HMAC-SHA256, SHA-256, CSPRNG bytes) are delegated to the
 * audited, zero-dependency `@noble/hashes` library; this module keeps the tiny
 * encode/decode + constant-time helpers and exposes the narrow, stable surface
 * the strategies import. Portable across Node (>=20.19), Bun, Deno, and
 * Cloudflare Workers — depends only on `TextEncoder`/`btoa`/`atob` plus
 * `@noble/hashes`, never on `node:crypto`.
 *
 * ponytail: no symmetric-key derivation / KDF sophistication here — the signing
 * secret is used raw as an HMAC key. Ceiling: support `iron-webcrypto` or argon2
 * for at-rest key handling, or an asymmetric (RS256/EdDSA) JWT scheme (see
 * `jwt.ts`, which uses `jose`).
 */
/** ASCII bytes → base64url (no padding). */
export declare function base64urlEncode(bytes: Uint8Array): string;
/** base64url string → bytes. */
export declare function base64urlDecode(s: string): Uint8Array;
/** utf-8 string → base64url. */
export declare function base64urlUtf8(data: string): string;
/** base64url → utf-8 string. */
export declare function utf8FromBase64url(s: string): string;
/** HMAC-SHA256 sign → base64url signature. */
export declare function hmacSign(secret: string, data: string): Promise<string>;
/** Constant-time HMAC-SHA256 verify against a base64url signature. */
export declare function hmacVerify(secret: string, data: string, signature: string): Promise<boolean>;
/** Constant-time string/buffer comparison — prevents timing side-channels. */
export declare function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean;
/** Cryptographically random base64url token (default 32 bytes ≈ 43 chars). */
export declare function randomToken(bytes?: number): string;
/** SHA-256 hex digest of utf-8 data. */
export declare function sha256Hex(data: string): Promise<string>;
/** SHA-256 → base64url (used for PKCE S256 code-challenge derivation). */
export declare function sha256Base64url(data: string): Promise<string>;
//# sourceMappingURL=crypto.d.ts.map