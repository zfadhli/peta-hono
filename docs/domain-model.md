# Domain Model — ncore (Function-based API DSL on Hono + ArkType)

> Scope: `src/openapi.ts` (~700 LOC) + `src/api.ts` (~320 LOC) + `src/index.ts` barrel. Stateless library, no persistence. Generated 2026-08-26, hardening smell: divergent change + duplicated param regex.

---

## 1. Bounded Contexts / Module Ownership

### Current vs proposed

| Concern | Current home | Problem | Proposed home | Rule |
|---------|--------------|---------|---------------|------|
| **Path & Method** — `normalizeMethod`, `toOapiPath`, `PARAM_TOKEN_RE`, `parseParamTokens` | Duplicated regex `/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)?/g` in `api.ts` + `openapi.ts`; `toOapiPath` only in `openapi.ts` | Drift, two truths for `optional` | `src/paths.ts` (pure) — **implemented 2026-08-26, ADR-010** | Single `PARAM_TOKEN_RE` export; both contexts import. No business logic there. Barrel `src/index.ts` re-exports `normalizeMethod` (`import { normalizeMethod } from "peta-hono"` per CHANGELOG 0.5.0 fix 0.5.1). |
| **Coercion** — `coerceDeep`, `coerceValue`, `resolveRef`, `is*Type` | `openapi.ts` private (~120 LOC) | Divergent change: spec + validation change together | `src/validation.ts` | Validation owns coercion; spec only borrows `JsonSchema` shape. |
| **Validation** — `arktypeValidator(target,schema)` | `openapi.ts` | Same | `src/validation.ts` | Throws `APIError(400)` — depends on `errors.ts` kernel, not `openapi.ts`. |
| **Registry & Hoisting** — `ComponentRegistry`, `sha1Hex`, `rewriteRefs`, `_schemaToOA`, `_getErrorSchemaRef` | `openapi.ts` private | Spec + hash + crypto mixed into routing class | `src/registry.ts` | Pure functions `(schema, registry) => JsonSchema`; async hash isolated. |
| **Error Kernel** — `APIError`, `ErrorHandler`, `createErrorHandler`, `fail` | `APIError`+`createErrorHandler` in `openapi.ts`, `fail` in `api.ts` | Cycle risk (`validator → APIError`) | `src/errors.ts` | Kernel, no deps on Hono/ArkType. Both `validation` and `openapi` import. Solves circular `api ↔ openapi`. |
| **OpenAPI Emission** — `OpenAPIHono`, `_routes`, `_buildSpec`, `_buildResponses`, `_addObjectParams`, `doc()` | `openapi.ts` class | God class (routing + spec + registry + errors) | `src/openapi.ts` (orchestrator, <300 LOC after extraction) | Injects `paths`, `validation`, `registry`, `errors`. Owns only Hono dispatch + `StoredRoute[]`. |
| **DSL Facade** — `createApi`, `api()` overloads, `api.get()` shorthands (`ApiMethodHelper`), `auth()` wrap, `docs()`, `ReqFor`, `ParamsFromPath`, `RouteFields` | `src/api.ts` | Leaked `ReturnType` shorthand collapsed overloads (grilling 02) | `src/api.ts` (facade) — **fixed 2026-08-26: `ApiMethodHelper<Auth,E>` explicit two-overload interface** | Depends on `paths` + `openapi` + `errors` + `validation` types only. No `coerce*` or `sha1Hex`. |

### Bounded contexts (DDD)

