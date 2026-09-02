# Spec — Type-safe method shorthands and controllable framework error responses

> Synthesized from current codebase + hardening gaps (c) 02 / 06, ADRs 007/009/010, glossary, and `src/api.ts` / `src/openapi.ts` as of 2026-08-26.
> Vocabulary: **ApiBuilder**, **ApiMethodHelper**, **RouteFields**, **RouteConfig**, **StoredRoute**, **ReqFor**, **ParamsFromPath**, **ParamToken**, **AuthField**, **ArktypeValidator**, **Coercion**, **ComponentRegistry**, **ErrorHandler**, **Ponytail**, **DocsMount**, **OapiPath**, **PARAM_TOKEN_RE** — per `docs/glossary.md`. Respects ADRs 001–011 (notably 007 framework errors, 009 shorthands, 010 single param regex).

---

## Seams (proposed — check with user)

Existing seams preferred; highest seam possible; fewer seams better (ideal = one). This feature touches **two orthogonal concerns** (type-level overloads + runtime/spec emission), so **two seams** is minimal — one per concern. No new seam required.

| # | Seam (highest possible) | What it proves | Prior art |
|---|--------------------------|----------------|-----------|
| **S1 — Type checker** | `nub run typecheck` (tsc `--noEmit` over `src/` + `examples/`) via **ApiBuilder** generic instantiation | `ApiMethodHelper<Auth,E>` preserves both overloads (`auth?:undefined` → `ReqFor` vs `auth:string` → `ReqFor & AuthField<Auth>`). Negative case on `createApi<undefined>` with `auth:"required"` + `({auth})=>` is a type error for **both** classic `api({method,path,auth})` and shorthand `api.get(path, {auth:"required"}, ...)`. Positive cases with `createApi<MyAuth>` pass. | `src/api.ts` overloads, `docs/adr/009` gap, `nub run typecheck` in CI |
| **S2 — App / OpenAPI contract** | `app.request("/openapi.json")` + `app.request(route)` in runnable `selfcheck.ts` (no test framework) | Framework-guaranteed error responses `400/401/404/500` appear exactly where spec says, share one deduped `{error:string}` ComponentRegistry component, `400` on validated `request.body/query/headers/params` **or** `hasParamTokens(path)` (auto-generated `request.params`), `404` ponytail heuristic on `:param` only, `401` only with `AuthScheme`/`security`, suppression via explicit `responses:{400}`/`{404}` guard `if(!responses[key])` | `src/openapi.selfcheck.ts` (6 checks: spec min/max, coercion, 400, $defs hoisting, onError chokepoint, debug), `examples/blog/selfcheck.ts` (41 checks + golden `spec.snapshot.json`), `examples/basic/selfcheck.ts`, `examples/auth/selfcheck.ts` |

**Question for user:** Do these two seams match your expectations? S1 covers the type-level contract without adding a runtime seam; S2 covers the HTTP/spec contract at the `Hono`/`OpenAPIHono` boundary (highest reusable seam). If you want a single seam, S2 can be stretched to cover types via `tsd`/`expect-type` assertions inside selfchecks, but `typecheck` is the canonical type seam today. Confirm or propose alternative seams before publishing tickets.

---

## Problem Statement

As a user of the Function-based API DSL, I face two related inconsistencies that erode trust in the framework:

1. **Shorthand vs classic type safety diverge.** I can declare an endpoint either as `api({method, path, auth:"required"}, handler)` or as the more ergonomic `api.get(path, {auth:"required"}, handler)`. When my app has no auth (`createApi<undefined>`), the classic form correctly rejects `({auth}) => ...` (handler has no `auth`), but the shorthand form incorrectly accepts it — so I ship code that typechecks but accesses `undefined` auth at runtime.

2. **Framework error docs are confusing.** The OpenAPI spec auto-documents `400 Bad Request`, `401 Unauthorized`, `404 Not Found`, and `500 Internal Server Error`. I want `400` only where validation can fail, `401` only behind a security scheme, `404` only where a resource lookup is plausible, and `500` always — all sharing one error schema. Instead, `400` appears on some param routes without explicit validation (via auto-generated `request.params`), wording says "only validated params" while code also matches path `:param`, and `400`/`404` suppression rules are unclear (can I suppress by declaring `responses:{400}`? Does that remove or replace?). The spec is noisy or missing where I expect control.

