# Auth hardening — Pilcrow best-practices gap analysis + design (ADR-style)

**Status:** Plan (architect output). No code changed. Do not bump version / build `dist/` / commit / push / publish.
**Baseline:** `peta-hono` v0.6.0 — built-in auth strategies (`src/auth/`), ADR-012. Source of truth for the gaps: https://auth.pilcrowonpaper.com.

This is the `/architect` design package: Phase A grounding (how auth works today + the externally-sourced best practices it falls short of), Phase B sketch (the chosen hardening shape, written usage-first), and the synthesis decision. The follow-on work is broken into tracer-bullet slices in `./issues/NN-*.md`.

---

## Phase A — Grounding

### A1. What `src/auth/` does today

`src/auth/` ships three strategy builders, all runtime-portable (Web Crypto only, no new dependency) and composed on top of the existing `auth(name, mw, scheme?)` gate mechanism:

- **Session** (`session.ts`): cookie `sid.<hmac>` (HMAC-SHA256 of the sid); payload lives in a pluggable `SessionStore`; guard loads the session and yields it as `req.auth`. SameSite defaults to `Lax`; `HttpOnly` defaults true; **`Secure` defaults false** (dev-over-http ceiling); **CSRF is opt-in** via an in-session double-submit token checked against an `x-csrf-token` header; session lifetime is a single absolute `ttlSeconds`.
- **JWT** (`jwt.ts`): HS256 access tokens (compact JWS, Web Crypto) + opaque refresh tokens that are server-stored (SHA-256 hashed), **rotated on every refresh, single-use, family-revoked on reuse** (a replayed rotated token revokes the whole family → 401). Access TTL defaults 900s; refresh TTL defaults 30d. **HS256 symmetric-only, one shared `secret`, no `kid`/rotation**; access tokens are stateless (not revocable before expiry); **refresh-token transport is the caller's job** (the strategy returns raw tokens, no cookie helper).
- **OAuth** (`oauth.ts`): Google authorization-code flow. `/start` builds a `state` (+ PKCE `code_verifier` when enabled) stored in a short-lived signed HttpOnly cookie, then redirects. `/callback` validates `state`, exchanges the code, fetches userinfo, calls the user's `onSuccess`, clears the state cookie. **PKCE defaults ON only when `clientSecret` is omitted** (`usePKCE ?? !clientSecret`); state cookie is **not `Secure`** and has no host prefix; provider `error` (user-denied) is not handled gracefully.
- **Shared primitives**: `cookie.ts` (RFC-6265 serialize/parse, no `__Host-` prefix / Secure-for-None enforcement / `Priority`), `crypto.ts` (HMAC, base64url, randomToken, SHA-256, constant-time compare), `store.ts` (`SessionStore` / `RefreshTokenStore` + in-memory adapters).

It deliberately has **no password-hashing primitive and no credential model** — the strategies assume the caller has already authenticated (issued a session/JWT/OAuth token); they are not a full "login" stack.

### A2. Relevant Pilcrow best practices

