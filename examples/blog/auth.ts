import { type } from "arktype";
import { fail } from "../../src/index.js";
import { hashPassword, verifyPassword } from "../../src/password.js";
import { api, jwt } from "./setup.js";

// --- Demo user store (colocated with the auth routes) ---
// ponytail: in-memory user store keyed by email. The demo password is hashed once
// at module load via `peta-hono/password` (scrypt); login constant-time verifies
// against it. Replace with a real users table for production.

export type User = { id: string; email: string; passwordHash: string };

// Public representation of a created user — never returns the password hash.
export type UserResponse = Omit<User, "passwordHash">;
const userSchema = type({ id: "string", email: "string" });

const demoPasswordHash = await hashPassword("password");

const users = new Map<string, User>([
  [
    "alice@example.com",
    { id: "alice", email: "alice@example.com", passwordHash: demoPasswordHash },
  ],
]);

// Public health check.
api.get("/health", { tags: ["System"], summary: "Health check" }, async () => ({ ok: true }));

// --- Register ---
// Create a user. One-shot insert (no `resolve` — there is no parent resource to
// load-and-guard). The password is hashed via `peta-hono/password` before it is
// stored; duplicate emails are rejected 409. The response never includes the hash.
api.post(
  "/register",
  {
    tags: ["Auth"],
    summary: "Register a new user",
    body: type({ email: "string", password: "string >= 8" }),
    responses: { 201: userSchema },
  },
  async ({ body }) => {
    if (users.has(body.email)) {
      throw fail.conflict("email already registered");
    }
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(body.password);
    const user: User = { id, email: body.email, passwordHash };
    users.set(body.email, user);
    return { id: user.id, email: user.email };
  },
);

// --- Login / refresh / logout ---
// Login validates credentials (constant-time) and issues a JWT access token. The
// access token travels in the body; the refresh token travels in BOTH the body
// and the HttpOnly `rt` cookie (so a client can use either transport to refresh).

api.post(
  "/login",
  {
    tags: ["Auth"],
    summary: "Log in — issue a JWT access token and set the refresh cookie",
    body: type({ email: "string", password: "string" }),
    responses: {
      200: type({ accessToken: "string", refreshToken: "string", expiresIn: "number" }),
    },
  },
  // Pass `c` so `refreshTransport` also sets the HttpOnly refresh cookie.
  async ({ body, c }) => {
    const user = users.get(body.email);
    // Constant-time verify against the precomputed `peta-hono/password` hash.
    if (!user || !(await verifyPassword(user.passwordHash, body.password))) {
      throw fail.unauthorized("Invalid credentials");
    }
    return jwt.issue(user.id, {}, c);
  },
);

api.post(
  "/refresh",
  {
    tags: ["Auth"],
    summary: "Rotate a refresh token for a fresh access token",
    body: type({ refreshToken: "string" }),
    responses: {
      200: type({ accessToken: "string", refreshToken: "string", expiresIn: "number" }),
    },
  },
  // Pass `c` so the rotated refresh token also lands in the refresh cookie.
  async ({ body, c }) => jwt.refresh(body.refreshToken, c),
);

api.post(
  "/logout",
  {
    tags: ["Auth"],
    summary: "Revoke the refresh token and clear the refresh cookie",
    status: 204,
    body: type({ refreshToken: "string" }),
  },
  async ({ body, c }) => {
    await jwt.revoke(body.refreshToken, c);
    return null;
  },
);

// --- Authenticated — demonstrates `{ auth: "jwt" }` ---

api.get(
  "/me",
  { auth: "jwt", tags: ["Auth"], summary: "The current JWT subject" },
  async ({ auth }) => ({ sub: auth.sub }),
);
