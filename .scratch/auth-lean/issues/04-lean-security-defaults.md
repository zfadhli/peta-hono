# 04: Lean security defaults — session CSRF origin, Secure cookies, OAuth PKCE on

**Source:** auth.pilcrowonpaper.com P4/P5/P9 — these are the defaults that matter and they are small default changes, not new option surface.

## What to build

Move the *defaults* of the cookie-based strategies toward the Pilcrow baseline. The heavy hardening is dropped (the libs cover it); these are the few small changes that make the default safe.

- **Session CSRF default-on** (`src/auth/session.ts`): change `csrf` from `false` to `"origin"` (accept `false | "origin" | "double-submit"`; keep `true` as an alias for `"double-submit"`). `"origin"` rejects mutating requests whose `Origin`/`Sec-Fetch-Site` is cross-site, using the new `origin?: string | string[]` option. Browsers already send these headers, so clients do nothing new — non-breaking yet closes the same-site-subdomain / top-level-GET hole that `SameSite=Lax` alone leaves.
- **Session cookie `Secure` + host-prefix defaults** (`src/auth/session.ts`): a `cookie` block (`{ secure?, sameSite?, path?, httpOnly?, hostPrefix? }`) defaulting `secure: true` (with a documented dev-over-http opt-out), plus `__Host-` when `hostPrefix` is set.
- **OAuth PKCE on by default** (`src/auth/oauth.ts`): change `usePKCE ?? !clientSecret` to default `true`, so confidential clients also get PKCE; harden the state cookie (`Secure` default + host prefix) and handle provider `error` query params (denial) via `onError`.

## Blocked by

03 (cookie transport/attribute hardening), which is in turn blocked by 02.

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` / `nub run lint` pass.
- [ ] Default session CSRF is `"origin"`: a mutating request with a mismatched `Origin` (or `Sec-Fetch-Site: cross-site`) is rejected 403; a same-origin mutating request passes with **no** client token. `"double-submit"` mode preserves today's `x-csrf-token` behavior; `false` restores legacy.
- [ ] The session cookie sets `Secure` (and `__Host-` when `hostPrefix` is set); dev-over-http has an explicit opt-out and `examples/strategies` use it.
- [ ] An OAuth confidential client (with `clientSecret`, no explicit `usePKCE`) produces a `code_challenge`/`code_challenge_method=S256`; `error=access_denied` routes to `onError` (not "Invalid OAuth state"); the state cookie is `Secure`.
- [ ] `src/auth.selfcheck.ts` gains origin-CSRF, Secure/prefix cookie, and OAuth PKCE-with-secret + provider-`error` tests; `examples/strategies` pass. `nub run check:all` green.

## Notes

These are the only hardening defaults carried over from `.scratch/auth-hardening/`, because they are small default flips rather than new surface. **Migration note for docs/CHANGELOG:** callers who ran `csrf: false` are unaffected; callers relying on cookie-auth mutations without a token need `origin` configured (the strategy should throw a helpful error if `"origin"` is the mode and `origin` is unset). Because `peta-hono` is pre-1.0, changing these defaults is acceptable as deliberate hardening.
