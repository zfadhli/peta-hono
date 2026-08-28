/**
 * Self-check for the built-in auth strategies.
 *
 * Covers:
 *   1. Session — create / cookie set / lookup via guard / destroy / logout
 *   2. JWT — issue access+refresh, verify access, rotate refresh, reuse-revoke
 *   3. OAuth (Google) — mount `/start` redirect + `/callback` code exchange
 *      against mocked token/userinfo endpoints, with PKCE state/code_verifier
 *   4. OpenAPI scheme emission — apiKey/in:cookie (session), bearer (jwt),
 *      oauth2/authorizationCode (google)
 *   5. Strategy coexistence — one app mixing session, jwt, oauth + a public route
 *   6. CSRF (opt-in) — double-submit token enforced on mutating requests
 *   7. auth.strategy unified dispatch — session/jwt/oauth via one spec
 *
 * ponytail: no test framework — runnable self-check with asserts, matching
 * src/openapi.selfcheck.ts and the example selfchecks. Cookie handling uses the
 * real Set-Cookie/request-Cookie round-trip (no server boot needed).
 */

import { type } from "arktype";
import { createApi } from "./api.js";

let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

/** Extract `name=value` from a Set-Cookie response header. */
function cookieValue(res: Response): string {
  const sc = res.headers.get("set-cookie");
  if (!sc) return "";
  const first = sc.split(";")[0]!;
  return first;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Session strategy
// ─────────────────────────────────────────────────────────────────────────────

async function sessionFlow(): Promise<void> {
  const { api, auth, docs, app } = createApi<{ userId: string }>({ title: "session" });

  const session = auth.session("session", {
    secret: "session-secret-32-chars-long!!",
    csrf: false,
  });

  api.post("/login", { body: type({ userId: "string" }) }, async ({ body, c }) => {
    await session.create(c, { userId: body.userId });
    return { ok: true };
  });
  api.get("/me", { auth: "session" }, async ({ auth }) => ({ userId: auth.userId }));
  api.post("/logout", { auth: "session", status: 204 }, async ({ c }) => {
    await session.destroy(c);
    return null;
  });
  docs();

  // Login → sets a session cookie
  let cookie = "";
  {
    const res = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice" }),
    });
    assert(res.status === 200, "login status 200");
    const body: any = await res.json();
    assert(body.ok === true, "login body ok");
    cookie = cookieValue(res);
    assert(cookie.startsWith("sid=") && cookie.length > "sid=".length, "login sets sid cookie");
  }

  // Guarded route with the session cookie → context flows
  {
    const res = await app.request("/me", { headers: { cookie: cookie } });
    assert(res.status === 200, "me status 200");
    const body: any = await res.json();
    assert(body.userId === "alice", "me userId from session");
  }

  // Guarded route without cookie → 401
  {
    const res = await app.request("/me");
    assert(res.status === 401, "me without cookie 401");
  }

  // Logout clears the session
  {
    const res = await app.request("/logout", { method: "POST", headers: { cookie: cookie } });
    assert(res.status === 204, "logout status 204");
    const cleared = cookieValue(res);
    assert(cleared.startsWith("sid="), "logout clears cookie");
    cookie = cleared; // now empty value
  }

  // Guarded route after logout → 401
  {
    const res = await app.request("/me", { headers: { cookie: cookie } });
    assert(res.status === 401, "me after logout 401");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. JWT strategy (access + rotation + reuse revocation)
// ─────────────────────────────────────────────────────────────────────────────

async function jwtFlow(): Promise<void> {
  const { api, auth, docs, app } = createApi<{ sub: string }>({ title: "jwt" });

  const jwt = auth.jwt("jwt", {
    secret: "jwt-secret-32-chars-long!!",
    issuer: "peta-hono",
    audience: "test",
    accessTtl: 900,
    refreshTtl: 3600,
  });

  api.post("/login", { body: type({ sub: "string" }) }, async ({ body }) => jwt.issue(body.sub));
  api.post("/refresh", { body: type({ refreshToken: "string" }) }, async ({ body }) =>
    jwt.refresh(body.refreshToken),
  );
  api.get("/me", { auth: "jwt" }, async ({ auth }) => ({ sub: auth.sub }));
  docs();

  const r1 = await app.request("/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sub: "user-1" }),
  });
  assert(r1.status === 200, "jwt login status 200");
  const t1: any = await r1.json();
  assert(
    typeof t1.accessToken === "string" && t1.accessToken.split(".").length === 3,
    "access token is JWS",
  );
  assert(typeof t1.refreshToken === "string", "refresh token issued");
  assert(typeof t1.expiresIn === "number", "expiresIn numeric");

  // Access token works on the guarded route
  {
    const res = await app.request("/me", {
      headers: { authorization: `Bearer ${t1.accessToken}` },
    });
    assert(res.status === 200, "me with access token 200");
    const body: any = await res.json();
    assert(body.sub === "user-1", "me sub from JWT");
  }

  // Guarded route rejects a bad token
  {
    const res = await app.request("/me", { headers: { authorization: "Bearer not.a.jwt" } });
    assert(res.status === 401, "me bad token 401");
  }

  // Refresh → rotation (new access + new refresh, old becomes single-use)
  const r2 = await app.request("/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: t1.refreshToken }),
  });
  assert(r2.status === 200, "refresh status 200");
  const t2: any = await r2.json();
  assert(t2.accessToken !== t1.accessToken, "rotated access token differs");
  assert(
    typeof t2.refreshToken === "string" && t2.refreshToken !== t1.refreshToken,
    "rotated refresh token differs",
  );

  // New access token works
  {
    const res = await app.request("/me", {
      headers: { authorization: `Bearer ${t2.accessToken}` },
    });
    assert(res.status === 200, "me with rotated access 200");
  }

  // Replaying the ORIGINAL (now rotated) refresh token ⇒ reuse detected ⇒ 401
  const r3 = await app.request("/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: t1.refreshToken }),
  });
  assert(r3.status === 401, "reuse of rotated refresh token 401");

  // The rotated token is now revoked too (family-wide revocation)
  const r4 = await app.request("/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: t2.refreshToken }),
  });
  assert(r4.status === 401, "family revoked after reuse 401");
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. OAuth (Google) strategy — mocked endpoints + PKCE
// ─────────────────────────────────────────────────────────────────────────────

