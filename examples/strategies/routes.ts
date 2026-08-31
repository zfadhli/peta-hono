import { type } from "arktype";
import { createApi, fail } from "../../src/index.js";
import { hashPassword, verifyPassword } from "../../src/password.js";

/**
 * Demonstrates the three built-in auth strategies in one app, on the hardened
 * (ticket 03–05) surface:
 *   - session (cookie, csrf `"origin"`) → `/auth/me`, `/auth/logout`
 *   - jwt (bearer + rotating refresh + HttpOnly refresh cookie) → `/auth/token`,
 *     `/auth/refresh`, `/auth/verify`
 *   - google oauth2 (authorization-code + PKCE) → `/auth/google/start`, `/auth/google/callback`
 *
 * It also shows the opt-in `peta-hono/password` helper (`hashPassword` /
 * `verifyPassword`) for hashing the demo user's credential.
 *
 * The strategies compose with the existing `{ auth: name }` route gating: each
 * guard is registered exactly like a hand-written `auth(name, mw, scheme)` and
 * gets the same OpenAPI 401 + `security` + `securitySchemes` treatment.
 *
 * ponytail: OAuth's token/userinfo endpoints are mocked via an injected
 * `fetchFn` (a real app points at Google and keeps `clientSecret` server-side).
 * The demo user is a fixed map — plug in a DB for production.
 */

// Credential-bearing config. In a real deployment these MUST come from the
// environment (or a secrets manager) — never from a committed literal. The env
// reads below keep the example runnable out-of-the-box (each fallback is a
// deliberate non-secret `replace-this`/`example` template) while documenting the
// production pattern: a deployed app sets SESSION_SECRET, JWT_SECRET,
// GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET and commits no real values.
const env = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
};

const users = new Map<string, { id: string; email: string }>([
  ["alice@example.com", { id: "u_alice", email: "alice@example.com" }],
]);

// Opt-in password helper: hash the demo password once at module load; login
// constant-time-verifies against it (rather than a hardcoded string compare).
const demoPasswordHash = await hashPassword("password");

const { api, auth, docs, app } = createApi<{ userId?: string; email?: string; sub?: string }>({
  title: "Strategies API",
  version: "1.0.0",
});

// --- Session strategy (cookie) ---
const session = auth.session("session", {
  secret: env("SESSION_SECRET", "replace-this-32-byte-session-secret!!"),
  cookieName: "sid",
  // CSRF defaults to `"origin"`: a cross-site mutating request (mismatched
  // `Origin` or `Sec-Fetch-Site: cross-site`) is rejected 403 with no client
  // token. `origin` (a string | string[]) is REQUIRED in this mode — the demo
  // app serves from http://localhost:3000, so this is the allowed origin.
  origin: ["http://localhost:3000"],
  // Dev-over-http: the session cookie is `Secure` by default (production). This
  // example runs on http, so opt out explicitly — remove in prod (or on https).
  cookie: { secure: false },
});

// --- JWT strategy (bearer access + rotating refresh) ---
const jwt = auth.jwt("jwt", {
  // Key rotation: `keys[0]` signs and stamps its `kid`; verification looks the
  // key up by the token's `kid` (an unknown/missing `kid` is rejected). Rotate
  // by prepending a new key and dropping the retired one.
  keys: [
    { kid: "2026-08", secret: env("JWT_SECRET", "replace-this-32-byte-jwt-secret!!") },
    { kid: "2025-11", secret: env("JWT_SECRET_OLD", "older-rotated-out-secret-32-bytes!!") },
  ],
  // `algorithms` pins the accepted `alg` (must include the signing alg). Signing
  // with `keys[0]` (an HMAC secret) is HS256, so HS256 must be accepted.
  algorithms: ["HS256"],
  // Asymmetric / multi-service verification is opt-in via `jwks` — a `URL`
  // resolves a remote JWKS, `{ keys: JWK[] }` a local one. Signing still uses
  // `keys`/`secret`. See `src/auth.selfcheck.ts` (`jwtAsymmetric`) for a full
  // RS256 + local-JWKS round-trip example.
  // jwks: someUrl | { keys: [{ kty, kid, k / n / e, alg }] },
  issuer: "strategies-example",
  audience: "api",
  accessTtl: 900,
  refreshTtl: 2592000,
  // `refreshTransport` also sets/clears an HttpOnly refresh cookie (path-scoped
  // to `/auth`) on `issue`/`refresh`/`revoke`. Tokens are still returned in the
  // body, so a client can use either transport.
  refreshTransport: { cookie: { name: "rt", path: "/auth" } },
});

