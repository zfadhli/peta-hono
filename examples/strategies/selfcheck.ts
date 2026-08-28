// ponytail: no test framework — runnable self-check with asserts.
// Boots the strategies example on a random port and exercises the session,
// jwt, and Google OAuth strategies end-to-end (OAuth endpoints are mocked in
// routes.ts via an injected fetchFn).

import { createAdaptorServer } from "@hono/node-server";
import { app } from "./routes.js";

const failures: string[] = [];

function assert(condition: boolean, label: string) {
  if (!condition) failures.push(label);
}

const server = createAdaptorServer({ fetch: app.fetch });
const port = await new Promise<number>((resolve) => {
  server.listen(0, () => {
    const addr = server.address();
    resolve(typeof addr === "object" && addr ? addr.port : 0);
  });
});
const baseUrl = `http://localhost:${port}`;

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
  const res = await fetch(`${baseUrl}${path}`, { ...options, headers });
  setCookieFrom(res);
  return res;
}

try {
  // 1. Health (public)
  const r0 = await fetch(`${baseUrl}/health`);
  assert(r0.status === 200, "health status");

  // 2. Session login → set sid cookie
  const r1 = await req("/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com", password: "password" }),
  });
  const j1: any = await r1.json();
  assert(r1.status === 200, "login status");
  assert(cookie.startsWith("sid="), "login set sid cookie");
  assert(j1.email === "alice@example.com", "login email");

  // 3. Session me (cookie) → context flows
  const r2 = await req("/auth/me");
  const j2: any = await r2.json();
  assert(r2.status === 200, "me status");
  assert(j2.email === "alice@example.com", "me email");

  // 4. Session me without cookie → 401
  const r4 = await fetch(`${baseUrl}/auth/me`);
  assert(r4.status === 401, "me without cookie 401");

  // 5. Logout clears the sid cookie
  const r5 = await req("/auth/logout", { method: "POST" });
  assert(r5.status === 204, "logout status");
  assert(cookie === "", "logout cleared cookie");

  // 6. JWT token issue + verify + refresh
  const r6 = await req("/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "alice@example.com" }),
  });
  const j6: any = await r6.json();
  assert(r6.status === 200, "token issue status");
  assert(typeof j6.accessToken === "string", "access token type");

  const r7 = await fetch(`${baseUrl}/auth/verify`, {
    headers: { authorization: `Bearer ${j6.accessToken}` },
  });
  const j7: any = await r7.json();
  assert(r7.status === 200, "verify status");
  assert(j7.sub === "u_alice", "verify sub");

  const r8 = await req("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: j6.refreshToken }),
  });
  const j8: any = await r8.json();
  assert(r8.status === 200, "refresh status");
  assert(j8.refreshToken !== j6.refreshToken, "refresh rotates token");

  // 7. Reuse of the rotated refresh token → 401 (family revoked)
  const r9 = await req("/auth/refresh", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: j6.refreshToken }),
  });
  assert(r9.status === 401, "refresh reuse 401");

  // 8. Google OAuth start → 302 + state cookie
  const r10 = await fetch(`${baseUrl}/auth/google/start`, { redirect: "manual" });
  const loc = r10.headers.get("location") ?? "";
  assert(r10.status === 302, "oauth start 302");
  assert(loc.includes("client_id=example-client-id"), "oauth start client_id");
  assert(loc.includes("code_challenge="), "oauth start PKCE");
  const url = new URL(loc);
  const state = url.searchParams.get("state") ?? "";
  assert(state.length > 0, "oauth start state");
  assert(
    (r10.headers.get("set-cookie") ?? "").split(";")[0]!.startsWith("oauth_state="),
    "oauth start state cookie",
  );

  // 9. OAuth callback (mock endpoints) → onSuccess runs, session cookie set
  const r11 = await fetch(
    `${baseUrl}/auth/google/callback?code=mock_code&state=${encodeURIComponent(state)}`,
    { headers: { cookie: r10.headers.get("set-cookie")?.split(";")[0] ?? "" } },
  );
  const j11: any = await r11.json();
  assert(r11.status === 200, "oauth callback status");
  assert(j11.email === "alice@example.com", "oauth callback email");
  assert((r11.headers.get("set-cookie") ?? "").includes("sid="), "oauth callback sets session");

  // 10. OAuth-issued session works on a protected route
  const jar = (r11.headers.get("set-cookie") ?? "").split(";")[0]!.startsWith("sid=")
    ? (r11.headers.get("set-cookie") ?? "").split(";")[0]!
    : "";
  const r12 = await fetch(`${baseUrl}/auth/me`, { headers: { cookie: jar } });
  assert(r12.status === 200, "oauth session me status");

  // 11. OpenAPI spec documents all three security schemes
  const r13 = await fetch(`${baseUrl}/openapi.json`);
  const spec: any = await r13.json();
  const schemes = spec.components?.securitySchemes ?? {};
  assert(schemes.session?.in === "cookie", "spec session in:cookie");
  assert(schemes.jwt?.scheme === "bearer", "spec jwt bearer");
  assert(schemes.google?.type === "oauth2", "spec google oauth2");
  assert(spec.paths?.["/auth/verify"]?.get?.responses?.["401"], "spec verify 401");
} finally {
  server.close();
}

if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} test(s)`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(failures.length);
} else {
  console.log("All strategies self-checks passed ✓");
}
