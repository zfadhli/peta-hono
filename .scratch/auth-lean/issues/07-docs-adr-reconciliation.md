# 07: Docs + ADR reconciliation for the lean, `jose`+`@noble/hashes` auth

**Source:** repo convention — ADR-012, `docs/glossary.md`, `docs/domain-model.md`, `README.md`, `CHANGELOG.md`, `AGENTS.md`.

## What to build

Make the docs and the ADRs describe the *lean, two-dependency* auth contract after tickets 01–06 land. No behavior change — words only. This is where the dependency decisions and the "caller owns credentials" boundary get recorded, including the arctic/oslo deprecation context.

Concretely:
- **`docs/adr/013-adopt-jose-for-jwt.md`** — reverses ADR-012's "reject jose, keep tree light": first runtime dependency for the JWT layer; why (delete hand-rolled JWS, get alg-pinning/RS256/EdDSA/JWKS/rotation for free, audited code); portability (Node ≥18/Bun/Deno/edge via Web Crypto); boundary (`jose` doesn't do cookies/CSRF/sessions/passwords).
- **`docs/adr/014-adopt-noble-hashes-for-crypto-and-password.md`** — records the `@noble/hashes` adoption for the shared crypto primitives (HMAC/SHA-256/random bytes) and the opt-in `peta-hono/password` scrypt helper, including the **Node floor** (v2 is ESM-only, Node ≥ 20.19 vs the current Web-Crypto Node ≥ 18) and the **scrypt-vs-argon2id** decision (scrypt default; argon2id ~5× slower in JS).
- Update `docs/glossary.md` / `docs/domain-model.md` for the new surface: `csrf: "origin" | "double-submit"`, cookie `Secure`/host-prefix defaults, JWT `keys`/`jwks`/`algorithms`/`refreshTransport`, and the `peta-hono/password` entry.
- Update `README.md` "How it works" + the auth bullet: the two runtime deps, the lean defaults, the migration note (dev-over-http `secure` opt-out; `origin` required when `csrf: "origin"`), and that **arctic/oslo are deprecated** (so the hand-rolled OAuth strategy is deliberate).
- Add a `CHANGELOG.md` `[Unreleased]` entry summarizing the JWT swap to `jose` + crypto consolidation to `@noble/hashes` + the opt-in password helper + the default changes, with migration notes and the Node floor bump.
- Update `AGENTS.md` commands/structure/key-patterns for any new re-exported types/subpath.

## Blocked by

01, 02, 03, 04, 05, 06 (the behavior tickets whose contract this documents).

## Status

ready-for-agent

## Acceptance criteria

- [ ] ADR-013 and ADR-014 match the shipped code exactly; no stale "HS256-only / no RS256/JWKS", "opt-in CSRF is off by default", or "password hashing is out of scope" phrasing remains.
- [ ] `docs/glossary.md` / `docs/domain-model.md` have no stale `AuthScheme`-vs-`SecurityScheme` reads and describe the new defaults/options.
- [ ] `README.md` + `examples/strategies` show the lean usage (CSRF origin, `secure`/`hostPrefix`, JWT `keys`/`refreshTransport`, OAuth PKCE default, `peta-hono/password`) and the dev-over-http caveat; the arctic/oslo deprecation note is present.
- [ ] `CHANGELOG.md` `[Unreleased]` documents the two dependency decisions, default changes, the Node floor, and migration notes; `AGENTS.md` reflects new exports.
- [ ] `nub run typecheck`, `nub run lint`, and `nub run check:all` pass. No version bump / no `dist/` build / no commit.

## Notes

Docs ticket only. Rate limiting and the user/registration model remain documented as the caller's responsibility (not implemented). If a doc statement disagrees with what tickets 01–06 implemented, fix the docs, not the code; if the code drifted from the ADR, open a correction note rather than silently "fixing" the docs to match incorrect behavior.