Together these make the DSL feel implemented but potentially wrong: types lie through shorthands, and specs diverge from literal wording.

## Solution

From the user's perspective, the fix is:

**Shorthands behave exactly like the classic form, at the type level.** `api.get`/`post`/`put`/`patch`/`del`/`delete` all preserve the two overloads: without `auth` the handler receives `ReqFor` (no `auth` field); with `{auth:"required"}` the handler receives `ReqFor & AuthField<Auth>` (present only when `Auth` is defined). On a no-auth app, using `auth:"required"` and trying to read `auth` in the handler is a type error through any entry point. The explicit helper type documents this contract in one place.

**Framework error responses are accurate, non-noisy, deduplicated, and controllable.** `400 Bad Request` documents where validation can actually occur — explicit validated `request.body`/`query`/`headers`/`params` **or** a path containing `:param` (which auto-generates a `request.params` validator via the single `PARAM_TOKEN_RE` source). `401 Unauthorized` documents only where a registered `AuthScheme` is attached (`security`). `404 Not Found` documents only where `hasParamTokens(path)` suggests a resource lookup (ponytail heuristic). `500 Internal Server Error` always documents. All share one deduped `{error:string}` component (`schema_<12hex>`). Each is suppressible/replaceable by declaring an explicit `responses:{400: schema}` / `{404: schema}` / etc., which the guard `if(!responses[key])` respects — clarifying that auto-docs replace rather than suppress-away (ponytail ceiling: future `hide400`/`documentNotFound`/`errors:[…]` opt-ins).

No new runtime dependencies or breaking API changes; existing routes keep working, specs shift only to match documented intent (pre-1.0 minor).

## User Stories

