# 03: Make documented auth match runtime — auth-protected endpoints must always show 401 + security

## Source

Prioritized DX review — H1 (auth scheme coupling), reporter: peta-hono DX review.

## What to build

The generated OpenAPI spec must not claim a protected endpoint is public.

Today the spec derives `security` from `config.auth && authSchemes.has(config.auth)` (`src/api.ts:266`), and `authSchemes` is only populated when `auth()` is called with its optional `scheme` argument (`src/api.ts:182`). Live probe confirms the divergence:

| `auth()` registration | route `{auth:"required"}` → spec responses | `security` |
|---|---|---|
| `auth("required", mw)` — **no scheme** | `['200','500']` — **no 401** | `undefined` (no lock, no `components.securitySchemes`) |
| `auth("required", mw, {type:"http",scheme:"bearer"})` | `['200','401','500']` | `[{required:[]}]` |

In both cases the endpoint enforces 401 at runtime, but with no `scheme` the OpenAPI spec omits `401`, the security requirement, and the lock icon. This silently inverts the library's core value ("accurate auto-generated docs").

## Acceptance criteria

- [ ] For a route with `{ auth: "required" }`, the generated `/openapi.json` documents `401 Unauthorized` **and** a `security` requirement, **and** (if a scheme is registered) the matching `components.securitySchemes` entry — even when `auth()` was called without the `scheme` argument.
- [ ] The chosen mechanism is documented: either (a) auto-derive a default security scheme (e.g. `{type:"http",scheme:"bearer"}`) when `auth` is applied but no scheme is registered, or (b) always emit `401`/`security` and treat `scheme` as only affecting the lock-icon kind.
- [ ] `nub run typecheck` and `nub run check:all` (lib + basic + blog + auth) pass.
- [ ] `examples/blog/spec.snapshot.json` is regenerated (`rm && nub examples/blog/selfcheck.ts`) and reviewed — the protected routes should now carry `401` + `security`.
- [ ] README "How it works" explains the coupling: "the `scheme` argument controls the lock kind; a route with `auth` is always documented as protected."

## Blocked by

None (can start immediately).
