# 02: Rebuild and gate the stale `dist/` artifact before the next release (blast-radius R2)

## Source

Blast-radius review — R2 (stale `dist/`, release-gating).

## Status

**PENDING — release-gating / verification only.** Explicitly do NOT bump the
package version, commit, push, tag, or publish now. Execute this only as the
release step, once a release is approved.

## What to build

Source changed (new `src/auth/` module, widened `SecurityScheme`, new barrel
re-exports) but `dist/` is still the v0.5.4 build, so the published package would
ship stale code. Concretely, `dist/` today:
- `dist/openapi.d.ts` still has `registerSecurityScheme(name, scheme: AuthScheme)`
  (source now uses the wide `SecurityScheme`).
- `dist/index.*` has no `createMemorySessionStore` / `createMemoryRefreshTokenStore`
  / `SecurityScheme` — the `src/auth` re-exports are absent.

The gate already exists but is not run against an up-to-date `dist/`.

Relevant config:
- `package.json` — `version: "0.5.4"`; `main`/`types`/`exports` → `dist/`;
  `"build"` = `tsc -p tsconfig.build.json`; `"check:dist"` =
  `nub run build && STALE=$(git status --porcelain -- dist/) && if [ -n "$STALE" ]; then echo 'dist/ is stale — run nub run build and commit dist/:'; exit 1; fi`;
  `"prepublishOnly"` = `nub run check:dist`.
- `tsconfig.build.json` — `NodeNext`, preserves ESM `.js` imports for the published
  artifact; `src/**/*.selfcheck.ts` excluded from the build.

## Acceptance criteria

- [ ] `nub run build` regenerates `dist/` from source, producing the `src/auth/`
      outputs and the widened `SecurityScheme` + new re-exports (`createMemorySessionStore`,
      `createMemoryRefreshTokenStore`, types `SecurityScheme`/`OAuth2Flows`/strategy
      types + store creators). Verify `src/auth/` files appear under `dist/`.
- [ ] `nub run check:dist` passes — a clean build produces NO diff in `dist/`
      (`git status --porcelain -- dist/` empty), so `npm publish` cannot ship a
      drifted artifact. Against the *current* source this fails until `nub run build`
      is run and `dist/` committed.
- [ ] Published-artifact imports resolve for the new exports. From a consumer install
      (or `npm pack` + install / `npm link`):
      `node -e "import('peta-hono').then(m => console.log(typeof m.createMemorySessionStore))"`
      prints `function`, and `m.createMemoryRefreshTokenStore` + the `SecurityScheme`
      type export are present. In-repo there is no self-link in `node_modules`, so
      the equivalent local check is
      `node -e "import('./dist/index.js').then(m => console.log(typeof m.createMemorySessionStore))"`.
- [ ] `nub run typecheck`, `nub run lint`, and `nub run check:all` pass against the
      rebuilt types (no source/declaration drift).
- [ ] The only artifact change is `dist/`. Do NOT change `package.json` version,
      commit, push, tag, or publish.

## Blocked by

None technical. Gated on release approval — see Status.

## Constraint

Keep this a build/verify ticket. The source is already correct — the only deliverable
is a fresh, committed, gate-passing `dist/`.
