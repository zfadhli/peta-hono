# Auth lean-down — `jose` (JWT/JWK) + `@noble/hashes` (crypto/password)

**Status:** Plan (architect output). No code changed. Do not bump version / build `dist/` / commit / push / publish.
**Supersedes:** the `.scratch/auth-hardening/` additive-hardening direction for the JWT/crypto/CSRF parts, and the lean plan's earlier "password hashing is out-of-scope / docs-only" framing.
**Baseline:** `peta-hono` v0.6.0, `src/auth/`, ADR-012.

The plan is to **drop hand-rolled crypto and lean on two audited, portable, tree-shakeable libraries**: `jose` for the JWT/JWK layer, and `@noble/hashes` for the small crypto primitives (HMAC, SHA-256, random bytes) plus an opt-in password hashing helper. The remaining custom code (cookie parse/serialize, store adapters, the OAuth flow, the strategy orchestration) stays thin by design.

Two facts worth confirming up front (both verified against current sources):

- **`@noble/hashes`** is audited (Cure53), **zero dependencies**, ~2.8KB gzipped, runs on Node/Bun/Deno/edge, and provides `hmac`, `sha256`, `randomBytes`, `scrypt`, and `argon2id`. Its v2 is ESM-only and requires **Node ≥ 20.19** (the Web-Crypto code implies Node 18+ today) — a floor bump worth flagging, or pin v1 (Node ≥ 14.21) for the older floor.
- **`arctic` and most of `oslo` are deprecated** by their author (July 2026) — so *don't* use them for OAuth/random. The OAuth strategy stays hand-rolled for a lean lib; the `@noble/hashes`/`jose` pairing is the coherent modern stack.

---

## Phase A — what gets deleted vs. added

### Replaced by libraries (smaller, audited code)
| Currently hand-rolled | New library |
|---|---|
| `jwt.ts` `signAccessToken`/`verifyAccessToken` (base64url JWS + HMAC + constant-time verify) | `jose` `SignJWT` / `jwtVerify` |
| `crypto.ts` `hmac` (session + OAuth state-cookie signing) | `@noble/hashes` `hmac` |
| `crypto.ts` `sha256`/`sha256Hex` (refresh-token at-rest hash, PKCE S256) | `@noble/hashes` `sha256` |
| `crypto.ts` `randomToken` (opaque refresh token / state / CSRF / verifier) | `@noble/hashes` `randomBytes` |
| `crypto.ts` `timingSafeEqual` (CSRF compare) | `@noble/hashes` `utils`/`crypto` (or keep the 10-line Web-Crypto compare) |

### Kept thin (not worth a dependency)
- `cookie.ts` — ~40-line RFC-6265 serialize/parse; add host-prefix + `Secure`-for-`None` in place.
- `store.ts` — `SessionStore`/`RefreshTokenStore` adapter interfaces + in-memory impls; caller brings a durable store.
- `oauth.ts` — the Google authorization-code + PKCE flow. **Keep hand-rolled** (arctic is deprecated). Extend only when a second provider is actually needed.
- `session.ts` / `index.ts` / `api.ts` orchestration.

### Capability gained (free-ish)
- `jose`: `alg` pinning (`algorithms`), `kid`/key rotation, **RS256/EdDSA**, **JWKS** (`createLocalJWKSet`/`createRemoteJWKSet`) — the old plan would have hand-rolled these. Also gives `EncryptJWT`/`jwtDecrypt` if encrypted cookies are ever wanted (no extra dep).
- `@noble/hashes`: audited password hashing via an **opt-in** `peta-hono/password` entry (`scrypt` recommended; `argon2id` available but ~5× slower than native in JS).

---

## Phase B — lean architecture

### Usage (thin caller contract)

