# 01: Harden cookie serialization + add a bearer-refresh transport helper

**Source:** auth.pilcrowonpaper.com — cookie attributes (`__Host-`/`__Secure-` prefix, `Secure` for `SameSite=None`, `Path=/`).

## What to build

Make `src/auth/cookie.ts` produce spec-hardened cookies and give the JWT strategy a safe way to transport a refresh token in an HttpOnly cookie. This is the **foundation** the session/oauth cookie hardening and the JWT refresh-transport tickets build on. It changes no behavior on its own beyond stricter serialization.

Concretely:
- `serializeCookie` gains `domain?`, `priority?`, and a `hostPrefix?` flag that renames the cookie to `__Host-<name>` and **forces** `Secure` + `Path=/` + no `Domain` (the browser contract for `__Host-`).
- Enforce the RFC-6265bis rule that `SameSite=None` **requires** `Secure` (throw a clear error rather than silently emit an invalid cookie).
- Add a tiny `CookieTransport` helper for opaque bearer tokens (refresh): read-from-request / set-on-response / clear-on-response, defaulting to `HttpOnly` + `Secure` + `SameSite=Lax` + host-prefixed, with `path` scoping so it is not sent to unrelated endpoints (e.g. `Path=/auth`).
- Add dedicated `__Secure-` prefix support for non-Host cookies where `Path=/` is not desired.

## Blocked by

None (can start immediately).

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` and `nub run lint` pass.
- [ ] `hostPrefix: true` yields `__Host-<name>` and asserts `Secure`+`Path=/`; passing `domain` or a non-`/` path with a host prefix throws.
- [ ] `sameSite: "None"` without `secure` throws a clear, actionable message.
- [ ] `CookieTransport` round-trips a token (set → read) and clears it correctly, and the cleared cookie uses `Max-Age=0` + matching attrs.
- [ ] A small unit block in `src/auth.selfcheck.ts` (or a new `src/cookie.selfcheck.ts` pulled into `check:all`) covers prefix/none-secure/transport round-trip.
- [ ] Existing `examples/strategies` still pass unchanged (no behavior regression from the stricter serializer).

## Notes

Keeps the zero-dependency posture. This ticket only *enables* `Secure`/host-prefix and safe refresh-cookie transport — actually turning them on (the strategy defaults) is ticket 02 (session) and ticket 04 (JWT refresh-transport).
