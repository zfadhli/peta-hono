/**
 * Integration tests for lib/openapi.ts.
 *
 * Covers:
 *   1. /openapi.json emits minimum/maximum in spec
 *   2. Query param coercion works (string "5" → number 5)
 *   3. Bad body returns 400 with error summary (via default onError)
 *   4. Recursive schema: $defs hoisted to components, $ref pointers rewritten
 *   5. Validation errors flow through app.onError (issue #4 regression guard)
 *   6. debug mode is dev-only — reveals details only with NODE_ENV=development
 *   7. Framework error responses are accurate & controllable (400 on :param, 404 heuristic,
 *      replace-vs-suppress via explicit responses:{404}) — grilling 06 / spec S2
 *   8. Auth-protected routes always document 401 + security (issue #03)
 *   9. Unmatched-route 404 routes through the JSON error policy (issue #04)
 *  10. hide400 opt-out suppresses the auto 400 on :param routes (issue #05)
 *  11. Success status resolves to the LOWEST 2xx/3xx (issue #08)
 *  12. Default info.version is 0.0.0 (issue #12)
 */
import { scope, type } from "arktype";
import { describe, expect, it } from "vitest";
import { createApi } from "./api.js";
import { OpenAPIHono } from "./openapi.js";

const app = new OpenAPIHono();

// ── POST /things — body with numeric range ────────────────────────
app.openapi(
  {
    method: "POST",
    path: "/things",
    summary: "Create a thing",
    request: {
      body: type({
        name: "string >= 1",
        count: "1 <= number.integer <= 100",
      }),
    },
    responses: { 201: type({ id: "string" }) },
  },
  async () => {
    return { id: crypto.randomUUID() };
  },
);

// ── GET /search — query with coercing number ──────────────────────
app.openapi(
  {
    method: "GET",
    path: "/search",
    summary: "Search things",
    request: {
      query: type({
        q: "string",
        limit: "1 <= number.integer <= 100",
      }),
    },
  },
  async ({ query }) => {
    const q = query as { q: string; limit: number };
    return { q: q.q, limit: q.limit };
  },
);

// ── GET /tree — recursive schema ($defs + $ref) ───────────────────
// ArkType's toJsonSchema() emits $defs and $ref pointers for recursive types.
// The library must hoist $defs to components/schemas and rewrite all refs.
const $tree = scope({ Tree: { label: "string", children: "Tree[]" } });
const Tree = $tree.export().Tree;

app.openapi(
  {
    method: "GET",
    path: "/tree",
    summary: "Get a tree",
    responses: { 200: Tree },
  },
  async () => ({ label: "root", children: [] }),
);

// ── OpenAPI docs ──────────────────────────────────────────────────
app.doc("/openapi.json", {
  info: { title: "Spike API", version: "0.0.1" },
});

