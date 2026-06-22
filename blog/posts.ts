import { z } from 'zod'
import { APIError } from '../lib/api.js'
import { api } from './setup.js'
import { createPost, deletePost, getPost, listPosts, updatePost } from './store.js'

// --- Reusable response schemas ---

const postSchema = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  authorId: z.string(),
  createdAt: z.string(),
})

// --- GET /posts — list with pagination ---

api(
  {
    method: 'GET',
    path: '/posts',
    tags: ['Posts'],
    summary: 'List all posts',
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(10),
      offset: z.coerce.number().int().min(0).default(0),
    }),
  },
  async ({ query }) => listPosts(query.limit, query.offset),
)

// --- GET /posts/:id — get one ---

api(
  {
    method: 'GET',
    path: '/posts/:id',
    tags: ['Posts'],
    summary: 'Get a post by ID',
    responses: { 200: postSchema },
  },
  async ({ id }) => {
    const post = getPost(id)
    if (!post) throw new APIError(404, 'post not found')
    return post
  },
)

// --- POST /posts — create (auth required) ---

api(
  {
    method: 'POST',
    path: '/posts',
    tags: ['Posts'],
    summary: 'Create a new post',
    body: z.object({
      title: z.string().min(1),
      content: z.string().min(1),
    }),
    responses: { 201: postSchema },
    auth: 'required',
  },
  async ({ body }) => {
    // ponytail: hardcoded authorId — in a real app this comes from the auth context
    return createPost(body.title, body.content, 'alice')
  },
)

// --- PUT /posts/:id — update (auth required) ---

api(
  {
    method: 'PUT',
    path: '/posts/:id',
    tags: ['Posts'],
    summary: 'Update an existing post',
    body: z.object({
      title: z.string().optional(),
      content: z.string().optional(),
    }),
    responses: { 200: postSchema },
    auth: 'required',
  },
  async ({ id, body }) => {
    const updated = updatePost(id, body)
    if (!updated) throw new APIError(404, 'post not found')
    return updated
  },
)

// --- DELETE /posts/:id — delete (auth required, returns 204 No Content) ---

api(
  {
    method: 'DELETE',
    path: '/posts/:id',
    tags: ['Posts'],
    summary: 'Delete a post',
    status: 204,
    auth: 'required',
  },
  async ({ id }) => {
    if (!deletePost(id)) throw new APIError(404, 'post not found')
    return null
  },
)
