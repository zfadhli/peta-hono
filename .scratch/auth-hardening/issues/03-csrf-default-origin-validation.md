# 03: CSRF default-on via Origin / Sec-Fetch-Site validation

**Source:** auth.pilcrowonpaper.com — CSRF is mandatory for cookie auth; SameSite alone is insufficient (P5).

## What to build

Make CSRF protection the **default** for cookie-based auth, and add the stronger signal Pilcrow recommends — `Origin`/`Sec-Fetch-Site` validation — so the protection does not depend on a client fetching a token. Today `csrf` is opt-in (`false`) and token-only (`x-csrf-token` vs an in-session value).

Concretely, `src/auth/session.ts`:
- Change `csrf` from `boolean` to `false | "origin" | "double-submit"` with default `"origin"` (keep `true` as an alias for `"double-submit"` for backward compatibility, and `false` to disable).
- **`"origin"`** (default): on a mutating request, reject unless `Sec-Fetch-Site` is `same-origin`/`none` **or** the `Origin` header matches the configured `origin` (new `origin?: string | string[]` option, required when mode is `"origin"`). Browsers already send these headers — the client does nothing new, so this is non-breaking yet closes the same-site-subdomain / top-level-GET hole that `SameSite=Lax` alone leaves open.
- **`"double-submit"`**: the existing in-session token + `x-csrf-token` header check, for stricter setups.
- The guard (`middleware`) consults the configured mode; `generateCsrf`/`verifyCsrf` remain for the `"double-submit"` path.

## Blocked by

02 (session hardening) — the origin check and session bookkeeping live in `session.ts`; 01 (cookie attrs) transitively.

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` / `nub run lint` pass.
- [ ] Default mode is `"origin"`: a mutating request with a mismatched `Origin` (or `Sec-Fetch-Site: cross-site`) is rejected with 403; a same-origin mutating request passes **without the client sending any token**.
- [ ] `"double-submit"` mode retains the current token-header behaviour (existing `src/auth.selfcheck.ts` CSRF block still passes against `true`/`"double-submit"`).
- [ ] `csrf: false` restores previous no-CSRF behavior for legacy callers.
- [ ] `src/auth.selfcheck.ts` gains an origin-mode test (mismatched Origin → 403; matching Origin → 200; GET unaffected) — passes.
- [ ] `examples/strategies` pass; the example documents its `origin` so origin-CSRF is exercised, not silently bypassed.

## Notes

This is the highest-value gap: it moves a real security control on by default without asking clients to fetch a token. **Migration note** (call out in docs/CHANGELOG): callers who deliberately ran with `csrf: false` are unaffected; callers who relied on cookie-auth mutations *without* a token now need `origin` configured (the strategy should throw a helpful error if `"origin"` is the mode and `origin` is unset). Because the library is pre-1.0, changing the default is acceptable as a deliberate hardening.
