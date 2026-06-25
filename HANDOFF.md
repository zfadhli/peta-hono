# Handoff

## Goal

Fix issue #4 (validation errors bypass app.onError) and ship v0.2.2 to npm. Encode "always use nub" convention in AGENTS.md.

## Session Info

- **Branch:** `master`
- **Project:** peta-hono
- **Saved:** 2026-06-25 08:40

## Changes

(working tree clean — no uncommitted changes)

## Recent Commits

```
a0d05d7 Merge pull request #5 from zfadhli/release/v0.2.2
4b53e39 docs: encode 'always use nub, never npm/pnpm/bun' convention in AGENTS.md
f0eee07 fix: route validation errors through app.onError (closes #4)
819da04 ci: remove redundant push trigger from publish workflow, bump actions/checkout to v7
9efa4ca fix: regenerated lockfile to include peer dep arktype for nub ci
```

## Files Touched

| File | Status | Done | Left |
|------|--------|------|------|
| `src/openapi.ts` | modified | Moved `APIError` here from `api.ts`; validator now throws `APIError(400, summary)` instead of returning `Response`; `OpenAPIHono` constructor registers default `onError` | None |
| `src/api.ts` | modified | Removed `APIError` class def; imports + re-exports from `openapi.ts` | None |
| `src/openapi.selfcheck.ts` | modified | Added 5th assertion: validation errors reach custom `onError` (regression guard for #4) | None |
| `AGENTS.md` | modified | Added convention: always use nub, never npm/pnpm/bun; updated structure (APIError now in openapi.ts, default onError on OpenAPIHono); updated key patterns (all errors route through onError) | None |
| `CHANGELOG.md` | modified | Added `[0.2.2]` entry | None |
| `package.json` | modified | `0.2.1` → `0.2.2` | None |
| `.github/workflows/publish.yml` | modified | Removed push trigger (release trigger is canonical); bumped `actions/checkout@v4` → `@v7` | None |
| `.github/workflows/ci.yml` | modified | Bumped `actions/checkout@v4` → `@v7` | None |

## Key Decisions

- **APIError moved to openapi.ts to fix circular dep**: validator needs to throw APIError, but api.ts already imports from openapi.ts. Moving APIError to the lower layer (openapi.ts) and having api.ts re-export it breaks the cycle cleanly. `fail` helpers stay in api.ts.
- **Default onError on OpenAPIHono**: needed so standalone use (raw `new OpenAPIHono()` without `createApi`) still emits 400s for validation errors. `createApi()` overrides it with its own policy (verified: `app.onError()` called twice → second wins).
- **v0.2.2 (patch) over minor**: issue #4 framed as a bug (validation should route through onError), response shape unchanged. SemVer: fix → patch.
- **Push trigger removed from publish.yml**: always raced the release trigger and failed (403 — version already published). CI workflow already covers branch-push validation.
- **`actions/checkout@v4` → `@v7`**: resolved Node 20 deprecation warning on GHA runners.

## Dead Ends

- **Circular import on issue's literal proposal**: `throw fail.badRequest(...)` in openapi.ts would require importing from api.ts → cycle. Fixed by moving APIError to openapi.ts instead.
- **Duck-typing error status**: considered having the validator throw a plain Error with `.status` and making onError check `typeof err.status === 'number'`. Rejected: implicit convention, less type-safe, could mask real bugs.

## Blockers

(None.)

## Next Steps

- [ ] Monitor v0.2.2 publish workflow: after release trigger fires, check npm for `peta-hono@0.2.2`
- [ ] The publish workflow's release trigger runs `nub ci` → `nub run typecheck` → `nub run check:all` → `npm publish`. If it fails, investigate `nub ci` lockfile issues (previous pattern).
- [ ] Consider prototyping the `debug` option in `createApi()` mentioned in the `ponytail:` comment on line 111 of `src/api.ts` — sends full error details in dev mode.

## Suggested Skills

- (No specific skills needed for next session.)
