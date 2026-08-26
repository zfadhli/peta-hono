// ponytail: no test framework — runnable self-check with asserts.
// Boots the app on a random port, runs all endpoint tests, exits non-zero on failure.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdaptorServer } from "@hono/node-server";
import { app, docs } from "./setup.js";

// Import route files for side-effect registration
await import("./posts.js");
await import("./comments.js");

// Mount docs after routes
docs();

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
const base = `http://localhost:${port}`;

let createdPostId = "";
let createdCommentId = "";

try {
  // 1. List posts (public)
  const r1 = await fetch(`${base}/posts`);
  const j1: any = await r1.json();
  assert(r1.status === 200, "list posts status");
  assert(Array.isArray(j1.posts), "list posts has array");
  assert(j1.total >= 3, "list posts has seeded data");

  // 2. List posts with pagination
  const r1b = await fetch(`${base}/posts?limit=1&offset=0`);
  const j1b: any = await r1b.json();
  assert(r1b.status === 200, "list posts paginated status");
  assert(j1b.posts.length === 1, "list posts paginated limit");
  assert(j1b.total >= 3, "list posts paginated total");

  // 3. Get post by ID (public)
  const firstPost = j1.posts[0]!;
  const r2 = await fetch(`${base}/posts/${firstPost.id}`);
  const j2: any = await r2.json();
  assert(r2.status === 200, "get post status");
  assert(j2.title === firstPost.title, "get post title");

  // 4. Get missing post → 404
  const r3 = await fetch(`${base}/posts/nonexistent`);
  const j3: any = await r3.json();
  assert(r3.status === 404, "get missing post status");
  assert(j3.error === "post not found", "get missing post error");

  // 5. Create post without auth → 401
  const r4 = await fetch(`${base}/posts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "New Post", content: "Content" }),
  });
  assert(r4.status === 401, "create post no auth status");

  // 6. Create post with auth → 201
  const r5 = await fetch(`${base}/posts`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify({ title: "New Post", content: "Fresh content" }),
  });
  const j5: any = await r5.json();
  assert(r5.status === 201, "create post status");
  assert(typeof j5.id === "string", "create post has id");
  assert(j5.title === "New Post", "create post title");
  createdPostId = j5.id;

  // 7. Update post with auth → 200
  const r6 = await fetch(`${base}/posts/${createdPostId}`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify({ title: "Updated Post" }),
  });
  const j6: any = await r6.json();
  assert(r6.status === 200, "update post status");
  assert(j6.title === "Updated Post", "update post title");

  // 8. Update missing post → 404
  const r6b = await fetch(`${base}/posts/nonexistent`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify({ title: "nope" }),
  });
  assert(r6b.status === 404, "update missing post status");

  // 9. Delete post with auth → 204 No Content
  const r7 = await fetch(`${base}/posts/${createdPostId}`, {
    method: "DELETE",
    headers: { authorization: "Bearer secret" },
  });
  const body7 = await r7.text();
  assert(r7.status === 204, "delete post status");
  assert(body7 === "", "delete post body empty");

  // 10. Delete missing post → 404
  const r7b = await fetch(`${base}/posts/${createdPostId}`, {
    method: "DELETE",
    headers: { authorization: "Bearer secret" },
  });
  const j7b: any = await r7b.json();
  assert(r7b.status === 404, "delete missing post status");
  assert(j7b.error === "post not found", "delete missing post error");

  // 11. List comments for a post (public)
  const postId = firstPost.id;
  const r8 = await fetch(`${base}/posts/${postId}/comments`);
  const j8: any = await r8.json();
  assert(r8.status === 200, "list comments status");
  assert(Array.isArray(j8.comments), "list comments is array");

  // 12. List comments for missing post → 404
  const r8b = await fetch(`${base}/posts/nonexistent/comments`);
  assert(r8b.status === 404, "list comments missing post");

  // 13. Create comment with auth → 201
  const r9 = await fetch(`${base}/posts/${postId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify({ content: "Great post!" }),
  });
  const j9: any = await r9.json();
  assert(r9.status === 201, "create comment status");
  assert(typeof j9.id === "string", "create comment has id");
  assert(j9.content === "Great post!", "create comment content");
  createdCommentId = j9.id;

  // 14. Create comment without auth → 401
  const r9b = await fetch(`${base}/posts/${postId}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content: "no auth" }),
  });
  assert(r9b.status === 401, "create comment no auth");

  // 15. Create comment on missing post → 404
  const r9c = await fetch(`${base}/posts/nonexistent/comments`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer secret" },
    body: JSON.stringify({ content: "nope" }),
  });
  assert(r9c.status === 404, "create comment missing post");

  // 16. Delete comment with auth → 204 No Content
  const r10 = await fetch(`${base}/posts/${postId}/comments/${createdCommentId}`, {
    method: "DELETE",
    headers: { authorization: "Bearer secret" },
  });
  const body10 = await r10.text();
  assert(r10.status === 204, "delete comment status");
  assert(body10 === "", "delete comment body empty");

  // 17. Delete missing comment → 404
  const r10b = await fetch(`${base}/posts/${postId}/comments/${createdCommentId}`, {
    method: "DELETE",
    headers: { authorization: "Bearer secret" },
  });
  const j10b: any = await r10b.json();
  assert(r10b.status === 404, "delete missing comment status");
  assert(j10b.error === "comment not found", "delete missing comment error");

  // 18. OpenAPI spec has all routes
  const r11 = await fetch(`${base}/openapi.json`);
  const spec: any = await r11.json();
  assert(r11.status === 200, "spec status");
  const paths = Object.keys(spec.paths);
  assert(paths.includes("/posts"), "spec has posts list");
  assert(paths.includes("/posts/{id}"), "spec has posts get");
  assert(paths.includes("/posts/{postId}/comments"), "spec has comments list");
  assert(paths.includes("/posts/{postId}/comments/{commentId}"), "spec has comment delete");

  // Check that the limit query param has default: 10 in the spec
  const limitParam = spec.paths?.["/posts"]?.get?.parameters?.find((p: any) => p.name === "limit");
  assert(limitParam?.schema?.default === 10, "limit default in spec");

  // 19. Docs UI returns HTML
  const r12 = await fetch(`${base}/docs`);
  assert(r12.status === 200, "docs status");

  // 20. OpenAPI spec snapshot — catches spec regressions.
  // To update: rm blog/spec.snapshot.json && nub blog/selfcheck.ts
  const here = dirname(fileURLToPath(import.meta.url));
  const snapshotPath = join(here, "spec.snapshot.json");
  const actual = `${JSON.stringify(spec, null, 2)}\n`;
  if (!existsSync(snapshotPath)) {
    writeFileSync(snapshotPath, actual);
    console.log(`  ℹ spec.snapshot.json created — review and commit`);
  } else {
    const expected = readFileSync(snapshotPath, "utf8");
    if (actual !== expected) {
      writeFileSync(join(here, "spec.actual.json"), actual);
      failures.push(
        "spec snapshot mismatch — review spec.actual.json, update snapshot if intentional",
      );
    }
  }
} finally {
  server.close();
}

if (failures.length > 0) {
  console.error(`FAILED: ${failures.length} test(s)`);
  for (const f of failures) console.error(`  ✗ ${f}`);
  process.exit(failures.length);
} else {
  console.log(`All 41 blog self-checks passed ✓`); // ponytail: count stays 41 — the default assertion is part of the spec check
}