1. As a library consumer with a no-auth app, I want `api.get("/x", {auth:"required"}, ({auth})=>...)` to be a type error, so that I don't ship a runtime `undefined` auth access.
2. As a library consumer with an authed app, I want `api.get("/x", {auth:"required"}, ({auth})=>...)` to expose `auth: MyAuth` in the handler, so that I get autocomplete and type safety for `auth.user.id`.
3. As a library consumer, I want the classic `api({method, path, auth:"required"}, handler)` and shorthand `api.get(path, {auth:"required"}, handler)` to have identical type rules, so that I can refactor between forms without changing types.
4. As a library consumer, I want `api.get("/x", {}, ({auth})=>...)` to be a type error when the route has no `auth` config, so that I don't read auth where none is injected.
5. As a library maintainer, I want the overload contract expressed as a named type, so that I can maintain it in one place and avoid `ReturnType` collapse bugs.
6. As an API developer, I want path params (`:name`, `:id?`, `:id{[0-9]+}`, `*`) to appear as flat top-level keys in the handler (`ReqFor` via `ParamsFromPath`/`ParamRecord`), so that I don't dig through `c.req.param`.
7. As an API developer, I want optional `:id?` to be typed `string | undefined` and emitted as an optional `request.params` schema, so that missing optional params don't require validation boilerplate.
8. As an API developer, I want `method` to autocomplete (`GET`/`get`/`Post`) and be case-insensitive at runtime via `normalizeMethod`, so that typos are caught statically but casing is forgiving.
9. As an API developer, I want `operationId` and `deprecated` to pass through to the OpenAPI `OpenAPIOperation`, so that SDK generation and docs mark deprecations.
10. As an app bootstrap author, I want `docs({specPath, uiPath})` and `docs(specPath, uiPath)` to both work and to require mounting after side-effect route imports, so that the spec includes all routes.
11. As an API consumer viewing docs, I want `400 Bad Request` to be documented only where a request can fail validation, so that the spec isn't noisy.
12. As an API consumer, I want `GET /health` (no validation, no params) to document `200` + `500` but not `400`/`401`/`404`, so that I trust error docs.
13. As an API consumer, I want `POST /things` with a validated `request.body` to document `400` (+ its success `201`), so that I know bad bodies are possible.
14. As an API consumer, I want `GET /search` with validated `request.query` (including coerced `number`/`boolean`/`number[]` via `Coercion`) to document `400`, so that malformed queries are visible.
15. As an API consumer, I want `GET /posts/{id}` (path has `:param`, auto-generates `request.params`) to document `400` (ponytail: benign even if runtime param `string` never actually 400s), so that the spec matches the validator pipeline.
16. As an API consumer, I want any endpoint whose path contains `:param` to have its `request.params` auto-generated from `parseParamTokens` via the single `PARAM_TOKEN_RE` source, so that type-level `ParamsFromPath` and runtime validator never drift.
17. As an API consumer, I want `401 Unauthorized` to appear only on routes where `{auth:"required"}` was registered with an `AuthScheme` (`bearer`/`basic`/`apiKey`) and emitted as `security: [{required: []}]` + `components.securitySchemes`, so that lock icons in Scalar match runtime auth.
18. As an API consumer, I want `401` not to appear on public routes, so that unauthenticated endpoints don't falsely claim auth.
19. As an API consumer, I want `404 Not Found` to appear automatically on routes with path params (`hasParamTokens`), so that resource lookups via `fail.notFound` are documented without manual `responses:{404}`.
20. As an API developer, I want to suppress the auto `404` on a param route that never 404s by declaring `responses:{404: schema}` (or custom schema), via the guard `if(!responses["404"])`, so that false-positive docs are controllable.
21. As an API developer, I want to replace the auto `400` schema by declaring `responses:{400: schema}` (guard `if(!responses["400"])`), understanding it replaces rather than removes `400` (ponytail ceiling: future `hide400`/`errors` array), so that I can customize error shape where needed.
22. As an API consumer, I want `500 Internal Server Error` to always be documented (if not explicitly declared), so that generic failures are not missing.
23. As an API developer, I want all framework errors (`400`/`401`/`404`/`500`) to share one deduped `ComponentRegistry` schema (`type({error:"string"})` → stable `schema_<12hex>` via content-hash, `rewriteRefs` from `#/$defs/` → `#/components/schemas/`), so that the spec is small and consistent.
24. As an API developer, I want deterministic spec emission: `/:param` → `/{param}` via `toOapiPath`, `method` normalized via `normalizeMethod`, `operationId` collision-free (`_2` suffix via `seenOperationIds` + `baseCounts`), and recursive `ArkType` `$defs` stably hoisted (no dangling `#/$defs/`), so that golden snapshots don't flake.
25. As an API developer, I want header schemas to use lowercase keys (`"x-api-key"` not `"X-Api-Key"`) because `Hono`/`Fetch Headers` lowercases at runtime and `Coercion` does not auto-lowercase (strict 400), so that runtime and docs (`_addObjectParams` lowercases when `in==="header"`) match.
26. As an API developer, I want `DocsMount` to be unauthenticated by default but guardable via `app.use("/openapi.json", mw)` / `app.use("/docs/*", mw)` before `docs()`, so that private APIs can protect specs (ponytail documented).
27. As an API developer, I want `ApiMethodHelper` / `RouteFields` / `ReqFor` vocabulary used consistently in docs and errors, so that the glossary is the source of truth and ADRs are precise.

## Implementation Decisions

- **DSL layer keeps explicit overloads; no `ReturnType` indirection.** The shorthand helper type is a named two-overload interface capturing `RouteFieldsWithoutMethodPath` + `ReqFor`/`AuthField` distinction per `Auth`/`Env` generics. This was chosen after a prototype showed `ReturnType<typeof makeMethodHelper>` on an overloaded inner `helper` collapses to the last (implementation) signature `auth?:string` → `req & {auth: Auth}`, losing the `auth:"required"` → `AuthField<Auth>` distinction and letting the negative `createApi<undefined>` shorthand pass. The explicit interface preserves the classic `api()` overload contract verbatim for shorthands. One internal `api as unknown` cast remains inside the helper implementation only (overloads stay strict outside).

  > Prototype shape (trimmed, from `src/api.ts`): `type ApiMethodHelper<Auth,E> = { <P,B,Q,H>(path:P, config: {auth?:undefined}, handler:(req: ReqFor<P,B,Q,H,E>)=>any):void; <P,B,Q,H>(path:P, config:{auth:string}, handler:(req: ReqFor<P,B,Q,H,E> & AuthField<Auth>)=>any):void }` + `function makeMethodHelper<M>(method:M): ApiMethodHelper<Auth,E> { function helper(...overload1)...; function helper(...overload2)...; function helper(...impl)... { apiImpl(...) } return helper }` + `api & {get: ApiMethodHelper<Auth,E>, post:..., ...}`.

