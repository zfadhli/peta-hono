# peta-hono — Domain Model (grill-with-docs)

> Stateless library. No persistence / storage context. Scope: `src/openapi.ts` + `src/api.ts` + `src/index.ts` + example usage (`examples/blog`, `examples/basic`, `examples/auth`). Read 2026-08-26: `src/api.ts:324` / `src/openapi.ts:700` / `HANDOFF.md` issues 01-07 / `AGENTS.md`.

---

## 1. Bounded Contexts (4+1)

We map the existing 2-file split (`api.ts` = DSL facade, `openapi.ts` = runtime + spec) onto 4 bounded contexts with clean language boundaries. A 5th (Cross-cutting) is implicit but listed.

### Context A — API DSL & Composition (High-level Facade)

**Purpose:** User-facing declarative surface. Encore-style ergonomics: `createApi() => { api, auth, docs, app }`.

*   **Ubiquitous language:** Builder, Route declaration, Handler, Config.
*   **Owned types:** `createApi<Auth,Env>`, `api()` overloads, `api.get/post/...` helpers, `RouteFields<P,B,Q,H>`, `ReqFor<P,B,Q,H,E>`, `AuthField<Auth>`, `docs()` overloads.
*   **Owned behavior:** closure captures `app: OpenAPIHono<E>`, `auths: Map<string,Middleware>`, `authSchemes: Map<string,AuthScheme>`; translates high-level `RouteFields` → low-level `RouteConfig`; derives `ParamRecord`/`ParamsFromPath`; builds `request.params` ArkType from path tokens when user omits it.
*   **Dependencies:** Depends on Context B (Validation) for building `type({})` param schema, Context C (OpenAPI) for `RouteConfig` shape, Context D for `auth()` wrapping. **Must not** own `arktypeValidator` or `_buildSpec` directly.
*   **Module:** `src/api.ts` (facade). Re-exports `APIError` from C to keep stable barrel.

**Invariants owned here:**
- `createApi()` is called **once per app** (singleton `setup.ts`). Exports `api` etc; route files import `api` for side-effect registration.
- `docs()` **must be called after** all side-effect route imports — else spec misses routes. Enforce via docs pattern, not compile-time.
- `auth(name, ...)` must precede `api({auth:name})` else runtime `throw Error(auth not registered)`.

### Context B — Validation & Coercion

**Purpose:** Turn wire strings into typed values before ArkType sees them. Preserve 400 semantics for missing/empty.

*   **Owned types:** `ArkType` (`Type<any,any>`), `ArktypeValidatorTarget = "json"|"query"|"header"|"param"`, coercion helpers `coerceDeep`, `coerceValue`, `resolveRef`, `isNumericType/isBooleanType/isArrayType/isObjectType`.
*   **Owned behavior:** `arktypeValidator(target, schema) => MiddlewareHandler`. Inside uses `validator(target, (value,c)=>{ coerceDeep; schema(data); if ArkErrors throw APIError(400) })`.
*   **Dependencies:** Depends on Context C for `APIError` (to throw) and `JsonSchema` for coercion walk (via `schema.toJsonSchema()`).
*   **Module:** `src/openapi.ts` `arktypeValidator` + coercion helpers (currently ~200 LOC private). Candidate extraction: `src/validation.ts` in future.

