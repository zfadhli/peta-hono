import { type } from "arktype";
import { fail } from "../../src/index.js";
import { createPost, deletePost, getPost, listPosts, updatePost } from "./db.js";
import { api } from "./setup.js";

// --- Reusable response schemas ---

const postSchema = type({
  id: "string",
  title: "string",
  content: "string",
  authorId: "string",
  createdAt: "string",
});

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
  async ({ query }) => listPosts(query.limit, query.offset),
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
    const post = await getPost(id);
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
    auth: "required",
  },
  async ({ body, auth }) => {
    return createPost(body.title, body.content, auth.user.id);
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
    auth: "required",
  },
  async ({ id, body, auth }) => {
    const existing = await getPost(id);
    if (!existing) throw fail.notFound("post not found");
    if (existing.authorId !== auth.user.id) throw fail.forbidden();
    const updated = await updatePost(id, body);
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
    auth: "required",
  },
  async ({ id, auth }) => {
    const existing = await getPost(id);
    if (!existing) throw fail.notFound("post not found");
    if (existing.authorId !== auth.user.id) throw fail.forbidden();
    await deletePost(id);
    return null;
  },
);
