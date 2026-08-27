import { type } from "arktype";
import { createApi, fail } from "../../src/index.js";

const { api, auth, docs, app } = createApi<{ user: { id: string } }>({
  title: "Encore-style Hono API",
  version: "1.0.0",
});

// --- Auth middleware --------------------------------------------------------
// Return-based: throw to reject, return value becomes req.auth in handlers.
// The third argument registers the OpenAPI security scheme (lock-icon kind) and
// is OPTIONAL — omit it and the scheme defaults to `bearer`, so every `{auth}`
// route is still documented as protected (401 + security + securitySchemes).

auth(
  "required",
  async (c) => {
    const token = c.req.header("Authorization");
    if (!token?.startsWith("Bearer ")) throw fail.unauthorized();
    return { user: { id: "alice" } };
  },
  { type: "http", scheme: "bearer" },
);

// --- 1. GET /hello/:name — path params (Encore-style) ----------------------
// Shorthand api.get(path, config, handler) — mirrors Hono's app.get.
// `operationId` overrides the auto-generated one (useful for SDK gens).

api.get(
  "/hello/:name",
  {
    tags: ["Hello"],
    summary: "Say hello to someone",
    operationId: "sayHello",
    auth: "required",
  },
  async ({ name }) => ({
    message: `Hello ${name}!`,
  }),
);

// --- 2. POST /things — body validation + APIError --------------------------
// `method` is now typed as `Method` with autocomplete; casing is free
// (`POST` / `post` / `Post` all normalize via `normalizeMethod`).

api(
  {
    method: "post",
    path: "/things",
    tags: ["Things"],
    summary: "Create a new thing",
    body: type({
      name: "string >= 1",
      count: "number.integer > 0",
    }),
    responses: { 201: type({ id: "string", userId: "string" }) },
    auth: "required",
  },
  async ({ body, auth }) => {
    if (body.count > 100) {
      throw fail.badRequest("count too high");
    }
    return { id: crypto.randomUUID(), userId: auth.user.id };
  },
);

// --- 3. GET /search — query params -----------------------------------------

api.get(
  "/search",
  {
    tags: ["Search"],
    summary: "Search for things",
    query: type({
      q: "string",
      limit: "1 <= number.integer <= 100 = 10",
    }),
    auth: "required",
  },
  async ({ query }) => {
    const results = Array.from({ length: query.limit }, (_, i) => ({
      id: i + 1,
      title: `${query.q} result ${i + 1}`,
    }));
    return { results, total: results.length };
  },
);

// --- 4. GET /legacy — deprecated example -----------------------------------

api.get(
  "/legacy",
  {
    tags: ["Hello"],
    summary: "Deprecated legacy endpoint",
    deprecated: true,
  },
  async () => ({ message: "This endpoint is deprecated" }),
);

// --- Mount OpenAPI docs ----------------------------------------------------

// ponytail: no auth on docs — protect it in production if needed.
// docs() now accepts either positional args or an options object.
docs({ specPath: "/openapi.json", uiPath: "/docs" });

export default app;