| # | Pilcrow guidance | Relationship to `src/auth/` |
|---|---|---|
| P1 | **Sessions over stateless JWTs.** Server-side session records; a client token is an *unknowable handle*, not a bag of claims. | `session.ts` is the aligned path; `jwt.ts` is the divergent one. |
| P2 | **Session token = high-entropy random (`>=32` bytes), stored hashed (SHA-256), compared constant-time.** | JWT refresh tokens already do this (excellent). Session `sid` is random but the cookie is *signed* rather than the id being stored hashed — acceptable because the payload is server-side, but the sid is both identifier and credential (see P6). |
| P3 | **Session expiry: idle + absolute; reissue a fresh session/token on auth and on sensitive actions.** | Session has absolute-only `ttlSeconds` (no idle, no rolling reissue on activity, no reissue-on-promotion). GAP. |
| P4 | **Cookies: `Secure`, `HttpOnly`, `SameSite=Lax`; `__Host-` prefix on sensitive cookies; `Path=/`; no bare `Domain`.** | `HttpOnly`+`SameSite=Lax` good; **`Secure` default-false** and **no `__Host-` prefix** anywhere. GAP. |
| P5 | **CSRF is mandatory for cookie-auth; the robust pattern is a double-submit token *plus* `Origin`/`Sec-Fetch-Site` validation (SameSite alone is not enough — subdomains and top-level GET navigation slip through).** | Session CSRF is **off by default** and is token-only (no origin/site-header check). GAP. |
| P6 | **Prefer id + secret split so the secret never needs to be logged/referenced as an identifier.** | Session sid doubles as identifier+credential (signed, so tamper-proof, but the split affordance is absent). MINOR GAP. |
| P7 | **JWTs: short access TTL, verify `alg` is pinned, support key rotation, and prefer asymmetric when multiple services verify.** | Access TTL 900s good; **single symmetric key, no `kid`/rotation, no alg-pinning assert** (safe today only because it always re-signs HS256 and never reads `alg`). GAP. |
| P8 | **Revocation: a stateless access token can't be revoked before expiry — use a `jti` blocklist if you need it.** | No access-token revocation hook. GAP (optional). |
| P9 | **OAuth: validate `state` (CSRF); use PKCE (S256) *on every* flow and client, confidential included; exact-match `redirect_uri`; handle provider `error`; prefer calling UserInfo over trusting unvalidated `id_token`.** | `state` ✓, PKCE-S256 ✓ (default-gated), UserInfo ✓. **PKCE should not depend on `clientSecret` being omitted**; state cookie not `Secure`; provider `error` unhandled. GAPS. |
| P10 | **Rate-limit login; don't reveal whether an account exists (consistent messages/timing); use argon2id/scrypt for passwords; hash password-reset/verification tokens; single-use + short-TTL email codes.** | Out of scope for the strategies (no credential flow); the library should at least document these and preserve a zero-dep posture. GAP (coverage / guidance). |

### A3. Gap → ticket map

| Gap | Ticket |
|---|---|
| No `__Host-`/`__Secure-` prefix, no Secure-for-None enforcement, no `Priority`, no cookie **transport helper** for bearer refresh tokens | 01 |
| Session cookie `Secure` default-false; absolute-only expiry; no idle/rolling reissue | 02 |
| CSRF off-by-default and token-only; no `Origin`/`Sec-Fetch-Site` validation | 03 |
| JWT HS256-only, one key, no rotation/`kid`, no access-token revocation, refresh-token transport left to caller | 04 |
| OAuth PKCE tied to `clientSecret` omission; state cookie not secure/prefixed; provider `error` unhandled | 05 |
| OAuth `/start`+`/callback` omitted from OpenAPI `paths` (`documentFlowRoutes` ceiling noted in ADR-012 R3) | 06 |
| No password-hashing primitive / credential guidance (P10) — scope decision, zero-dep tension | 07 |
| ADR-012 / glossary / domain-model / README / CHANGELOG must reflect the resulting contract | 08 |

---

## Phase B — Sketch (hardening shape, written usage-first)

Design goal: **additive, opt-in, non-breaking** hardening that moves the defaults toward the Pilcrow baseline without changing what existing callers had to do. The narrow `AuthScheme`/`SecurityScheme` split, `auth(name, mw, scheme?)`, `createApi`, and every existing example are untouched.

### Usage (the caller's contract after hardening)

```ts
// Session — hardened defaults
const session = auth.session("session", {
  secret,
  origin: "https://app.example.com",               // NEW: origin the cookie is served from (Origin/Sec-Fetch-Site CSRF)
  idleTtlSeconds: 1800,                             // NEW: rolling idle timeout (default 1800); absolute ttlSeconds caps it
  reissueOnActivity: true,                          // NEW: rotate the sid on activity (default false; see note)
  csrf: "origin",                                   // CHANGED default: "origin" (Origin/Sec-Fetch-Site) | "double-submit" | false
  cookie: { secure: true, hostPrefix: true },       // NEW shape: cookie attribute block pushed down to the strategy
});

// JWT — key rotation + broadcast-ready
const jwt = auth.jwt("jwt", {
  secret: primary,
  keys: [{ kid: "k1", secret: primary }, { kid: "k2", secret: rotating }],  // NEW: rotation map (defaults to [{ kid: "k1", secret }])
  accessTtl: 900,
  refreshTransport: { cookie: { name: "rt", hostPrefix: true, secure: true, path: "/auth" } }, // NEW: set refresh cookie on issue/refresh
  revokeAccess: async (jti) => memoryBlocklist.add(jti), // NEW optional jti blocklist for access-token revocation
});

// OAuth — PKCE everywhere
const google = auth.oauth("google", {
  clientId, clientSecret, redirectUri,
  usePKCE: true,                                    // CHANGED default: true (no longer gated on clientSecret omission)
  cookie: { secure: true, hostPrefix: true },
  onSuccess,
});
```

