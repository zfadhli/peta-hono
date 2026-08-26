# ADR 001 — Hono + ArkType as the stack

**Date:** 2026-06-23 (updated 2026-08-26)
**Status:** Accepted

## Context

Need a runtime-agnostic HTTP layer (Node / Bun / Deno / Cloudflare Workers) with typed validation and OpenAPI derivation that preserves `minimum`/`maximum`/`type: integer` constraints. `hono@^4.7` already ships in examples via `serve`; `arktype@^2.2` provides `type({})` DSL (`"1 <= number.integer <= 100"`) plus `toJsonSchema()` as single source for both validation and spec — no second schema declaration.

Hardening required Web Crypto portability (`node:crypto` → `crypto.subtle`), strict `noUncheckedIndexedAccess`, and `nub` toolchain.

## Decision

Choose `hono` as base (`OpenAPIHono extends Hono`) + `arktype` as peer dep (`Type<any,any>`). ArkType's `toJsonSchema()` drives both `arktypeValidator` and `_buildSpec`/`_schemaToOA`. Support `strict` + `noUncheckedIndexedAccess` across `src/` + `examples/`.

Pin peers `hono@^4.7`, `arktype@^2.2`, install via `nub add peta-hono hono arktype`. No adapter layer.

## Alternatives

- **Hono + Zod (+ zod-openapi / hono-openapi):** 10× ecosystem, better error messages, but string DSL not native and `zod-to-openapi` is external; coercion would need separate config.
- **Elysia:** Bun-only, loses Workers/Node portability.
- **tRPC:** No REST/OpenAPI, wrong abstraction for docs-first API.
- **Adapter `Validator<T> => {parse, toJsonSchema}`:** Would support Zod+ArkType but doubles type inference complexity and spec fidelity risk; rejected for scope.

## Consequences

- **Migration:** Swaps require rewriting all `type({})` schemas and `coerceDeep` walk (ADR 008). `pnpm-lock.yaml` must include `arktype` sub-deps (`@ark/schema` etc.) — 0.2.1 already regenerated after `nub ci` frozen failure.
- **Testing:** `src/openapi.selfcheck.ts` asserts `minimum/maximum/type: integer` retained in spec; query coercion cases (Issue 03).
- **Concurrency:** Stateless, no locks.
- **Docs:** README `peerDependencies`, `nub` quickstart, ArkType DSL examples (`"string >= 1"`), `allowBuilds` for `lefthook`.
- **Ceiling:** If Hono removes `c.req.valid()` generics or ArkType changes `toJsonSchema` shape, vendor `OpenAPIHono` must be patched (ADR 002 justifies ownership).

## References

- `src/api.ts` — `AnyArkType`, `ArkInfer`, `ReqFor`
- `src/openapi.ts` — `ArkType`, `arktypeValidator`, `coerceDeep`, `sha1Hex`
- `AGENTS.md` Stack — Nub + Hono + ArkType