- **Modules modified:** DSL facade (the `createApi` closure that owns `auths`/`authSchemes` maps, overloads, `auth()` → `c.set("auth",ctx)`, `docs()` mount) and OpenAPI emission (the `OpenAPIHono` class that owns `_routes: StoredRoute[]`, `ComponentRegistry` (`schemas` + `securitySchemes`), `_buildSpec`/`_buildResponses`/`_addObjectParams`/`_schemaToOA`/`_getErrorSchemaRef`). No new module added in this slice; the change follows the deferred incremental split strategy (paths kernel already extracted per ADR-010; errors/validation/registry extraction stays deferred per ADR-011).

- **Interfaces modified:** `RouteFieldsWithoutMethodPath` (existing) is reused; the new public contract is `ApiMethodHelper<Auth,E>` (consumed by `api.get/post/put/patch/del/delete`). `RouteFields`/`ReqFor`/`ParamsFromPath`/`ParamRecord` stay unchanged. `RouteConfig`/`StoredRoute` continue to own the low-level shape.

- **Path + method grammar stays single-source.** `normalizeMethod`/`toOapiPath`/`PARAM_TOKEN_RE`/`PARAM_HAS_RE`/`parseParamTokens`/`hasParamTokens` live in the pure paths kernel and are re-exported via the OpenAPI barrel. Both the DSL's auto `request.params` generation (`type(Object.fromEntries(tokens.map(...)))`) and the OpenAPI `400`/`404` heuristics use `hasParamTokens`/`parseParamTokens` — no duplicated literals, per ADR-010.

- **Framework error policy (ADRs 007 + 006):** In `_buildResponses` the guards remain `if(!responses[key])` for `400`/`401`/`404`/`500`. `400`'s predicate is `request.body` or `query` or `headers` or `params` **or** `hasParamTokens(path)` (auto-generated params). This is intentional (hardening b6354f3) — literal "only validated params" wording was updated to include auto-generated params. `401`'s predicate is `config.security` (set only when `auth` name has a registered `AuthScheme`). `404`'s predicate is the `hasParamTokens(path)` ponytail heuristic (benign false-positive on e.g. `/search/:query`, suppressible via explicit `responses:{404: schema}`; ceiling: future `documentNotFound` opt-in or `errors:[…]` array). `500` always unless already declared. All share one lazily created `type({error:"string"})` → hoisted `schema_<hash>` ref via deduped `ComponentRegistry`.

- **Spec emission details preserved:** Success code selection `status ?? first 2xx/3xx in responses ?? "200"`; `204` has no `content`; `operationId` default `method_oapiPath` (`/`→`_`, `{}` stripped) with `Set`+`Map` dedup `_2`; `$defs` hoisting via Web Crypto `sha1Hex(normalizeRefs(JSON.stringify(def)))` → `schema_<12hex>` with `rewriteRefs`; header param names lowercased in `_addObjectParams` when `in==="header"` to match Fetch `Headers` runtime.

- **No schema changes.** `ArkType` peer (`arktype@^2.2.1`) and `Hono@^4.7` stay; no persistence.

## Testing Decisions

- **What makes a good test:** Only external behavior — typed handler shapes and HTTP/OpenAPI contract as seen by a consumer (`app.request`, `GET /openapi.json`), plus the type checker's verdict. No testing of private helper casts, map internals, or hash implementation details. Spec snapshots assert golden output; type negatives assert the compiler errors, not runtime throws.

