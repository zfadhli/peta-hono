// Tests the blog example app (posts + comments CRUD, OpenAPI spec, docs UI,
// and the golden spec snapshot). Uses `app.request()` directly — no server boot.
//
// The old `selfcheck.ts` tracked a hardcoded assertion count (`All 41 blog
// self-checks passed ✓`) that silently desynced as asserts were added/removed.
// Real `expect()` assertions remove that bookkeeping.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { app, docs } from "./setup.js";

// Import route files for side-effect registration
await import("./posts.js");
await import("./comments.js");

// Mount docs after routes
docs();

const auth = { authorization: "Bearer secret" };
const json = { "content-type": "application/json" };

describe("blog API", () => {
  it("list / get / create / update / delete posts and comments", async () => {
    let createdPostId = "";
    let createdCommentId = "";

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

    // 6. Create post with auth → 201
    const r5 = await app.request("/posts", {
      method: "POST",
      headers: { ...json, ...auth },
      body: JSON.stringify({ title: "New Post", content: "Fresh content" }),
    });
    const j5: any = await r5.json();
    expect(r5.status, "create post status").toBe(201);
    expect(typeof j5.id, "create post has id").toBe("string");
    expect(j5.title, "create post title").toBe("New Post");
    createdPostId = j5.id;

    // 7. Update post with auth → 200
    const r6 = await app.request(`/posts/${createdPostId}`, {
      method: "PUT",
      headers: { ...json, ...auth },
      body: JSON.stringify({ title: "Updated Post" }),
    });
    const j6: any = await r6.json();
    expect(r6.status, "update post status").toBe(200);
    expect(j6.title, "update post title").toBe("Updated Post");

    // 8. Update missing post → 404
    const r6b = await app.request("/posts/nonexistent", {
      method: "PUT",
      headers: { ...json, ...auth },
      body: JSON.stringify({ title: "nope" }),
    });
    expect(r6b.status, "update missing post status").toBe(404);

    // 9. Delete post with auth → 204 No Content
    const r7 = await app.request(`/posts/${createdPostId}`, {
      method: "DELETE",
      headers: { ...auth },
    });
    const body7 = await r7.text();
    expect(r7.status, "delete post status").toBe(204);
    expect(body7, "delete post body empty").toBe("");

    // 10. Delete missing post → 404
    const r7b = await app.request(`/posts/${createdPostId}`, {
      method: "DELETE",
      headers: { ...auth },
    });
    const j7b: any = await r7b.json();
    expect(r7b.status, "delete missing post status").toBe(404);
    expect(j7b.error, "delete missing post error").toBe("post not found");

    // 11. List comments for a post (public)
    const postId = firstPost.id;
    const r8 = await app.request(`/posts/${postId}/comments`);
    const j8: any = await r8.json();
    expect(r8.status, "list comments status").toBe(200);
    expect(Array.isArray(j8.comments), "list comments is array").toBe(true);

    // 12. List comments for missing post → 404
    const r8b = await app.request("/posts/nonexistent/comments");
    expect(r8b.status, "list comments missing post").toBe(404);

    // 13. Create comment with auth → 201
    const r9 = await app.request(`/posts/${postId}/comments`, {
      method: "POST",
      headers: { ...json, ...auth },
      body: JSON.stringify({ content: "Great post!" }),
    });
    const j9: any = await r9.json();
    expect(r9.status, "create comment status").toBe(201);
    expect(typeof j9.id, "create comment has id").toBe("string");
    expect(j9.content, "create comment content").toBe("Great post!");
    createdCommentId = j9.id;

    // 14. Create comment without auth → 401
    const r9b = await app.request(`/posts/${postId}/comments`, {
      method: "POST",
      headers: { ...json },
      body: JSON.stringify({ content: "no auth" }),
    });
    expect(r9b.status, "create comment no auth").toBe(401);

    // 15. Create comment on missing post → 404
    const r9c = await app.request("/posts/nonexistent/comments", {
      method: "POST",
      headers: { ...json, ...auth },
      body: JSON.stringify({ content: "nope" }),
    });
    expect(r9c.status, "create comment missing post").toBe(404);

    // 16. Delete comment with auth → 204 No Content
    const r10 = await app.request(`/posts/${postId}/comments/${createdCommentId}`, {
      method: "DELETE",
      headers: { ...auth },
    });
    const body10 = await r10.text();
    expect(r10.status, "delete comment status").toBe(204);
    expect(body10, "delete comment body empty").toBe("");

    // 17. Delete missing comment → 404
    const r10b = await app.request(`/posts/${postId}/comments/${createdCommentId}`, {
      method: "DELETE",
      headers: { ...auth },
    });
    const j10b: any = await r10b.json();
    expect(r10b.status, "delete missing comment status").toBe(404);
    expect(j10b.error, "delete missing comment error").toBe("comment not found");
  });

  it("openapi spec documents all routes + default limit", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status, "spec status").toBe(200);
    const spec: any = await res.json();
    const paths = Object.keys(spec.paths);
    expect(paths, "spec has posts list").toContain("/posts");
    expect(paths, "spec has posts get").toContain("/posts/{id}");
    expect(paths, "spec has comments list").toContain("/posts/{postId}/comments");
    expect(paths, "spec has comment delete").toContain("/posts/{postId}/comments/{commentId}");

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
  // `rm examples/blog/spec.snapshot.json && nub run test` — review the diff and commit it.
  it("openapi spec snapshot matches", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status, "snapshot spec status").toBe(200);
    const spec = await res.json();

    const here = dirname(fileURLToPath(import.meta.url));
    const snapshotPath = join(here, "spec.snapshot.json");
    const actual = `${JSON.stringify(spec, null, 2)}\n`;

    // Mirror the old self-check: if the snapshot is missing, regenerate it; git
    // diff then surfaces the change for a human to review before committing.
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