| Context | Language | Proposed module | Owns | Depends on |
|---------|----------|-----------------|------|------------|
| **A. DSL & Composition** | `ApiBuilder`, `RouteFields`, `ReqFor`, `AuthField` | `src/api.ts` | `createApi<Auth,Env>` closure, overloads, `auth()` → `c.set("auth",ctx)`, `docs()` mount | `paths`, `openapi` (RouteConfig), `errors` |
| **B. Validation & Coercion** | `ArktypeValidator`, `Coercion` | `src/validation.ts` | `coerceDeep/coerceValue`, `arktypeValidator` (throws `APIError(400)`) | `errors` (kernel), `ArkType` |
| **C. Routing & Paths** | `ParamToken`, `OapiPath`, `NormalizedMethod` | `src/paths.ts` | `PARAM_TOKEN_RE`, `parseParamTokens`, `toOapiPath`, `normalizeMethod`, `SUPPORTED_METHODS` | none (pure) |
| **D. Spec & Registry** | `ComponentRegistry`, `Stable hash`, `RewriteRefs` | `src/registry.ts` | `sha1Hex`, `rewriteRefs`, `schemaToOA`, `getErrorSchemaRef`, `ComponentRegistry` | `errors` (for JsonSchema type) |
| **E. Auth & Security** | `AuthScheme`, `SecurityScheme`, `SecurityRequirement` | `src/api.ts` + `src/openapi.ts` (`registerSecurityScheme`) + new `src/auth/` (built-in strategies: session / jwt / oauth) | `auth()` maps, strategy handles, `components.securitySchemes` | `paths`, `openapi` (SecurityScheme) |
| **Kernel. Error & Lifecycle** | `APIError`, `ErrorHandler`, `fail` | `src/errors.ts` | `APIError`, `createErrorHandler(debug?)`, `fail/errors/httpErrors` | none |

**Invariant:** dependency direction is `A → C, E, Kernel` and `C(orchestrator) → B, C, D, Kernel`. Never `B → C` or `D → A` (acyclic).

### Action checklist

