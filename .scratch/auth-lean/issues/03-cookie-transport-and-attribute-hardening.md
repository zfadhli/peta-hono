# 03: Cookie serialization hardening + bearer-refresh `CookieTransport`

**Source:** auth.pilcrowonpaper.com — cookie attributes (`__Host-`/`__Secure-` prefix, `Secure` for `SameSite=None`, `Path=/`).

## What to build

Make `src/auth/cookie.ts` produce spec-hardened cookies and give the JWT strategy a safe way to transport a refresh token in an HttpOnly cookie. This is the foundation the session/oauth cookie defaults (ticket 04) and the JWT refresh-transport (ticket 05) build on. It changes no behavior of its own beyond stricter serialization.

Concretely:
- `serializeCookie` gains `domain?`, `priority?`, and a `hostPrefix?` flag that renames the cookie to `__Host-<name>` and **forces** `Secure` + `Path=/` + no `Domain` (the browser contract for `__Host-`).
- Enforce the RFC-6265bis rule that `SameSite=None` **requires** `Secure` (throw a clear error rather than silently emit an invalid cookie).
- Add a `__Secure-` prefix variant for non-Host cookies where `Path=/` is not desired.
- Add a small `CookieTransport` helper for opaque bearer tokens (refresh): read-from-request / set-on-response / clear-on-response, defaulting to `HttpOnly` + `Secure` + `SameSite=Lax` + host-prefixed, with `path` scoping so it is not sent to unrelated endpoints (e.g. `Path=/auth`).

## Blocked by

02 (crypto consolidation lands first; the transport/attribute helpers are consumed by 04 and 05).

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` and `nub run lint` pass.
- [ ] `hostPrefix: true` yields `__Host-<name>` and asserts `Secure`+`Path=/`; passing `domain` or a non-`/` path with a host prefix throws.
- [ ] `sameSite: "None"` without `secure` throws a clear, actionable message.
- [ ] `__Secure-` prefix is emitted without forcing `Path=/`.
- [ ] `CookieTransport` round-trips a token (set → read) and clears it correctly; the cleared cookie uses `Max-Age=0` + matching attrs.
- [ ] A unit block in `src/auth.selfcheck.ts` (or a small `src/cookie.selfcheck.ts` pulled into `check:all`) covers prefix/none-secure/transport round-trip.
- [ ] Existing `examples/strategies` pass unchanged (no behavior regression from the stricter serializer).

## Notes

Uses only the core `@noble/hashes`/Web-Crypto primitives — no new dependency. This ticket only *enables* `Secure`/host-prefix and safe refresh-cookie transport; actually turning them on (the strategy defaults) is ticket 04 (session/oauth) and ticket 05 (JWT refresh-transport).
