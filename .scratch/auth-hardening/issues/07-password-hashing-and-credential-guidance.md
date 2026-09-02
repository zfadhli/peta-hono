# 07: Password-hashing + credential guidance (scope decision)

**Source:** auth.pilcrowonpaper.com — P10 (argon2id/scrypt for passwords, hashed reset/verification tokens, rate limiting, no account-enumeration).

## What to build

Decide and implement how `peta-hono` should treat **password hashing / credential storage**, which the strategies currently do not cover at all. The library is deliberately dependency-free (Web Crypto only), so the honest options are limited. This ticket is a **decision first**, then the minimal code/docs that follow from it.

Options under consideration (to be settled before writing code):
- **A. Document-only.** Add a `docs/` guide + README + glossary section (plus `ponytail:` notes in the strategies) recommending argon2id/scrypt and a credentials table, with a reference example — no new code, zero-dep preserved.
- **B. Opt-in peer dependency.** Add an optional `peta-hono/password` entry point that wraps `@node-rs/argon2` (or similar) behind a tiny interface (`hashPassword`/`verifyPassword`) exported only when the peer dep is installed; the core stays dependency-free.
- **C. Web-Crypto-only scheme.** Document that argon2id is *not* available in Web Crypto and show a pure-Web-Crypto password-hashing fallback is insecure — so this option should be rejected.

Also cover, as guidance only (not implemented in the strategies): hashing password-reset/verification tokens, single-use + short-TTL email codes, login rate limiting, and consistent error messages to avoid account enumeration.

## Blocked by

None (can start immediately). It feeds the docs ticket 08 only if adopted.

## Status

ready-for-agent

## Acceptance criteria

- [ ] The decision (A, B, or C) is recorded in `docs/adr/013-*.md` (or a follow-on) with the dependency trade-off made explicit.
- [ ] If A: docs + README + glossary describe the recommended credential model and the strategies' `ponytail:` notes reference it; no runtime dependency added; `nub run typecheck` / `nub run lint` pass.
- [ ] If B: a `peta-hono/password` entry compiles (`tsc`), has a selfcheck covering hash/verify + wrong-password + constant-time behavior, and the main barrel/`src/auth` stays dependency-free; `nub run check:all` passes.
- [ ] Whichever option lands, the README/CHANGELOG note the boundary: `peta-hono` ships auth *transport* (session/JWT/OAuth), and credential *storage* is the caller's responsibility, with a recommended default.
- [ ] No version bump / no `dist/` build / no commit (release is a separate step).

## Notes

This is the coverage gap Pilcrow weights most heavily, and it is the one most in tension with the repo's zero-dep ceiling. Treating it as an explicit scope decision — and writing an ADR either way — is the point of the ticket. If the maintainers want the library to remain purely transport-level, option A with strong docs is the correct outcome; do not silently land a dependency.
