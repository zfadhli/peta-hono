import { z } from 'zod'
import { APIError } from '../lib/api.js'
import { api } from './setup.js'
import { getPost, listComments, createComment, deleteComment } from './store.js'

const commentSchema = z.object({
  id: z.string(),
  postId: z.string(),
  content: z.string(),
  authorId: z.string(),
  createdAt: z.string(),
})

// --- GET /posts/:postId/comments — list comments for a post ---

api(
  {
    method: 'GET',
    path: '/posts/:postId/comments',
    tags: ['Comments'],
    summary: 'List comments on a post',
    responses: { 200: z.object({ comments: z.array(commentSchema) }) },
  },
  async ({ postId }) => {
    if (!getPost(postId)) throw new APIError(404, 'post not found')
    return { comments: listComments(postId) }
  },
)

// --- POST /posts/:postId/comments — create comment (auth required) ---

api(
  {
    method: 'POST',
    path: '/posts/:postId/comments',
    tags: ['Comments'],
    summary: 'Add a comment to a post',
    body: z.object({ content: z.string().min(1) }),
    responses: { 201: commentSchema },
    auth: 'required',
  },
  async ({ postId, body }) => {
    const comment = createComment(postId, body.content, 'bob')
    if (!comment) throw new APIError(404, 'post not found')
    return comment
  },
)

// --- DELETE /posts/:postId/comments/:commentId — delete comment (auth required) ---

api(
  {
    method: 'DELETE',
    path: '/posts/:postId/comments/:commentId',
    tags: ['Comments'],
    summary: 'Delete a comment',
    status: 204,
    auth: 'required',
  },
  async ({ postId, commentId }) => {
    if (!deleteComment(postId, commentId)) throw new APIError(404, 'comment not found')
    return null
  },
)
