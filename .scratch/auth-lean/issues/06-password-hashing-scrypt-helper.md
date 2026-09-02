# 06: Opt-in `peta-hono/password` scrypt helper (via @noble/hashes)

**Source:** auth.pilcrowonpaper.com P10 — password hashing is the one gap `jose` can't cover, and `@noble/hashes` makes it feasible while staying audited, zero-dependency, and portable.

## What to build

Promote password hashing from "documented-out-of-scope" to a real, **opt-in** feature so the library offers a safe credential primitive without forcing a dependency into the core.

Concretely, a new `src/password.ts` exposed as a **`peta-hono/password` subpath** (keeps the core thin):
- `hashPassword(password: string, { memoryCost?, timeCost?, ... }?): Promise<string>` — returns a self-describing hash (parameter-encoded, salt included), backed by `@noble/hashes` **`scrypt`** with sane work factors and a fresh random salt per call.
- `verifyPassword(hash: string, password: string): Promise<boolean>` — re-derives from the encoded parameters and constant-time-compares (same API as the argon2/scrypt convention).
- A per-call options override for the work factors, and a documented note that **scrypt is the default because `argon2id` is ~5× slower than native in pure JS** (`@noble/hashes` exposes `argon2id`, but scrypt is the recommended portable choice). The interface is shaped so argon2id could be swapped in later without changing call sites.
- A `ponytail:` note that this is credential *hashing only* — it does not manage users, passwords, or sessions (the strategies stay transport-level).

This is the natural enabler at the boundary described in the design doc: `peta-hono` ships auth transport (session/JWT/OAuth) *and now* a safe password primitive, but the user model/registration flow stays the caller's.

## Blocked by

02 (`@noble/hashes` is installed and consolidating the crypto layer).

## Status

ready-for-agent

## Acceptance criteria

- [ ] `nub run typecheck` / `nub run lint` pass; the barrel exports the subpath entry.
- [ ] `hashPassword`/`verifyPassword` round-trip (hash → verify true); wrong password → false; same password with different salts → different hashes.
- [ ] The hash string is parameter-encoded and re-derives on verify (no params lost); constant-time comparison (a `timingSafeEqual` path is exercised).
- [ ] `@noble/hashes` is a dependency only for this opt-in entry — the core barrel/`src/auth` stays dependency-light (it may already ship `@noble/hashes` via ticket 02, but the password entry is separate).
- [ ] A selfcheck block (in `src/password.selfcheck.ts` pulled into `check:all`, or added to `src/auth.selfcheck.ts`) covers hash/verify/wrong-password/salt-uniqueness.
- [ ] `nub run check:all` green; no version bump / no `dist/` build / no commit.

## Notes

This is the coverage gap Pilcrow weights most heavily. Deciding to *include* a hashing primitive (scrypt, recommended) is the change from the earlier plan that called this out-of-scope. The ADR (ticket 07) must record the scrypt-vs-argon2id decision and the work-factor defaults. If the maintainers want the library to remain purely transport-level, this ticket is the place to keep it as a documented pattern instead — but the interface above is the lean way to include it without a core-dep.