- **Which modules will be tested:**
  - **Type contract (S1):** `createApi<Auth,Env>` via `nub run typecheck` negatives/positives: `createApi<undefined>` with `api` + `api.get` and `({auth})` destructuring must error; `createApi<MyAuth>` with `{auth:"required"}` must expose `auth: MyAuth`; `api.get("/x", {}, ({auth})=>)` must error when route has no auth. This is the type seam — no runtime harness needed.
  - **Runtime/spec contract (S2):** `OpenAPIHono` / `createApi` via `app.request` in `selfcheck.ts` files: validated vs unvalidated routes (`body`/`query`/`param`), authed vs public (`AuthScheme`/`security` → lock icon), param vs non-param (`hasParamTokens` → `400`/`404`), deduplicated `schema_84c5e…` component count, golden `spec.snapshot.json` workflow (`rm spec.snapshot.json && nub examples/blog/selfcheck.ts` to regenerate, excluded from Biome via overrides).

- **Prior art:** `src/openapi.selfcheck.ts` (6 assertions: spec `minimum`/`maximum`, query `coerceDeep` string→number, `400` on bad body via thrown `APIError` chokepoint, recursive `$defs` → `#/components/schemas` rewrite, `onError` chokepoint regression, `debug` gated by `NODE_ENV`), `examples/blog/selfcheck.ts` (41 checks + snapshot, `components.securitySchemes` + per-route `security`, param vs non-param `404`), `examples/basic/selfcheck.ts` (`/hello/{name}` `401`/`400`/`200`, `/search` missing query `400`), `examples/auth/selfcheck.ts` (register→profile→logout→login cookie jar). CI runs `nub run lint` + `nub run typecheck` + `nub run check:all` (`lib + basic + blog + auth`).

## Out of Scope

- Explicit `hide400` / `documentNotFound` / `errors:[400,404]` config array for full suppression of framework errors without a replacement schema — documented as ponytail ceiling, not implemented in this slice (users replace via `responses:{400: schema}` / `{404: schema}` which still documents that code).
- Suppressing `400` entirely on a param route that is known to never actually 400 (e.g. `GET /posts/{id}` where `type({id:"string"})` always passes) — accepted as benign spec noise; revisit if noise becomes user-visible.
- `POST /lookup` body-lookup `404` auto-doc (no path param, `fail.notFound` in handler) — remains inconsistent by design; requires explicit `responses:{404}` or future `errors` field (grilling Q21).
- `HttpMethod` `string & {}` fallback removal or stricter `^[a-z0-9_-]+$` `operationId` validation — stays permissive; spec `required:false` with `/{id}` path stays as-is (grilling 009 ceiling).
- Module splits (`src/errors.ts` kernel, `src/validation.ts`, `src/registry.ts`) beyond the already-extracted `src/paths.ts` — deferred per ADR-011 until size/divergent-change threshold.
- New dependencies, test framework introduction, or changes to `pnpm-workspace.yaml`/`lefthook`/`biome` beyond snapshot override hygiene.

## Further Notes

- **Ponytails carried forward:** `400` on auto-generated `:param` (`hasParamTokens` → `400` even though `type({id:"string"})` rarely 400s), `404` heuristic on any `:param`, header lowercasing (`coerceDeep` does NOT auto-lowercase; `_addObjectParams` emits `name.toLowerCase()` when `in==="header"`), `dispatch` cast for `Hono.on()` overloads, `*` → `{wildcard}`. Each has ceiling/upgrade noted in `src/openapi.ts` comments and ADRs 007/009.
- **Pre-1.0 snapshot-minor contract:** Adding `404`/`400` auto-docs is spec drift; shipped as `0.4.0` minor, not major — consumers pinning `^0.5.0` get drift without major, documented.
- **Dependency direction invariant stays acyclic:** DSL facade → paths/kernel, orchestrator → validation/registry/paths/kernel; never `validation → orchestrator`.
- **Docs sync:** After this slice, `docs/adr/007` wording includes `or path has :param (auto-generated)` + guard note, `docs/adr/009` records `ApiMethodHelper` fix, `docs/glossary.md` adds `ApiMethodHelper` entry + `Ponytail` `400` note, `docs/domain-model.md` (bounded contexts + `ApiMethodHelper` sketch) updated; `src/openapi.ts` header comment updated. `dist/` rebuilt via `nub run build` (check:dist gate).