// --- Google OAuth2 (authorization-code flow) ---
// ponytail: mock endpoints so the example runs without real Google creds. A real
// app passes clientId/clientSecret/redirectUri and omits fetchFn.
auth.oauth("google", {
  clientId: env("GOOGLE_CLIENT_ID", "example-client-id"),
  clientSecret: env("GOOGLE_CLIENT_SECRET", "example-client-secret"),
  redirectUri: "http://localhost:3000/auth/google/callback",
  scopes: ["openid", "email", "profile"],
  // PKCE is on by default (even with a clientSecret) — no `usePKCE` needed.
  // Dev-over-http: the state cookie is `Secure` by default (production). This
  // example runs on http, so opt out explicitly — remove in prod (or on https).
  stateCookie: { secure: false },
  tokenURL: "https://mock.example/token",
  userInfoURL: "https://mock.example/userinfo",
  // Demo mock — real apps omit `fetchFn` and point at Google (server-side secret).
  fetchFn: async (input, init) => {
    const url =
      typeof input === "string" ? input : input instanceof Request ? input.url : String(input);
    if (url.includes("/token")) {
      void init;
      return new Response(
        JSON.stringify({
          access_token: "mock_access",
          id_token: "mock_id",
          expires_in: 3600,
          token_type: "Bearer",
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (url.includes("/userinfo")) {
      return new Response(
        JSON.stringify({ sub: "google-123", email: "alice@example.com", email_verified: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("not found", { status: 404 });
  },
  onError: (err) =>
    new Response(JSON.stringify({ error: err.message }), {
      status: 400,
      headers: { "content-type": "application/json" },
    }),
  onSuccess: async ({ user, c }) => {
    // Demo: issue a session for the returning user (or issue a JWT via jwt.issue()).
    // session.create(...) returns the `Set-Cookie` value — attach it because this
    // handler returns a raw Response (a plain `c.header()` would be dropped).
    const email = typeof user.email === "string" ? user.email : "";
    const sub = typeof user.sub === "string" ? user.sub : "";
    const cookie = await session.create(c, { userId: sub, email });
    const res = new Response(JSON.stringify({ email, sub }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    res.headers.append("Set-Cookie", cookie);
    return res;
  },
});

// --- Public ---

api.get("/health", { tags: ["System"] }, async () => ({ ok: true }));

// --- Session routes ---

api.post(
  "/auth/login",
  {
    tags: ["Auth"],
    summary: "Log in (session)",
    body: type({ email: "string", password: "string" }),
    responses: { 200: type({ email: "string" }) },
  },
  async ({ body, c }) => {
    const user = users.get(body.email);
    // Verify against the precomputed `peta-hono/password` hash (constant-time).
    if (!user || !(await verifyPassword(demoPasswordHash, body.password))) {
      throw fail.unauthorized("Invalid credentials");
    }
    await session.create(c, { userId: user.id, email: user.email });
    return { email: user.email };
  },
);

api.get(
  "/auth/me",
  { auth: "session", tags: ["Auth"], summary: "Current session user" },
  async ({ auth }) => ({ id: auth.userId, email: auth.email }),
);

api.post(
  "/auth/logout",
  { auth: "session", status: 204, tags: ["Auth"], summary: "Destroy session" },
  async ({ c }) => {
    await session.destroy(c);
    return null;
  },
);

// --- JWT routes ---

api.post(
  "/auth/token",
  { tags: ["Auth"], summary: "Issue access + refresh token", body: type({ email: "string" }) },
  // Pass `c` so `refreshTransport` also sets the HttpOnly refresh cookie.
  async ({ body, c }) => {
    const user = users.get(body.email);
    if (!user) throw fail.unauthorized("Unknown user");
    return jwt.issue(user.id, {}, c);
  },
);

api.post(
  "/auth/refresh",
  {
    tags: ["Auth"],
    summary: "Rotate a refresh token",
    body: type({ refreshToken: "string" }),
    responses: {
      200: type({ accessToken: "string", refreshToken: "string", expiresIn: "number" }),
    },
  },
  // Pass `c` so the rotated refresh token also lands in the refresh cookie.
  async ({ body, c }) => jwt.refresh(body.refreshToken, c),
);

api.get(
  "/auth/verify",
  { auth: "jwt", tags: ["Auth"], summary: "Verify the bearer access token" },
  async ({ auth }) => ({ sub: auth.sub }),
);

// --- Mount OpenAPI docs ---

docs({ specPath: "/openapi.json", uiPath: "/docs" });

export { app };
