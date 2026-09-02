// Shared SQLite client. All route files import `db` from here so they share one
// in-memory database; each route file keeps its own query logic colocated (see
// posts.ts / comments.ts). Table columns are declared in schema.ts (drizzle)
// and mirrored here as raw DDL so the tables exist before any query runs.

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

const client = createClient({ url: ":memory:" });

// Create tables
await client.execute(
  "CREATE TABLE IF NOT EXISTS posts (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL)",
);
await client.execute(
  "CREATE TABLE IF NOT EXISTS comments (id TEXT PRIMARY KEY, post_id TEXT NOT NULL, content TEXT NOT NULL, author_id TEXT NOT NULL, created_at TEXT NOT NULL)",
);

export const db = drizzle(client);
