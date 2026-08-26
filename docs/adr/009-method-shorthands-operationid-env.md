# ADR 009 — Method shorthands, Method typing, operationId/deprecated, Env generic (v0.5.0)

**Date:** 2026-08-26
**Status:** Accepted

## Context

Classic `api({method:"GET", path:"/hello/:name"})` is verbose vs Hono's `app.get("/hello/:name", ...)`. Users wanted SDK-friendly `operationId` overrides and `deprecated` flag, typed `method` autocomplete, `docs()` options-object ergonomics, and typed `req.c` (`c.var`/`c.env` via Hono `Env`) without losing `Auth` generic. Optional `:id?` params should infer `string | undefined`.

## Decision

- **Shorthands:** `api.get/post/put/patch/delete/del(path, configWithoutMethodPath, handler)` via `makeMethodHelper(M)` delegating to `api({method: M, path, ...config}, handler)`. `api.delete` + alias `api.del` (Hono `del` compat). Classic form unchanged.
- **Method typing:** `SUPPORTED_METHODS=["GET","POST","PUT","PATCH","DELETE"]`, `type HttpMethod=typeof SUPPORTED_METHODS[number]`, `type Method = HttpMethod | Lowercase<HttpMethod> | (string & {})` (autocomplete for known, runtime `normalizeMethod` case-insensitive, throws `Unsupported method: ${m}. Use one of: ...`).
- **operationId/deprecated:** `RouteConfig {operationId?, deprecated?}`; `_buildSpec` uses `config.operationId ?? method_oapiPath` with same `Set+Map` dedup `_2` suffix for custom collisions; `deprecated` emits verbatim; no `^[a-z0-9_-]+$` validation — user responsibility.
- **docs() overload:** `docs(specPath?,uiPath?)` **and** `docs({specPath?,uiPath?})` — `specPathOrOpts:string|{specPath?,uiPath?}` defaults `/openapi.json`/`/docs`; both `app.doc` + `app.get(apiReference)`.
- **Env generic:** `createApi<Auth=undefined, E extends Env=Env>`; `ReqFor<...,E> {c:Context<E>}`, `auth(name,(c:Context<E>)=>Auth,scheme?)` → `c.set("auth",ctx)`; `Env`-aware `ReqFor` intersections preserve `c.var` typing (e.g., `peta-auth` `c.var.session`).
- **Optional params:** `ParamRecord` handles `:name{regex}?` → optional; `ParamsFromPath` recursive `&` yields `string | undefined`; runtime `paramTokens` regex captures `(\?)?`; `request.params = type({[name]: optional?"string?":"string"})` + `toOapiPath` drops `?` → `/{name}` (spec `required:false` via `string?` → `required` set, but OAPI path param `required:true` implied — divergence noted as spec `required:false` while path still `/{id}`).

## Alternatives

- Keep only classic `api({method})` — worse ergonomics.
- Keep only shorthands — breaking.
- Adapter for `Method` strict union only (`HttpMethod | Lowercase`) without `string & {}` — loses extensibility for custom methods (rejected; `string & {}` preserves autocomplete + runtime throw).
- `createApi<{auth,env}>` object generic — more explicit but positional `createApi<Auth,Env>` is shorter; chosen positional, documented.

## Consequences

- **Migration:** Non-breaking; examples migrated to shorthands + `operationId:"sayHello"` + `deprecated:true` + `docs({})`. Type inference for `api.get("/hello/:name", {auth:"required"}, ({name,auth})=>...)` fully works (Ab vs no-auth overloads).
- **Testing:** `nub run typecheck` passes; manual `app.request("/hello")` with `:name?` missing → 200 `{name:"world"}`; `operationId:"customOp"` + second `customOp` → `_2`; `deprecated:true` verbatim.
- **Docs:** README `api.get` quickstart, `Method` casing note, `createApi<Auth,Env>` snippet, `docs({})` form.
- **Gaps (grilling Q6–11):** `makeMethodHelper` uses `api as any` casts hiding overload launder; `ReturnType<typeof makeMethodHelper>` collapses two overloads → negative `api.get` with `auth` on `createApi<undefined>` not type-error (classic `api()` still errors). Future tighten: explicit overload types not `ReturnType`, or drop `string & {}` fallback. Optional path spec `required:false` with `/{id}` path is technically invalid OAPI 3.0 (`required` should be true) — options: emit two paths or keep `required:false` + doc note.

## References

- `src/api.ts` — `makeMethodHelper`, `RouteFields`, `ParamRecord`, `ReqFor`, `createApi<Auth,Env>`
- `src/openapi.ts` — `normalizeMethod`, `RouteConfig`, `_buildSpec` operationId dedup
- `README.md` Quickstart — shorthands, `Method`, `operationId`, `deprecated`

