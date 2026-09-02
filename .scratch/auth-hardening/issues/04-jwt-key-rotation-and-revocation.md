# 04: JWT key rotation, access-token revocation, and refresh-token cookie transport

**Source:** auth.pilcrowonpaper.com — JWT limits (P7 short TTL / rotation / asymmetric, P8 revocation) + P4 cookie transport.

## What to build

Close the JWT strategy's three real gaps without changing its task-1 behaviour:
1. **Key rotation / `kid` identification** — today there is a single symmetric `secret` with no `kid`, so rotating a key invalidates all outstanding access tokens at once.
2. **Access-token revocation** — access tokens are stateless and cannot be revoked before `exp`; add an *optional* `jti` blocklist hook.
3. **Refresh-token cookie transport** — `issue`/`refresh` return raw tokens and rely on the caller to transport them; provide a safe HttpOnly-cookie transport (default off) so the refresh token does not end up in `localStorage`/an Authorization header.

Concretely, `src/auth/jwt.ts`:
- Add `keys?: { kid: string; secret: string }[]` (default `[{ kid: "k1", secret }]`). Sign with the current (last) key and embed `kid` in the header; verify selects the key by the token's `kid` and **rejects** an unknown/missing `kid` and any `alg` other than `HS256` (pins the algorithm).
- Add `revokeAccess?: (jti: string, sub: string) => Promise<void>` — called at issue and consulted during verification via a passed-in `isAccessRevoked?(jti, sub)` predicate; optional so stateless callers are unaffected.
- Add `refreshTransport?: { cookie: { name, path?, hostPrefix?, secure?, sameSite? } }` — when set, `issue`/`refresh` also set the refresh cookie on the response (and `revoke` clears it), using the shared `CookieTransport` from ticket 01.
- Keep `issue`/`refresh`/`revoke`/`verifyAccess`/`middleware` signatures; the new options are additive with back-compatible defaults.

## Blocked by

01 (cookie transport + attribute hardening).

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` / `nub run lint` pass.
- [ ] A token signed with a retired `kid` that is no longer in `keys` fails verification; a token signed with a current `kid` verifies. A token whose header `alg` is not `HS256` is rejected.
- [ ] With `revokeAccess`, a revoked `jti` is rejected by `verifyAccess`/`middleware`; without it, behaviour is unchanged.
- [ ] With `refreshTransport`, `issue`/`refresh` set an HttpOnly refresh cookie and `revoke` clears it (round-trip via the shared transport); without it, tokens are still returned in the body as today.
- [ ] `src/auth.selfcheck.ts` gains rotation (`kid`) + alg-pin + optional revocation + refresh-cookie transport tests — passes.
- [ ] `examples/strategies` pass unchanged.

## Notes

HS256-only remains the documented ceiling (no RS256/EdDSA/JWKS yet) — this ticket adds rotation and revocation affordances, not a new algorithm. `refreshTransport` default stays off so existing callers are not forced into a new cookie; enabling it is the recommended path and is what makes it safe to ship a refresh token to a browser (P9).
