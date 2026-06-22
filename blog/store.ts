// ponytail: in-memory Map store, no DB. Replace with real DB when data needs to persist.

export type Post = {
  id: string
  title: string
  content: string
  authorId: string
  createdAt: string
}

export type Comment = {
  id: string
  postId: string
  content: string
  authorId: string
  createdAt: string
}

const posts = new Map<string, Post>()
const comments = new Map<string, Comment>()

// --- Seeded data ---

function seed() {
  const now = new Date().toISOString()
  for (const post of [
    { title: 'Getting Started with Encore', content: 'Encore.ts is an open source infrastructure SDK for TypeScript...' },
    { title: 'Building REST APIs with Hono', content: 'Hono is a small, simple, and ultrafast web framework...' },
    { title: 'Type-Safe APIs with Zod', content: 'Zod is a TypeScript-first schema declaration and validation library...' },
  ]) {
    const postId = crypto.randomUUID()
    posts.set(postId, { id: postId, ...post, authorId: 'alice', createdAt: now })
  }
}
seed()

// --- Post operations ---

export function listPosts(limit: number, offset: number): { posts: Post[]; total: number } {
  const all = [...posts.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return { posts: all.slice(offset, offset + limit), total: all.length }
}

export function getPost(id: string): Post | undefined {
  return posts.get(id)
}

export function createPost(title: string, content: string, authorId: string): Post {
  const id = crypto.randomUUID()
  const post: Post = { id, title, content, authorId, createdAt: new Date().toISOString() }
  posts.set(id, post)
  return post
}

export function updatePost(id: string, data: { title?: string; content?: string }): Post | undefined {
  const post = posts.get(id)
  if (!post) return undefined
  const updated = { ...post, ...data }
  posts.set(id, updated)
  return updated
}

export function deletePost(id: string): boolean {
  return posts.delete(id)
}

// --- Comment operations ---

export function listComments(postId: string): Comment[] {
  return [...comments.values()]
    .filter((c) => c.postId === postId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export function createComment(postId: string, content: string, authorId: string): Comment | undefined {
  if (!posts.has(postId)) return undefined
  const id = crypto.randomUUID()
  const comment: Comment = { id, postId, content, authorId, createdAt: new Date().toISOString() }
  comments.set(id, comment)
  return comment
}

export function deleteComment(postId: string, commentId: string): boolean {
  const comment = comments.get(commentId)
  if (!comment || comment.postId !== postId) return false
  return comments.delete(commentId)
}
