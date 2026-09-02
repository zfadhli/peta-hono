// Tests the full auth example flow: register → profile → logout → login → profile,
// plus OpenAPI spec + docs UI. Uses `app.request()` directly with a simple cookie jar.

import { describe, expect, it } from "vitest";
import app from "./routes.js";

// Simple cookie jar — tracks session cookie across requests.
let cookieHeader = "";

async function req(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (cookieHeader) headers.set("Cookie", cookieHeader);
  const res = await app.request(path, { ...options, headers });
  const setCookie = res.headers.get("set-cookie");
  if (setCookie) {
    // Take only the name=value part before any attributes
    cookieHeader = setCookie.split(";")[0]!;
  }
  return res;
}

describe("auth example app", () => {
  it("register → profile → logout → login → profile", async () => {
    // 1. Register — happy path
    const r1 = await req("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "password123" }),
    });
    const j1: any = await r1.json();
    expect(r1.status, "register status").toBe(201);
    expect(typeof j1.id, "register id type").toBe("string");
    expect(j1.email, "register email").toBe("alice@example.com");
    expect(cookieHeader.length > 0, "register set cookie").toBe(true);

    // 2. Profile — with session cookie from registration
    const r2 = await req("/auth/profile");
    const j2: any = await r2.json();
    expect(r2.status, "profile status").toBe(200);
    expect(j2.email, "profile email").toBe("alice@example.com");
    expect(typeof j2.id, "profile id type").toBe("string");

    // 3. Logout
    const r3 = await req("/auth/logout", { method: "POST" });
    expect(r3.status, "logout status").toBe(204);

    // 4. Profile after logout — should be unauthorized
    const r4 = await req("/auth/profile");
    expect(r4.status, "profile after logout status").toBe(401);

    // 5. Profile without any cookie
    const r5 = await app.request("/auth/profile");
    expect(r5.status, "profile no cookie status").toBe(401);

    // 6. Register same email — should conflict
    const r6 = await req("/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "password456" }),
    });
    expect(r6.status, "register duplicate status").toBe(409);

    // 7. Login with wrong password
    const r7 = await req("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "wrongpassword" }),
    });
    expect(r7.status, "login wrong password status").toBe(401);

    // 8. Login with non-existent email
    const r8 = await req("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
    });
    expect(r8.status, "login nonexistent status").toBe(401);

    // 9. Login correctly
    const r9 = await req("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "alice@example.com", password: "password123" }),
    });
    const j9: any = await r9.json();
    expect(r9.status, "login status").toBe(200);
    expect(j9.email, "login email").toBe("alice@example.com");
    expect(typeof j9.id, "login id type").toBe("string");
    expect(cookieHeader.length > 0, "login set cookie").toBe(true);

    // 10. Profile after login
    const r10 = await req("/auth/profile");
    const j10: any = await r10.json();
    expect(r10.status, "profile after login status").toBe(200);
    expect(j10.email, "profile after login email").toBe("alice@example.com");
  });

  it("openapi spec documents all auth routes + session scheme", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status, "spec status").toBe(200);
    const spec: any = await res.json();
    expect(spec.paths["/auth/register"], "spec has register").toBeTruthy();
    expect(spec.paths["/auth/login"], "spec has login").toBeTruthy();
    expect(spec.paths["/auth/profile"], "spec has profile").toBeTruthy();
    expect(spec.paths["/auth/logout"], "spec has logout").toBeTruthy();
    expect(
      spec.components?.securitySchemes?.session,
      "spec has session security scheme",
    ).toBeTruthy();
  });

  it("docs UI returns HTML", async () => {
    const res = await app.request("/docs");
    expect(res.status, "docs status").toBe(200);
    const html = await res.text();
    expect(html.includes("Scalar"), "docs content").toBe(true);
  });
});
