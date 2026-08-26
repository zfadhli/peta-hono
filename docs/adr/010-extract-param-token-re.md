# ADR 010 — Extract `PARAM_TOKEN_RE` and share param parsing

**Date:** 2026-08-26
**Status:** Accepted — implemented 2026-08-26 (src/paths.ts)

## Context

Two modules parse Hono path tokens independently with the same literal:

```ts
// src/openapi.ts:409 and src/api.ts:193 — identical
[...path.matchAll(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)?/g)].map(m=>({name:m[1]!, optional:!!m[2]}))
```

A third site uses the same shape without `?` capture for heuristic checks:

```ts
// src/openapi.ts:452, 468 — :param presence / 404 heuristic
/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/.test(path)
config.path.match(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/)
```

`api.ts` builds `request.params` ArkType from tokens; `openapi.ts` auto-generates a validator and flattens `req` with the same tokens plus enforces `path.startsWith("/")`. `toOapiPath` uses a sibling regex `/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/g → "{$1}"` + `* → {wildcard}`. Type-level `ParamsFromPath` / `ParamRecord` mirrors the same `?:name{regex}?` grammar at the type level.

Smell: **duplicated param token regex** — divergent change risk. If Hono adds a token shape or we tighten `[a-zA-Z0-9_]` (e.g., allow `-`), one site drifts and `ParamsFromPath<P>` (type) and runtime `paramTokens` (value) desync → handler `ReqFor` lies about `req.id` optionality.

## Decision

Create `src/paths.ts` as the single source for path grammar (pure, no deps):

```ts
// src/paths.ts
export const SUPPORTED_METHODS = ["GET","POST","PUT","PATCH","DELETE"] as const;
export const PARAM_TOKEN_RE = /:([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)?/g;
export const PARAM_HAS_RE  = /:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/; // non-global for .test
export type ParamToken = { name: string; optional: boolean };

export function parseParamTokens(path: string): ParamToken[] {
  return [...path.matchAll(PARAM_TOKEN_RE)].map(m => ({ name: m[1]!, optional: !!m[2] }));
}
export function hasParamTokens(path: string): boolean { return PARAM_HAS_RE.test(path); }
export function normalizeMethod(m: string): string; // already exists — move here
export function toOapiPath(path: string): string;   // ":x{regex}? → {x}", "* → {wildcard}"
```

Changes:

- `src/api.ts`: `import { parseParamTokens, hasParamTokens } from "./paths.js"` — delete inline `matchAll` regex; `request.params` now via `parseParamTokens(config.path)`.
- `src/openapi.ts`: same import for `paramTokens`, `hasParamTokens` (replace both heuristic regexes), `toOapiPath`, `normalizeMethod`; re-export `normalizeMethod`/`toOapiPath` for barrel stability.
- `src/index.ts`: no change (barrel re-exports unchanged).
- Keep `ParamsFromPath`/`ParamRecord` in `src/api.ts` but add comment `// keep in sync with PARAM_TOKEN_RE — see ADR-010`.
- Future: consider deriving `ParamsFromPath` from `ParamToken` via type-level parse, or lint rule that `PARAM_TOKEN_RE` is the only `:[a-z` literal.

Non-goals: do not change grammar, do not relax `*` handling, do not touch coercion.

## Alternatives

- **Leave duplicated** — cheapest now, but already flagged as smell; any param grammar tweak requires two edits + spec snapshot diff review.
- **Extract only the constant `PARAM_TOKEN_RE` into `src/openapi.ts` and import from `api.ts`** — creates `api → openapi` dep for a constant; `openapi.ts` is the wrong owner (paths are cross-cutting). `paths.ts` keeps deps acyclic (`api` and `openapi` both → `paths`).
- **Merge param parsing into `src/validation.ts`** — conflates routing grammar with coercion; `paths` is more cohesive.
- **Full `src/paths.ts` + type-level `ParsePath<P>` rewrite** — heavier; type-level parser already works, defer until desync bug proves need.

## Consequences

- **Migration:** Additive + internal. No public API change. `paths.ts` is new; imports use `.js` extension (Nub `bundler` resolves to `.ts`). `dist/` adds `paths.js` + `paths.d.ts` — included via `tsc -p tsconfig.build.json` (no `exports` change needed).
- **Testing:** Existing selfchecks cover param paths (`/hello/:name`, `/posts/:id`, `/:postId/comments/:commentId`, `/*` → `/{wildcard}`); add one unit assertion: `parseParamTokens("/a/:id/:name?/:slug{[0-9]+}?")` → `[{id,false},{name,true},{slug,true}]` and `toOapiPath` round-trip. Golden `spec.snapshot.json` unchanged (regression guard).
- **Concurrency/docs:** None. Document `PARAM_TOKEN_RE` in `docs/glossary.md` ParamToken entry; cross-ref `AGENTS.md` Key patterns route-order note.
- **Follow-up:** If `hasParamTokens` heuristic for 404 auto-doc needs tuning (ADR-007), only `paths.ts` changes.

## References

- `src/openapi.ts:409, 452, 468` — duplicated regex sites
- `src/api.ts:193` — duplicated `matchAll`
- `src/openapi.ts:183` — `toOapiPath`
- `docs/glossary.md` — ParamToken / OapiPath

