import { createClient } from "@libsql/client";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { comments, posts } from "./schema.js";

export type Post = {
  id: string;
  title: string;
  content: string;
  authorId: string;
  createdAt: string;
};

export type Comment = {
  id: string;
  postId: string;
  content: string;
  authorId: string;
  createdAt: string;
};

const client = createClient({ url: ":memory:" });

// Create tables
await client.execute(
  "CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL)",
);
await client.execute(
  "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, content TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL)",
);
export const db = drizzle(client);

// --- Seed data ---

async function seed() {
  const now = new Date().toISOString();
  const existing = await db.select({ id: posts.id }).from(posts).limit(1);
  if (existing.length > 0) return; // already seeded

  for (const post of [
    {
      title: "Getting Started with Encore",
      content: "Encore.ts is an open source infrastructure SDK for TypeScript...",
    },
    {
      title: "Building REST APIs with Hono",
      content: "Hono is a small, simple, and ultrafast web framework...",
    },
    {
      title: "Type-Safe APIs with Zod",
      content: "Zod is a TypeScript-first schema declaration and validation library...",
    },
  ]) {
    await db.insert(posts).values({
      id: crypto.randomUUID(),
      ...post,
      authorId: "alice",
      createdAt: now,
    });
  }
}
await seed();

// --- Post operations ---

export async function listPosts(
  limit: number,
  offset: number,
): Promise<{ posts: Post[]; total: number }> {
  const rows = await db
    .select()
    .from(posts)
    .orderBy(desc(posts.createdAt))
    .limit(limit)
    .offset(offset);

  const countResult = await db.select({ count: sql<number>`count(*)` }).from(posts);
  const count = countResult[0]?.count ?? 0;

  return { posts: rows as Post[], total: Number(count) };
}

export async function getPost(id: string): Promise<Post | undefined> {
  const rows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  return rows[0] as Post | undefined;
}

export async function createPost(title: string, content: string, authorId: string): Promise<Post> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(posts).values({ id, title, content, authorId, createdAt: now });
  return { id, title, content, authorId, createdAt: now };
}

export async function updatePost(
  id: string,
  data: { title?: string; content?: string },
): Promise<Post | undefined> {
  const existing = await getPost(id);
  if (!existing) return undefined;

  const updated = { ...existing, ...data };
  await db.update(posts).set(updated).where(eq(posts.id, id));
  return updated;
}

export async function deletePost(id: string): Promise<boolean> {
  const existing = await getPost(id);
  if (!existing) return false;
  await db.delete(posts).where(eq(posts.id, id));
  return true;
}

// --- Comment operations ---

export async function listComments(postId: string): Promise<Comment[]> {
  const rows = await db
    .select()
    .from(comments)
    .where(eq(comments.postId, postId))
    .orderBy(comments.createdAt);
  return rows as Comment[];
}

export async function createComment(
  postId: string,
  content: string,
  authorId: string,
): Promise<Comment | undefined> {
  // Verify post exists
  const post = await getPost(postId);
  if (!post) return undefined;

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.insert(comments).values({ id, postId, content, authorId, createdAt: now });
  return { id, postId, content, authorId, createdAt: now };
}

export async function deleteComment(postId: string, commentId: string): Promise<boolean> {
  const rows = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
  const comment = rows[0];
  if (!comment || comment.postId !== postId) return false;
  await db.delete(comments).where(eq(comments.id, commentId));
  return true;
}
