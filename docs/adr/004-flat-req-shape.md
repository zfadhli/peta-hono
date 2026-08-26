# ADR 004 — Flat req shape (Encore-style) + c escape hatch

**Date:** 2026-06-25
**Status:** Accepted

## Context

Hono exposes `c.req.param`, `c.req.query`, `c.req.valid("json")`, `c.var`, `c.env`. Desired handler ergonomics: `async ({name, body, query, auth}) => ...` with path params flat, fully typed via `ParamsFromPath`, `ArkInfer`. Must still support `session.save()`/`destroy()` via Hono `Context`.

## Decision

- Type: `ReqFor<P,B,Q,H,E> = ParamsFromPath<P> & {body?:B}&{query?:Q}&{headers?:H}&{c:Context<E>} & AuthField<Auth>` + `ParamRecord` handling `:id?` → `string | undefined`.
- Runtime `req: Record<string,unknown>` built as `Object.assign(req, valid("param"))` when `paramTokens.length>0`, then `req.body/query/headers` if declared, `req.auth` if `c.get("auth")!==undefined`, always `req.c = c`.
- Handler return `plain object → c.json(result, status)`; `null → c.body(null,status)` for 204; `Response` passthrough.
- `createApi<Auth,Env>` second generic types `req.c` (`Context<Env>`) and `auth` middleware `(c:Context<Env>)=>Auth`.

## Alternatives

- Nested `{params:{name}}` — mirrors Hono but worse ergonomics, requires `c.req.param` digging.
- No `req.c` — blocks `session.save()` (auth example needs `c.var.session`).
- `c`-only callback — loses inference for `body/query/headers`.

## Consequences

- **Migration:** Changing shape is breaking; no alias — `ParamsFromPath` is source of truth, keep its regex in sync with runtime `paramTokens` parsing.
- **Testing:** `basic/selfcheck` asserts `({name})` destructuring; typecheck negative cases for `Auth` presence.
- **Concurrency:** None.
- **Docs:** README flat-shape table, `Env` generic snippet (`createApi<{user},{Variables:{session}}>` → `c.var.session` typed).
- **Ceiling (grilling Q5):** Namespace collision if param named `body`/`query`/`headers`/`auth`/`c` — add registration-time guard `if paramTokens ∩ reserved → throw`. Reserve list documented here.

## References

- `src/api.ts` — `ParamRecord`, `ParamsFromPath`, `ReqFor`, `AuthField`, `createApi<Auth,Env>`
- `src/openapi.ts` — `openapi()` req flattening
- `examples/auth/routes.ts` — `c.var.session` usage

