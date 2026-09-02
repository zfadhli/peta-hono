// Shared API builder singleton — every route file imports `api` (and the JWT
// strategy handle) from here. ESM modules are singletons, so all routes register
// on the same `app` instance.

import { createApi } from "../../src/index.js";

// Credentials come from the environment in production; the fallback is a
// deliberate non-secret dev template (same approach as examples/strategies).
const env = (name: string, fallback: string): string => {
  const v = process.env[name];
  return v && v.length > 0 ? v : fallback;
};

const { api, auth, docs, app } = createApi<{ sub: string }>({
  title: "Blog API",
  version: "1.0.0",
});

// JWT strategy: a bearer access token (issued at login) plus an HttpOnly refresh
// cookie. Registering it here makes `{ auth: "jwt" }` a real gate — every such
// route is documented as protected (401 + a `security` requirement + a matching
// `components.securitySchemes` bearer entry). `refreshTransport` sets/rotates/
// clears the HttpOnly `rt` cookie when `issue`/`refresh`/`revoke` are handed the
// request `Context` (see examples/strategies/routes.ts).
const jwt = auth.jwt("jwt", {
  secret: env("JWT_SECRET", "replace-this-32-byte-jwt-secret!!"),
  algorithms: ["HS256"],
  issuer: "blog-api",
  audience: "api",
  accessTtl: 900,
  refreshTtl: 2592000,
  refreshTransport: { cookie: { name: "rt", path: "/" } },
});

export { api, app, auth, docs, jwt };
