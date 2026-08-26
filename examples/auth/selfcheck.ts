// ponytail: no test framework, just a runnable self-check with asserts.
// Tests the full auth flow: register → profile → logout → login → profile.

import { createAdaptorServer } from "@hono/node-server";
import app from "./routes.js";

const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (!condition) failures.push(label);
}

// Boot a test server on a random port
const server = createAdaptorServer({ fetch: app.fetch });
const port = await new Promise<number>((resolve) => {
  server.listen(0, () => {
    const addr = server.address();
    resolve(typeof addr === "object" && addr ? addr.port : 0);
  });
});
const baseUrl = `http://localhost:${port}`;

// Simple cookie jar — tracks session cookie across requests
let cookieHeader = "";

async function req(path: string, options?: RequestInit) {
  const headers = new Headers(options?.headers);
  if (cookieHeader) headers.set("Cookie", cookieHeader);
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const setCookie = res.headers.get("Set-Cookie");
  if (setCookie) {
    // Take only the name=value part before any attributes
    cookieHeader = setCookie.split(";")[0]!;
  }
  return res;
}

try {
  // 1. Register — happy path
  const r1 = await req("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com", password: "password123" }),
  });
  const j1: any = await r1.json();
  assert(r1.status === 201, "register status");
  assert(typeof j1.id === "string", "register id type");
  assert(j1.email === "alice@example.com", "register email");
  assert(cookieHeader.length > 0, "register set cookie");

  // 2. Profile — with session cookie from registration
  const r2 = await req("/auth/profile");
  const j2: any = await r2.json();
  assert(r2.status === 200, "profile status");
  assert(j2.email === "alice@example.com", "profile email");
  assert(typeof j2.id === "string", "profile id type");

  // 3. Logout
  const r3 = await req("/auth/logout", { method: "POST" });
  assert(r3.status === 204, "logout status");

  // 4. Profile after logout — should be unauthorized
  const r4 = await req("/auth/profile");
  assert(r4.status === 401, "profile after logout status");

  // 5. Profile without any cookie
  const r5 = await fetch(`${baseUrl}/auth/profile`);
  assert(r5.status === 401, "profile no cookie status");

  // 6. Register same email — should conflict
  const r6 = await req("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com", password: "password456" }),
  });
  assert(r6.status === 409, "register duplicate status");

  // 7. Login with wrong password
  const r7 = await req("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com", password: "wrongpassword" }),
  });
  assert(r7.status === 401, "login wrong password status");

  // 8. Login with non-existent email
  const r8 = await req("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "nobody@example.com", password: "password123" }),
  });
  assert(r8.status === 401, "login nonexistent status");

  // 9. Login correctly
  const r9 = await req("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com", password: "password123" }),
  });
  const j9: any = await r9.json();
  assert(r9.status === 200, "login status");
  assert(j9.email === "alice@example.com", "login email");
  assert(typeof j9.id === "string", "login id type");
  assert(cookieHeader.length > 0, "login set cookie");

  // 10. Profile after login
  const r10 = await req("/auth/profile");
  const j10: any = await r10.json();
  assert(r10.status === 200, "profile after login status");
  assert(j10.email === "alice@example.com", "profile after login email");

  // 11. OpenAPI spec — verify all routes documented
  const r11 = await fetch(`${baseUrl}/openapi.json`);
  const spec: any = await r11.json();
  assert(r11.status === 200, "spec status");
  assert(spec.paths["/auth/register"] !== undefined, "spec has register");
  assert(spec.paths["/auth/login"] !== undefined, "spec has login");
  assert(spec.paths["/auth/profile"] !== undefined, "spec has profile");
  assert(spec.paths["/auth/logout"] !== undefined, "spec has logout");
  assert(
    spec.components?.securitySchemes?.session !== undefined,
    "spec has session security scheme",
  );

  // 12. Docs UI
  const r12 = await fetch(`${baseUrl}/docs`);
  assert(r12.status === 200, "docs status");
  const html = await r12.text();
  assert(html.includes("Scalar"), "docs content");
} finally {
  server.close();
}

if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} test(s)`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(failures.length);
} else {
  console.log("All self-checks passed ✓");
}