### Module map

- `src/auth/cookie.ts` — add `hostPrefixName()`, enforce `Secure` when `SameSite="None"`, `Priority`, and a small `CookieTransport` helper (set-on-Response / read-from-Request / clear) used for bearer-refresh cookies.
- `src/auth/session.ts` — new `origin`/`idleTtlSeconds`/`reissueOnActivity` options; `csrf` becomes `false | "origin" | "double-submit"` (default `"origin"`); cookie attributes flow through the hardened serializer.
- `src/auth/jwt.ts` — `keys`/`kid` rotation map (verify identifies the key by `kid`; sign uses the current), optional `revokeAccess` (jti blocklist adapter), `refreshTransport` cookie mode, pinned `alg` assertion.
- `src/auth/oauth.ts` — `usePKCE` default `true`; cookie attrs hardened; handle provider `error` query param; keep `/start`+`/callback` omitted from `paths` unless `documentFlowRoutes` is set (ticket 06).
- `src/auth/index.ts` / `src/api.ts` — re-export the new option types; no change to `auth(name, mw, scheme?)` or `createApi`.

### Rationale (why this shape)

- **`csrf: "origin"` as the new default is the key move.** It is non-breaking for clients (browsers already send `Origin`/`Sec-Fetch-Site` on mutating requests — the client does nothing new), yet it closes the CSRF window that `SameSite=Lax` alone leaves open (same-site subdomains, top-level GET navigation). `"double-submit"` remains available for stricter setups, and `false` for legacy. This honors Pilcrow's "CSRF is mandatory for cookie auth" without forcing clients to fetch a token on every mutation.
- **Idle + absolute expiry** restores the "boundary on stolen sessions" principle (P3) cheaply: a stolen cookie only survives the idle timeout, and a hard absolute cap bounds worst-case exposure.
- **Additive option blocks (`cookie`, `keys`, `refreshTransport`, `revokeAccess`)** keep the public surface small and the defaults backward-compatible. Key rotation is opt-in so existing single-`secret` callers are unaffected.
- **PKCE default `true`** aligns with OAuth 2.1 without breaking the confidential-client path (the `code_verifier` is still only sent in the state cookie).

### Cost/benefit notes (ponytail ceilings preserved)

- Key rotation and access-token revocation add surface; they stay opt-in and default to the current behavior.
- `reissueOnActivity` (rolling sid rotation) is intentionally gated behind the cookie transport + idle support and is off by default to avoid surprising callers with new cookies mid-flight.
- **Zero-dependency posture is preserved** — no argon2id/scrypt package is added here; ticket 07 is a scope decision for whether to add a *password* helper as an opt-in (likely an optional peer dep + documented pattern) or document the recommended approach instead.

### Out of scope

- Password hashing / credential storage / email verification / sign-up flow (no user model in the library). Flagged as the gap in **ticket 07** and documented, not implemented, unless the scope decision lands there.
- Rate limiting (an application/proxy concern) — documented as caller responsibility.

---

## Synthesis decision

Adopt the **additive-hardening** design above over two alternatives considered:

1. **Reject the design-space alternative of "leave strategies as-is and document caveats."** The gaps (no `Secure`/host prefix on cookies, CSRF off by default, PKCE gating, single symmetric key) are precisely the kind of "works but is a known footgun" that Pilcrow calls out; documentation alone leaves the defaults unsafe.
2. **Reject the alternative of a wide breaking rewrite** (e.g. move session claims to a stateless signed cookie, or require argon2id now). A breaking rewrite risks the blast-radius patterns the release just stabilized (ADR-011/R1), and argon2id violates the deliberate zero-dep ceiling. The opt-in + default-improvement path lands every real win without those costs.

The hardening is deliberately split so each slice can land independently and stay green against `nub run typecheck` / `nub run lint` / `nub run check:auth` (+ a `check:all` at the end). See `./issues/` for the ordered slices.
