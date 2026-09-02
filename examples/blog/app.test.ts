// Tests the blog example app (JWT auth flow + posts/comments CRUD, OpenAPI spec,
// docs UI, and the golden spec snapshot). Uses `app.request()` directly — no
// server boot. The routes are registered as side-effect imports (same as index.ts).

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { app, docs } from "./setup.js";

// Import route files for side-effect registration
await import("./auth.js");
await import("./posts.js");
await import("./comments.js");

// Mount docs after routes
docs();

const json = { "content-type": "application/json" };

// Log in as the seeded demo user. Returns the access token, the refresh token,
// and the HttpOnly refresh cookie the server issued (from the Set-Cookie header).
async function login() {
  const res = await app.request("/login", {
    method: "POST",
    headers: { ...json },
    body: JSON.stringify({ email: "alice@example.com", password: "password" }),
  });
  expect(res.status, "login status").toBe(200);
  const data: any = await res.json();
  return {
    accessToken: data.accessToken as string,
    refreshToken: data.refreshToken as string,
    setCookie: res.headers.get("set-cookie") ?? "",
  };
}

describe("blog API", () => {
  it("public read routes work; writes require a valid JWT", async () => {
    // 1. List posts (public)
    const r1 = await app.request("/posts");
    const j1: any = await r1.json();
    expect(r1.status, "list posts status").toBe(200);
    expect(Array.isArray(j1.posts), "list posts has array").toBe(true);
    expect(j1.total >= 3, "list posts has seeded data").toBe(true);

    // 2. List posts with pagination
    const r1b = await app.request("/posts?limit=1&offset=0");
    const j1b: any = await r1b.json();
    expect(r1b.status, "list posts paginated status").toBe(200);
    expect(j1b.posts.length, "list posts paginated limit").toBe(1);
    expect(j1b.total >= 3, "list posts paginated total").toBe(true);

    // 3. Get post by ID (public)
    const firstPost = j1.posts[0]!;
    const r2 = await app.request(`/posts/${firstPost.id}`);
    const j2: any = await r2.json();
    expect(r2.status, "get post status").toBe(200);
    expect(j2.title, "get post title").toBe(firstPost.title);

    // 4. Get missing post → 404
    const r3 = await app.request("/posts/nonexistent");
    const j3: any = await r3.json();
    expect(r3.status, "get missing post status").toBe(404);
    expect(j3.error, "get missing post error").toBe("post not found");

    // 5. Create post without auth → 401
    const r4 = await app.request("/posts", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ title: "New Post", content: "Content" }),
    });
    expect(r4.status, "create post no auth status").toBe(401);

    // 6. Create post with a fake bearer token → 401 (JWT verification fails)
    const r4b = await app.request("/posts", {
      method: "POST",
      headers: { ...json, authorization: "Bearer not-a-real-jwt" },
      body: JSON.stringify({ title: "New Post", content: "Content" }),
    });
    expect(r4b.status, "create post bad token status").toBe(401);

    // 7. List comments for a post (public)
    const postId = firstPost.id;
    const r8 = await app.request(`/posts/${postId}/comments`);
    const j8: any = await r8.json();
    expect(r8.status, "list comments status").toBe(200);
    expect(Array.isArray(j8.comments), "list comments is array").toBe(true);

    // 8. List comments for missing post → 404
    const r8b = await app.request("/posts/nonexistent/comments");
    expect(r8b.status, "list comments missing post").toBe(404);

    // 9. Create comment without auth → 401
    const r9b = await app.request(`/posts/${postId}/comments`, {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ content: "no auth" }),
    });
    expect(r9b.status, "create comment no auth").toBe(401);
  });

  it("login → me → CRUD → refresh → logout", async () => {
    // --- Login ---
    const { accessToken, refreshToken, setCookie } = await login();
    expect(typeof accessToken, "login accessToken type").toBe("string");
    expect(typeof refreshToken, "login refreshToken type").toBe("string");
    // Refresh token also lands in an HttpOnly cookie (refreshTransport).
    expect(setCookie, "login set refresh cookie").toContain("rt=");
    expect(setCookie, "refresh cookie is HttpOnly").toContain("HttpOnly");

    // Login with wrong password → 401
    const rBad = await app.request("/login", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ email: "alice@example.com", password: "wrong" }),
    });
    expect(rBad.status, "login wrong password").toBe(401);

    // Login with unknown user → 401
    const rBad2 = await app.request("/login", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ email: "nobody@example.com", password: "password" }),
    });
    expect(rBad2.status, "login unknown user").toBe(401);

    const auth = { authorization: `Bearer ${accessToken}` };

    // --- /me (auth-gated JWT route) ---
    const rMe = await app.request("/me", { headers: auth });
    const jMe: any = await rMe.json();
    expect(rMe.status, "me status").toBe(200);
    expect(jMe.sub, "me subject").toBe("alice");

    // /me without a token → 401
    const rMeNo = await app.request("/me");
    expect(rMeNo.status, "me no auth").toBe(401);

    // --- Authenticated post CRUD ---
    const r5 = await app.request("/posts", {
      method: "POST",
      headers: { ...json, ...auth },
      body: JSON.stringify({ title: "New Post", content: "Fresh content" }),
    });
    const j5: any = await r5.json();
    expect(r5.status, "create post status").toBe(201);
    expect(typeof j5.id, "create post has id").toBe("string");
    expect(j5.authorId, "create post author").toBe("alice");
    const createdPostId = j5.id;

    // Update post → 200
    const r6 = await app.request(`/posts/${createdPostId}`, {
      method: "PUT",
      headers: { ...json, ...auth },
      body: JSON.stringify({ title: "Updated Post" }),
    });
    const j6: any = await r6.json();
    expect(r6.status, "update post status").toBe(200);
    expect(j6.title, "update post title").toBe("Updated Post");

    // Update missing post → 404
    const r6b = await app.request("/posts/nonexistent", {
      method: "PUT",
      headers: { ...json, ...auth },
      body: JSON.stringify({ title: "nope" }),
    });
    expect(r6b.status, "update missing post status").toBe(404);

    // Delete post → 204 No Content
    const r7 = await app.request(`/posts/${createdPostId}`, {
      method: "DELETE",
      headers: { ...auth },
    });
    expect(r7.status, "delete post status").toBe(204);
    expect(await r7.text(), "delete post body empty").toBe("");

    // Delete missing post → 404
    const r7b = await app.request(`/posts/${createdPostId}`, {
      method: "DELETE",
      headers: { ...auth },
    });
    const j7b: any = await r7b.json();
    expect(r7b.status, "delete missing post status").toBe(404);
    expect(j7b.error, "delete missing post error").toBe("post not found");

    // --- Authenticated comment CRUD ---
    const commentsPostId = (await (await app.request("/posts")).json()).posts[0].id;
    const r9 = await app.request(`/posts/${commentsPostId}/comments`, {
      method: "POST",
      headers: { ...json, ...auth },
      body: JSON.stringify({ content: "Great post!" }),
    });
    const j9: any = await r9.json();
    expect(r9.status, "create comment status").toBe(201);
    expect(typeof j9.id, "create comment has id").toBe("string");
    expect(j9.content, "create comment content").toBe("Great post!");
    const createdCommentId = j9.id;

    // Create comment on missing post → 404
    const r9c = await app.request("/posts/nonexistent/comments", {
      method: "POST",
      headers: { ...json, ...auth },
      body: JSON.stringify({ content: "nope" }),
    });
    expect(r9c.status, "create comment missing post").toBe(404);

    // Delete comment → 204 No Content
    const r10 = await app.request(`/posts/${commentsPostId}/comments/${createdCommentId}`, {
      method: "DELETE",
      headers: { ...auth },
    });
    expect(r10.status, "delete comment status").toBe(204);
    expect(await r10.text(), "delete comment body empty").toBe("");

    // Delete missing comment → 404
    const r10b = await app.request(`/posts/${commentsPostId}/comments/${createdCommentId}`, {
      method: "DELETE",
      headers: { ...auth },
    });
    const j10b: any = await r10b.json();
    expect(r10b.status, "delete missing comment status").toBe(404);
    expect(j10b.error, "delete missing comment error").toBe("comment not found");

    // --- Refresh rotation ---
    const rRefresh = await app.request("/refresh", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ refreshToken }),
    });
    expect(rRefresh.status, "refresh status").toBe(200);
    const jRefresh: any = await rRefresh.json();
    expect(typeof jRefresh.accessToken, "refresh accessToken type").toBe("string");
    expect(typeof jRefresh.refreshToken, "refresh refreshToken type").toBe("string");
    const rotatedRefresh = jRefresh.refreshToken as string;
    expect(rotatedRefresh, "refresh rotated token differs").not.toBe(refreshToken);
    expect(rRefresh.headers.get("set-cookie") ?? "", "refresh sets new cookie").toContain("rt=");

    // Reusing a rotated token ⇒ token-theft signal → 401 (whole family revoked)
    const rReuse = await app.request("/refresh", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ refreshToken }),
    });
    expect(rReuse.status, "refresh reuse status").toBe(401);

    // --- Logout (fresh login, so the token is live) ---
    const second = await login();
    const rLogout = await app.request("/logout", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ refreshToken: second.refreshToken }),
    });
    expect(rLogout.status, "logout status").toBe(204);
    expect(await rLogout.text(), "logout body empty").toBe("");
    const logoutCookie = rLogout.headers.get("set-cookie") ?? "";
    expect(logoutCookie, "logout clears cookie name").toContain("rt=");
    expect(logoutCookie, "logout clears cookie (Max-Age=0)").toContain("Max-Age=0");

    // Revoked refresh token can no longer be used → 401
    const rAfter = await app.request("/refresh", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ refreshToken: second.refreshToken }),
    });
    expect(rAfter.status, "refresh after logout").toBe(401);
  });

  it("register → login with the new user", async () => {
    // Register a brand-new user → 201, id + email, never the password hash.
    const rReg = await app.request("/register", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ email: "bob@example.com", password: "password123" }),
    });
    expect(rReg.status, "register status").toBe(201);
    const jReg: any = await rReg.json();
    expect(typeof jReg.id, "register has id").toBe("string");
    expect(jReg.email, "register email").toBe("bob@example.com");
    expect(jReg.passwordHash, "register omits passwordHash").toBeUndefined();

    // Registering the same email again → 409 Conflict.
    const rDup = await app.request("/register", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ email: "bob@example.com", password: "another-pass" }),
    });
    expect(rDup.status, "register duplicate status").toBe(409);
    const jDup: any = await rDup.json();
    expect(jDup.error, "register duplicate error").toBe("email already registered");

    // Password shorter than 8 chars → 400 (body validation).
    const rWeak = await app.request("/register", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ email: "carol@example.com", password: "short" }),
    });
    expect(rWeak.status, "register weak password status").toBe(400);

    // The newly-registered user can log in and hit /me with its JWT.
    const rLogin = await app.request("/login", {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ email: "bob@example.com", password: "password123" }),
    });
    expect(rLogin.status, "login as registered user status").toBe(200);
    const jLogin: any = await rLogin.json();
    expect(typeof jLogin.accessToken, "registered login accessToken type").toBe("string");

    const rMe = await app.request("/me", {
      headers: { authorization: `Bearer ${jLogin.accessToken}` },
    });
    expect(rMe.status, "me as registered user status").toBe(200);
    const jMe: any = await rMe.json();
    expect(jMe.sub, "me subject as registered user").toBe(jReg.id);
  });

  it("openapi spec documents all routes + default limit", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status, "spec status").toBe(200);
    const spec: any = await res.json();
    const paths = Object.keys(spec.paths);
    expect(paths, "spec has health").toContain("/health");
    expect(paths, "spec has register").toContain("/register");
    expect(paths, "spec has login").toContain("/login");
    expect(paths, "spec has refresh").toContain("/refresh");
    expect(paths, "spec has logout").toContain("/logout");
    expect(paths, "spec has me").toContain("/me");
    expect(paths, "spec has posts list").toContain("/posts");
    expect(paths, "spec has posts get").toContain("/posts/{id}");
    expect(paths, "spec has comments list").toContain("/posts/{postId}/comments");
    expect(paths, "spec has comment delete").toContain("/posts/{postId}/comments/{commentId}");

    // The JWT auth scheme is documented as a bearer security scheme.
    expect(spec.components?.securitySchemes?.jwt?.scheme, "jwt security scheme is bearer").toBe(
      "bearer",
    );

    // Check that the limit query param has default: 10 in the spec
    const limitParam = spec.paths?.["/posts"]?.get?.parameters?.find(
      (p: any) => p.name === "limit",
    );
    expect(limitParam?.schema?.default, "limit default in spec").toBe(10);
  });

  it("docs UI returns HTML", async () => {
    const res = await app.request("/docs");
    expect(res.status, "docs status").toBe(200);
  });

  // Golden OpenAPI spec regression guard. To update the snapshot:
  // `rm examples/blog/spec.snapshot.json && nub run blog:check` — review the diff and commit it.
  it("openapi spec snapshot matches", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status, "snapshot spec status").toBe(200);
    const spec = await res.json();

    const here = dirname(fileURLToPath(import.meta.url));
    const snapshotPath = join(here, "spec.snapshot.json");
    const actual = `${JSON.stringify(spec, null, 2)}\n`;

    if (!existsSync(snapshotPath)) {
      writeFileSync(snapshotPath, actual);
      return;
    }
    const expected = readFileSync(snapshotPath, "utf8");
    expect(actual, "spec snapshot mismatch — update spec.snapshot.json if intentional").toBe(
      expected,
    );
  });
});
