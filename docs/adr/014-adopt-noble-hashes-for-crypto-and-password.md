# ADR 014 — Adopt `@noble/hashes` for the shared crypto primitives + opt-in password hashing

**Date:** 2026-08-29
**Status:** Accepted — implemented (`src/auth/crypto.ts`, `src/password.ts`)

## Context

The built-in auth strategies hand-rolled their small crypto primitives
(HMAC-SHA256 for cookie signing, SHA-256 for refresh-token at-rest hashing and
PKCE S256, CSPRNG bytes for opaque tokens / state / CSRF). These were correct but
**unaudited**, and the library had no password-hashing primitive at all (documented
as "caller responsibility").

`@noble/hashes` is audited (Cure53), zero-dependency, ~2.8 kB gzipped, portable
across Node/Bun/Deno/edge, and provides `hmac`, `sha256`, `randomBytes`, `scrypt`,
and `argon2id`. It is the natural home for the thin primitives the strategies need
while keeping the library's hand-written code limited to what the library doesn't
provide (cookie parse/serialize, store adapters, the OAuth flow).

## Decision

Adopt **`@noble/hashes`** and:

1. **Consolidate the shared primitives** (`src/auth/crypto.ts`) onto it, keeping
   the exact exported helper names/signatures so `session.ts`/`oauth.ts` don't
   change:
   - `hmacSign`/`hmacVerify` → `@noble/hashes/hmac` (`hmac(sha256, key, msg)`),
     keeping a constant-time compare.
   - `sha256Hex` / the PKCE `sha256Base64url` → `@noble/hashes/sha2` `sha256`.
   - `randomToken` → `@noble/hashes/utils` `randomBytes`.
2. **Add an opt-in password helper** at a new `peta-hono/password` subpath
   (`src/password.ts`): `hashPassword` / `verifyPassword` backed by
   `@noble/hashes` `scrypt`, returning a self-describing, parameter-encoded hash
   (work factors + salt + derived key), with constant-time verification.

### scrypt vs argon2id

**scrypt is the default** because `argon2id` is ~5× slower than native in pure JS
(per `@noble/hashes`' own docs). Default work factors: `N=2**15` (≈32 MiB),
`r=8`, `p=1`, `dkLen=32`. Callers override via the per-call options; the
interface is shaped so argon2id could be swapped in later without changing call
sites.

### Node floor

`@noble/hashes` v2 is **ESM-only** and requires **Node ≥ 20.19** (the current
Web-Crypto code implied Node ≥ 18). This is an accepted floor bump; pinning v1
(Node ≥ 14.21) was rejected because the focused v2 API + modern floor are worth
it for a pre-1.0 library. `engines.node` is set to `>=20.19.0`.

## Alternatives considered

- **Keep hand-rolled crypto.** Leaves the sensitive primitives unaudited and gives
  no password path. Rejected.
- **`node:crypto`.** Not portable to Bun/Deno/edge without a shim. Rejected — the
  library is runtime-portable.
- **`bcrypt` / `bcryptjs` / `argon2`** for password hashing. Native deps or
  deprecated; `@noble/hashes` gives an audited, zero-dep, portable scrypt/argon2id
  without a separate dependency. Rejected.
- **Pin `@noble/hashes` v1 for the older Node floor.** Rejected — keeps an older
  API for a pre-1.0 library; the Node ≥20.19 floor is acceptable and documented.

## Consequences

- **Second runtime dependency** (after `jose`, ADR-013). The core barrel stays
  dependency-light: `@noble/hashes` is already shipped for the auth crypto, and
  the password helper is a separate opt-in subpath.
- **Behavior-preserving consolidation** — session/oauth are unchanged (same helper
  names, same outputs); the existing `src/auth.selfcheck.ts` passes unchanged.
- **Node floor bump to ≥20.19** (ESM-only `@noble/hashes` v2) — recorded in
  `package.json` `engines`.
- **Boundary** — `hashPassword`/`verifyPassword` are credential *hashing only*;
  they do not manage users, passwords, or sessions. The user model / registration
  flow stays the caller's.

## References

- `src/auth/crypto.ts` — thin wrappers over `@noble/hashes` (hmac / sha256 / randomBytes)
- `src/password.ts` — `peta-hono/password` scrypt helper
- ADR-013 (`jose` for the JWT layer)
- ADR-012 (built-in auth strategies)