```ts
const jwt = auth.jwt("jwt", {
  secret: "32+ random bytes",                                // symmetric (default)
  // keys: [{ kid: "k1", secret }, { kid: "k2", secret: rotating }],   // key rotation
  // jwks: new URL("https://provider/.well-known/jwks.json"),          // remote JWKS
  algorithms: ["HS256"],                                    // alg pinning
  refreshTransport: { cookie: { name: "rt", hostPrefix: true, secure: true, path: "/auth" } },
});

const session = auth.session("session", {
  secret,
  origin: "https://app.example.com",   // for CSRF origin mode
  csrf: "origin",                       // default now "origin" (was false)
  cookie: { secure: true, hostPrefix: true },
});

// Opt-in password hashing — separate entry point, keeps the core thin
import { hashPassword, verifyPassword } from "peta-hono/password";
const digest = await hashPassword("correct horse battery staple"); // scrypt via @noble/hashes
await verifyPassword(digest, "correct horse battery staple");
```

### Module map
- `src/auth/jwt.ts` — `SignJWT`/`jwtVerify`; `keys`/`jwks`/`algorithms`; `refreshTransport` cookie mode; keep opaque refresh rotation + family-revoke (unchanged).
- `src/auth/crypto.ts` — trimmed to thin wrappers over `@noble/hashes` (`hmac`, `sha256`, `randomToken`, PKCE helper), so session/oauth keep their current shapes without the hand-rolled implementations.
- `src/auth/session.ts` — `origin` + `csrf: "origin" | "double-submit"` (default `"origin"`); `cookie` block (Secure/host-prefix defaults).
- `src/auth/oauth.ts` — `usePKCE` default `true`; hardened state cookie; provider `error` handling.
- `src/auth/cookie.ts` — host-prefix + `Secure`-for-`None` enforcement + `CookieTransport` helper.
- `src/password.ts` (new, opt-in entry) — `hashPassword`/`verifyPassword` backed by `@noble/hashes` `scrypt`, with a documented `argon2id` caveat; exported from a `peta-hono/password` subpath so the core stays dependency-light.
- `src/auth/index.ts` / `src/api.ts` — re-export the new option types; `auth(name, mw, scheme?)` and `createApi` unchanged.

### Cost / trade-offs (stated plainly)
- **Two runtime deps where there were none** (besides the docs-UI `@scalar/hono-api-reference`). This reverses ADR-012's "keep the tree light" line for the JWT layer and adds one for the crypto primitives. The payoff: audited crypto instead of hand-rolled, plus RS256/EdDSA/JWKS/rotation and a real password-hashing path, all cross-runtime.
- **Node floor.** `jose` needs Node ≥ 18; `@noble/hashes` v2 needs Node ≥ 20.19 (ESM-only). Flag this; pin `@noble/hashes` v1 if the older floor must be kept.
- **`argon2id` in JS is slow** — recommend `scrypt` as the default, `argon2id` optional. `@noble/hashes`' own docs say so.
- **Small-and-lean, not line-count.** The win is audited crypto + capability + less custom code to maintain/test; the thin helpers `jose`/`@noble/hashes` don't provide (cookie parsing, store adapters, OAuth flow) stay small on purpose.

### Out of scope
- Multi-provider OAuth / passkeys / email verification / sign-up flow — no user model; documented as caller responsibility.
- Rate limiting — application/proxy concern, documented.
- OAuth `/start`+`/callback` OpenAPI `paths` documentation (`documentFlowRoutes`) — unchanged/optional follow-up, not part of the lean core.

---

## Synthesis decision

Adopt **`jose` + `@noble/hashes`** and consolidate the crypto layer onto them. Rejected alternatives:

1. **Keep all hand-rolled crypto.** Leaves the most security-critical, hardest-to-audit code in the library and keeps HS256-only and no password hashing — exactly the ceiling the caller is asking to remove.
2. **Use the deprecated `arctic`/`oslo` stack.** They're being deprecated by their author; building on them is not lean or safe.
3. **Add the libs but keep the `.scratch/auth-hardening/` option set.** That would add dependencies *and* surface — the opposite of lean. Instead, the surviving defaults (Secure/host-prefix, CSRF origin, PKCE on) are default *changes*, and the heavy hand-rolled hardening is dropped because the libs provide it.

The slices below are ordered so each lands green against `nub run typecheck` / `nub run lint` / `nub run check:auth` (and `check:all` at the end).
