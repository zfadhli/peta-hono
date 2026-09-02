/**
 * Type-level regression guard for the method-shorthand overload contract (grilling 02 / spec S1).
 *
 * Convention: `*.test-d.ts` — Vitest type tests (run via `nub run check:all` / `vitest run`),
 * and type-checked by `nub run typecheck` (tsc --noEmit over src/ + examples/). NOT built into
 * dist/ (`*.test-d.ts` excluded by tsconfig.build.json) and not run at runtime.
 *
 * Pins the S1 contract: reading `auth` in a handler is a TYPE ERROR on a no-auth app
 * (createApi<undefined>) through BOTH the classic api() form and the shorthand api.get() form.
 * If `ApiMethodHelper<Auth,E>` ever regressed back to `ReturnType<typeof makeMethodHelper>`
 * (the overload-collapse bug), the `@ts-expect-error` directives below become unused and
 * `nub run typecheck` fails — proving the negative case stays a type error.
 *
 * Issue #11: the diagnostic the user sees is `Property 'auth' does not exist on type
 * 'ReqFor<...>'`. That means the route config is missing `auth: "required"` — the handler
 * only receives `auth` when the route declares it (or the app is registered with
 * `createApi<Auth>`). Add `auth: "required"` to the config to fix it. README "How it works"
 * documents this diagnostic so it is actionable without reading source.
 */
import { type AuthScheme, createApi, type SecurityScheme } from "./api.js";

// ── Positive: an authed app lets the handler read `auth` ──────────────
const authed = createApi<{ user: { id: string } }>({ title: "authed" });

authed.api(
  { method: "GET", path: "/a/:id", auth: "required" },
  ({ id, auth }) => `${id}|${auth.user.id}`,
);
authed.api.get("/a/:id", { auth: "required" }, ({ id, auth }) => `${id}|${auth.user.id}`);
authed.api.get("/public", {}, () => "ok");

// ── Negative: a no-auth app must REJECT reading `auth` in both forms ──
const noAuth = createApi<undefined>({ title: "no-auth" });

// Issue #11: this is the diagnostic users see — `auth` is not on the handler
// because the route is not auth-required. Add `auth: "required"` to fix it.
// @ts-expect-error — classic api(): no `auth` field on a no-auth app, handler must not read it
noAuth.api({ method: "GET", path: "/x", auth: "required" }, ({ auth }) => auth.user.id);

// @ts-expect-error — shorthand api.get(): no `auth` field on a no-auth app
noAuth.api.get("/x", { auth: "required" }, ({ auth }) => auth.user.id);

// ── `resolve` type contract (values in this section are referenced by the resolve field) ──
// Positive: a resolver's return value is type-inferred onto the handler, and a
// resolver on an authed route may read `auth`. R1 (accepted): resolver params are
// annotated explicitly — the guaranteed contract (inline arrows get implicit any
// under strict mode).
const authedResolve = createApi<{ sub: string }>({ title: "authed-resolve" });
authedResolve.api(
  {
    method: "GET",
    path: "/a/:id",
    auth: "required",
    resolve: { who: async ({ auth }: { auth: { sub: string } }) => auth.sub },
  },
  ({ who }) => who.toUpperCase(),
);
authedResolve.api.get(
  "/a/:id",
  {
    auth: "required",
    resolve: {
      post: async ({ id, auth }: { id: string; auth: { sub: string } }) => ({ id, who: auth.sub }),
    },
  },
  ({ post }) => post.id,
);

// Positive: absent `resolve` leaves the handler type unchanged (no `_` fields).
const noResolve = createApi<{ sub: string }>({ title: "no-resolve" });
noResolve.api.get("/plain/:id", {}, ({ id }) => id);

// Negative: a resolver cannot read `auth` on a no-auth app (auth is not on the
// resolver input). Must be a type error in BOTH the classic and shorthand forms.
// The resolver is hoisted so the config expression stays within lineWidth (100);
// an over-long inline config gets wrapped by the formatter, which breaks the
// suppression directive placement (it must sit on the error's anchor line).
const authReader = async ({ auth }: { auth: { user: { id: string } } }) => auth.user.id;
// @ts-expect-error — classic api(): resolver reads `auth` on a no-auth app
noAuth.api({ method: "GET", path: "/x", resolve: { thing: authReader } }, ({ thing }) => thing);
// @ts-expect-error — shorthand api.get(): resolver reads `auth` on a no-auth app
noAuth.api.get("/x", { resolve: { thing: authReader } }, ({ thing }) => thing);

// ── ADR-012 / blast-radius Fix 1: input vs emitted security-scheme types ──
// AuthScheme is the NARROW input passed to `auth(name, mw, scheme?)` (stable
// since v0.5.4: http bearer/basic + apiKey header/query). SecurityScheme is the
// WIDE emitted type (adds apiKey/in:cookie + oauth2). A wide scheme must NOT be
// assignable to AuthScheme — that pins the auth() input contract so an
// exhaustive switch over AuthScheme keeps compiling.
const cookieScheme: SecurityScheme = { type: "apiKey", in: "cookie", name: "sid" };
const oauth2Scheme: SecurityScheme = {
  type: "oauth2",
  flows: { authorizationCode: { authorizationUrl: "u", tokenUrl: "t", scopes: {} } },
};

// Bearer is a valid narrow AuthScheme input (unchanged from v0.5.4).
const bearerInput: AuthScheme = { type: "http", scheme: "bearer" };
// @ts-expect-error — cookie apiKey is wide, not a narrow AuthScheme input
const badCookieInput: AuthScheme = cookieScheme;
// @ts-expect-error — oauth2 is wide, not a narrow AuthScheme input
const badOauthInput: AuthScheme = oauth2Scheme;
void bearerInput;
void badCookieInput;
void badOauthInput;
