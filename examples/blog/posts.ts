import { type } from "arktype";
import { desc, eq, sql } from "drizzle-orm";
import { fail } from "../../src/index.js";
import { db } from "./db.js";
import { posts } from "./schema.js";
import { seed } from "./seed.js";
import { api } from "./setup.js";

// Seed the posts table once at module load (before any request).
await seed();

type Post = {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: string;
};

// --- Reusable response schemas ---

const postSchema = type({
  id: "string",
  title: "string",
  content: "string",
  authorId: "string",
  createdAt: "string",
});

// --- Resolver: load a post and enforce ownership (used by PUT/DELETE via resolve) ---
// Inline queries stay in the route file (no query-wrapper functions). The
// resolver is a declared route input (`resolve: { post: ownedPost }`) that runs
// after validation + auth, and its return value is type-inferred onto the
// handler as `post` — the 404/403 checks live in ONE place, not per-route.
const ownedPost = async ({ id, auth }: { id: string; auth: { sub: string } }) => {
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  const existing = rows[0] as Post | undefined;
  if (!existing) throw fail.notFound("post not found");
  if (existing.authorId !== auth.sub) throw fail.forbidden();
  return existing;
};

// --- GET /posts — list with pagination (shorthand) ---

api.get(
  "/posts",
  {
    tags: ["Posts"],
    summary: "List all posts",
    query: type({
      limit: "1 <= number.integer <= 100 = 10",
      offset: "number.integer >= 0 = 0",
    }),
  },
  async ({ query }) => {
    const rows = await db
      .select()
      .from(posts)
      .orderBy(desc(posts.createdAt))
      .limit(query.limit)
      .offset(query.offset);
    const countResult = await db.select({ count: sql<number>`count(*)` }).from(posts);
    const count = countResult[0]?.count ?? 0;
    return { posts: rows as Post[], total: Number(count) };
  },
);

// --- GET /posts/:id — get one ---

api.get(
  "/posts/:id",
  {
    tags: ["Posts"],
    summary: "Get a post by ID",
    responses: { 200: postSchema },
  },
  async ({ id }) => {
    const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
    const post = rows[0] as Post | undefined;
    if (!post) throw fail.notFound("post not found");
    return post;
  },
);

// --- POST /posts — create (auth required) ---

api.post(
  "/posts",
  {
    tags: ["Posts"],
    summary: "Create a new post",
    body: type({
      title: "string >= 1",
      content: "string >= 1",
    }),
    responses: { 201: postSchema },
    auth: "jwt",
  },
  async ({ body, auth }) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db
      .insert(posts)
      .values({ id, title: body.title, content: body.content, authorId: auth.sub, createdAt: now });
    return { id, title: body.title, content: body.content, authorId: auth.sub, createdAt: now };
  },
);

// --- PUT /posts/:id — update (auth required) ---

api.put(
  "/posts/:id",
  {
    tags: ["Posts"],
    summary: "Update an existing post",
    body: type({
      title: "string?",
      content: "string?",
    }),
    responses: { 200: postSchema },
    auth: "jwt",
    resolve: { post: ownedPost },
  },
  async ({ id, body, post }) => {
    const updated = { ...post, ...body };
    await db.update(posts).set(updated).where(eq(posts.id, id));
    return updated;
  },
);

// --- DELETE /posts/:id — delete (auth required, returns 204 No Content) ---

api.delete(
  "/posts/:id",
  {
    tags: ["Posts"],
    summary: "Delete a post",
    status: 204,
    auth: "jwt",
    resolve: { post: ownedPost },
  },
  async ({ id }) => {
    await db.delete(posts).where(eq(posts.id, id));
    return null;
  },
);
