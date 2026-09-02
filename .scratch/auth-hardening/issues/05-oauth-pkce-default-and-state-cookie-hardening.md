# 05: OAuth PKCE-on-by-default + hardened state cookie + graceful provider-error handling

**Source:** auth.pilcrowonpaper.com — OAuth (P9): PKCE (S256) on every flow and client, `Secure` state cookie, handle provider `error`.

## What to build

Align the Google OAuth strategy with OAuth 2.1 best practices:
1. **PKCE on by default for all clients**, not only public/`clientSecret`-omitted ones. Today `usePKCE ?? !clientSecret` means a confidential client (with a `clientSecret`) silently skips PKCE — the exact gap OAuth 2.1 closes. Change the default to `true` (still overridable with `usePKCE: false`).
2. **Harden the state cookie** — add `Secure` (default true) and the `__Host-`/`__Secure-` prefix support from ticket 01; the state cookie is short-lived and HttpOnly already.
3. **Handle provider `error`** — today a user denying consent yields `?error=access_denied` (no `code`), which surfaces as a confusing "Invalid OAuth state". Detect the `error` query param and route to `onError` with a clear reason.

Concretely, `src/auth/oauth.ts`:
- `usePKCE` default `true` (regardless of `clientSecret`); the `code_verifier` still only ever travels in the signed state cookie.
- Add a `cookie` option block (`{ secure?, sameSite?, path?, hostPrefix? }`) applied to the state cookie; default `secure: true` (with the same dev opt-out convention as session).
- In `/callback`, before validating `state`, check for an `error`/`error_description` query param and call `onError` with a structured error (fall back to the existing default 400 otherwise).

## Blocked by

01 (cookie transport + attribute hardening).

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` / `nub run lint` pass.
- [ ] A confidential client (with `clientSecret`, `usePKCE` unset) produces a `code_challenge`/`code_challenge_method=S256` in the authorize URL; `usePKCE: false` still opts out.
- [ ] The state cookie includes `Secure` (and `__Host-` when `hostPrefix` is set); the dev-over-http opt-out works.
- [ ] A callback with `?error=access_denied` returns a 400 via `onError` with a clear message (not "Invalid OAuth state"), and clears the state cookie.
- [ ] `src/auth.selfcheck.ts` gains a PKCE-with-clientSecret test, a state-cookie attr test, and a provider-`error` test — passes.
- [ ] `examples/strategies` pass.

## Notes

PKCE default-on is non-breaking: a server with a `clientSecret` already sent it; adding the `code_verifier` is invisible to the provider and strictly improves the flow. The `/start`+`/callback` path-omission from OpenAPI `paths` is unchanged (see ticket 06 for the opt-in `documentFlowRoutes`).
