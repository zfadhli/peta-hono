# 01: Add `jose`; replace hand-rolled JWT sign/verify

**Source:** ADR-012 reverse-decision — the library adopts its first runtime dependency for the JWT layer, replacing hand-rolled JWS.

## What to build

Add `jose` as a runtime dependency (`nub install jose`) and swap `src/auth/jwt.ts`'s homegrown HS256 `signAccessToken`/`verifyAccessToken` for `jose`'s `SignJWT` / `jwtVerify`. This removes the most security-critical, hardest-to-audit custom code (manual base64url header/payload + HMAC + constant-time verify) and replaces it with audited code, while keeping the existing HS256 behavior and token format.

Concretely, `src/auth/jwt.ts`:
- `issue()` signs with `new SignJWT({ sub, ...claims }).setProtectedHeader({ alg, kid }).setIssuedAt().setExpirationTime().setIssuer()/setAudience()/setJti().sign(secret)`.
- `verifyAccess()`/`middleware()` verify with `jwtVerify(token, key, { algorithms, issuer, audience })` — `algorithms` pins the alg (default `["HS256"]`), so a token with an unexpected `alg` is rejected.
- Keep `issue`/`refresh`/`revoke`/`verifyAccess`/`middleware` signatures and the opaque, hashed, rotated refresh-token store unchanged.
- Back-compat: existing HS256 tokens are standard compact JWS, so `jwtVerify` reads them; no session/rotation break.

## Blocked by

None (can start immediately).

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub install jose` succeeds; `nub run typecheck` and `nub run lint` pass.
- [ ] The access token is a valid compact JWS that `jwtVerify` accepts; `issue` → guarded route works end-to-end (mirrors the current `src/auth.selfcheck.ts` JWT block).
- [ ] A token signed with a different `alg` than the pinned `algorithms` array is rejected (alg-confusion closed).
- [ ] The JWT-specific hand-rolled helpers (JWS base64url/HMAC construction in `crypto.ts`) are removed; `crypto.ts` is slimmed to the session/oauth helpers only.
- [ ] `nub run check:all` passes; `examples/strategies` pass.

## Notes

This is the dependency decision, so the ADR must be written here (or in ticket 07): reversing ADR-012's "reject jose, keep tree light," documenting the first-runtime-dep trade and the Node ≥18 / Bun / Deno / edge portability. `jose` uses Web Crypto, so runtime support is unchanged.
