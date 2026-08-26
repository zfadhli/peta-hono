import { type } from "arktype";
import { hashPassword, verifyPassword } from "peta-auth";
import { session } from "peta-auth/hono";
import { createApi, fail } from "../../src/index.js";

// --- Types ---

interface User {
  id: string;
  email: string;
  passwordHash: string;
}

const users = new Map<string, User>();

// --- App ---

const { api, auth, docs, app } = createApi<{ user: { id: string; email: string } }>({
  title: "Auth Example",
  version: "1.0.0",
});

// ponytail: hardcoded password for demo — load from env in production
app.use("*", session({ password: "a".repeat(32), cookieName: "session" }));

// Bridge peta-auth session → peta-hono typed auth context
auth(
  "session",
  async (c) => {
    const s = c.var.session;
    if (!s.userId) throw fail.unauthorized();
    return { user: { id: s.userId, email: s.email ?? "" } };
  },
  { type: "http", scheme: "bearer" },
);

// --- Register ---

api(
  {
    method: "POST",
    path: "/auth/register",
    body: type({ email: "string", password: "string >= 8" }),
    responses: { 201: type({ id: "string", email: "string" }) },
    summary: "Register a new user",
    tags: ["Auth"],
  },
  async ({ body, c }) => {
    if (users.has(body.email)) throw fail.conflict("Email already registered");
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(body.password);
    users.set(body.email, { id, email: body.email, passwordHash });

    const s = c.var.session;
    s.userId = id;
    s.email = body.email;
    await s.save();

    return { id, email: body.email };
  },
);

// --- Login ---

api(
  {
    method: "POST",
    path: "/auth/login",
    body: type({ email: "string", password: "string" }),
    responses: { 200: type({ id: "string", email: "string" }) },
    summary: "Login with email and password",
    tags: ["Auth"],
  },
  async ({ body, c }) => {
    const user = users.get(body.email);
    if (!user) throw fail.unauthorized("Invalid email or password");
    const valid = await verifyPassword(user.passwordHash, body.password);
    if (!valid) throw fail.unauthorized("Invalid email or password");

    const s = c.var.session;
    s.userId = user.id;
    s.email = user.email;
    await s.save();

    return { id: user.id, email: user.email };
  },
);

// --- Profile (protected) ---

api(
  {
    method: "GET",
    path: "/auth/profile",
    auth: "session",
    summary: "Get profile of currently logged-in user",
    tags: ["Auth"],
  },
  async ({ auth }) => {
    return { id: auth.user.id, email: auth.user.email };
  },
);

// --- Logout (protected) ---

api(
  {
    method: "POST",
    path: "/auth/logout",
    auth: "session",
    summary: "Logout and destroy session",
    tags: ["Auth"],
    status: 204,
  },
  async ({ c }) => {
    const s = c.var.session;
    s.destroy();
    return null;
  },
);

// --- Mount OpenAPI docs ---

docs();

export default app;
