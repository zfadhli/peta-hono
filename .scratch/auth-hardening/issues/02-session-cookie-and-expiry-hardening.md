# 02: Session cookie + expiry hardening (Secure default, host prefix, idle + absolute)

**Source:** auth.pilcrowonpaper.com — session boundaries (P4 cookies, P3 expiry/reissue).

## What to build

Bring the cookie-session strategy up to the Pilcrow cookie + expiry baseline. The session cookie should be `Secure` by default (opt-out for dev-over-http), support the `__Host-` prefix, and model **idle + absolute** expiry rather than a single lifetime, with an optional rolling reissue on activity so a stolen session only lives as long as the user is active.

Concretely, `src/auth/session.ts`:
- Add a `cookie` option block (`{ secure?, sameSite?, path?, httpOnly?, hostPrefix? }`, defaulting `secure: true` in production, `false` when a dev opt-out is set).
- Add `idleTtlSeconds?` (default e.g. 1800) alongside the existing `ttlSeconds` (absolute cap). A record expires if `now - lastUsedAt > idleTtlSeconds` **or** `now > absoluteExpiresAt`.
- Add `reissueOnActivity?` (default false) — when a valid session is used and the idle window is about to close, rotate to a fresh `sid` and set a new cookie (combat session-fixation/stale-cookie reuse). Off by default to avoid surprising mid-flight cookie swaps.
- Keep `create()`/`destroy()`/`get()`/`generateCsrf()`/`verifyCsrf()` signatures; `create()` writes the idle + absolute bookkeeping into the stored record (no client-visible change).

## Blocked by

01 (cookie transport + attribute hardening).

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` / `nub run lint` pass.
- [ ] Default `secure` is `true`; the session cookie sets `Secure` + `__Host-` when `hostPrefix` is set; dev-over-http has an explicit opt-out.
- [ ] A session with only idle activity but past the absolute cap is rejected; a session past idle but within the absolute cap is rejected until activity (and extended by activity when reissue is on).
- [ ] `reissueOnActivity` rotates the sid cookie on use; the old sid is invalidated and the new cookie is returned.
- [ ] `src/auth.selfcheck.ts` gains assertions for secure/prefix (via a live Set-Cookie/request round-trip), idle-vs-absolute expiry, and reissue-on-activity. Passes.
- [ ] `examples/strategies` still pass with `secure` explicitly set for its localhost server (dev opt-out path exercised).

## Notes

Non-breaking by design: defaults move toward `Secure`+host-prefix but the *options* are additive. Existing callers who never set `secure` will now get a `Secure` cookie — on plain-http localhost dev this will stop working, so the docs must call out the dev opt-out (matches the established `ponytail:` pattern). `reissueOnActivity` stays opt-in to avoid a silent new cookie appearing mid-request.
