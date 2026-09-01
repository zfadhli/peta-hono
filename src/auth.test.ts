/**
 * Tests for the built-in auth strategies.
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
 * Cookie handling uses the real Set-Cookie/request-Cookie round-trip (no server
 * boot needed).
 */
import { type } from "arktype";
import type { Context } from "hono";
import { SignJWT } from "jose";
import { describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import { createCookieTransport, parseCookies, serializeCookie } from "./auth/cookie.js";
import { generateKey } from "./index.js";

/** Extract `name=value` from a Set-Cookie response header. */
function cookieValue(res: Response): string {
  const sc = res.headers.get("set-cookie");
  if (!sc) return "";
  const first = sc.split(";")[0]!;
  return first;
}

/** A minimal Hono `Context` stand-in exposing the header surface the cookie helpers use. */
function makeFakeContext() {
  const setCookies: string[] = [];
  let cookieHeader = "";
  const c = {
    req: {
      header(name: string) {
        return name === "Cookie" ? cookieHeader || null : null;
      },
    },
    header(_name: string, value: string) {
      setCookies.push(value);
    },
  } as unknown as Context;
  return {
    c,
    setCookies,
    applyLast() {
      const last = setCookies[setCookies.length - 1];
      if (last !== undefined) cookieHeader = last.split(";")[0]!;
    },
  };
}

describe("built-in auth strategies", () => {
  // ─────────────────────────────────────────────────────────────────────────
  // 1. Session strategy
  // ─────────────────────────────────────────────────────────────────────────

  it("Session create / lookup / logout", async () => {
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
      expect(res.status, "login status 200").toBe(200);
      const body: any = await res.json();
      expect(body.ok, "login body ok").toBe(true);
      cookie = cookieValue(res);
      expect(
        cookie.startsWith("sid=") && cookie.length > "sid=".length,
        "login sets sid cookie",
      ).toBe(true);
    }

    // Guarded route with the session cookie → context flows
    {
      const res = await app.request("/me", { headers: { cookie: cookie } });
      expect(res.status, "me status 200").toBe(200);
      const body: any = await res.json();
      expect(body.userId, "me userId from session").toBe("alice");
    }

    // Guarded route without cookie → 401
    {
      const res = await app.request("/me");
      expect(res.status, "me without cookie 401").toBe(401);
    }

    // Logout clears the session
    {
      const res = await app.request("/logout", { method: "POST", headers: { cookie: cookie } });
      expect(res.status, "logout status 204").toBe(204);
      const cleared = cookieValue(res);
      expect(cleared.startsWith("sid="), "logout clears cookie").toBe(true);
      cookie = cleared; // now empty value
    }

    // Guarded route after logout → 401
    {
      const res = await app.request("/me", { headers: { cookie: cookie } });
      expect(res.status, "me after logout 401").toBe(401);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 2. JWT strategy (access + rotation + reuse revocation)
  // ─────────────────────────────────────────────────────────────────────────

  it("JWT issue / verify / rotate / reuse-revoke", async () => {
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
    expect(r1.status, "jwt login status 200").toBe(200);
    const t1: any = await r1.json();
    expect(
      typeof t1.accessToken === "string" && t1.accessToken.split(".").length === 3,
      "access token is JWS",
    ).toBe(true);
    expect(typeof t1.refreshToken, "refresh token issued").toBe("string");
    expect(typeof t1.expiresIn, "expiresIn numeric").toBe("number");

    // Access token works on the guarded route
    {
      const res = await app.request("/me", {
        headers: { authorization: `Bearer ${t1.accessToken}` },
      });
      expect(res.status, "me with access token 200").toBe(200);
      const body: any = await res.json();
      expect(body.sub, "me sub from JWT").toBe("user-1");
    }

    // Guarded route rejects a bad token
    {
      const res = await app.request("/me", { headers: { authorization: "Bearer not.a.jwt" } });
      expect(res.status, "me bad token 401").toBe(401);
    }

    // An HS512-signed token is rejected because the strategy pins algorithms:["HS256"]
    // (alg-confusion closed).
    {
      const hs512Token = await new SignJWT({ sub: "user-1" })
        .setProtectedHeader({ alg: "HS512" })
        .setExpirationTime("1m")
        .sign(new TextEncoder().encode("jwt-secret-32-chars-long!!"));
      const payload = await jwt.verifyAccess(hs512Token);
      expect(payload, "HS512 token rejected (alg pinned to HS256)").toBeNull();
    }

    // Refresh → rotation (new access + new refresh, old becomes single-use)
    const r2 = await app.request("/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: t1.refreshToken }),
    });
    expect(r2.status, "refresh status 200").toBe(200);
    const t2: any = await r2.json();
    expect(t2.accessToken, "rotated access token differs").not.toBe(t1.accessToken);
    expect(
      typeof t2.refreshToken === "string" && t2.refreshToken !== t1.refreshToken,
      "rotated refresh token differs",
    ).toBe(true);

    // New access token works
    {
      const res = await app.request("/me", {
        headers: { authorization: `Bearer ${t2.accessToken}` },
      });
      expect(res.status, "me with rotated access 200").toBe(200);
    }

    // Replaying the ORIGINAL (now rotated) refresh token ⇒ reuse detected ⇒ 401
    const r3 = await app.request("/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: t1.refreshToken }),
    });
    expect(r3.status, "reuse of rotated refresh token 401").toBe(401);

    // The rotated token is now revoked too (family-wide revocation)
    const r4 = await app.request("/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: t2.refreshToken }),
    });
    expect(r4.status, "family revoked after reuse 401").toBe(401);
  });

  // JWT alg-pinning guard: the accepted `algorithms` must include the signing
  // alg (HS256), else the strategy would reject its own tokens — fail fast.
  it("JWT alg-pinning guard (HS256 must be accepted)", async () => {
    const { auth } = createApi<Record<string, unknown>>({ title: "alg-guard" });
    let threw = false;
    try {
      auth.jwt("jwt", { secret: "jwt-secret-32-chars-long!!", algorithms: ["HS512"] });
    } catch {
      threw = true;
    }
    expect(threw, "jwt throws when algorithms excludes the signing alg HS256").toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 3. OAuth (Google) strategy — mocked endpoints + PKCE
  // ─────────────────────────────────────────────────────────────────────────

  it("OAuth (Google) start / callback with PKCE", async () => {
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
    expect(startRes.status, "oauth start 302").toBe(302);
    const location = startRes.headers.get("location") ?? "";
    expect(location.includes("client_id=test-client-id"), "start url has client_id").toBe(true);
    expect(
      location.includes("code_challenge=") && location.includes("code_challenge_method=S256"),
      "start uses PKCE",
    ).toBe(true);
    const url = new URL(location);
    const state = url.searchParams.get("state") ?? "";
    expect(state.length > 0, "start url has state").toBe(true);
    const stateCookie = cookieValue(startRes);
    expect(stateCookie.startsWith("oauth_state="), "start sets state cookie").toBe(true);

    // Callback with a matching state + code → exchanges via mocked fetch, onSuccess runs
    const cbRes = await app.request(
      `/auth/google/callback?code=mock_code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: stateCookie } },
    );
    expect(cbRes.status, "oauth callback 200").toBe(200);
    const cbBody: any = await cbRes.json();
    expect(cbBody.email, "oauth callback onSuccess user").toBe("alice@example.com");
    expect(tokenCalls.length, "token endpoint hit once").toBe(1);
    expect(
      tokenCalls[0]!.includes("code_verifier="),
      "token exchange sends PKCE code_verifier",
    ).toBe(true);

    // State mismatch / missing cookie → 400 (not 200)
    const badRes = await app.request("/auth/google/callback?code=mock_code&state=forged");
    expect(badRes.status, "oauth bad state 400").toBe(400);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 4. OpenAPI scheme emission + strategy coexistence
  // ─────────────────────────────────────────────────────────────────────────

  it("OpenAPI securitySchemes emitted", async () => {
    const { api, auth, docs, app } = createApi<Record<string, unknown>>({
      title: "all",
      version: "1.0.0",
    });

    const sessionStore = auth.session("session", {
      secret: "session-secret-32-chars-long!!",
      csrf: false,
    });
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
    expect(res.status, "spec status 200").toBe(200);
    const spec: any = await res.json();

    const schemes = spec.components?.securitySchemes ?? {};
    expect(schemes.session?.type, "session scheme is apiKey").toBe("apiKey");
    expect(schemes.session?.in, "session scheme in:cookie").toBe("cookie");
    expect(
      schemes.jwt?.type === "http" && schemes.jwt?.scheme === "bearer",
      "jwt scheme bearer",
    ).toBe(true);
    expect(schemes.google?.type, "oauth scheme is oauth2").toBe("oauth2");
    expect(
      schemes.google?.flows?.authorizationCode?.authorizationUrl ===
        "https://accounts.google.com/o/oauth2/v2/auth",
      "oauth google authorize url",
    ).toBe(true);
    const googleFlows = schemes.google?.flows?.authorizationCode ?? {};
    expect(googleFlows.scopes?.openid !== undefined, "oauth scopes present").toBe(true);
    expect(googleFlows.tokenUrl, "oauth token url").toBe("https://oauth2.googleapis.com/token");

    // Protected routes carry 401 + a `security` requirement; public route does not.
    const sOp = spec.paths?.["/s"]?.get;
    const jOp = spec.paths?.["/j"]?.get;
    const pubOp = spec.paths?.["/pub"]?.get;
    expect(sOp?.responses?.["401"], "session route documents 401").toBeTruthy();
    expect(
      Array.isArray(sOp?.security) && sOp.security[0]?.session !== undefined,
      "session route security",
    ).toBe(true);
    expect(jOp?.responses?.["401"], "jwt route documents 401").toBeTruthy();
    expect(
      Array.isArray(jOp?.security) && jOp.security[0]?.jwt !== undefined,
      "jwt route security",
    ).toBe(true);
    expect(!pubOp?.security && !pubOp?.responses?.["401"], "public route has no security/401").toBe(
      true,
    );
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 5. Strategy coexistence
  // ─────────────────────────────────────────────────────────────────────────

  it("Strategies coexist in one app", async () => {
    const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "mix" });
    const session = auth.session("session", {
      secret: "session-secret-32-chars-long!!",
      csrf: false,
    });
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
      expect(res.status, "coexist login 200").toBe(200);
      cookie = cookieValue(res);
    }
    {
      const res = await app.request("/session-only", { headers: { cookie } });
      expect(res.status, "coexist session-only 200").toBe(200);
    }
    {
      const res = await app.request("/public");
      expect(res.status, "coexist public 200").toBe(200);
    }
    {
      const tokenRes = await app.request("/token", { method: "POST" });
      const t: any = await tokenRes.json();
      const res = await app.request("/jwt-only", {
        headers: { authorization: `Bearer ${t.accessToken}` },
      });
      expect(res.status, "coexist jwt-only 200").toBe(200);
    }
    {
      const res = await app.request("/session-only", { headers: { authorization: "Bearer x" } });
      expect(res.status, "coexist session rejects bearer (cookie required)").toBe(401);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 6. CSRF (opt-in) — double-submit token enforced on mutating requests
  // ─────────────────────────────────────────────────────────────────────────

  it("CSRF (opt-in) enforced on mutating requests", async () => {
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
    expect(login.status, "csrf login 200").toBe(200);
    const cookie = cookieValue(login);

    // Fetch a CSRF token bound to the session (GET is not a mutating request).
    const tok = await app.request("/csrf-token", { headers: { cookie } });
    expect(tok.status, "csrf token 200").toBe(200);
    const { csrfToken } = (await tok.json()) as { csrfToken: string };
    expect(typeof csrfToken === "string" && csrfToken.length > 0, "csrf token issued").toBe(true);

    // Mutating route without the token → 403.
    const noTok = await app.request("/update", { method: "POST", headers: { cookie } });
    expect(noTok.status, "csrf missing token 403").toBe(403);

    // With the token → 200.
    const withTok = await app.request("/update", {
      method: "POST",
      headers: { cookie, "x-csrf-token": csrfToken },
    });
    expect(withTok.status, "csrf with token 200").toBe(200);

    // Wrong token → 403.
    const badTok = await app.request("/update", {
      method: "POST",
      headers: { cookie, "x-csrf-token": "not-the-token" },
    });
    expect(badTok.status, "csrf wrong token 403").toBe(403);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 7. auth.strategy(name, { type, ... }) unified dispatch
  // ─────────────────────────────────────────────────────────────────────────

  it("auth.strategy unified dispatch", async () => {
    const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "dispatch" });
    const session = auth.strategy("s2", {
      type: "session",
      secret: "dispatch-secret-32-chars!!",
      csrf: false,
    });

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
    expect(login.status, "dispatch login 200").toBe(200);
    const cookie = cookieValue(login);

    const me = await app.request("/me", { headers: { cookie } });
    expect(me.status, "dispatch me 200").toBe(200);
    const { userId } = (await me.json()) as { userId: string };
    expect(userId, "dispatch session context").toBe("bob");

    // The dispatch registers a real security scheme too.
    const spec = (await (await app.request("/openapi.json")).json()) as any;
    expect(spec.components?.securitySchemes?.s2?.in, "dispatch scheme cookie").toBe("cookie");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 8. Cookie serialization hardening + CookieTransport
  // ─────────────────────────────────────────────────────────────────────────

  it("Cookie serialize hardening (__Host- / __Secure- / None=Secure)", async () => {
    // __Host- prefix forces Secure + Path=/ and renames the cookie.
    {
      const cookie = serializeCookie("sid", "abc", { hostPrefix: true });
      expect(cookie.startsWith("__Host-sid=abc"), "hostPrefix renames to __Host-sid").toBe(true);
      expect(cookie.includes("; Secure"), "hostPrefix forces Secure").toBe(true);
      expect(cookie.includes("; Path=/"), "hostPrefix forces Path=/").toBe(true);
    }
    // __Host- rejects a non-"/" path and a Domain.
    {
      let threw = false;
      try {
        serializeCookie("sid", "abc", { hostPrefix: true, path: "/auth" });
      } catch {
        threw = true;
      }
      expect(threw, "hostPrefix rejects a non-/ path").toBe(true);
    }
    {
      let threw = false;
      try {
        serializeCookie("sid", "abc", { hostPrefix: true, domain: "example.com" });
      } catch {
        threw = true;
      }
      expect(threw, "hostPrefix rejects Domain").toBe(true);
    }
    // SameSite=None requires Secure (RFC-6265bis).
    {
      let threw = false;
      try {
        serializeCookie("sid", "abc", { sameSite: "None" });
      } catch {
        threw = true;
      }
      expect(threw, "SameSite=None without Secure throws").toBe(true);
    }
    // __Secure- prefix does NOT force Path=/.
    {
      const cookie = serializeCookie("sid", "abc", {
        securePrefix: true,
        secure: true,
        path: "/auth",
      });
      expect(cookie.startsWith("__Secure-sid=abc"), "securePrefix renames to __Secure-sid").toBe(
        true,
      );
      expect(cookie.includes("; Path=/auth"), "securePrefix keeps Path=/auth").toBe(true);
    }
  });

  it("CookieTransport set / read / clear round-trip", async () => {
    // Defaults: HttpOnly + Secure + SameSite=Lax, path scoped; set → read → clear.
    {
      const fc = makeFakeContext();
      const transport = createCookieTransport({ name: "rt", path: "/auth" });
      transport.set(fc.c, "token-1");
      expect(fc.setCookies[0]!.includes("; HttpOnly"), "transport cookie HttpOnly").toBe(true);
      expect(fc.setCookies[0]!.includes("; Secure"), "transport cookie Secure").toBe(true);
      expect(fc.setCookies[0]!.includes("; SameSite=Lax"), "transport cookie SameSite=Lax").toBe(
        true,
      );
      fc.applyLast();
      expect(transport.read(fc.c), "transport read returns the set token").toBe("token-1");
      transport.clear(fc.c);
      const cleared = fc.setCookies[fc.setCookies.length - 1]!;
      expect(cleared.includes("; Max-Age=0"), "transport clear uses Max-Age=0").toBe(true);
      expect(cleared.startsWith("rt="), "transport clear keeps the name").toBe(true);
    }
    // Host-prefixed transport renames and reads via the __Host- name.
    {
      const fc = makeFakeContext();
      const transport = createCookieTransport({ name: "rt", hostPrefix: true });
      transport.set(fc.c, "val");
      expect(fc.setCookies[0]!.startsWith("__Host-rt=val"), "hostPrefix transport renames").toBe(
        true,
      );
      fc.applyLast();
      expect(transport.read(fc.c), "hostPrefix transport reads the renamed cookie").toBe("val");
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9. Session CSRF origin mode + Secure cookie default
  // ─────────────────────────────────────────────────────────────────────────

  it("Session CSRF origin mode + Secure cookie default", async () => {
    const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "origin-csrf" });
    const session = auth.session("session", {
      secret: "origin-secret-32-chars-long!!",
      origin: "http://localhost", // CSRF defaults to "origin"
    });

    api.post("/login", { body: type({ userId: "string" }) }, async ({ body, c }) => {
      await session.create(c, { userId: body.userId });
      return { ok: true };
    });
    api.post("/update", { auth: "session" }, async ({ auth }) => ({ userId: auth.userId }));
    docs();

    const login = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice" }),
    });
    expect(login.status, "origin-csrf login 200").toBe(200);
    const cookie = cookieValue(login);
    expect(
      (login.headers.get("set-cookie") ?? "").includes("; Secure"),
      "session cookie Secure by default",
    ).toBe(true);

    // Same-origin mutating request passes with NO client token.
    const ok = await app.request("/update", {
      method: "POST",
      headers: { cookie, origin: "http://localhost" },
    });
    expect(ok.status, "origin-csrf same-origin passes with no token").toBe(200);

    // Mismatched Origin → 403.
    const cross = await app.request("/update", {
      method: "POST",
      headers: { cookie, origin: "http://evil.example" },
    });
    expect(cross.status, "origin-csrf mismatched Origin 403").toBe(403);

    // Sec-Fetch-Site: cross-site → 403.
    const xsite = await app.request("/update", {
      method: "POST",
      headers: { cookie, "sec-fetch-site": "cross-site" },
    });
    expect(xsite.status, "origin-csrf cross-site 403").toBe(403);

    // A non-browser client (no Origin) still passes.
    const noOrigin = await app.request("/update", { method: "POST", headers: { cookie } });
    expect(noOrigin.status, "origin-csrf non-browser passes").toBe(200);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 9b. Session cookie host-prefix
  // ─────────────────────────────────────────────────────────────────────────

  it("Session cookie host-prefix (__Host-sid round-trip)", async () => {
    const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "host-prefix" });
    const session = auth.session("session", {
      secret: "host-prefix-secret-32-chars-long!!",
      csrf: false,
      cookie: { hostPrefix: true },
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

    const login = await app.request("/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "alice" }),
    });
    const sc = login.headers.get("set-cookie") ?? "";
    expect(sc.startsWith("__Host-sid="), "session hostPrefix cookie __Host-sid").toBe(true);
    expect(
      sc.includes("; Path=/") && sc.includes("; Secure"),
      "session hostPrefix Path=/ + Secure",
    ).toBe(true);
    const cookie = sc.split(";")[0]!;
    const me = await app.request("/me", { headers: { cookie } });
    expect(me.status, "session hostPrefix read works").toBe(200);
    const meBody: any = await me.json();
    expect(meBody.userId, "session hostPrefix context flows").toBe("alice");
    // The cleared cookie also uses __Host-sid + Max-Age=0 (no double prefix).
    const out = await app.request("/logout", { method: "POST", headers: { cookie } });
    const cleared = out.headers.get("set-cookie") ?? "";
    expect(cleared.startsWith("__Host-sid="), "session hostPrefix logout clears __Host-sid").toBe(
      true,
    );
    expect(cleared.includes("; Max-Age=0"), "session hostPrefix logout Max-Age=0").toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 10. OAuth PKCE-on-by-default (confidential client) + provider error
  // ─────────────────────────────────────────────────────────────────────────

  it("OAuth PKCE-by-default (confidential) + provider error", async () => {
    const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "oauth-pkce" });
    const fetchFn: typeof fetch = async () => new Response("not found", { status: 404 });

    // Confidential client (clientSecret) with NO explicit usePKCE → PKCE on by default.
    auth.oauth("google", {
      clientId: "cid",
      clientSecret: "csecret",
      redirectUri: "http://localhost/cb",
      authorizationURL: "https://mock.example/auth",
      tokenURL: "https://mock.example/token",
      userInfoURL: "https://mock.example/userinfo",
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

    api.get("/public", {}, async () => ({ ok: true }));
    docs();

    const start = await app.request("/auth/google/start");
    expect(start.status, "oauth pkce start 302").toBe(302);
    const loc = start.headers.get("location") ?? "";
    expect(
      loc.includes("code_challenge=") && loc.includes("code_challenge_method=S256"),
      "confidential client uses PKCE by default",
    ).toBe(true);
    const startCookie = start.headers.get("set-cookie") ?? "";
    expect(startCookie.includes("oauth_state="), "oauth state cookie present").toBe(true);
    expect(startCookie.includes("; Secure"), "oauth state cookie is Secure").toBe(true);

    // Provider denial ?error=access_denied → onError (not "Invalid OAuth state").
    const err = await app.request("/auth/google/callback?error=access_denied");
    expect(err.status, "oauth provider error -> onError 400").toBe(400);
    const errBody: any = await err.json();
    expect(errBody.error?.includes("access_denied"), "oauth provider error message").toBe(true);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 11. JWT key rotation (`keys`/`kid`) + alg-pinning
  // ─────────────────────────────────────────────────────────────────────────

  it("JWT key rotation (kid) + alg-pinning", async () => {
    const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "jwt-rotation" });
    const jwt = auth.jwt("jwt", {
      keys: [
        { kid: "k1", secret: "rotation-secret-k1-32-bytes!!" },
        { kid: "k2", secret: "rotation-secret-k2-32-bytes!!" },
      ],
      algorithms: ["HS256"],
    });
    api.post("/login", {}, async () => jwt.issue("user-1"));
    docs();

    const login = await app.request("/login", { method: "POST" });
    const t: any = await login.json();
    const header = JSON.parse(Buffer.from(t.accessToken.split(".")[0]!, "base64url").toString());
    expect(header.kid, "rotation stamps current key kid").toBe("k1");
    expect((await jwt.verifyAccess(t.accessToken))?.sub, "rotation verifies via kid").toBe(
      "user-1",
    );

    // Rotate k1 away — a token still signed with k1 now fails (unknown kid).
    const { auth: auth2 } = createApi<Record<string, unknown>>({ title: "jwt-rotation2" });
    const jwt2 = auth2.jwt("jwt2", {
      keys: [{ kid: "k2", secret: "rotation-secret-k2-32-bytes!!" }],
      algorithms: ["HS256"],
    });
    expect(await jwt2.verifyAccess(t.accessToken), "rotated-away kid rejected").toBeNull();

    // A token with a missing kid is rejected in keys mode.
    const noKid = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setExpirationTime("1m")
      .sign(new TextEncoder().encode("rotation-secret-k1-32-bytes!!"));
    expect(await jwt.verifyAccess(noKid), "missing kid rejected in keys mode").toBeNull();

    // An alg outside `algorithms` is rejected (alg-confusion closed).
    const wrongAlg = await new SignJWT({ sub: "user-1" })
      .setProtectedHeader({ alg: "HS512", typ: "JWT", kid: "k1" })
      .setExpirationTime("1m")
      .sign(new TextEncoder().encode("rotation-secret-k1-32-bytes!!"));
    expect(await jwt.verifyAccess(wrongAlg), "alg outside algorithms rejected").toBeNull();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 12. JWT asymmetric (RS256) + JWKS verification
  // ─────────────────────────────────────────────────────────────────────────

  it("JWT asymmetric RS256 + JWKS verification", async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      true,
      ["sign", "verify"],
    );
    const publicJwk = (await crypto.subtle.exportKey("jwk", keyPair.publicKey)) as {
      kty: string;
      n: string;
      e: string;
    };

    const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "jwt-rs" });
    const jwt = auth.jwt("jwt", {
      keys: [{ kid: "rsa1", key: keyPair.privateKey }],
      jwks: { keys: [{ ...publicJwk, kid: "rsa1", alg: "RS256" }] },
      algorithms: ["RS256"],
    });
    api.post("/login", {}, async () => jwt.issue("user-1"));
    api.get("/me", { auth: "jwt" }, async ({ auth }) => ({ sub: auth.sub }));
    docs();

    const login = await app.request("/login", { method: "POST" });
    const t: any = await login.json();
    const header = JSON.parse(Buffer.from(t.accessToken.split(".")[0]!, "base64url").toString());
    expect(header.alg, "RS256 token alg").toBe("RS256");
    expect(header.kid, "RS256 token kid").toBe("rsa1");

    expect((await jwt.verifyAccess(t.accessToken))?.sub, "RS256 verify via JWKS").toBe("user-1");

    const me = await app.request("/me", {
      headers: { authorization: `Bearer ${t.accessToken}` },
    });
    expect(me.status, "RS256 guarded route 200").toBe(200);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 12b. generateKey() — asymmetric keypair helper (default RS256 / EdDSA / RS384)
  // ─────────────────────────────────────────────────────────────────────────

  it("generateKey() wires straight into keys/jwks/algorithms (RS256 default)", async () => {
    // No `algorithm` → defaults to RS256, and the public JWK is stamped with kid+alg.
    const { kid, privateKey, publicJwk } = await generateKey({ kid: "gen-1" });
    expect(kid, "generateKey kid").toBe("gen-1");
    expect(publicJwk.kty, "generateKey RS256 kty").toBe("RSA");
    expect(publicJwk.alg, "generateKey default alg RS256").toBe("RS256");
    expect(publicJwk.kid, "generateKey kid on publicJwk").toBe("gen-1");
    expect(publicJwk.n, "generateKey RS256 modulus present").toBeTruthy();

    // The returned key/JWK drop straight into `keys`/`jwks` (with `algorithms`
    // accepting the signing alg) — no hand-rolled crypto.subtle wiring.
    const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "jwt-gen-rs" });
    const jwt = auth.jwt("jwt", {
      keys: [{ kid, key: privateKey }],
      jwks: { keys: [publicJwk] },
      algorithms: ["RS256"],
    });
    api.post("/login", {}, async () => jwt.issue("user-1"));
    docs();
    const login = await app.request("/login", { method: "POST" });
    const t: any = await login.json();
    const header = JSON.parse(Buffer.from(t.accessToken.split(".")[0]!, "base64url").toString());
    expect(header.alg, "generateKey RS256 token alg").toBe("RS256");
    expect(header.kid, "generateKey RS256 token kid").toBe("gen-1");
    expect((await jwt.verifyAccess(t.accessToken))?.sub, "generateKey RS256 verify").toBe("user-1");
  });

  it("generateKey() EdDSA round-trips", async () => {
    const { kid, privateKey, publicJwk } = await generateKey({ algorithm: "EdDSA" });
    expect(publicJwk.kty, "generateKey EdDSA kty OKP").toBe("OKP");
    expect(publicJwk.crv, "generateKey EdDSA crv Ed25519").toBe("Ed25519");
    expect(publicJwk.alg, "generateKey EdDSA alg").toBe("EdDSA");

    const { auth } = createApi<Record<string, unknown>>({ title: "jwt-gen-ed" });
    const jwt = auth.jwt("ed", {
      keys: [{ kid, key: privateKey }],
      jwks: { keys: [publicJwk] },
      algorithms: ["EdDSA"],
    });
    const t = await jwt.issue("user-1");
    expect((await jwt.verifyAccess(t.accessToken))?.sub, "generateKey EdDSA verify").toBe("user-1");
  });

  it("generateKey() RS384 (RSA-hash disambiguation)", async () => {
    const { kid, privateKey, publicJwk } = await generateKey({ algorithm: "RS384" });
    expect(publicJwk.alg, "generateKey RS384 alg").toBe("RS384");
    const { auth } = createApi<Record<string, unknown>>({ title: "jwt-gen-rs384" });
    // `algorithms` must accept the signing alg (RS384). This validates that
    // deriveSigningAlg maps an SHA-384 RSA key to RS384, not RS256.
    const jwt = auth.jwt("rs384", {
      keys: [{ kid, key: privateKey }],
      jwks: { keys: [publicJwk] },
      algorithms: ["RS384"],
    });
    const t = await jwt.issue("user-1");
    expect((await jwt.verifyAccess(t.accessToken))?.sub, "generateKey RS384 verify").toBe("user-1");
  });

  // ─────────────────────────────────────────────────────────────────────────
  // 13. JWT refresh-token cookie transport (`refreshTransport`)
  // ─────────────────────────────────────────────────────────────────────────

  it("JWT refresh-token cookie transport", async () => {
    const { api, auth, docs, app } = createApi<Record<string, unknown>>({ title: "jwt-rt" });
    const jwt = auth.jwt("jwt", {
      secret: "jwt-refresh-32-chars-long!!",
      refreshTransport: { cookie: { name: "rt", path: "/auth" } },
    });
    api.post("/login", {}, async ({ c }) => jwt.issue("user-1", {}, c));
    api.post("/refresh", {}, async ({ c }) =>
      jwt.refresh(parseCookies(c.req.header("Cookie")).rt!, c),
    );
    docs();

    const login = await app.request("/login", { method: "POST" });
    const sc = login.headers.get("set-cookie") ?? "";
    expect(sc.startsWith("rt="), "issue sets refresh cookie").toBe(true);
    expect(
      sc.includes("; HttpOnly") && sc.includes("; Path=/auth"),
      "refresh cookie HttpOnly + path",
    ).toBe(true);
    const t1: any = await login.json();
    const rtCookie = sc.split(";")[0]!;
    expect(rtCookie.slice("rt=".length), "refresh cookie value matches body").toBe(t1.refreshToken);

    const ref = await app.request("/refresh", { method: "POST", headers: { cookie: rtCookie } });
    expect(ref.status, "refresh via cookie 200").toBe(200);
    const refSc = ref.headers.get("set-cookie") ?? "";
    expect(refSc.startsWith("rt="), "refresh sets a new refresh cookie").toBe(true);
    const t2: any = await ref.json();
    expect(refSc.slice("rt=".length).split(";")[0], "rotated cookie matches body").toBe(
      t2.refreshToken,
    );

    // Without `refreshTransport`, tokens are returned in the body only.
    const { auth: auth2 } = createApi<Record<string, unknown>>({ title: "jwt-no-rt" });
    const jwt2 = auth2.jwt("jwt", { secret: "jwt-refresh-32-chars-long!!" });
    const t3 = await jwt2.issue("user-1");
    expect(typeof t3.refreshToken, "no-refreshTransport still returns body-only token").toBe(
      "string",
    );
  });
});
