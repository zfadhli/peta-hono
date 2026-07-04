# Handoff

## Goal

Auto-document 404 responses in OpenAPI spec for endpoints with path params. Ship v0.4.0 to npm.

## Session Info

- **Branch:** `master`
- **Project:** peta-hono
- **Saved:** 2026-07-04

## Changes

(working tree clean — no uncommitted changes)

## Files Touched

| File | Status | Done | Left |
|------|--------|------|------|
| `src/openapi.ts` | modified | Added 404 auto-injection in `_buildResponses` when `config.path` has `:param` tokens (closes #7) | None |
| `examples/blog/spec.snapshot.json` | modified | Regenerated — 404 now documented for all 6 endpoints with path params | None |
| `package.json` | modified | `0.3.0` → `0.4.0` | None |
| `CHANGELOG.md` | modified | Added `[0.4.0]` section | None |
| `HANDOFF.md` | modified | Updated for this session | None |

## Key Decisions

- **404 auto-injection: path `:param` heuristic (not auth):** Path params strongly imply resource lookup → potential 404. Auth is a weaker signal (ownership checks are handler logic, not structural). The `!responses["404"]` guard lets users suppress 404 by declaring an explicit one.
- **v0.4.0 (minor)**: Feature addition (changed generated spec) → minor bump.
- **Snake case `postId` / `commentId` preserved:** The blog spec uses `:postId` not `:id`. The 404 heuristic treats any `:param` the same — correct behavior.

## Dead Ends

(None — straightforward implementation.)

## Blockers

(None.)

## Next Steps

- [ ] v0.4.0 ready to publish (`nub ci && npm publish`).
- [ ] Remaining `ponytail:` comments in `openapi.ts` (lines 254, 289) — both are deliberate design constraints, not action items.
- [ ] Potential next features: `errors: [403, 404]` config field for explicit error-code docs without full schemas; response status override; route-level tags.

## Suggested Skills

- (No specific skills needed.)
