# 02: Typed handler request shapes from ArkType

**What to build:** Handlers registered via the high-level builder receive fully typed request objects derived from the ArkType schemas declared in the route config — body, query, and headers inferred from their ArkType instances, path params inferred from the path string, and auth context present only when the route opts into a named auth scheme.

**Blocked by:** 01: Rebuild and gate the published artifact

**Status:** done (committed 6c43e05)

- [x] A route declaring `body: type({ title: "string" })` yields `req.body: { title: string }` with autocomplete and compile-time errors on misspelled or missing fields; same for `query` and `headers`
- [x] Path params declared as `path: "/hello/:name"` appear as flat top-level `req.name: string` (and multi-param paths infer each token), without requiring `c.req.param` digging, and `req.c` remains the Hono context for session flows
- [x] `createApi<Auth>` with `auth: "required"` injects `req.auth: Auth` typed from the builder generic; routes without `auth` have no `auth` field, and mismatched auth usage is a type error
- [x] Verified via `nub run typecheck` (positive and negative inference cases) and `app.request()` happy-path checks for `basic` and `blog` style routes, with no change to runtime status codes or response shapes
