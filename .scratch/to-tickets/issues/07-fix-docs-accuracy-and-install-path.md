# 07: Fix documentation accuracy — README structure tree and standard install path

## Source

Prioritized DX review — H5 (stale README structure) + M3 (Nub-only install docs) + ADR status drift.

## What to build

The public and internal docs must give an accurate map of the repo and a path to install for any package consumer.

Concrete inaccuracies found:

- **README `Project structure` (`README.md:127–145`) is stale:** it lists `examples/example/` but the dir is `examples/basic/`; it lists `blog/store.ts` but `store.ts` was replaced by `db.ts` + `schema.ts`; it credits `openapi.ts — ... createRoute ...` but there is no `createRoute` (it is `openapi()`); it omits `src/paths.ts` (ADR-010 single source), `examples/auth/`, and `blog/spec.snapshot.json`.
- **Install is Nub-only (`README.md:26–40`):** the package is a normal npm package (`main`, `exports`, peerDeps `arktype`/`hono`) but the only documented install is `nub add peta-hono`. There is no `npm/pnpm/bun install peta-hono hono arktype` path, and no note that `nub` is only needed for the repo's own examples.
- **Internal doc drift:** `docs/domain-model.md` §3 and `docs/adr/README.md` list ADR-010 as **Proposed**, but ADR-010's own status is "Accepted — implemented" and `src/paths.ts` exists. The domain-model "value objects" sketch shows `src/errors.ts`/`src/validation.ts`/`src/registry.ts` as if present; they are proposed.

## Acceptance criteria

- [ ] README `Project structure` reflects the real tree: `examples/basic/`, `examples/blog/` (`db.ts` + `schema.ts`, no `store.ts`), `examples/auth/`, and `src/paths.ts`; `createRoute` corrected to `openapi()`.
- [ ] README "Install" documents a standard `npm i peta-hono hono arktype` (and pnpm/bun) path, notes peer deps, and clarifies `nub` is only for the repo examples.
- [ ] The `errors`/`validation`/`registry` sketch in `docs/domain-model.md` is clearly marked proposed/not-yet-existing, and the ADR-010 status is corrected to "Accepted — implemented" in both `docs/domain-model.md` and `docs/adr/README.md`.
- [ ] Docs-tree accuracy is verified by a `grep`-style check (no `store.ts`/`createRoute`/`examples/example/` references remain).

## Blocked by

None (docs-only; can start immediately).
