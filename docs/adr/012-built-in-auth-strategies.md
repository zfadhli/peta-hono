# ADR 012 — Built-in auth strategies (session / JWT / Google OAuth)

**Date:** 2026-08-27
**Status:** Accepted — implemented (initial pass, `src/auth/`)

## Context

The existing `auth(name, mw, scheme?)` takes a user-supplied middleware. It is
powerful and composes with `{ auth: name }` gating, but it leaves the hard parts
— cookie sessions, JWT signing + refresh rotation, and an OAuth2 code flow — to
the caller. The goal is **built-in, reusable strategy helpers** that:

- still register through the same code path, so a `{ auth: name }` route keeps
  the existing 401 + `security` + `components.securitySchemes` behavior, and
- are **optional** (opt-in) with no breaking change to `auth(name, mw, scheme?)`
  or `createApi<Auth, Env>(opts)`.

Three strategies are in scope: **session** (cookie), **JWT** (bearer access +
rotating refresh), and **Google OAuth2** (authorization-code + PKCE).

## Decision

Non-breaking, additive. `auth` (a function) gains strategy methods; `createApi`
keeps its signature.

### Public surface

```ts
const { api, auth, docs, app } = createApi<Auth, Env>({ title, version, debug })

// Named strategies (each registers under the given gate name)
const session = auth.session("session", { secret, cookieName?, store?, csrf? })
const jwt     = auth.jwt("jwt", { secret, accessTtl?, refreshTtl?, issuer?, audience?, store? })
const google  = auth.oauth("google", { clientId, clientSecret?, redirectUri, scopes?, onSuccess, ... })

// Unified dispatch (same builders, discriminated by `type`)
auth.strategy("session", { type: "session", ... })
auth.strategy("jwt",     { type: "jwt", ... })
auth.strategy("google",  { type: "oauth", ... })
```

Each strategy returns a handle exposing its flow helpers:
- **session**: `create(c, data)`, `destroy(c)`, `get(c)`, `generateCsrf(c)`, `verifyCsrf(c, token)`. `create`/`destroy` both set the cookie on the context *and* return the `Set-Cookie` value, so a handler returning a raw `Response` (e.g. an OAuth `onSuccess`) can attach it.
- **jwt**: `issue(sub, claims?)`, `refresh(refreshToken)`, `revoke(refreshToken)`, `verifyAccess(token)`.
- **oauth**: `authorizeUrl(state, codeChallenge?)`, `exchangeCode(code, verifier?)`, `getUser(tokens)`, `mount(app)` (registers `/start` + `/callback`).

### Registration model

Session/JWT strategies have a guard middleware and are registered exactly like a
hand-written `auth(name, mw, scheme)` (so `{ auth: name }` works and is
documented protected). OAuth is a **flow**, not a request guard: its strategy
registers the `oauth2` security scheme (for `components.securitySchemes`) and
mounts the `/start` + `/callback` routes directly on `app`; downstream protected
routes use a `jwt`/`session` gate. Public store adapters
(`createMemorySessionStore` / `createMemoryRefreshTokenStore`) and the store
interfaces are exported so callers can supply a durable store.

### Security-scheme type split — narrow input vs wide emitted

To avoid breaking consumers who exhaustively switch on the `auth()` input type,
`AuthScheme` (the narrow input) is left unchanged, and the wide emitted set grows
as a separate `SecurityScheme`:

```ts
// Input to auth(name, mw, scheme?) — stable since v0.5.4
export type AuthScheme =
  | { type: "http"; scheme: "bearer" | "basic" }
  | { type: "apiKey"; in: "header" | "query"; name: string };

// Emitted for components.securitySchemes — adds the built-in-strategy kinds
export type SecurityScheme =
  | AuthScheme
  | { type: "apiKey"; in: "cookie"; name: string }
  | { type: "oauth2"; flows: OAuth2Flows };
```

### JWT — homegrown HS256, no dependency

Access tokens are compact JWS (HS256) signed with a shared secret via Web Crypto
(`crypto.subtle`), portable to Node/Bun/Deno/edge — no new dependency, mirroring
the existing `sha1Hex` Web Crypto use. Each access token carries a unique `jti`.
Refresh tokens are **opaque, server-stored (hashed with SHA-256), rotated on
every refresh, single-use**, and **family-revoked on reuse** (a replayed rotated
token revokes the whole family → 401). The refresh store implements
`RefreshTokenStore` (default in-memory; supply a durable one in prod).

