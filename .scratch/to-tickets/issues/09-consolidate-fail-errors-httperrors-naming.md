# 09: Consolidate the `fail` / `errors` / `httpErrors` error-helper naming

## Source

Prioritized DX review — M2 (three aliases for one helper).

## What to build

The public error helpers must have one canonical name so a new user knows what to reach for.

Today `src/api.ts:70–80` exports three names for the identical object, all re-exported at the barrel (`src/index.ts`):
- `fail` — the primary (`throw fail.notFound()`)
- `errors` — "noun form" (`throw errors.notFound()`)
- `httpErrors` — "explicit HTTP error helpers"

Three entry points for one helper hurt discoverability and add API surface. This is a naming decision, not a behavior change.

## Acceptance criteria

- [ ] A single canonical name is chosen and made primary (recommended: keep `fail`, the verb form used throughout examples/README).
- [ ] The redundant alias is either removed or clearly documented as a pure synonym, and the glossary/README/ADR use one consistent name.
- [ ] README "How it works" lists one helper (`fail`) and notes any remaining alias as a synonym (not three parallel "features").
- [ ] Removing/renaming does not break the public barrel (`src/index.ts`) — keep `fail` exported; only the redundant alias is addressed.
- [ ] `nub run typecheck` and `nub run check:all` pass.

## Blocked by

None (decision + docs/API surface; can start immediately).
