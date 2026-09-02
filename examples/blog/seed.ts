// Seed the posts table with demo data. The posts route module imports this and
// runs `seed()` once at module load, before any request. A real app would seed
// via a migration or an admin script instead.

import { db } from "./db.js";
import { posts } from "./schema.js";

export async function seed() {
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