**Invariants:**
- **Coercion before validation** — deep, element-wise for arrays + nested objects, single level `JSON.parse` for `"{...}"` strings.
- **Empty/whitespace string and `undefined` never coerce to `0`/`false`** — they pass through so ArkType 400s.
- **Array query special:** single `"1"` string with `items:number` wraps to `[1]`; repeated `?ids=1&ids=2` already `string[]` and each element coerced.
- **Header schemas must use lowercase keys** — `ponytail:` Hono lowercases via Fetch Headers; spec emits lowercased param names.
- **Throws `APIError(400, summary)` — never returns `Response`** — so `app.onError` is the single chokepoint (regression guard selfcheck #5).

### Context C — OpenAPI Emission & Documentation

**Purpose:** Deterministic `3.0.0` spec at `/openapi.json` + Scalar UI at `/docs`. Hoisting, refs, deduping, param surfacing.

*   **Owned types:** `OpenAPIHono<E,S,BasePath>`, `RouteConfig`, `StoredRoute`, `OpenAPISpec/Operation/Parameter/Response/RequestBody/Components`, `ComponentRegistry {schemas, securitySchemes}`, `AuthScheme`.
*   **Owned behavior:** `openapi(config, handler)` registration + middleware assembly + Hono `this.on()` dispatch + `req` flattening + response wrapping; `doc(url,info)` + `_buildSpec()` + `_buildResponses()` + `_schemaToOA()` + `_addObjectParams()` + `rewriteRefs()` + `toOapiPath()` + `sha1Hex()`; operationId deduping (`_2` suffix); framework error injection (400/401/404/500 with one deduped `schema_<12hex>` error component).
*   **Module:** `src/openapi.ts` `OpenAPIHono` class (bulk). Candidate split: `src/openapi/emission.ts` + `registry.ts` + `paths.ts`.

**Invariants:**
- **Path conversion:** Hono `/:name`, `/:name{regex}`, `/:name?`, `/:name{regex}?`, `/*` → OpenAPI `/{name}`, `/{wildcard}` via `toOapiPath` regex (`/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/` + `*→{wildcard}`).
- **OperationId:** `config.operationId ?? "${method}_${oapiPath.replace(/[{}]/g,"").replace(/\//g,"_")}"`, deduped with `Set<string>` + `Map<baseId, count>` → suffix `_2`, `_3`...
- **Component naming:** stable `schema_<sha1Hex(JSON.stringify(def) after normalizing #/$defs/ names to indices).slice(0,12)>` — not ArkType's counter `intersection216`. `rewriteRefs` rewrites all `$ref: "#/$defs/X"` → `"#/components/schemas/schema_<hash>"`; `json.$defs` deleted; no `#/$defs/` remains; no `$defs` key in final spec.
- **Deduping:** `_components.schemas: Map<string,JsonSchema>` — same content hash writes once; `_errorSchemaRef` single `{error:"string"}` component reused for 400/401/404/500; `spec.components.schemas` only if non-empty.
- **Param surfacing:** `_addObjectParams` uses `_schemaToOA` (not raw `toJsonSchema`) so `$defs` already hoisted; iterates `json.properties` + `json.required` set; lowercases header param names.
- **Responses:** user-declared `config.responses` plus framework-guaranteed: 400 if any validated `body/query/headers/params` or path has `:param`; 401 if `config.security`; 404 heuristic if path matches `:param` regex (ponytail: benign false-positive, user suppresses by declaring `responses:{404}`); 500 always; successCode = `config.status ?? first 2xx/3xx in responses ?? "200"`; 204 has no content.
- **Header lowercasing + `toOapiPath` mismatch guard:** documented, not enforced.

### Context D — Auth & Security

**Purpose:** Named reusable auth middleware + OpenAPI security scheme emission (lock icons in Scalar).

*   **Owned types:** `AuthScheme = {type:"http", scheme:"bearer"|"basic"} | {type:"apiKey", in:"header"|"query", name:string}`, `security?: Record<string,string[]>[]` per operation, `auths/authSchemes` maps.
*   **Owned behavior:** `auth(name, (c:Context<E>)=>Auth|Promise<Auth>, scheme?)` wraps return-based fn into `MiddlewareHandler` that `c.set("auth", ctx)`; registers `app.registerSecurityScheme(name,scheme)`; per-route `security: [{[name]:[]}]` only if `authSchemes.has(name)`.
*   **Module:** Split across `src/api.ts` (`auth()` wrapper + maps) and `src/openapi.ts` (`registerSecurityScheme`, `security` emission in `_buildSpec`). Clean merge into `src/auth.ts` possible.

**Invariants:**
- **Return-based:** `throw fail.*` to reject, `return ctx` becomes `req.auth` (typed via `createApi<Auth>` + `AuthField<Auth>`). No `c.json` inside middleware.
- **Injection:** handler wrapper reads `(c as {get(key:string):unknown}).get("auth")` and assigns `req.auth` if present.
- **Typing gate:** `RouteFields & {auth: string}` overload → `ReqFor & AuthField<Auth>`; missing `auth` → no `auth` field; mismatch is compile error.
- **Spec coupling:** `auth(name,mw)` without `scheme` → runtime works, docs show no lock; with `scheme` → `components.securitySchemes` + per-route `security`.

### Context E — Error & Lifecycle (Cross-cutting Kernel)

**Purpose:** Single chokepoint for every error.

*   **Owned types:** `APIError(status: ContentfulStatusCode, message)`, `fail/errors/httpErrors` helpers (11 codes), `ErrorHandler = (err,c)=>Response`, `createErrorHandler(debug?)`.
*   **Owned behavior:** `OpenAPIHono` constructor `this.onError(createErrorHandler())`; `createApi()` **overrides** with `app.onError(createErrorHandler(opts.debug))`; `createErrorHandler` branches: `if err instanceof APIError → c.json({error:err.message}, err.status)` else `console.error`, `isProd = process.env.NODE_ENV==="production"`, if `debug&&isProd → console.warn(redacting)`, `effectiveDebug = debug && !isProd`, if `effectiveDebug → {error:message, stack}` else `{error:"Internal Server Error"}` 500.
*   **Module:** `src/openapi.ts` (`APIError`, `createErrorHandler`) re-exported via `src/api.ts` (`fail`).

**Invariants:**
- **Single chokepoint:** handler-thrown `APIError`, validator-thrown `APIError(400)`, unexpected throw — all through `app.onError`. No duplicate policy (fixed in issue #4).
- **`fail` aliases:** `errors === fail`, `httpErrors === fail`; helpers have default messages; `APIError` for custom codes.
- **Status selection:** success `204` when `result===null` and code is 2xx, else `c.json(result, ContentfulStatusCode)`.
- **Debug gating:** `debug` leaks stack/messages only when `!isProd`; prod+debug warns and redacts — avoids leaking absolute paths.
- **Hono types:** `dispatch` via `this.on.bind` cast (ponytail: overload complexity), `creq = c.req as {valid(target:string):...}` preserves `this`.

---

## 2. Aggregates / Entities / Value Objects

### 2.1 Aggregates

#### Aggregate — `ApiBuilder<Auth,Env>` (closure returned by `createApi`)

*   **Root:** closure scope, not a class. Identity = `app` instance.
*   **Fields:**
    - `app: OpenAPIHono<Env>` — owned `Hono` subclass.
    - `auths: Map<string, MiddlewareHandler>` — registered auth wrappers.
    - `authSchemes: Map<string, AuthScheme>` — optional scheme per auth name.
    - `opts: {title?, version?, debug?}` — docs info + error policy flag.
*   **Entities owned:** `AuthRegistration` (name→mw+scheme), ephemeral `RouteFields` → `RouteConfig` translations.
*   **Methods:** `auth(name,mw,scheme?)`, `api(config,handler)` + method shorthands `get/post/put/patch/del/delete`, `docs(specPath|opts)`.
*   **Invariants:** Maps are written only via `auth()`; routes appended via `api()` which calls `app.openapi()`. No direct mutation of `_routes` from facade.
*   **Relationships:** `ApiBuilder --1→ OpenAPIHono --*→ StoredRoute`; `ApiBuilder --*→ AuthRegistration`; `ApiBuilder --uses→ arktypeValidator`.

#### Aggregate — `OpenAPIHono<E>` (extends `Hono<E,S,BasePath>`)

*   **Root:** `OpenAPIHono` instance (`app`). Identity = `Hono` instance.
*   **Fields:**
    - `_routes: StoredRoute[]` — insertion-ordered, drives spec + Hono dispatch order.
    - `_components: ComponentRegistry { schemas: Map<string,JsonSchema>, securitySchemes: Map<string,AuthScheme> }` — mutable registry, built incrementally via `_schemaToOA` hoisting.
    - `_errorSchemaRef: JsonSchema|null` — lazy singleton `{$ref:"#/components/schemas/schema_<hash>"}` for `{error:string}`.
    - error handler: via `Hono.onError(ErrorHandler)`.
*   **Methods:** `openapi(config, handler)`, `doc(url,info)`, `registerSecurityScheme`, `_buildSpec`, `_buildResponses`, `_schemaToOA`, `_addObjectParams`, `_getErrorSchemaRef`.
*   **Invariants:** `_routes` order = Hono registration order = spec path iteration order; `_components` keys are stable `schema_<12hex>`; operationIds unique across aggregate.

#### Aggregate — `OpenAPISpec` (ephemeral, built on `GET /openapi.json`)

*   **Root:** `OpenAPISpec` object returned by `_buildSpec`.
*   **Fields:** `openapi: "3.0.0"`, `info:{title,version}`, `paths: Record<string, Record<string, OpenAPIOperation>>`, `components:{schemas?, securitySchemes?}`.
*   **Owned:** `OpenAPIOperation` per `(oapiPath, method)` with `operationId`, `parameters[]`, `requestBody`, `responses`, `security`, `tags/summary/description/deprecated`.
*   **Invariants:** No `$defs`, no `#/$defs/` refs, all refs → `#/components/schemas/schema_<12hex>`; 500 always present; paths use OAPI form.

### 2.2 Entities

| Entity | Identity | Fields | Lifecycle | Notes |
|---|---|---|---|---|
| `StoredRoute` | `(method, oapiPath, insertionIndex)` — not user-visible id | `method: string` (lowercase stored, uppercase dispatches), `oapiPath: string`, `config: RouteConfig`, `handler: RouteHandler (req:Record<string,unknown>)=>...` | Append-only in `_routes`; survives for life of `app`. | `oapiPath` derived via `toOapiPath(config.path)`. `paramTokens` re-derived per `openapi()` call for validator + req flattening. |
| `RouteConfig` | Value-passed config, not persisted | `method: Method`, `path: string (Hono)`, `request?:{body?,query?,headers?,params?: ArkType}`, `responses?: Record<number,ArkType>`, `tags?, summary?, description?, security?, middleware?:MiddlewareHandler[]`, `status?, operationId?, deprecated?` | Created per `api()` call; stored inside `StoredRoute.config`. | `security` auto-set only if `auth` name has scheme. `middleware` is user array + prepended auth mw. |
| `AuthRegistration` | `name: string` key in `Map` | `name`, `wrapped: MiddlewareHandler` (does `c.set("auth", await mw(c))`), `scheme?: AuthScheme`, `raw: (c:Context<E>)=>Auth` | `auth(name,…)` idempotent overwrite; no delete. | Return-based, not next()-based auth. |
| `OpenAPIOperation` | `(oapiPath, method)` unique in spec | `operationId: string` (unique), `responses: Record<string,OpenAPIResponse>`, `parameters?: OpenAPIParameter[]`, `requestBody?: OpenAPIRequestBody`, `security?: Record<string,string[]>[]`, `tags?, summary?, description?, deprecated?` | Built per `_buildSpec` iteration. | Success code selection inside `responses`. |

### 2.3 Value Objects (immutable, structural equality)

| VO | Fields / Shape | Constraints | Where Used |
|---|---|---|---|
| `HttpMethod` | `"GET"|"POST"|"PUT"|"PATCH"|"DELETE"` | Closed set `SUPPORTED_METHODS`. | Runtime validation. |
| `Method` | `HttpMethod | Lowercase<HttpMethod> | (string & {})` | Case-insensitive autocomplete: any string but known ones hint; `normalizeMethod` validates. | `api()` config, `RouteConfig.method`. |
| `NormalizedMethod` | lowercase `string` in supported set | `normalizeMethod` throws `Unsupported method: ${m}. Use one of: ...` if not in set (case-insensitive). | `openapi()` lowercases, dispatches uppercase `GET` etc to `this.on`. |
| `ApiPath` (Hono) | `string` starting with `/` | Must start with `/` else `throw Path must start with "/"`. Tokens `:([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)?` | `RouteConfig.path`, `api()` / shorthands. |
| `OapiPath` | `string` | Derived: `toOapiPath(ApiPath)` → `:x`→`{x}`, `*`→`{wildcard}`. Used as `paths` key. | `_buildSpec` path item key. |
| `ParamToken` | `{name:string, optional:boolean}` | Parsed via `matchAll(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)?/g)`. `optional = !!group2`. | Both `api.ts` (build `request.params` ArkType) and `openapi.ts` (auto-generate params validator + req flattening). |
| `ParamRecord` | `{[K in N]?:string} | {[K in N]:string}` conditional on token shape | Single-token helper; `:id?`, `:name{regex}?` → optional. | Type-level `ParamsFromPath`. |
| `ParamsFromPath<P>` | Recursive conditional `ParamRecord & ...` | Walks `:${Param}/${Rest}`. Empty path → `{}`. | `ReqFor` intersection. |
| `StatusCode` / `ContentfulStatusCode` | `number` (`StatusCode` includes 204) | `ContentfulStatusCode` = all but 204 for `c.json`; `APIError` requires `ContentfulStatusCode`. | `APIError`, `_buildResponses`, handler return wrapping. |
| `OperationId` | `string` | Default `method_oapiPath` with `/ → _`, `{}` stripped. Collision → `_2`, `_3` via `seenOperationIds` + `baseCounts`. | `OpenAPIOperation.operationId`. |
| `JsonSchema` | ArkType `JsonSchema` (includes `type`, `properties`, `required`, `minimum/maximum`, `$defs`, `$ref`, etc) | After `_schemaToOA`, `$defs` removed, `$schema` deleted, `$ref` rewritten. | Component hoisting. |
| `ComponentName` | `string` `schema_<12hex>` | `sha1Hex(normalizeRefs(JSON.stringify(def))).slice(0,12)`. `normalizeRefs` maps `#/$defs/originalName` → `#/$defs/index`. | `_components.schemas` key. |
| `OpenAPIParameter` | `{name, in:"path"|"query"|"header", required:boolean, schema:JsonSchema, description?}` | `required = requiredSet.has(name)`; header `name` lowercased. | `_addObjectParams`. |
| `OpenAPIResponse` | `{description, content?:{"application/json":{schema:JsonSchema}}}` | 204 has no content; else schema via `_schemaToOA` or error ref. | `_buildResponses`. |
| `AuthScheme` | `union: {type:"http", scheme:"bearer"|"basic"} | {type:"apiKey", in:"header"|"query", name}` | Direct emission to `components.securitySchemes`. | `auth()` + `registerSecurityScheme`. |
| `SecurityRequirement` | `Record<string,string[]>` e.g. `{required:[]}` | Per-route `security: [{[name]:[]}]` only if scheme existed. | `OpenAPIOperation.security`. |
| `ErrorBody` | `{error:string} (+ stack? in debug)` | Shared `{error:"string"}` ArkType → JsonSchema hoisted once. | `_getErrorSchemaRef`. |
| `CoercedValue` | `unknown` after `coerceValue` | Preserves `undefined` and `""` / whitespace. | `coerceDeep` output. |
| `DocsMount` | `{specPath:string, uiPath:string}` | Defaults `/openapi.json`, `/docs`; `docs()` overload: `(specPath?,uiPath?)` or `({specPath?,uiPath?})`. | `ApiBuilder.docs()`. |
| `HandlerReq` (runtime) | `Record<string,unknown> & {body?, query?, headers?, auth?, c:Context}` | Flattened: `paramTokens` spread top-level, `body/query/headers` nested, `auth` if set, `c` always. | `RouteHandler` arg. |

---

## 3. Proposed Model — Types, Modules, Relationships, Constraints, Invariants

### 3.1 Module Map (current → proposed)

```
Current:
  src/openapi.ts  ≈ 700 LOC — OpenAPIHono + validators + coercion + spec + APIError + helpers
  src/api.ts      ≈ 324 LOC — createApi facade + type utils (ParamRecord, ReqFor, AuthField)
  src/index.ts    — barrel

Proposed (no rename required for v0.5, but ADR for future split):

  src/types.ts        ← shared VOs: Method, HttpMethod, AuthScheme, ArkType, ErrorBody
  src/validation.ts   ← arktypeValidator, coerceDeep/coerceValue, is*Type, resolveRef
  src/paths.ts        ← toOapiPath, normalizeMethod, SUPPORTED_METHODS, ParamToken parsing, ParamsFromPath helpers (value + type)
  src/registry.ts     ← ComponentRegistry, sha1Hex, rewriteRefs, _schemaToOA, _getErrorSchemaRef (pure)
  src/openapi.ts      ← OpenAPIHono (core, injects validation/registry/paths)
  src/api.ts          ← createApi (DSL, depends only on types + openapi)
  src/errors.ts       ← APIError, fail/errors/httpErrors, createErrorHandler  [OR keep in openapi.ts — current choice breaks cycle: validator needs APIError]
  src/index.ts        ← barrel (re-exports public surface)
```

**Constraint:** `APIError` lives in `openapi.ts` (not `api.ts`) because `arktypeValidator` must `throw new APIError` without circular `api→openapi→api`. `api.ts` re-exports it. Future `errors.ts` would be the cycle breaker if split.

### 3.2 Type Model (authoritative sketch — mirrors source truth)

```ts
// types.ts
export type HttpMethod = typeof SUPPORTED_METHODS[number];
export type Method = HttpMethod | Lowercase<HttpMethod> | (string & {});
export type AuthScheme = ...;
export type ArkType = Type<any,any>;
export type ErrorHandler = (err: Error, c: Context) => Response | Promise<Response>;

// paths.ts
export const SUPPORTED_METHODS = ["GET","POST","PUT","PATCH","DELETE"] as const;
export function normalizeMethod(m: string): string;
export function toOapiPath(path: string): string;
export type ParamToken = { name: string; optional: boolean };
export function parseParamTokens(path: string): ParamToken[];

// validation.ts
export function coerceDeep(schema: ArkType, data: Record<string,unknown>): Record<string,unknown>;
export function arktypeValidator(target:"json"|"query"|"header"|"param", schema:ArkType): MiddlewareHandler;

// registry.ts
export type ComponentRegistry = { schemas: Map<string,JsonSchema>; securitySchemes: Map<string,AuthScheme> };
export function rewriteRefs(node: unknown, rename: Map<string,string>): void;
export async function sha1Hex(data:string): Promise<string>;
export async function schemaToOA(schema: ArkType, registry: ComponentRegistry): Promise<JsonSchema>;

// openapi.ts
export class APIError extends Error { constructor(public status: ContentfulStatusCode, message: string) }
export function createErrorHandler(debug?: boolean): ErrorHandler;
export interface RouteConfig { method: Method; path: string; request?: {...}; responses?: Record<number,ArkType>; /* tags etc */ }
export interface StoredRoute { method:string; oapiPath:string; config:RouteConfig; handler:RouteHandler }
export class OpenAPIHono<E extends Env> extends Hono<E> { _routes: StoredRoute[]; _components: ComponentRegistry; openapi(); doc(); registerSecurityScheme(); private _buildSpec(); private _buildResponses(); }

// api.ts
export type ParamRecord<S> = ...;
export type ParamsFromPath<P> = ...;
export type ReqFor<P,B,Q,H,E extends Env> = ParamsFromPath<P> & {body?} & {query?} & {headers?} & {c:Context<E>};
export type AuthField<Auth> = [Auth] extends [undefined] ? {} : {auth:Auth};
export type RouteFields<P,B,Q,H> = { method:Method; path:P; body?:B; query?:Q; headers?:H; responses?; middleware?; tags?; summary?; description?; status?; operationId?; deprecated? };
export function createApi<Auth=undefined, E extends Env>(opts?:{title?,version?,debug?}): {app:OpenAPIHono<E>; api: ApiWithHelpers; auth: (name:string,mw:(c:Context<E>)=>Auth,scheme?:AuthScheme)=>void; docs: (...args)=>void };
```

### 3.3 Relationships (ER-ish)

```
createApi<Auth,Env> --creates 1--> OpenAPIHono<Env> (app)
createApi --owns *--> AuthRegistration(name, wrappedMw, scheme)
createApi.api --translates RouteFields<P,B,Q,H> --> RouteConfig
RouteConfig --contains 0..1--> ArkType (body) --toJsonSchema--> JsonSchema --hoisted--> ComponentRegistry.schemas
RouteConfig --contains 0..1--> ArkType (query) --coerced via coerceDeep--> validated query
RouteConfig --contains 0..1--> ArkType (headers)
RouteConfig --contains 0..*--> MiddlewareHandler[] (auth mw prepended + user middleware)
OpenAPIHono --stores *--> StoredRoute --holds 1--> RouteConfig + RouteHandler
OpenAPIHono --owns 1--> ComponentRegistry
OpenAPIHono --owns 1--> ErrorHandler (createErrorHandler)
StoredRoute --derived--> ParamToken[] (parseParamTokens) --builds--> request.params ArkType (type({name:"string"|"string?"}))
StoredRoute --derived--> oapiPath (toOapiPath)
OpenAPIHono._buildSpec --reads *--> StoredRoute + ComponentRegistry --produces 1--> OpenAPISpec
OpenAPISpec --contains *--> OpenAPIOperation --contains *--> OpenAPIParameter --schema--> JsonSchema (or $ref)
ArktypeValidator --throws--> APIError(400) --caught by--> ErrorHandler (onError chokepoint)
ApiHandler --throws--> APIError(* ) or unexpected Error --caught by--> ErrorHandler
ApiHandler --receives--> HandlerReq (flat params + nested body/query/headers + auth? + c)
DocsMount --mounted on--> OpenAPIHono (GET specPath + GET uiPath via Scalar apiReference)
Hono Env<E> --threads through--> Context<E> --typed via--> createApi<Auth,E> --> auth mw (c:Context<E>) and ReqFor.c
```

### 3.4 Constraints & Invariants (checklist for implementation)

**Path / Method:**
- [ ] `config.path` must start with `/` — runtime `throw`.
- [ ] `normalizeMethod` case-insensitive, only `GET,POST,PUT,PATCH,DELETE` — runtime `throw Unsupported method: ${m}` with helpful join.
- [ ] `toOapiPath` deterministic: regex `:name{regex}?` → `{name}`, `*` → `{wildcard}`; applied identically in `api.ts` (for params ArkType) and `openapi.ts` (for oapiPath).
- [ ] `ParamToken` regex `#/ :([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)?/g` — captures `optional = !!?`. Supports `:id?`, `:id{[0-9]+}`, `:id{[0-9]+}?`, `:postId`, `:*`? No `:id?` inside `*`. Wildcard is `*` → `{wildcard}` lowercased.

**Req shape:**
- [ ] `ParamsFromPath<P>` type-level matches runtime `paramTokens` derivation — keep the two regexes in sync or extract `parseParamTokens` shared.
- [ ] Handler `req` flattening: `Object.assign(req, valid("param"))` when `paramTokens.length>0`, plus `req.body/query/headers` if declared, `req.auth` if `c.get("auth") !== undefined`, `req.c = c` always.
- [ ] `ReqFor` intersections preserve `noUncheckedIndexedAccess` — optional params `string | undefined`.

**Auth:**
- [ ] `auth()` wrapping preserves `this` via `c.set("auth", ctx)` with cast — no `c.get` until handler.
- [ ] `security` only emitted if `authSchemes.has(authName)` — avoids phantom auth docs.
- [ ] `AuthField<Auth>` conditional makes `req.auth` absent when `Auth=undefined`.

**Validation / Coercion (must hold before any `schema(data)`):**
- [ ] `coerceDeep` reads `schema.toJsonSchema()` + `$defs` to resolve refs — handles `number|integer/number`, `boolean`, `array` (element-wise), `object` (JSON-parse string then walk `properties`).
- [ ] Guard: `if raw===undefined` / `trim()===""` → skip coercion (preserves 400).
- [ ] Array single-string wrapping: `typeof raw==="string"` with array schema → `return [coercedElement]`.
- [ ] Curried: `coerceDeep` walks top-level `json.properties` only if `isObjectSchema`; per-property delegates to `coerceValue`.

**OpenAPI emission:**
- [ ] `operationId` deterministic: `base = config.operationId ?? "${method}_${oapiPath.replace(/[{}]/g,"").replace(/\//g,"_")}"`, then `seen: Set`, `baseCounts: Map` → `_N` suffix. Collision-free even with user overrides.
- [ ] `ComponentRegistry` deduping: `if (!map.has(name)) map.set(name, json)`.
- [ ] `rewriteRefs` recursive, in-place, handles both object and array nodes; matches `#/$defs/(.+)` exactly.
- [ ] `schemaToOA`: `delete json.$schema`, if no `$defs` return early. Normalize refs to indices before hashing, `rename: Map<old,schema_<12hex>>`, `rewriteRefs(json,rename)`, hoist each def, `delete json.$defs`.
- [ ] `_addObjectParams` uses `_schemaToOA` then walks `json.properties` + `required` set; `header` name lowercased; respects `description` passthrough.
- [ ] `_buildResponses`: success `200/201/204` descriptions map; `successCode = status ?? first 2xx/3xx ?? "200"`; ensure that code exists; 204 no content; framework errors: compute `hasValidation` (any request.* or path has `:param`), `hasSecurity`, `hasPathParam`; use `if (!responses[key])` guard so explicit `responses:{404:schema}` suppresses heuristic; deduped error ref via `_getErrorSchemaRef`.
- [ ] `_getErrorSchemaRef` lazy: `type({error:"string"})` → `toJsonSchema`, `delete $schema`, `hash = sha1Hex(JSON.stringify(json))`, `name = schema_${hash}`, put once, return `{$ref: "#/components/schemas/${name}"}`.

**Error / Lifecycle:**
- [ ] `OpenAPIHono` ctor installs default `onError(createErrorHandler())`; `createApi()` overwrites with `createErrorHandler(debug)` — single policy object shared.
- [ ] `arktypeValidator` **throws** `APIError(400, summary)` — not `return c.json(...)` — so custom `onError` sees it (selfcheck #5).
- [ ] `createErrorHandler`: `isProd` checks `process.env.NODE_ENV==="production"` safely (`typeof process≠undefined`); `if(debug && isProd) warn`; `effectiveDebug = !!debug && !isProd` — stack only then.
- [ ] Handler return: `if result instanceof Response return result; if result===null return c.body(null, Number(successCode))` else `c.json(result, Number(successCode))`.

**Composition:**
- [ ] `docs(specPath|opts)` supports both overloads: `string|{specPath?,uiPath?}` → `specPath ?? "/openapi.json"`, `uiPath ?? "/docs"`; `app.doc(specPath, {openapi:"3.0.0", info:{title,version}})` + `app.get(uiPath, apiReference({spec:{url:specPath}}))`.
- [ ] Route import order matters — documented, not enforced — specific before generic.

---

## 4. Glossary Candidate List (22 terms)

| # | Term | Context | Definition (one-line) | Notes / Alias |
|---|---|---|---|---|
| 1 | **ApiBuilder** | A | Closure returned by `createApi()` holding `app`, maps, `opts`; facade over `OpenAPIHono`. | Setup singleton. |
| 2 | **RouteConfig** | C | Low-level `{method, path, request, responses, tags...}` consumed by `OpenAPIHono.openapi()`. | Distinguish from `RouteFields` (high-level generic). |
| 3 | **RouteFields** | A | Generic high-level config `{method, path:P, body?:B, query?:Q ...}` with ArkType generics for inference. | User-facing. |
| 4 | **StoredRoute** | C | Persisted `{method, oapiPath, config, handler}` in `_routes`. | Insertion-ordered. |
| 5 | **ParamToken** | A/C | Parsed `{name, optional}` from Hono path `:name`, `:name?`, `:name{regex}?`, `*`. | Regex `/:([a-z...` |
| 6 | **ParamsFromPath** | A | Type-level `ParamRecord` intersection deriving flat param keys from `P`. | `ReqFor` building block. |
| 7 | **ReqFor** | A | Handler req type `ParamsFromPath<P> & {body?} & {query?} & {headers?} & {c:Context<E>}`. | Flat params Encore-style. |
| 8 | **AuthField** | A | Conditional `{auth:Auth}` only when `Auth≠undefined`. | Controls presence. |
| 9 | **AuthRegistration** | D | `Map<string, MiddlewareHandler>` entry from `auth(name,mw,scheme?)` → wrapper doing `c.set("auth",ctx)`. | Return-based. |
| 10 | **AuthScheme** | D | OpenAPI security scheme union `http bearer/basic` or `apiKey {in,name}`. | Scalar lock icon. |
| 11 | **ArkType** | B | `Type<any,any>` alias with `.toJsonSchema()` + callable validation `schema(data)=>data\|ArkErrors`. | Peer dep `arktype`. |
| 12 | **ArktypeValidator** | B | `validator(target, fn)` middleware factory that coerces then validates and throws `APIError(400)` on `ArkErrors`. | Throws not returns. |
| 13 | **Coercion** | B | `coerceDeep/coerceValue` walk translating query/header strings → numbers/booleans/arrays before validation; skips empty/missing. | Deep + element-wise. |
| 14 | **OapiPath** | C | OpenAPI form `/{param}` derived via `toOapiPath` (`:x→{x}`, `*→{wildcard}`). | `paths` key. |
| 15 | **OperationId** | C | Unique `operationId` string per operation; default `method_oapiPath` with dedup `_2` suffix; override via `config.operationId`. | SDK generation. |
| 16 | **ComponentRegistry** | C | `{schemas:Map<string,JsonSchema>, securitySchemes:Map<string,AuthScheme>}` hoisting `$defs` to stable names. | `schema_<12hex>` keys. |
| 17 | **Stable hash name** | C | `schema_<sha1Hex(normalizeRefs(JSON.stringify(def))).slice(0,12)>` — content-hash, not counter. | `sha1Hex` via Web Crypto. |
| 18 | **RewriteRefs** | C | Recursive in-place `#/$defs/X` → `#/components/schemas/schema_<hash>` rewriting. | `rewriteRefs(node, rename)`. |
| 19 | **DocsMount** | C | `docs(specPath, uiPath)` binding Scalar UI (`apiReference`) at `uiPath` with spec URL `specPath`. | Mount after routes. |
| 20 | **APIError** | E | `class APIError extends Error {status:ContentfulStatusCode, message}` — typed HTTP error thrown everywhere, rendered by `onError`. | Single chokepoint. |
| 21 | **fail / errors / httpErrors** | E | Object of helpers `fail.notFound(msg?) → new APIError(404,msg)` (11 codes) with two aliases. | Ergonomic throw. |
| 22 | **ErrorHandler** | E | `createErrorHandler(debug?) => (err,c)=>Response` policy: `APIError→c.json({error},status)` else 500 with optional debug stack/redaction. | Prod-gated debug. |
| — | **Ponytail** | Cross | Comment marker `ponytail:` denoting deliberate simplification with documented ceiling + upgrade path. | e.g., header lowercasing. |
| — | **Hono Env** | A/E | Generic `Env` threading `{Variables, Bindings}` through `Context<E>` via `createApi<Auth,Env>` → `ReqFor.c` + `auth` middleware. | `c.var.session`. |

---

## 5. ADR Outline (8 ADRs — 5 required + 3 recommended)

Format per ADR: **Context → Decision → Alternatives → Consequences (migration, testing, concurrency, docs)** — keep to half-page each for implementation.

### ADR-01 — Hono + ArkType as stack

*   **Context:** Need a runtime-agnostic (Node/Bun/Deno/Workers) HTTP layer with typed validation and OpenAPI derivation. Alternatives evaluated during v0.1. Existing agency: Hono already in `examples/*` via `serve`; ArkType provides `.toJsonSchema()` with `minimum/maximum` preservation (vs zod's similar, but ArkType's string DSL ` "1 <= number.integer <= 100"` maps well to query coercion + OpenAPI). Must support `strict` + `noUncheckedIndexedAccess`.
*   **Decision:** Choose `hono@^4.7` as base (`OpenAPIHono extends Hono`) + `arktype@^2.2` (`Type<any,any>`) directly, no adapter layer. ArkType's `toJsonSchema()` is the single source for both validation and spec.
*   **Alternatives:** (a) Hono + Zod (+ `zod-openapi` / `hono-openapi`); (b) Elysia (Bun-only); (c) tRPC (no REST/OpenAPI); (d) Hono + `arktype` via external validator lib but that duplicates coercion.
*   **Consequences:** Migration — n/a initial; swaps require rewriting all `type({})` schemas and coercion walk. Testing — lib selfcheck validates `minimum/maximum/integer` retained in spec; query coercion cases (Issue 03). Concurrency — stateless, no locks. Docs — README `peerDependencies`, `nub` install, ArkType DSL usage examples.

### ADR-02 — In-repo `OpenAPIHono` vs external OpenAPI lib

*   **Context:** Could reuse `hono-openapi` / `zod-openapi` / `chan` etc. But need deterministic emission (stable hash hoisting), framework-error deduction (400/401/404/500), header lowercasing, operationId collision handling, ponytail 404 heuristic — all coupled to runtime routing and coercion semantics.
*   **Decision:** Build `OpenAPIHono` in-repo (`src/openapi.ts`), ~700 LOC, with private `_routes`, `_components`, `_buildSpec`/`_schemaToOA`/`rewriteRefs`/`sha1Hex`. Use only Hono's `validator` helper + `apiReference` for UI.
*   **Alternatives:** (a) Adopt `hono-openapi` + transform; (b) Use `openapi3-ts` builder; (c) Keep legacy `hono` with separate spec tool.
*   **Consequences:** Migration — upgrading Hono internals requires pinning; `nub run check:dist` guards `dist`. Testing — `spec.snapshot.json` golden file + `No #/$defs` assertions; det harness for `$defs` hoisting. Concurrency — `_buildSpec` is async ( `sha1Hex` via Web Crypto) but `GET /openapi.json` handler is per-request, no shared mutation during build except lazy `_errorSchemaRef`. Docs — document that spec is at `/openapi.json`, not external file.

### ADR-03 — Side-effect registration & `setup.ts` singleton

*   **Context:** Ergonomics goal: `api()` top-level call registers a route without manually passing `app` around. Similar to Encore. Multi-file apps need shared state. Alternatives: class `app.openapi(config,handler)` everywhere (verbose), or explicit `app` import (loses generic `Auth`/`Env` plumbing).
*   **Decision:** `createApi()` returns closure-captured `app`; `setup.ts` calls it once and re-exports `{api,auth,docs,app}`; route files import `api` and call it at top level for side effects; `index.ts` imports route files for side effects then calls `docs()`.
*   **Alternatives:** (a) No singleton — each route file calls `createApi` (breaks one `app`); (b) Explicit `register(app, config, handler)`; (c) Decorator/config-object array.
*   **Consequences:** Migration — v0.1 already adopted; future linter could detect `createApi` called twice. Testing — `blog/selfcheck` imports `setup` then dynamic `import("./posts.js")` to ensure order. Concurrency — side effects run at import time, before `serve`; no race. Docs — `AGENTS.md` details mount order, singleton protectable pattern, route-order shadowing warning; auth-guarded docs recipe `app.use('/docs/*', mw)` before `docs()`.

### ADR-04 — Flat `req` shape (Encore-style) vs nested / Hono-native

*   **Context:** Hono gives `c.req.param`, `c.req.query`, `c.req.json`. Desired: `handler({id, body, query, auth, c})` with path params flat, fully typed. Decisions: where to put `auth`, whether to expose `c`, how optional `:id?` types.
*   **Decision:** Type-level `ReqFor = ParamsFromPath<P> & {body?}&{query?}&{headers?}&{c:Context<E>} & AuthField<Auth>`, runtime `req` is `Record<string,unknown>` with `Object.assign(req, valid("param"))` flattening, nested `body/query/headers`, `req.auth` if set, always `req.c`. Handler return → `c.json`/`c.body` by framework. `ParamRecord` optional handling mirrors path `?`.
*   **Alternatives:** (a) Nested `{params:{name}}` (mirrors Hono, worse ergonomics); (b) No `req.c` (blocks `session.save()`); (c) Callback `c` only (loses inference).
*   **Consequences:** Migration — changing shape is breaking; alias could map. Testing — selfchecks assert `({name})` destructuring. Concurrency — none. Docs — README flat-shape table, mutation examples.

### ADR-05 — Throwing validator + single `onError` chokepoint

*   **Context:** Early version returned `c.json(400)` directly from validator, bypassing custom `onError` (request IDs, logging, prod redaction). Need single policy for `APIError` + validation + unexpected throws.
*   **Decision:** `arktypeValidator` throws `new APIError(400, result.summary)` on `ArkErrors`; `OpenAPIHono` ctor installs `onError(createErrorHandler())`; `createApi` overrides with debug-aware version; shared `createErrorHandler` is the only policy; `api.ts` `fail` helpers construct `APIError`.
*   **Alternatives:** (a) Return `Response` from validator (current violation); (b) Separate validator error handler; (c) Next-style error middleware chain.
*   **Consequences:** Migration — fixed in `0.2.2` (Issue #4); `APIError` moved `api.ts → openapi.ts` to break cycle. Testing — selfcheck #5 `assertValidationErrorReachesOnError` mounts probe with failing body and counts `onError` invocations. Concurrency — `onError` is per-request Hono hook. Docs — `AGENTS.md` chokepoint section, `ponytail:` comment on log.

### ADR-06 — Stable content-hash component names + `$defs` hoisting

*   **Context:** ArkType `toJsonSchema()` emits `$defs: { intersection216: ... }` with counter names and dangling `#/$defs/` refs — unstable across runs, non-OpenAPI. Need deterministic `components.schemas` for snapshot tests and SDK stability.
*   **Decision:** `sha1Hex` via `crypto.subtle.digest("SHA-1")` → `schema_<12hex>`; build `name→index` map, `normalizeRefs(JSON.stringify(def))` replacing `#/$defs/name` → `#/$defs/index` before hashing, so hash depends on structure not counter; `rename: Map(old,stable)`, `rewriteRefs(json, rename)` in-place on body + nested defs; hoist to `_components.schemas`, `delete json.$defs` + `delete json.$schema`.
*   **Alternatives:** (a) Use ArkType's raw `intersectionN` names (unstable diffs); (b) Use hash of raw JSON without normalization (unstable on ref rename); (c) Use `uuid` (nondeterministic).
*   **Consequences:** Migration — run `nub run build` + `rm spec.snapshot.json && nub blog/selfcheck` to rebase snapshot after any hashing change (documented in AGENTS). Testing — selfcheck #4 asserts no `"$defs"`, no `#/$defs/`, all refs → `#/components/schemas/`, name regex `schema_[a-f0-9]{12}`. Concurrency — `sha1Hex` async but pure. Docs — snapshot workflow documented.

### ADR-07 — Framework-guaranteed 400/401/404/500 with ponytail 404 heuristic

*   **Context:** Spec should document `400` only where validation can happen, `401` only with security, `404` where resource lookup plausible, `500` always — sharing one `{error:string}` component. Heuristic avoids noisy 404 on every route.
*   **Decision:** `_buildResponses` auto-injects: 400 if `request.{body,query,headers,params}` or path has `:param`; 401 if `config.security` (i.e., `auth` with `AuthScheme`); 404 heuristic if path matches `:([a-z...` regex (ponytail: false-positive benign, ceiling `documentNotFound` opt-in or explicit `responses:{404}` guard `if (!responses["404"])` suppresses); 500 always; single `_getErrorSchemaRef()` deduped `{error:string}` component via `schema_<hash>`.
*   **Alternatives:** (a) Always emit 400/401/404/500 on every operation (noisy); (b) Never auto-emit (under-doc); (c) Explicit `errors:[400,404]` config array; (d) `documentNotFound:true` opt-in flag.
*   **Consequences:** Migration — `0.4.0` minor bump added 404 auto docs (change in generated spec → minor semver). Testing — blog/selfcheck spec asserts `/posts/{id}` has 404, `/health`→no 404, explicit `responses:{404}` suppresses, `_errorSchemaRef` deduped single key. Concurrency — none. Docs — ponytail comment with ceiling/upgrade path.

### ADR-08 — Deep coercion before validation

*   **Context:** Query/header arrive as strings (`?limit=5` → `"5"`), but ArkType `type({limit:"number.integer"})` expects `number`. Naive `Number()` at top level misses nested objects, arrays, booleans, and mis-coerces `""` → `0`. Issue #03 required deep element-wise coercion with correct empty/missing handling.
*   **Decision:** `coerceDeep` walks `schema.toJsonSchema()` object properties, `coerceValue` recurses per property schema (resolving `$ref` via `resolveRef`), handling `number|integer` (`Number` only if `!isNaN`), `boolean` (`"true"`/`"false"` only), `array` (element-wise, wrapping single string), `object` (JSON parse attempt + walk sub-properties). Guards preserve `undefined` and `trim()===""`.
*   **Alternatives:** (a) No coercion — require users `Number(q.limit)` (poor UX); (b) Shallow coercion only top-level primitives (miss nested/arrays); (c) Use `arktype`'s built-in coercion scopes (inconsistent with Hono's `validator` flow).
*   **Consequences:** Migration — coercion is additive; `GET /search?limit=5` previously could 400 now 200 correctly. Testing — Issue 03 cases: flat, nested `{filters:{limit:"number"}}`, arrays `?ids=1&ids=2` and `?ids=1`, booleans `?active=true`, empty `?limit=` remains 400. Concurrency — sync walk. Docs — header lowercasing caveat, array query shape guidance.

*Future ADR candidates:* `normalizeMethod` single helper, `docs()` overload shape, `204 null → c.body(null,status)` vs empty object, `Env` generics threading.

---

## 6. Implementation Guidance (no code yet — for next agent)

- **Order:** Keep facade (`api.ts`) thin — move only coercion helpers to `validation.ts` if ADR-08 extraction is approved; otherwise keep single-file `openapi.ts` to avoid premature split (current 700 LOC is maintainable).
- **Type imports:** `arktype` import is `import { type Type, type } from "arktype"` — preserve ESM `.js` extension.
- **Strictness:** `strict` + `noUncheckedIndexedAccess` — any new `obj[key]` needs guard.
- **Ponytails:** Keep `// ponytail: ...` markers for deliberate simplifications (`*→{wildcard}`, header lowercasing, dispatch cast).
- **Spec snapshot:** Golden `examples/blog/spec.snapshot.json` excluded via `biome.json` overrides — always regenerate via `rm spec.snapshot.json && nub examples/blog/selfcheck.ts` after emission changes.
- **Selfchecks:** No test framework — `nub src/openapi.selfcheck.ts` + `blog/basic/auth` as regression harness; add selfcheck assertions, not jest/vitest.

---

*Generated by domain-modeling agent for grill-with-docs. Next: produce `docs/adr/*` from §5 outline.*
