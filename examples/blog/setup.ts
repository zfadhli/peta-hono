// Shared API builder singleton — every route file imports `api` and `auth` from here.
// ESM modules are singletons, so all routes register on the same `app` instance.

import { createApi, fail } from "../../src/index.js";

const { api, auth, docs, app } = createApi<{ user: { id: string } }>({
  title: "Blog API",
  version: "1.0.0",
});

// Auth middleware: required for write operations, skip for reads.
// Return-based: throw to reject, return value becomes req.auth in handlers.
// The third argument registers the OpenAPI security scheme (lock-icon kind). It
// is OPTIONAL — omit it and the scheme defaults to `bearer`, so every `{auth}`
// route is still documented as protected (401 + security requirement + matching
// components.securitySchemes entry). Pass an explicit scheme only to change the
// lock icon (basic, apiKey, ...).
auth(
  "required",
  async (c) => {
    const token = c.req.header("Authorization");
    if (!token?.startsWith("Bearer ")) throw fail.unauthorized();
    return { user: { id: "alice" } };
  },
  { type: "http", scheme: "bearer" },
);

export { api, app, auth, docs };
