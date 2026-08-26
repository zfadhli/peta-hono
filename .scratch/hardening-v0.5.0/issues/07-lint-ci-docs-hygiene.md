# 07: Lint/CI/docs hygiene

**What to build:** Tooling, CI, and docs are consistent across source and examples so style drift, missing coverage, and misconfigured workspace settings are caught mechanically and the `setup.ts` singleton plus `docs()` mount remain a documented, protectable pattern.

**Blocked by:** 01: Rebuild and gate the published artifact

**Status:** done (verified 2026-08-26, committed pending)

- [x] `biome` and `lefthook` cover `src/` and `examples/` consistently (no `src/`-only lint that misses `auth`/`blog`/`basic` drift), `pnpm-workspace.yaml` `allowBuilds` is valid, and `tsconfig` module resolution for dev (`bundler`, `nub file.ts`) vs build (`NodeNext`, ESM `.js`) is reconciled or documented so `.js` extensions work in all runtimes
- [x] `check:all` runs `src/openapi` lib checks plus `basic`, `blog`, and `auth` example selfchecks so auth/session regressions (register → profile → logout → login cookie jar) cannot ship undetected; the existing `createAdaptorServer` + `fetch` + `assert` pattern is reused without introducing a test framework
- [x] `docs(specPath, uiPath)` mount order (call after route imports) and the `setup.ts` singleton pattern (create once, import `api` for side-effect registration) remain supported and route-import-order shadowing is documented; an auth-guarded docs recipe is documented for private APIs while the default unauthenticated `ponytail:` is preserved
- [x] Verified via `nub run lint` + `nub run typecheck` + `nub run check:all` all green on a clean checkout, plus `GET /docs` still 200s and contains the Scalar marker