async function oauthFlow(): Promise<void> {
  const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "oauth" });

  const tokenCalls: string[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (url.includes("/token")) {
      tokenCalls.push(String(typeof init?.body === "string" ? init.body : ""));
      return new Response(
        JSON.stringify({
          access_token: "mock_access",
          id_token: "mock_id",
          expires_in: 3600,
          scope: "openid email profile",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/userinfo")) {
      return new Response(
        JSON.stringify({
          sub: "google-123",
          email: "alice@example.com",
          name: "Alice",
          email_verified: true,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  };

  const google = auth.oauth("google", {
    clientId: "test-client-id",
    redirectUri: "http://localhost/auth/google/callback",
    scopes: ["openid", "email", "profile"],
    authorizationURL: "https://mock.example/auth",
    tokenURL: "https://mock.example/token",
    userInfoURL: "https://mock.example/userinfo",
    usePKCE: true,
    fetchFn,
    onSuccess: ({ user }) =>
      new Response(JSON.stringify({ email: user.email }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    onError: (err) =>
      new Response(JSON.stringify({ error: err.message }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
  });
  void google;

  api.get("/public", {}, async () => ({ ok: true }));
  docs();

  // Start → 302 redirect to the authorize URL, sets state cookie, PKCE challenge
  const startRes = await app.request("/auth/google/start");
  assert(startRes.status === 302, "oauth start 302");
  const location = startRes.headers.get("location") ?? "";
  assert(location.includes("client_id=test-client-id"), "start url has client_id");
  assert(
    location.includes("code_challenge=") && location.includes("code_challenge_method=S256"),
    "start uses PKCE",
  );
  const url = new URL(location);
  const state = url.searchParams.get("state") ?? "";
  assert(state.length > 0, "start url has state");
  const stateCookie = cookieValue(startRes);
  assert(stateCookie.startsWith("oauth_state="), "start sets state cookie");

  // Callback with a matching state + code → exchanges via mocked fetch, onSuccess runs
  const cbRes = await app.request(
    `/auth/google/callback?code=mock_code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: stateCookie } },
  );
  assert(cbRes.status === 200, "oauth callback 200");
  const cbBody: any = await cbRes.json();
  assert(cbBody.email === "alice@example.com", "oauth callback onSuccess user");
  assert(tokenCalls.length === 1, "token endpoint hit once");
  assert(tokenCalls[0]!.includes("code_verifier="), "token exchange sends PKCE code_verifier");

  // State mismatch / missing cookie → 400 (not 200)
  const badRes = await app.request("/auth/google/callback?code=mock_code&state=forged");
  assert(badRes.status === 400, "oauth bad state 400");
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. OpenAPI scheme emission + strategy coexistence
// ─────────────────────────────────────────────────────────────────────────────

async function openApiSchemes(): Promise<void> {
  const { api, auth, docs, app } = createApi<Record<string, unknown>>({
    title: "all",
    version: "1.0.0",
  });

  const sessionStore = auth.session("session", { secret: "session-secret-32-chars-long!!" });
  const jwtStore = auth.jwt("jwt", { secret: "jwt-secret-32-chars-long!!" });
  const googleStore = auth.oauth("google", {
    clientId: "cid",
    clientSecret: "csecret",
    redirectUri: "http://localhost/auth/google/callback",
    onSuccess: ({ user }) =>
      new Response(JSON.stringify({ email: user.email }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  });
  void sessionStore;
  void jwtStore;
  void googleStore;

  api.get("/s", { auth: "session" }, async () => ({}));
  api.get("/j", { auth: "jwt" }, async () => ({}));
  api.get("/pub", {}, async () => ({}));
  docs();

  const res = await app.request("/openapi.json");
  assert(res.status === 200, "spec status 200");
  const spec: any = await res.json();

  const schemes = spec.components?.securitySchemes ?? {};
  assert(schemes.session?.type === "apiKey", "session scheme is apiKey");
  assert(schemes.session?.in === "cookie", "session scheme in:cookie");
  assert(schemes.jwt?.type === "http" && schemes.jwt?.scheme === "bearer", "jwt scheme bearer");
  assert(schemes.google?.type === "oauth2", "oauth scheme is oauth2");
  assert(
    schemes.google?.flows?.authorizationCode?.authorizationUrl ===
      "https://accounts.google.com/o/oauth2/v2/auth",
    "oauth google authorize url",
  );
  const googleFlows = schemes.google?.flows?.authorizationCode ?? {};
  assert(googleFlows.scopes && googleFlows.scopes.openid !== undefined, "oauth scopes present");
  assert(googleFlows.tokenUrl === "https://oauth2.googleapis.com/token", "oauth token url");

  // Protected routes carry 401 + a `security` requirement; public route does not.
  const sOp = spec.paths?.["/s"]?.get;
  const jOp = spec.paths?.["/j"]?.get;
  const pubOp = spec.paths?.["/pub"]?.get;
  assert(sOp?.responses?.["401"], "session route documents 401");
  assert(
    Array.isArray(sOp?.security) && sOp.security[0]?.session !== undefined,
    "session route security",
  );
  assert(jOp?.responses?.["401"], "jwt route documents 401");
  assert(Array.isArray(jOp?.security) && jOp.security[0]?.jwt !== undefined, "jwt route security");
  assert(!pubOp?.security && !pubOp?.responses?.["401"], "public route has no security/401");
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Strategy coexistence
// ─────────────────────────────────────────────────────────────────────────────

async function coexistence(): Promise<void> {
  const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "mix" });
  const session = auth.session("session", { secret: "session-secret-32-chars-long!!" });
  const jwt = auth.jwt("jwt", { secret: "jwt-secret-32-chars-long!!" });

  api.get("/public", {}, async () => ({ kind: "public" }));
  api.get("/session-only", { auth: "session" }, async () => ({ kind: "session" }));
  api.get("/jwt-only", { auth: "jwt" }, async () => ({ kind: "jwt" }));
  api.post("/login", { body: type({ userId: "string" }) }, async ({ body, c }) => {
    await session.create(c, { userId: body.userId });
    return { ok: true };
  });
  api.post("/token", {}, async () => jwt.issue("user-1"));
  docs();

  let cookie = "";
  {
    const res = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice" }),
    });
    assert(res.status === 200, "coexist login 200");
    cookie = cookieValue(res);
  }
  {
    const res = await app.request("/session-only", { headers: { cookie } });
    assert(res.status === 200, "coexist session-only 200");
  }
  {
    const res = await app.request("/public");
    assert(res.status === 200, "coexist public 200");
  }
  {
    const tokenRes = await app.request("/token", { method: "POST" });
    const t: any = await tokenRes.json();
    const res = await app.request("/jwt-only", {
      headers: { authorization: `Bearer ${t.accessToken}` },
    });
    assert(res.status === 200, "coexist jwt-only 200");
  }
  {
    const res = await app.request("/session-only", { headers: { authorization: "Bearer x" } });
    assert(res.status === 401, "coexist session rejects bearer (cookie required)");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. CSRF (opt-in) — double-submit token enforced on mutating requests
// ─────────────────────────────────────────────────────────────────────────────

async function csrfFlow(): Promise<void> {
  const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "csrf" });
  const session = auth.session("session", { secret: "csrf-secret-32-chars-long!!", csrf: true });

  api.post("/login", { body: type({ userId: "string" }) }, async ({ body, c }) => {
    await session.create(c, { userId: body.userId });
    return { ok: true };
  });
  api.get("/csrf-token", {}, async ({ c }) => ({ csrfToken: await session.generateCsrf(c) }));
  api.post("/update", { auth: "session" }, async ({ auth }) => ({ userId: auth.userId }));
  docs();

  const login = await app.request("/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "alice" }),
  });
  assert(login.status === 200, "csrf login 200");
  const cookie = cookieValue(login);

  // Fetch a CSRF token bound to the session (GET is not a mutating request).
  const tok = await app.request("/csrf-token", { headers: { cookie } });
  assert(tok.status === 200, "csrf token 200");
  const { csrfToken } = (await tok.json()) as { csrfToken: string };
  assert(typeof csrfToken === "string" && csrfToken.length > 0, "csrf token issued");

  // Mutating route without the token → 403.
  const noTok = await app.request("/update", { method: "POST", headers: { cookie } });
  assert(noTok.status === 403, "csrf missing token 403");

  // With the token → 200.
  const withTok = await app.request("/update", {
    method: "POST",
    headers: { cookie, "x-csrf-token": csrfToken },
  });
  assert(withTok.status === 200, "csrf with token 200");

  // Wrong token → 403.
  const badTok = await app.request("/update", {
    method: "POST",
    headers: { cookie, "x-csrf-token": "not-the-token" },
  });
  assert(badTok.status === 403, "csrf wrong token 403");
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. auth.strategy(name, { type, ... }) unified dispatch
// ─────────────────────────────────────────────────────────────────────────────

async function strategyDispatch(): Promise<void> {
  const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "dispatch" });
  const session = auth.strategy("s2", { type: "session", secret: "dispatch-secret-32-chars!!" });

  api.post("/login", { body: type({ userId: "string" }) }, async ({ body, c }) => {
    await session.create(c, { userId: body.userId });
    return { ok: true };
  });
  api.get("/me", { auth: "s2" }, async ({ auth }) => ({ userId: auth.userId }));
  docs();

  const login = await app.request("/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ userId: "bob" }),
  });
  assert(login.status === 200, "dispatch login 200");
  const cookie = cookieValue(login);

  const me = await app.request("/me", { headers: { cookie } });
  assert(me.status === 200, "dispatch me 200");
  const { userId } = (await me.json()) as { userId: string };
  assert(userId === "bob", "dispatch session context");

  // The dispatch registers a real security scheme too.
  const spec = (await (await app.request("/openapi.json")).json()) as any;
  assert(spec.components?.securitySchemes?.s2?.in === "cookie", "dispatch scheme cookie");
}

console.log("=== Built-in auth strategy self-check ===");
console.log();

await check("Session create / lookup / logout", sessionFlow);
await check("JWT issue / verify / rotate / reuse-revoke", jwtFlow);
await check("OAuth (Google) start / callback with PKCE", oauthFlow);
await check("OpenAPI securitySchemes emitted", openApiSchemes);
await check("Strategies coexist in one app", coexistence);
await check("CSRF (opt-in) enforced on mutating requests", csrfFlow);
await check("auth.strategy unified dispatch", strategyDispatch);

console.log();
console.log(`Result: ${passed}/7 passed, ${failed} failed`);

if (failed > 0) process.exit(1);
