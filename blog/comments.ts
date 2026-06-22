import { type } from 'arktype'
import { fail } from '../lib/api.js'
import { api } from './setup.js'
import { getPost, listComments, createComment, deleteComment } from './store.js'

const commentSchema = type({
  id: 'string',
  postId: 'string',
  content: 'string >= 1',
  authorId: 'string',
  createdAt: 'string',
})

// --- GET /posts/:postId/comments — list comments for a post ---

api(
  {
    method: 'GET',
    path: '/posts/:postId/comments',
    tags: ['Comments'],
    summary: 'List comments on a post',
    responses: { 200: type({ comments: commentSchema.array() }) },
  },
  async ({ postId }) => {
    if (!getPost(postId)) throw fail.notFound('post not found')
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
    body: type({ content: 'string >= 1' }),
    responses: { 201: commentSchema },
    auth: 'required',
  },
  async ({ postId, body, auth }) => {
    const comment = createComment(postId, body.content, auth.user.id)
    if (!comment) throw fail.notFound('post not found')
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
    if (!deleteComment(postId, commentId)) throw fail.notFound('comment not found')
    return null
  },
)