describe("OpenAPIHono", () => {
  // ── Assertion 1: OpenAPI spec has minimum/maximum ─────────────────
  it("OpenAPI spec has minimum/maximum", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);

    const spec: any = await res.json();

    // POST /things body has minimum/maximum on count
    const postThing = spec.paths?.["/things"]?.post;
    expect(postThing).toBeTruthy();
    const bodySchema = postThing?.requestBody?.content?.["application/json"]?.schema;
    expect(bodySchema).toBeTruthy();
    const count = bodySchema?.properties?.count;
    expect(count).toBeTruthy();
    expect(count?.minimum).toBe(1);
    expect(count?.maximum).toBe(100);
    expect(count?.type).toBe("integer");

    // Auto-documented framework error: 400 on validated endpoints (no auth → no 401 here)
    const thingResponses = postThing?.responses ?? {};
    expect(thingResponses["400"]).toBeTruthy();
    expect(thingResponses["400"]?.description).toBe("Bad Request");

    // GET /search query param has minimum/maximum
    const getSearch = spec.paths?.["/search"]?.get;
    expect(getSearch).toBeTruthy();
    const limitParam = getSearch?.parameters?.find((p: any) => p.name === "limit");
    expect(limitParam).toBeTruthy();
    expect(limitParam?.schema?.minimum).toBe(1);
    expect(limitParam?.schema?.maximum).toBe(100);
  });

  // ── Assertion 2: Coercion ─────────────────────────────────────────
  it("Query coercion string→number", async () => {
    const res = await app.request("/search?q=foo&limit=5");
    expect(res.status).toBe(200);
    const body: any = await res.json();
    expect(typeof body.limit).toBe("number");
    expect(body.limit).toBe(5);
    expect(body.q).toBe("foo");
  });

  // ── Assertion 3: Validation error returns 400 ─────────────────────
  it("Validation error returns 400", async () => {
    const res = await app.request("/things", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", count: 0 }),
    });
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.error).toBeTruthy();
    expect(typeof body.error).toBe("string");
  });

  // ── Assertion 4: Recursive schema $ref rewriting ──────────────────
  it("Recursive schema $ref rewriting", async () => {
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec: any = await res.json();
    const specStr = JSON.stringify(spec);

    // No $defs key should remain anywhere in the spec
    expect(specStr).not.toContain('"$defs"');

    // No $ref should point to #/$defs/ (all should be rewritten)
    expect(specStr).not.toContain("#/$defs/");

    // All $ref values must point to #/components/schemas/
    const refMatches = specStr.match(/"\$ref":"([^"]+)"/g) ?? [];
    for (const refMatch of refMatches) {
      const refValue = refMatch.match(/"\$ref":"([^"]+)"/)?.[1];
      expect(refValue?.startsWith("#/components/schemas/")).toBe(true);
    }

    // Component schema names must use stable hash format (schema_<12hex>)
    const schemaKeys = Object.keys(spec.components?.schemas ?? {});
    expect(schemaKeys.length).toBeGreaterThan(0);
    for (const key of schemaKeys) {
      expect(key).toMatch(/^schema_[a-f0-9]{12}$/);
    }
  });

  // ── Assertion 5: Validation errors flow through app.onError ────────
  // Regression guard for issue #4: arktypeValidator must throw (not return a
  // Response) so a custom onError sees validation failures — single chokepoint
  // for request IDs, structured logging, env-based message hiding, etc.
  it("Validation errors reach app.onError", async () => {
    const probe = new OpenAPIHono();
    let sawValidationError = false;
    probe.onError((err, c) => {
      sawValidationError = true;
      return c.json({ error: err.message }, 400);
    });
    probe.openapi(
      {
        method: "POST",
        path: "/echo",
        request: { body: type({ name: "string" }) },
      },
      async ({ body }) => body as Record<string, unknown>,
    );

    const res = await probe.request("/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(400);
    expect(sawValidationError).toBe(true);
    const body: any = await res.json();
    expect(typeof body.error).toBe("string");
  });

  // ── Assertion 6: debug is dev-only — reveals details only in development ──
  // Regression guard for issue #06: debug:true must never leak error/stack in a
  // production-deployed context. The safe default is to WITHHOLD details unless
  // an explicit NODE_ENV=development signal is present (the old gate leaked on
  // Bun/Deno/edge or a Node process with NODE_ENV unset).
  it("debug reveals details only in development", async () => {
    const prev = process.env.NODE_ENV;

    // Development: debug reveals error + stack.
    process.env.NODE_ENV = "development";
    try {
      const { app, api } = createApi<undefined>({ debug: true });
      api({ method: "GET", path: "/crash" }, async () => {
        throw new Error("db connection failed");
      });
      const res = await app.request("/crash");
      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body.error).toBe("db connection failed");
      expect(body.stack).toBeTruthy();
    } finally {
      process.env.NODE_ENV = prev;
    }

    // Production / NODE_ENV absent: debug must NOT leak error or stack.
    delete process.env.NODE_ENV;
    try {
      const { app, api } = createApi<undefined>({ debug: true });
      api({ method: "GET", path: "/crash" }, async () => {
        throw new Error("secret db connection failed");
      });
      const res = await app.request("/crash");
      expect(res.status).toBe(500);
      const body: any = await res.json();
      expect(body.error).toBe("Internal Server Error");
      expect(body.stack).toBeFalsy();
    } finally {
      if (prev === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = prev;
    }
  });

  // ── Assertion 7: framework error responses are accurate & controllable ──
  // Grilling 06 / spec S2: 400 auto-doc on `:param` routes (auto-generated
  // request.params validator), 404 ponytail heuristic on `:param`, both sharing
  // one deduped error component. Declaring explicit `responses:{404}` REPLACES
  // the auto 404 (custom schema) rather than suppressing it — guard
  // `if(!responses["404"])` respects the explicit response.
  it("Framework error responses are accurate & controllable", async () => {
    const { api, app, docs } = createApi<undefined>({ title: "Framework Errors" });

    // Route 1 — path has :param → auto-generated params validator → auto docs 400 + 404
    api({ method: "GET", path: "/posts/:id" }, async ({ id }) => ({ id }));

    // Route 2 — explicit responses:{404} replaces the auto 404 schema (not suppress)
    api(
      {
        method: "GET",
        path: "/docs/:id",
        responses: { 404: type({ error: "string", reason: "string" }) },
      },
      async ({ id }) => ({ id }),
    );

    // Mount the docs so /openapi.json exposes the spec (createApi does not auto-mount)
    docs();

    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec: any = await res.json();

    const posts = spec.paths?.["/posts/{id}"]?.get;
    expect(posts).toBeTruthy();
    expect(posts?.responses?.["400"]).toBeTruthy();
    expect(posts?.responses?.["404"]).toBeTruthy();
    const posts400Ref =
      posts?.responses?.["400"]?.content?.["application/json"]?.schema?.$ref ?? "";
    expect(posts400Ref.startsWith("#/components/schemas/schema_")).toBe(true);

    const docsRoute = spec.paths?.["/docs/{id}"]?.get;
    expect(docsRoute).toBeTruthy();
    const docs404 = docsRoute?.responses?.["404"];
    expect(docs404).toBeTruthy();
    const docs404Schema = docs404?.content?.["application/json"]?.schema;
    expect(docs404Schema?.properties?.reason).toBeTruthy();
    expect(docs404Schema?.$ref).not.toBe(posts400Ref);
  });

  // ── Assertion 8: auth-protected routes always document 401 + security ──
  // Regression guard for issue #03: a route with `{auth}` must be documented as
  // protected even when `auth()` was registered WITHOUT a scheme argument. The
  // optional `scheme` only controls the lock-icon kind; a default bearer scheme
  // is published so the `security` requirement resolves to a real scheme.
  it("Auth-protected routes document 401 + security", async () => {
    const { api, app, auth, docs } = createApi<{ user: { id: string } }>({
      title: "Auth Doc",
      version: "1.0.0",
    });
    auth("required", async () => ({ user: { id: "alice" } })); // no scheme
    api({ method: "GET", path: "/a/:id", auth: "required" }, async ({ id }) => ({ id }));
    api({ method: "GET", path: "/pub" }, async () => ({ ok: true }));
    docs();

    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec: any = await res.json();

    const op = spec.paths?.["/a/{id}"]?.get;
    expect(op).toBeTruthy();
    expect(op?.responses?.["401"]).toBeTruthy();
    expect(Array.isArray(op?.security) && op.security.length > 0).toBe(true);
    const schemeName = op?.security?.[0] && Object.keys(op.security[0] as object)[0];
    expect(schemeName).toBe("required");
    expect(spec.components?.securitySchemes?.required).toBeTruthy();
    expect(spec.components?.securitySchemes?.required?.scheme).toBe("bearer");

    // A public route must NOT carry 401/security.
    const pubOp = spec.paths?.["/pub"]?.get;
    expect(pubOp).toBeTruthy();
    expect(pubOp?.responses?.["401"]).toBeFalsy();
    expect(pubOp?.security).toBeFalsy();
  });

  // ── Assertion 9: unmatched-route 404 routes through the JSON error policy ──
  // Regression guard for issue #04: an unmatched route must return application/json
  // {error} via the shared createErrorHandler policy (not Hono's text/plain 404),
  // unifying the two 404 shapes under the single chokepoint.
  it("Unmatched-route 404 is JSON via error policy", async () => {
    const { app: createApiApp } = createApi<undefined>({ title: "404" });
    const bareApp = new OpenAPIHono();

    for (const probe of [createApiApp, bareApp]) {
      const res = await probe.request("/no/such/route");
      expect(res.status).toBe(404);
      const ctype = res.headers.get("content-type") ?? "";
      expect(ctype).toContain("application/json");
      const body: any = await res.json();
      expect(body.error).toBe("Not Found");
    }
  });

  // ── Assertion 10: hide400 opt-out suppresses the auto 400 on `:param` routes ──
  // Regression guard for issue #05: a pure `:param` route auto-documents 400 by
  // default (auto-generated params validator); `hide400: true` suppresses it while
  // leaving 500 and any user-declared 400 intact.
  it("hide400 suppresses auto 400 on :param", async () => {
    const { api, app, docs } = createApi<undefined>({ title: "hide400" });
    api({ method: "GET", path: "/p/:id" }, async ({ id }) => ({ id }));
    api.get("/q/:id", { hide400: true }, async ({ id }) => ({ id })); // shorthand surface
    api(
      {
        method: "GET",
        path: "/r/:id",
        hide400: true,
        responses: { 400: type({ error: "string" }) },
      },
      async ({ id }) => ({ id }),
    );
    docs();

    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec: any = await res.json();

    const p = spec.paths?.["/p/{id}"]?.get;
    const q = spec.paths?.["/q/{id}"]?.get;
    const r = spec.paths?.["/r/{id}"]?.get;
    expect(p).toBeTruthy();
    expect(q).toBeTruthy();
    expect(r).toBeTruthy();

    expect(p?.responses?.["400"]).toBeTruthy();
    expect(q?.responses?.["400"]).toBeFalsy();
    expect(q?.responses?.["500"]).toBeTruthy();
    expect(r?.responses?.["400"]).toBeTruthy();
  });

  // ── Assertion 11: success status resolves to the LOWEST 2xx/3xx ──
  // Regression guard for issue #08: JS enumerates integer-like response keys in
  // ascending numeric order, so "first 2xx/3xx" in source order is actually the
  // LOWEST. Set `status` explicitly when declaring multiple 2xx/3xx codes.
  it("Success status resolves to lowest 2xx/3xx", async () => {
    const { api, app, docs } = createApi<undefined>({ title: "status" });
    api(
      { method: "GET", path: "/a", responses: { 200: type({}), 201: type({}) } },
      async () => ({}),
    );
    api(
      { method: "GET", path: "/b", responses: { 201: type({}), 200: type({}) } },
      async () => ({}),
    );
    api({ method: "GET", path: "/c", responses: { 201: type({}) } }, async () => ({}));
    api(
      { method: "GET", path: "/d", status: 201, responses: { 200: type({}), 201: type({}) } },
      async () => ({}),
    );
    docs();

    // Runtime status
    expect((await app.request("/a")).status).toBe(200);
    expect((await app.request("/b")).status).toBe(200);
    expect((await app.request("/c")).status).toBe(201);
    expect((await app.request("/d")).status).toBe(201);

    // Spec documents both declared codes (success resolution only picks the default)
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec: any = await res.json();
    const a2s = Object.keys(spec.paths?.["/a"]?.get?.responses ?? {}).filter((k: string) =>
      k.startsWith("2"),
    );
    expect(a2s).toContain("200");
    expect(a2s).toContain("201");
  });

  // ── Assertion 12: default info.version is 0.0.0 (not a misleading 1.0.0) ──
  // Regression guard for issue #12: a pre-1.0 lib must not print a confidently-
  // wrong 1.0.0 when `version` is omitted; default to 0.0.0.
  it("Default info.version is 0.0.0", async () => {
    const { api, app, docs } = createApi<undefined>({ title: "no-version" });
    api({ method: "GET", path: "/v" }, async () => ({}));
    docs();
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec: any = await res.json();
    expect(spec.info?.version).toBe("0.0.0");
    expect(spec.info?.title).toBe("no-version");
  });
});
