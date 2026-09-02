import { type } from "arktype";
import { eq } from "drizzle-orm";
import { fail } from "../../src/index.js";
import { db } from "./db.js";
import { comments, posts } from "./schema.js";
import { api } from "./setup.js";

type Comment = {
  id: string;
  postId: string;
  content: string;
  authorId: string;
  createdAt: string;
};

// --- Reusable response schema ---

const commentSchema = type({
  id: "string",
  postId: "string",
  content: "string >= 1",
  authorId: "string",
  createdAt: "string",
});

// --- Resolver: verify the parent post exists (used by GET + POST comment) ---
// A no-auth resolver reads only `{ postId }`; thrown `fail.notFound` on a missing
// post flows through onError the same way a handler throw does.
const existingPost = async ({ postId }: { postId: string }) => {
  const rows = await db.select({ id: posts.id }).from(posts).where(eq(posts.id, postId)).limit(1);
  if (rows.length === 0) throw fail.notFound("post not found");
  return rows[0];
};

// --- GET /posts/:postId/comments — list comments for a post ---

api.get(
  "/posts/:postId/comments",
  {
    tags: ["Comments"],
    summary: "List comments on a post",
    responses: { 200: type({ comments: commentSchema.array() }) },
    resolve: { post: existingPost },
  },
  async ({ postId }) => {
    const rows = await db
      .select()
      .from(comments)
      .where(eq(comments.postId, postId))
      .orderBy(comments.createdAt);
    return { comments: rows as Comment[] };
  },
);

// --- POST /posts/:postId/comments — create comment (auth required) ---

api.post(
  "/posts/:postId/comments",
  {
    tags: ["Comments"],
    summary: "Add a comment to a post",
    body: type({ content: "string >= 1" }),
    responses: { 201: commentSchema },
    auth: "jwt",
    resolve: { post: existingPost },
  },
  async ({ postId, body, auth }) => {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    await db
      .insert(comments)
      .values({ id, postId, content: body.content, authorId: auth.sub, createdAt: now });
    return { id, postId, content: body.content, authorId: auth.sub, createdAt: now };
  },
);

// --- DELETE /posts/:postId/comments/:commentId — delete comment (auth required) ---

api.delete(
  "/posts/:postId/comments/:commentId",
  {
    tags: ["Comments"],
    summary: "Delete a comment",
    status: 204,
    auth: "jwt",
  },
  async ({ postId, commentId }) => {
    const rows = await db.select().from(comments).where(eq(comments.id, commentId)).limit(1);
    const comment = rows[0];
    if (!comment || comment.postId !== postId) throw fail.notFound("comment not found");
    await db.delete(comments).where(eq(comments.id, commentId));
    return null;
  },
);
