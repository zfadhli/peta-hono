# 05: JWT capability unlock (jose) + refresh-token cookie transport

**Source:** ADR-012 ceiling — HS256-only, no RS256/JWKS/rotation; and Pilcrow P4 — refresh token should travel in an HttpOnly cookie, not a base64red body.

## What to build

Two linked moves on the JWT strategy, both enabled by `jose` (ticket 01) and the cookie transport (ticket 03):

1. **Unlock asymmetric + JWKS + key rotation via `jose`** — `keys`/`kid`, `jwks`, and `algorithms` become opt-in config instead of hand-rolled crypto:
   - `keys?: { kid: string; secret: string }[]` (default `[{ kid: "k1", secret }]`) — sign with the current key and stamp `kid`; verify selects the key by the token's `kid` and rejects unknown/missing `kid`.
   - `jwks?: URL | { keys: JWK[] }` for `createRemoteJWKSet`/`createLocalJWKSet`, and accept a public `CryptoKey` for multi-service verification.
   - `algorithms?: string[]` (default `["HS256"]`) to pin the accepted algs (e.g. add `"RS256"` when an asymmetric key is used).
2. **Refresh-token cookie transport** — `refreshTransport?: { cookie: { name, path?, hostPrefix?, secure?, sameSite? } }`: when set, `issue`/`refresh` also set the HttpOnly refresh cookie on the response and `revoke` clears it, via the `CookieTransport` from ticket 03.

Keep `issue`/`refresh`/`revoke`/`verifyAccess`/`middleware` signatures; the opaque refresh rotation + family-revoke store is unchanged.

## Blocked by

01 (jose), 03 (cookie transport).

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` / `nub run lint` pass.
- [ ] With `keys`, a token signed by a still-present `kid` verifies; a token whose `kid` was removed, or has an unknown/missing `kid`, is rejected; a token whose `alg` is outside `algorithms` is rejected (alg-confusion closed).
- [ ] With an asymmetric key / JWKS, an RS256 (or EdDSA) token signs and verifies; the `algorithms` array is honored.
- [ ] With `refreshTransport`, `issue`/`refresh` set an HttpOnly refresh cookie and `revoke` clears it (round-trip via `CookieTransport`); without it, tokens are still returned in the body as today.
- [ ] Default single-`secret` callers see no behavior change (no `kid`; `algorithms: ["HS256"]`; no refresh cookie).
- [ ] `src/auth.selfcheck.ts` gains rotation (`kid`) + asymmetric/JWKS + alg-pin + refresh-cookie-transport tests; `examples/strategies` pass. `nub run check:all` green.

## Notes

Opt-in throughout — existing callers who only pass `secret` are unaffected. This is the payoff of adopting `jose`: rotation and asymmetric support are configuration, not a new crypto module. HS256 remains the sensible default; callers opting into a public-key scheme for multi-service verification add `keys`/`jwks`/`algorithms`. `refreshTransport` defaults off so existing callers aren't forced into a new cookie; enabling it is the recommended path and is what makes it safe to ship a refresh token to a browser.
