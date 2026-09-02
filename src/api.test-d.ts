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
