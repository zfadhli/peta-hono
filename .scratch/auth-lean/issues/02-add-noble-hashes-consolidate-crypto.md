# 02: Add `@noble/hashes`; consolidate the crypto primitives onto it

**Source:** audited crypto for the thin primitives the session/oauth strategies already use (`hmac` for cookie signing, `sha256` for refresh-token hashing / PKCE, `randomBytes` for tokens) — and the enabler for the opt-in password helper (ticket 06).

## What to build

Add `@noble/hashes` and replace the hand-rolled Web-Crypto HKDF-adjacent primitives in `src/auth/crypto.ts` with thin wrappers over it, so the session and OAuth strategies keep their **exact current shapes and behavior** but no longer ship hand-rolled `hmac`/`sha256`/`randomBytes`. This is a behavior-preserving internal consolidation (HMAC-SHA256, SHA-256, and CSPRNG bytes are unchanged).

Concretely, `src/auth/crypto.ts`:
- Back `hmacSign`/`hmacVerify` with `@noble/hashes/hmac` (`hmac(sha256, key, msg)`), keeping the constant-time compare (use `@noble/hashes/util` or the existing 10-line `timingSafeEqual`).
- Back `sha256Hex`/the PKCE `sha256Base64url` with `@noble/hashes/sha2` `sha256` (+ `bytesToHex`/`base64url` from `utils`).
- Replace `randomToken` with `@noble/hashes/utils` `randomBytes`.
- Keep the exported helper names/signatures identical so `session.ts`/`oauth.ts` don't change.

## Blocked by

None (can start immediately). Independent of ticket 01 (jose) — jose moves the JWT layer, this consolidates the shared crypto.

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub install @noble/hashes` succeeds; `nub run typecheck` and `nub run lint` pass.
- [ ] `src/auth.ts`/`session.ts`/`oauth.ts` behave identically after the swap — the existing `src/auth.selfcheck.ts` (session create/lookup/logout, JWT, OAuth start/callback, CSRF) still passes.
- [ ] `crypto.ts` no longer hand-rolls HMAC/SHA-256/CSPRNG; it delegates to `@noble/hashes` while preserving the same exported API.
- [ ] `nub run check:all` passes; `examples/strategies` pass.
- [ ] The Node floor is noted (see Notes) — the dependency is added with an explicit stance on `@noble/hashes` v2 (Node ≥ 20.19, ESM-only) vs pinning v1.

## Notes

This keeps the library portable (Node/Bun/Deno/edge) while moving the sensitive primitives to an **audited, zero-dependency library**. `crypto.ts` becomes a thin adapter rather than a crypto implementation. `@noble/hashes` v2 is ESM-only and needs Node ≥ 20.19 (the current Web-Crypto code implies Node ≥ 18); pin v1 or accept the floor bump — record whichever is chosen in the ADR (ticket 07). Deliberately does **not** add password hashing yet; that's ticket 06.