- [x] Extract `src/paths.ts` first (ADR-010) — 1 constant + 2 functions, zero risk. **Done 2026-08-26** — `src/paths.ts` canonical, `src/index.ts` barrel now re-exports `normalizeMethod` (patch 0.5.1). `toOapiPath` header ponytail moved to `_addObjectParams`.
- [x] Header lowercasing user-facing doc — README `How it works` + `Features` + AGENTS `Key patterns` now state lowercase keys; glossary `Coercion`/`Ponytail` amended (see 2026-08-26 patch).
- [x] Fix shorthand overload collapse — `ApiMethodHelper<Auth,E>` replaces `ReturnType<typeof makeMethodHelper>` (ADR-009, grilling 02) — negative `api.get` with `auth` on `createApi<undefined>` now errors, matching classic `api()`.
- [x] Clarify 400 auto-doc on param routes — `_buildResponses` `hasParamTokens` intentionally documents `400` for `GET /:id` (b6354f3); `src/openapi.ts` comment + ADR-007 now state `OR path has :param` and `Guard if(!responses["400"])` respects explicit `responses:{400}`. **2046-08-27 (issue #05): `hide400` opt-out added** so a pure `:param` route can suppress the auto 400 entirely.
- [ ] Extract `src/errors.ts` — move `APIError`+`createErrorHandler`+`fail` there; re-export from `openapi.ts`/`api.ts` for barrel stability.
- [ ] Extract `src/validation.ts` — after `errors.ts` exists (breaks cycle).
- [ ] Defer `src/registry.ts` split until `openapi.ts` >800 LOC or second divergent change (ADR-011 — Proposed, not now).

---

## 2. Glossary (Ubiquitous Language)

Source of truth for naming; ADRs reference these terms. See `docs/glossary.md` for full 25-term registry.

| Term | Context | Type | Definition | Constraint / Example |
|------|---------|------|------------|----------------------|
| **RouteConfig** | OpenAPI | Entity input | Low-level `{method:Method, path:string(Hono), request?:{body?,query?,headers?,params?:ArkType}, responses?:Record<number,ArkType>, tags?, summary?, security?, middleware?, status?, operationId?, deprecated?}` consumed by `OpenAPIHono.openapi()` | `path` must start with `/`; `method` via `normalizeMethod` |
| **ArkType** | Validation | VO | `Type<any,any>` — callable `schema(data)=>data\|ArkErrors` + `toJsonSchema(): JsonSchema`. Peer `arktype@^2.2.1` | Single source for validation + spec |
| **AuthScheme** | Auth/OpenAPI | VO | ` {type:"http", scheme:"bearer"\|"basic"} \| {type:"apiKey", in:"header"\|"query", name:string}` — narrow input to `auth(name,mw,scheme?)`; the wide emitted set is `SecurityScheme` | Scalar lock icon; `auth(name,mw,scheme?)` |
| **Method normalization** | Routing | VO | `normalizeMethod(m:string): string` — case-insensitive, throws `Unsupported method: ${m}. Use one of: GET, ...` | `SUPPORTED_METHODS=["GET","POST","PUT","PATCH","DELETE"]`; `type Method = HttpMethod \| Lowercase<HttpMethod> \| (string & {})` |
| **OapiPath** | OpenAPI | VO | OpenAPI form `/{param}` via `toOapiPath(path)` | `:name`→`{name}`, `:name{regex}`→`{name}`, `:name?`→`{name}`, `*`→`{wildcard}` |
| **PARAM_TOKEN_RE** | Routing | VO | `/ :([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)? /g` — shared constant for `parseParamTokens` | Captures `name` + `optional=!!?`. See ADR-010 |
| **Coercion** | Validation | Policy | `coerceDeep(schema, data)` + `coerceValue(prop, raw, defs)` deep walk of `JsonSchema` before `schema(data)`; `string→number/boolean/array/object` | Guards: `raw===undefined` or `trim()===""` never coerce → preserved for 400. Array single `"1"`→`[1]` |
| **ErrorHandler** | Kernel | Policy | `createErrorHandler(debug?) => (err,c)=>Response` — single chokepoint: `APIError→c.json({error},status)` else `console.error` + dev-gated `debug && (NODE_ENV==="development"||"test")` stack | `debug` is dev-only — **withholds** details (generic 500) unless NODE_ENV is explicitly development/test; warns if `debug && NODE_ENV==="production"` |
| **OperationId** | OpenAPI | VO | Unique `operationId` per `OpenAPIOperation` | Default `method_oapiPath` (`/`→`_`, `{}` stripped); collision → `_2`,`_3` via `seenOperationIds:Set` + `baseCounts:Map`; overridable via `config.operationId` |
| **ComponentRegistry** | OpenAPI | Aggregate | `{schemas:Map<string,JsonSchema>, securitySchemes:Map<string,SecurityScheme>}` — hoists `$defs` to stable names | Key `schema_<sha1Hex(normalizeRefs(JSON.stringify(def))).slice(0,12)>` |
| **StoredRoute** | OpenAPI | Entity | Persisted `{method:string(lower), oapiPath:string, config:RouteConfig, handler:RouteHandler}` in `_routes[]` insertion order | Drives both Hono dispatch (`this.on`) and `_buildSpec` iteration |
| **ArktypeValidator** | Validation | Middleware | `arktypeValidator(target:"json"\|"query"\|"header"\|"param", schema)` → `validator(target, fn)` that coerces then **throws `APIError(400, summary)`** on `ArkErrors` | Never returns `Response` — routes through `app.onError` (regression guard selfcheck #5) |
| **DocsMount** | OpenAPI | VO | `docs(specPath?,uiPath?)` or `docs({specPath?,uiPath?})` — `app.doc(specPath, {openapi:"3.0.0",info})` + `app.get(uiPath, apiReference({spec:{url:specPath}}))` | Must be called after side-effect route imports |

---

## 3. ADR Summaries

| ADR | Title | Status | One-line decision |
|-----|-------|--------|-------------------|
| [010](./adr/010-extract-param-token-re.md) | Extract `PARAM_TOKEN_RE` and share param parsing | **Accepted — implemented** | Single `src/paths.ts` constant + `parseParamTokens(path)` + re-exports; delete duplicated `matchAll` in `api.ts`/`openapi.ts`. |
| [011](./adr/011-split-openapi-by-responsibility.md) | Split `src/openapi.ts` by responsibility | **Proposed — deferred incremental** | Do **not** big-bang split at 700 LOC; extract `paths.ts` + `errors.ts` now, `validation.ts` next, defer `registry.ts` until >800 LOC / second divergent change. Justify: orchestration cohesion outweighs SRP cost today. |
| [012](./adr/012-built-in-auth-strategies.md) | Built-in auth strategies (session / JWT / Google OAuth) | **Accepted — implemented** | New `src/auth/` module: additive `auth.session/jwt/oauth/strategy` builders that register through the same `auth(name,mw,scheme?)` path; `SecurityScheme` is the new wide emitted type (cookie apiKey + oauth2) while `AuthScheme` (the `auth()` input) is unchanged; JWT is homegrown HS256 via Web Crypto (superseded by ADR-013); session is signed-cookie + pluggable store; OAuth is an authorization-code + PKCE flow with `onSuccess` as the only integration point. All opt-in, no breaking change. |
| [013](./adr/013-adopt-jose-for-jwt.md) | Adopt `jose` for the JWT layer | **Accepted — implemented** | First runtime dep for the JWT layer: `SignJWT`/`jwtVerify` replace hand-rolled JWS; opt-in `keys`/`kid` rotation, `jwks`, asymmetric (RS256/EdDSA), `algorithms` alg-pinning, and `refreshTransport` (HttpOnly refresh cookie via `CookieTransport`). Reverses ADR-012's "keep the tree light". |
| [014](./adr/014-adopt-noble-hashes-for-crypto-and-password.md) | Adopt `@noble/hashes` for crypto + opt-in password hashing | **Accepted — implemented** | `@noble/hashes` backs the shared crypto primitives (HMAC/SHA-256/random bytes) and the opt-in `peta-hono/password` scrypt helper. Node floor bumped to ≥20.19 (ESM-only v2); scrypt default (argon2id ~5× slower in JS). |

Full ADRs: `docs/adr/010-*.md`, `docs/adr/011-*.md`.

---

## 4. Entity / Value Object Sketch — `RouteConfig → StoredRoute → OpenAPIOperation` Pipeline

### Pipeline diagram

```
[User code]  RouteFields<P,B,Q,H>  (api.ts, generic, type-level ParamsFromPath)
      │  createApi().api(): translates + builds request.params ArkType + security
      ▼
  RouteConfig  {method, path:Hono, request, responses, security, middleware, status, operationId?, deprecated?}
      │  OpenAPIHono.openapi(config, handler): normalizeMethod, toOapiPath, parseParamTokens, assemble mws
      ▼
  StoredRoute  {method:NormalizedMethod(lower), oapiPath, config, handler:RouteHandler}
      │  _routes[] append-only (insertion order = Hono registration order = spec iteration order)
      ▼  GET /openapi.json → _buildSpec()
  OpenAPIOperation  {operationId, parameters[], requestBody?, responses{}, security?, tags/summary/deprecated}
      │  + rewritten $refs, hoisted components, framework 400/401/404/500 injection
      ▼
  OpenAPISpec  {openapi:"3.0.0", info, paths: Record<OapiPath, Record<method, OpenAPIOperation>>, components}
```

### Ownership & cardinality

```
createApi<Auth,Env> --1--- OpenAPIHono<Env> --*--> StoredRoute --1--> RouteConfig
RouteConfig --0..1--> ArkType (body|query|headers|params) --toJsonSchema--> JsonSchema --hoisted--> ComponentRegistry
StoredRoute --derived--> ParamToken[] --builds--> request.params ArkType (if omitted)
StoredRoute --derived--> OapiPath (toOapiPath)
OpenAPIHono --1--> ComponentRegistry --*--> schema_<12hex> : JsonSchema
StoredRoute --1..1--> OpenAPIOperation (per _buildSpec iteration)
```

### Value objects & entities (sketch)

```ts
// src/paths.ts — pure, no deps (IMPLEMENTED, ADR-010)
export const SUPPORTED_METHODS = ["GET","POST","PUT","PATCH","DELETE"] as const;
export type HttpMethod = typeof SUPPORTED_METHODS[number];
export type Method = HttpMethod | Lowercase<HttpMethod> | (string & {});
export const PARAM_TOKEN_RE = /:([a-zA-Z0-9_]+)(?:\{[^}]+\})?(\?)?/g;
export type ParamToken = { name: string; optional: boolean };
export function parseParamTokens(path: string): ParamToken[]; // matchAll(PARAM_TOKEN_RE)
export function normalizeMethod(m: string): string; // lower, validate
export function toOapiPath(path: string): string;   // :x→{x}, *→{wildcard}

// src/errors.ts — kernel, no deps (PROPOSED — not yet extracted; currently in openapi.ts + api.ts)
export class APIError extends Error { constructor(public status: ContentfulStatusCode, msg: string) }
export type ErrorHandler = (err: Error, c: Context) => Response | Promise<Response>;
export function createErrorHandler(debug?: boolean): ErrorHandler;
export const fail: Record<"badRequest"|"notFound"|..., (msg?:string)=>APIError>;

// src/validation.ts — depends on errors + ArkType (PROPOSED — not yet extracted; currently in openapi.ts)
export type ArkType = Type<any,any>;
export function coerceDeep(schema: ArkType, data: Record<string,unknown>): Record<string,unknown>;
export function coerceValue(expected: JsonSchema, raw: unknown, defs?: Record<string,JsonSchema>): unknown;
export function arktypeValidator(target:"json"|"query"|"header"|"param", schema: ArkType): MiddlewareHandler;

// src/registry.ts — pure + Web Crypto (PROPOSED — deferred until openapi.ts > 800 LOC / second divergent change, ADR-011)
export type ComponentRegistry = { schemas: Map<string,JsonSchema>; securitySchemes: Map<string,SecurityScheme> };
export function rewriteRefs(node: unknown, rename: Map<string,string>): void;
export function sha1Hex(data: string): Promise<string>;
export function schemaToOA(schema: ArkType, registry: ComponentRegistry): Promise<JsonSchema>;

// src/openapi.ts — orchestrator (IMPLEMENTED)
export interface RouteConfig { method: Method; path: string; request?:{body?,query?,headers?,params?:ArkType}; responses?:Record<number,ArkType>; tags?; summary?; description?; security?; middleware?; status?; operationId?; deprecated?; hide400? }
export interface StoredRoute { method: string; oapiPath: string; config: RouteConfig; handler: RouteHandler }
export type RouteHandler = (req: Record<string,unknown>)=> Record<string,unknown>|null | Promise<...>;
export class OpenAPIHono<E extends Env> extends Hono<E> {
  private _routes: StoredRoute[]; private _components: ComponentRegistry; private _errorSchemaRef: JsonSchema|null;
  openapi(config: RouteConfig, handler: RouteHandler): void;
  doc(url: string, info: {openapi?:string; info:{title:string;version:string}}): void;
  registerSecurityScheme(name:string, scheme:SecurityScheme): void;
  private _buildSpec(...): Promise<OpenAPISpec>; private _buildResponses(...); private _addObjectParams(...);
}

// src/api.ts — facade, generic inference (IMPLEMENTED)
export type ParamRecord<S extends string> = ...; // :id? → {id?:string}
export type ParamsFromPath<P extends string> = ...; // recursive ParamRecord & ...
export type ReqFor<P,B,Q,H,E extends Env> = ParamsFromPath<P> & {body?:ArkInfer<B>} & {query?:ArkInfer<Q>} & {headers?:ArkInfer<H>} & {c:Context<E>} & AuthField<Auth>;
export type RouteFields<P,B,Q,H> = { method:Method; path:P; body?:B; query?:Q; headers?:H; responses?; middleware?; tags?; summary?; description?; status?; operationId?; deprecated?; hide400?; auth?:string };
export type ApiMethodHelper<Auth,E extends Env> = {
  <P extends string,B,Q,H>(path:P, config:RouteFieldsWithoutMethodPath<P,B,Q,H> & {auth?:undefined}, handler:(req:ReqFor<P,B,Q,H,E>)=>any): void;
  <P extends string,B,Q,H>(path:P, config:RouteFieldsWithoutMethodPath<P,B,Q,H> & {auth:string}, handler:(req:ReqFor<P,B,Q,H,E> & AuthField<Auth>)=>any): void;
}; // explicit, not ReturnType — fixes grilling 02 collapse
// makeMethodHelper<M>(method:M): ApiMethodHelper<Auth,E> delegates to api({method,path,...})
export function createApi<Auth=undefined,E extends Env>(opts?:{title?,version?,debug?}): { app:OpenAPIHono<E>; api: ApiWithHelpers; auth:(name:string,mw:(c:Context<E>)=>Auth,scheme?:AuthScheme)=>void; docs:(...args)=>void }; // ApiWithHelpers: api & {get:ApiMethodHelper, post:ApiMethodHelper, ...}
```

### Transformations & invariants (checklist)

| Stage | Derived field | How | Invariant |
|-------|---------------|-----|-----------|
| `RouteFields → RouteConfig` | `request.params` | If `parseParamTokens(path).length>0` and no explicit `params`, `type(Object.fromEntries(tokens.map(t=>[t.name, t.optional?"string?":"string"]))` | Type-level `ParamsFromPath` and runtime `parseParamTokens` use **same** `PARAM_TOKEN_RE` |
| `RouteFields → RouteConfig` | `security` | Every registered `auth()` publishes a security scheme (default `{type:"http",scheme:"bearer"}` when the `scheme` arg is omitted); `config.auth` → `[{[auth]:[]}]` | A route with `{auth}` is ALWAYS documented protected (401 + security + matching scheme); no dangling security ref |
| `RouteConfig → StoredRoute` | `method` | `normalizeMethod(config.method)` → lower | Throws on unsupported |
| `RouteConfig → StoredRoute` | `oapiPath` | `toOapiPath(config.path)` | `:x{regex}?`→`{x}`, `*`→`{wildcard}`; used as `paths` key |
| `RouteConfig → StoredRoute` | `paramTokens` | `parseParamTokens(config.path)` — used for validator + `req` flattening | Re-derived per `openapi()`, not stored |
| `StoredRoute → Operation` | `operationId` | `config.operationId ?? "${method}_${oapiPath.replace(/[{}]/g,"").replace(/\//g,"_")}"` + dedup `Set`+`Map` → `_2` | Unique across spec |
| `StoredRoute → Operation` | `parameters[]` | `_addObjectParams` via `schemaToOA` then `json.properties` + `required` set; header names lowercased (`paramName = name.toLowerCase()` when `in==="header"`) | Uses `schemaToOA` (hoisted), not raw `toJsonSchema`. **Invariant:** header schemas MUST use lowercase keys; `coerceDeep` does NOT auto-lowercase (strict 400). |
| `StoredRoute → Operation` | `responses` | `_buildResponses`: user `responses` + framework `400/401/404/500` with `if(!responses[key])` guard + single `getErrorSchemaRef()`; `400` triggers on `request.body/query/headers/params` **or** `hasParamTokens(path)` (auto-generated params), suppressed by `hide400`; `401` triggers on any `config.security`; success code = `status ?? lowest 2xx/3xx ?? 200` | Explicit `responses:{400}` replaces auto (and `hide400` suppresses it); explicit `responses:{404}` suppresses heuristic; success default is the LOWEST 2xx/3xx (set `status` for non-lowest) |
| `StoredRoute → Hono` | dispatch | `this.on(method, path, ...mws, handlerWrapper)` via `dispatch` cast | `handlerWrapper` flattens `valid("param")` → `req`, injects `auth`/`c`, maps `null→204`, `Response→passthrough`, else `c.json` |

### Handler runtime shape

```ts
// what handler receives (flat Encore-style)
type HandlerReq = {
  // flat path params (top-level)
  id: string; postId?: string;
  // nested validated payloads
  body?: unknown; query?: unknown; headers?: unknown;
  // auth & escape hatch
  auth?: Auth; c: Context<E>;
}
```

**Lifecycle:** `StoredRoute` is append-only; `_buildSpec` is per-request pure except lazy `_errorSchemaRef` (`Map.setIfAbsent` safe). Unmatched-route `app.notFound` now returns `application/json {error}` via the shared `createErrorHandler` policy (unified with `fail.notFound`) — the no-`notFound`-chokepoint gap is closed (formerly ADR-005 known gap).

---

## References

- `src/openapi.ts` — `OpenAPIHono`, `coerceDeep`, `toOapiPath`, `normalizeMethod`, `rewriteRefs`, `_buildSpec`
- `src/api.ts` — `createApi`, `ParamsFromPath`, `ReqFor`, `auth` wrapper
- `docs/glossary.md` — canonical term definitions
- `docs/adr/*` — 001–009 accepted, 010–011 proposed (this doc)
- `.scratch/grill-with-docs/domain-model.md` — prior 4-context sketch (700 LOC analysis)
