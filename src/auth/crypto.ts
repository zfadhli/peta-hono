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

import { hmac } from "@noble/hashes/hmac.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, randomBytes } from "@noble/hashes/utils.js";

const te = new TextEncoder();

/** ASCII bytes → base64url (no padding). */
export function base64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

/** base64url string → bytes. */
export function base64urlDecode(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** utf-8 string → base64url. */
export function base64urlUtf8(data: string): string {
  return base64urlEncode(te.encode(data));
}

/** base64url → utf-8 string. */
export function utf8FromBase64url(s: string): string {
  return new TextDecoder().decode(base64urlDecode(s));
}

/** HMAC-SHA256 → raw bytes. */
function hmacSha256(secret: string, data: string): Uint8Array {
  return hmac(sha256, te.encode(secret), te.encode(data));
}

/** HMAC-SHA256 sign → base64url signature. */
export async function hmacSign(secret: string, data: string): Promise<string> {
  return base64urlEncode(hmacSha256(secret, data));
}

/** Constant-time HMAC-SHA256 verify against a base64url signature. */
export async function hmacVerify(
  secret: string,
  data: string,
  signature: string,
): Promise<boolean> {
  return timingSafeEqual(hmacSha256(secret, data), decodeOrEmpty(signature));
}

/** Constant-time string/buffer comparison — prevents timing side-channels. */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}

/** Cryptographically random base64url token (default 32 bytes ≈ 43 chars). */
export function randomToken(bytes = 32): string {
  return base64urlEncode(randomBytes(bytes));
}

/** SHA-256 hex digest of utf-8 data. */
export async function sha256Hex(data: string): Promise<string> {
  return bytesToHex(sha256(te.encode(data)));
}

/** SHA-256 → base64url (used for PKCE S256 code-challenge derivation). */
export async function sha256Base64url(data: string): Promise<string> {
  return base64urlEncode(sha256(te.encode(data)));
}

/** Decode a base64url signature to bytes, returning empty array on malformed input. */
function decodeOrEmpty(s: string): Uint8Array {
  try {
    return base64urlDecode(s);
  } catch {
    return new Uint8Array(0);
  }
}
