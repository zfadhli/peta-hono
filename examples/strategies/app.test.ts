// Tests the strategies example (session + jwt + Google OAuth end-to-end, with
// mocked OAuth endpoints). Uses `app.request()` directly with a simple cookie jar.

import { describe, expect, it } from "vitest";
import { app } from "./routes.js";

// Cookie jar — tracks a single session cookie name/value across requests.
let cookie = "";

function setCookieFrom(res: Response): void {
  const sc = res.headers.get("set-cookie");
  if (!sc) return;
  const first = sc.split(";")[0]!;
  const eq = first.indexOf("=");
  // If the value is empty (e.g. a cleared cookie), drop the entry from the jar.
  if (first.slice(eq + 1) === "") cookie = "";
  else cookie = first;
}

async function req(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (cookie) headers.set("Cookie", cookie);
  const res = await app.request(path, { ...options, headers });
  setCookieFrom(res);
  return res;
}

describe("strategies example app", () => {
  it("health + session login / me / logout with csrf origin", async () => {
    // 1. Health (public)
    const r0 = await app.request("/health");
    expect(r0.status, "health status").toBe(200);

    // 2. Session login → sets the sid cookie. csrf:"origin" lets a non-browser
    // client through (fetch sends no Origin).
    const r1 = await req("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "password" }),
    });
    const j1: any = await r1.json();
    expect(r1.status, "login status").toBe(200);
    expect(cookie.startsWith("sid="), "login set sid cookie").toBe(true);
    expect(j1.email, "login email").toBe("alice@example.com");

    // 2b. Wrong password → 401 (verified against the peta-hono/password hash).
    const r1b = await req("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "not-the-password" }),
    });
    expect(r1b.status, "login wrong password 401").toBe(401);

    // 3. Session me (cookie) → context flows
    const r2 = await req("/auth/me");
    const j2: any = await r2.json();
    expect(r2.status, "me status").toBe(200);
    expect(j2.email, "me email").toBe("alice@example.com");

    // 4. Session me without cookie → 401
    const r4 = await app.request("/auth/me");
    expect(r4.status, "me without cookie 401").toBe(401);

    // 5. csrf:"origin" — a cross-site mutating request is rejected 403...
    const r5a = await req("/auth/logout", {
      method: "POST",
      headers: { origin: "http://evil.example" },
    });
    expect(r5a.status, "logout cross-origin 403").toBe(403);
    expect(cookie.startsWith("sid="), "cross-origin logout keeps the session").toBe(true);

    // ...while a same-origin one passes (and clears the session cookie).
    const r5b = await req("/auth/logout", {
      method: "POST",
      headers: { origin: "http://localhost:3000" },
    });
    expect(r5b.status, "logout same-origin 204").toBe(204);
    expect(cookie, "logout cleared cookie").toBe("");
  });

  it("jwt token issue / verify / refresh / reuse-revoke", async () => {
    // 6. JWT token issue → body tokens + HttpOnly refresh cookie (refreshTransport)
    const r6 = await app.request("/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com" }),
    });
    const j6: any = await r6.json();
    expect(r6.status, "token issue status").toBe(200);
    expect(typeof j6.accessToken, "access token type").toBe("string");
    const rt = r6.headers.get("set-cookie") ?? "";
    expect(rt.startsWith("rt="), "token issue sets refresh cookie").toBe(true);
    expect(
      rt.includes("; HttpOnly") && rt.includes("; Path=/auth"),
      "refresh cookie HttpOnly + path",
    ).toBe(true);

    // 7. Verify the bearer access token (signed by keys[0], kid-stamped)
    const r7 = await app.request("/auth/verify", {
      headers: { authorization: `Bearer ${j6.accessToken}` },
    });
    const j7: any = await r7.json();
    expect(r7.status, "verify status").toBe(200);
    expect(j7.sub, "verify sub").toBe("u_alice");

    // 8. Refresh rotates the token (and sets a fresh refresh cookie)
    const r8 = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: j6.refreshToken }),
    });
    const j8: any = await r8.json();
    expect(r8.status, "refresh status").toBe(200);
    expect(j8.refreshToken, "refresh rotates token").not.toBe(j6.refreshToken);

    // 9. Reuse of the rotated refresh token → 401 (family revoked)
    const r9 = await app.request("/auth/refresh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: j6.refreshToken }),
    });
    expect(r9.status, "refresh reuse 401").toBe(401);
  });

  it("google oauth start / callback + oauth-issued session", async () => {
    // 10. Google OAuth start → 302 + state cookie
    const r10 = await app.request("/auth/google/start");
    const loc = r10.headers.get("location") ?? "";
    expect(r10.status, "oauth start 302").toBe(302);
    expect(loc.includes("client_id=example-client-id"), "oauth start client_id").toBe(true);
    expect(loc.includes("code_challenge="), "oauth start PKCE").toBe(true);
    const url = new URL(loc);
    const state = url.searchParams.get("state") ?? "";
    expect(state.length > 0, "oauth start state").toBe(true);
    expect(
      (r10.headers.get("set-cookie") ?? "").split(";")[0]!.startsWith("oauth_state="),
      "oauth start state cookie",
    ).toBe(true);

    // 11. OAuth callback (mock endpoints) → onSuccess runs, session cookie set
    const r11 = await app.request(
      `/auth/google/callback?code=mock_code&state=${encodeURIComponent(state)}`,
      { headers: { cookie: r10.headers.get("set-cookie")?.split(";")[0] ?? "" } },
    );
    const j11: any = await r11.json();
    expect(r11.status, "oauth callback status").toBe(200);
    expect(j11.email, "oauth callback email").toBe("alice@example.com");
    expect(
      (r11.headers.get("set-cookie") ?? "").includes("sid="),
      "oauth callback sets session",
    ).toBe(true);

    // 12. OAuth-issued session works on a protected route
    const jar = (r11.headers.get("set-cookie") ?? "").split(";")[0]!.startsWith("sid=")
      ? (r11.headers.get("set-cookie") ?? "").split(";")[0]!
      : "";
    const r12 = await app.request("/auth/me", { headers: { cookie: jar } });
    expect(r12.status, "oauth session me status").toBe(200);
  });

  it("openapi spec documents all three security schemes", async () => {
    // 13. OpenAPI spec documents all three security schemes
    const r13 = await app.request("/openapi.json");
    expect(r13.status, "spec status").toBe(200);
    const spec: any = await r13.json();
    const schemes = spec.components?.securitySchemes ?? {};
    expect(schemes.session?.in, "spec session in:cookie").toBe("cookie");
    expect(schemes.jwt?.scheme, "spec jwt bearer").toBe("bearer");
    expect(schemes.google?.type, "spec google oauth2").toBe("oauth2");
    expect(spec.paths?.["/auth/verify"]?.get?.responses?.["401"], "spec verify 401").toBeTruthy();
  });
});
