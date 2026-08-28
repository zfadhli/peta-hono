# ADR 013 — Adopt `jose` for the JWT layer

**Date:** 2026-08-29
**Status:** Accepted — implemented (`src/auth/jwt.ts`)

## Context

ADR-012 built the JWT strategy on a **hand-rolled HS256 JWS** via Web Crypto
(manual base64url header/payload + HMAC + constant-time verify), keeping the tree
dependency-free. That delivered a working HS256 access token with a rotating
refresh store. Its documented ceiling was **HS256-only — no RS256/EdDSA, no
JWKS, no key rotation**, with the sign/verify being the most security-critical,
hardest-to-audit code in the library.

`jose` is the audited, portable, ESM + TS-friendly library for the exact layer we
hand-rolled. Real `@noble/hashes` covers the small crypto primitives (ADR-014);
`jose` should cover the JWT layer — and in doing so, unlock RS256/EdDSA, JWKS
resolution, and `kid`/key rotation as *configuration*, not a new crypto module.

## Decision

Adopt **`jose`** (first runtime dependency for the JWT layer) and replace the
homegrown `signAccessToken`/`verifyAccessToken` in `src/auth/jwt.ts` with `jose`'s
`SignJWT` / `jwtVerify`.

- `issue()` signs with `new SignJWT({ sub, ...claims }).setProtectedHeader({ alg, typ:"JWT", kid? }).setIssuedAt().setExpirationTime().setIssuer()/setAudience()/setJti().sign(key)`.
- `verifyAccess()`/`middleware()` verify with `jwtVerify(token, key, { algorithms, issuer, audience })` — `algorithms` pins the `alg`, so a token with an unexpected `alg` is rejected (alg-confusion closed).
- `issue`/`refresh`/`revoke`/`verifyAccess`/`middleware` signatures are unchanged; the opaque, hashed, rotated, family-revoked refresh store is unchanged.

### Public surface added (opt-in)

- **`secret`** — symmetric HMAC key (unchanged from v0.6.0): tokens are signed
  HS256, carry no `kid`, and are verified with the same secret.
- **`keys?: { kid: string; secret: string }[]`** — key rotation (HMAC). `keys[0]`
  signs and stamps its `kid`; verification selects the key by the token's `kid`
  and rejects a token with a missing or unknown `kid`. Each entry may also carry
  an asymmetric `CryptoKey` (`{ kid, key }`) for RS256/EdDSA signing.
- **`jwks?: URL | { keys: JWK[] }`** — a remote
  (`createRemoteJWKSet(URL)`) or local (`createLocalJWKSet({ keys })`) JWKS used
  to **verify** inbound tokens (asymmetric / multi-service). Signing still uses
  `secret`/`keys`.
- **`algorithms?: JwtAlgorithm[]`** (default `["HS256"]`) — pins the accepted
  algs. It **must include the signing alg** (validated at construction) so the
  strategy never mints a token it rejects; add e.g. `"RS256"` when an asymmetric
  key is used.
- **`refreshTransport?: { cookie: {...} }`** — when set, `issue`/`refresh` also
  set an HttpOnly refresh cookie on the supplied `Context` and `revoke` clears
  it, via the `CookieTransport` helper from `src/auth/cookie.ts` (ticket 03).
  `CookieTransport` defaults to HttpOnly + Secure + SameSite=Lax, path-scoped,
  with **`hostPrefix: false`** (a deliberate default so `path` scoping works).
  Setting `hostPrefix: true` renames to `__Host-<name>` **and forces `Path=/`**,
  so a non-`/` `path` requires omitting `hostPrefix` (the `Secure` + `__Secure-`
  variant works at a non-`/` path).

## Alternatives considered

- **Keep the hand-rolled HS256 JWS.** Leaves the most security-critical code
  hand-written and keeps the HS256-only ceiling (no RS256/EdDSA/JWKS/rotation).
  Rejected — this is exactly the ceiling we are removing.
- **`jsonwebtoken`.** Common but CommonJS-oriented and less portable/audited than
  `jose`; `jose` is ESM + TS-first and targets Web Crypto for cross-runtime use.
  Rejected.
- **`arctic` / `oslo`** for the whole auth surface. Deprecated by their author —
  building on them is not lean or safe. The OAuth flow stays hand-rolled
  (see ADR-012). Rejected.

## Consequences

- **First runtime dependency for the JWT layer** — reverses ADR-012's "keep the
  tree light" line. The payoff: audited JWS serialization + constant-time
  verification, alg pinning, RS256/EdDSA, JWKS, and `kid`/rotation — all
  configuration, not custom crypto.
- **Portability unchanged** — `jose` uses Web Crypto; it runs on Node (≥18),
  Bun, Deno, and edge. (The actual Node floor is set by `@noble/hashes` v2,
  Node ≥20.19 — see ADR-014.)
- **Backward compatible** — existing callers passing only `secret` see identical
  HS256 tokens with no `kid`; `algorithms` defaults to `["HS256"]`; no refresh
  cookie is set without `refreshTransport`. The `algorithms` construction guard
  (must include the signing alg) is a fail-fast improvement, not a break.
- **Boundary** — `jose` does not do cookies, CSRF, sessions, or passwords. Those
  remain the library's thin helpers (cookie serialize/parse, the session
  strategy, and the opt-in `peta-hono/password` scrypt helper).

## References

- `src/auth/jwt.ts` — `SignJWT`/`jwtVerify`, `keys`/`jwks`/`algorithms`, `refreshTransport`
- ADR-012 (built-in auth strategies) — the HS256-only ceiling this reverses
- ADR-014 (`@noble/hashes` for crypto + the opt-in password helper)
- `src/auth/cookie.ts` — `__Host-`/`__Secure-` + `CookieTransport` (ticket 03)
