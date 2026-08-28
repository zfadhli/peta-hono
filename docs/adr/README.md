# ADRs — peta-hono

| # | Title | Date | Status |
|---|-------|------|--------|
| 001 | Hono + ArkType as the stack | 2026-06-23 | Accepted |
| 002 | In-repo OpenAPIHono (own the spec emitter) | 2026-06-23 | Accepted |
| 003 | Side-effect registration & setup.ts singleton | 2026-06-25 | Accepted |
| 004 | Flat req shape (Encore-style) + c escape hatch | 2026-06-25 | Accepted |
| 005 | Throwing validator + single onError chokepoint | 2026-06-25 | Accepted |
| 006 | Stable content-hash component names + $defs hoisting | 2026-08-26 | Accepted |
| 007 | Framework errors 400/401/404/500 + ponytail 404 | 2026-08-26 | Accepted |
| 008 | Deep query/header coercion before validation | 2026-08-26 | Accepted |
| 009 | Method shorthands, Method typing, operationId/deprecated, Env generic (v0.5.0) | 2026-08-26 | Accepted |
| 010 | Extract `PARAM_TOKEN_RE` and share param parsing | 2026-08-26 | Accepted — implemented |
| 011 | Split `src/openapi.ts` by responsibility (deferred incremental) | 2026-08-26 | Proposed |
| 012 | Built-in auth strategies (session / JWT / Google OAuth) | 2026-08-27 | Accepted — implemented |

Glossary: [`../glossary.md`](../glossary.md)
Domain model: [`../domain-model.md`](../domain-model.md) (canonical) · [`../../.scratch/grill-with-docs/domain-model.md`](../../.scratch/grill-with-docs/domain-model.md) (grill archive)
Grilling report: see `git log --grep=grill` and `.scratch/grill-with-docs/` — 24 sharp questions, perf/spec-vs-runtime gaps, `Env`/`docs()`/`operationId` ceilings documented in ADR 009.