### Session — signed cookie, pluggable store, opt-in CSRF

The session id travels in a signed cookie (`sid.hmac`), the payload lives in a
`SessionStore`. `SameSite=Lax` is the default mitigation; CSRF is opt-in
double-submit via an in-session token validated against a header. The cookie is
**not** generated `Secure` by default (dev over http) — set `secure: true`.

### OAuth — authorization-code + PKCE, injection point is `onSuccess`

`/start` builds a `state` (+ PKCE `code_verifier`) and stores both in a short-lived,
signed, HttpOnly cookie, then redirects to the provider. `/callback` validates
`state` against the cookie, exchanges the code (with `code_verifier`), fetches
the user profile, calls `onSuccess({ user, tokens, request, c })`, and clears the
state cookie. `tokenURL`/`userInfoURL`/`fetchFn` are injectable for tests and
proxies; `onSuccess` is where you issue a JWT or create a session.

## Alternatives considered

- **Extend `auth(name, mw, scheme?)` for each strategy** — forces the strategy's
  guard + flow helpers into a single callback signature; struggles to expose
  `create`/`issue`/`refresh` helpers. Rejected: the existing signature is a pure
  guard; strategies need both a guard and flow helpers.
- **Add a dependency for JWT (`jose`, `jsonwebtoken`)** — `jose` is ESM + ts-friendly
  but pulls a dependency tree and type surface into a library that is deliberately
  thin and runtime-portable. Web Crypto HS256 covers the requirement at zero
  dependency cost. Rejected: keep the tree light; documented ceiling (RS256/JWKS).
  **Superseded by [ADR-013](./013-adopt-jose-for-jwt.md)** — the library now adopts
  `jose` for the JWT layer (HS256 default + opt-in RS256/EdDSA/JWKS/rotation).
- **Wire OAuth to automatically issue a JWT/session** — couples the strategies and
  hides the integration point. Rejected: `onSuccess` keeps the strategies
  composable and lets the caller decide (issue JWT *or* session *or* both).

## Consequences

- **Migration:** additive. Existing `auth(name, mw, scheme?)`, `createApi`, the
  `AuthScheme` http/apiKey cases, and every example are unchanged. New exports
  (strategy types + store creators) come from the `src/auth/` module and the
  barrel. `AuthScheme` (the narrow `auth()` input) is unchanged since v0.5.4; the
  wide emitted set (`apiKey`/`in:"cookie"`, `oauth2`) lives in the new
  `SecurityScheme`. The widening is compile-time-only and affects only consumers
  who read `components.securitySchemes` with `AuthScheme` — they should switch to
  `SecurityScheme`.
- **Testing:** `src/auth.selfcheck.ts` (7 assertions) covers session
  create/lookup/logout, JWT issue/verify/rotate/reuse-revoke, the OAuth mocked
  start/callback with PKCE, OpenAPI scheme emission, strategy coexistence in one
  app, opt-in CSRF enforcement, and `auth.strategy` unified dispatch.
  `examples/strategies/` runs them over a real server with a cookie jar. Wired
  into `check:all`.
- **ponytail ceilings:** HS256 only (no RS256/JWKS yet); session cookies are
  signed not encrypted; in-memory stores are process-local; OAuth `onSuccess` is
  the only integration point (no auto-refresh wiring).
- **Flow routes are deliberately omitted from the OpenAPI `paths`.** `/start` and
  `/callback` are registered via `app.get` (a browser redirect/RT exchange, not a
  JSON operation). Forcing them through `app.openapi` would make `_buildResponses`
  declare a `200 "Success"` body for what is actually a `302` redirect (the spec
  emitter maps any non-204 code to a JSON body), a spec/runtime mismatch that
  violates the library's spec-accuracy invariant. The `oauth2` security scheme IS
  emitted to `components.securitySchemes`; the flow route *paths* are not. Revisit
  if a truthful `No Content`/redirect response is added to the emitter.
- **Docs:** glossary + domain-model updated; `examples/strategies/` added to the
  README structure tree; `AGENTS.md` commands/structure/key-patterns updated.

## References

- `src/auth/*` — crypto, store, cookie, session, jwt, oauth strategies
- `src/api.ts` — `registerAuth` + `auth.session/jwt/oauth/strategy` wiring
- `src/openapi.ts` — `SecurityScheme` (wide emitted) + `AuthScheme` (narrow input)
- `src/auth.selfcheck.ts`, `examples/strategies/` — tests
