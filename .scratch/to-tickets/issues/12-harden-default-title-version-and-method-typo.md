# 12: Harden default title/version and method-typo runtime throw (low-risk papercuts)

## Source

Prioritized DX review — low-severity papercuts (`version`/`title` defaults, `Method`-typo runtime throw, `:param{regex}` docs).

## What to build

A batch of small, low-risk ergonomic fixes that reduce surprise without a big API change.

Items:

- **`version` defaults to `"1.0.0"`** (`src/api.ts:370`) and **`title` to `"API"`** (`:369`). For a pre-1.0 library the generated spec prints a confidently-wrong `info.version` unless the user overrides it. Consider defaulting `version` to `"0.0.0"` (or the package's own version) and `title` to a clearer placeholder.
- **`method` typed as `HttpMethod | Lowercase<HttpMethod> | (string & {})`** (README + `src/paths.ts`): `method:"GETT"` passes typecheck then throws at runtime via `normalizeMethod` ("Unsupported method"). The `(string & {})` fallback is for extensibility, but a typo survives the compiler and only fails at runtime. Note the tradeoff in README.
- **`:id{[0-9]+}` regex is not enforced by the ArkType param validator** — it is typed/validated as `string`. Hono's router enforces the regex during matching (non-match → 404, not 400), so behavior is fine, but the pattern gives a false impression in docs that the validator constrains format. Add a note.

## Acceptance criteria

- [ ] `createApi({title})` without `version` no longer emits a misleading `1.0.0` (a clearer default is chosen and documented).
- [ ] README documents that `method`'s `(string & {})` escape hatch means a typo passes typecheck and throws at runtime, and that `normalizeMethod` is the enforcement point.
- [ ] README notes that `:param{regex}` format is enforced by Hono's router (matching → 404 on mismatch), not by the ArkType schema, which types/validates it as `string`.
- [ ] `nub run typecheck` and `nub run check:all` pass; `examples/blog/spec.snapshot.json` regenerated if the default `info.version` changes affect it.

## Blocked by

None (can start immediately).
