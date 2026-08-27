/**
 * Self-check for lib/openapi.ts spike.
 * Seven assertions:
 *   1. /openapi.json emits minimum/maximum in spec
 *   2. Query param coercion works (string "5" → number 5)
 *   3. Bad body returns 400 with error summary (via default onError)
 *   4. Recursive schema: $defs hoisted to components, $ref pointers rewritten
 *   5. Validation errors flow through app.onError (issue #4 regression guard)
 *   6. debug mode reveals error details
 *   7. Framework error responses are accurate & controllable (400 on :param, 404 heuristic,
 *      replace-vs-suppress via explicit responses:{404}) — grilling 06 / spec S2
 */

import { scope, type } from "arktype";
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

// ── Run checks ────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

// ── Assertion 1: OpenAPI spec has minimum/maximum ─────────────────
async function assertSpec() {
  const res = await app.request("/openapi.json");
  if (res.status !== 200) throw new Error(`spec endpoint returned ${res.status}`);

  const spec: any = await res.json();

  // Check POST /things body has minimum/maximum on count
  const postThing = spec.paths?.["/things"]?.post;
  if (!postThing) throw new Error("POST /things not in spec");
  const bodySchema = postThing.requestBody?.content?.["application/json"]?.schema;
  if (!bodySchema) throw new Error("request body schema missing");
  const count = bodySchema?.properties?.count;
  if (!count) throw new Error("count property missing in body schema");
  if (count.minimum !== 1) throw new Error(`expected minimum:1, got ${count.minimum}`);
  if (count.maximum !== 100) throw new Error(`expected maximum:100, got ${count.maximum}`);
  if (count.type !== "integer") throw new Error(`expected type:integer, got ${count.type}`);

  // Auto-documented framework error: 400 on validated endpoints (no auth → no 401 here)
  const thingResponses = postThing.responses ?? {};
  const r400 = thingResponses["400"];
  if (!r400) throw new Error("POST /things missing auto-documented 400 response");
  if (r400.description !== "Bad Request")
    throw new Error(`400 description expected 'Bad Request', got ${r400.description}`);

  // Check GET /search query parameter has minimum/maximum
  const getSearch = spec.paths?.["/search"]?.get;
  if (!getSearch) throw new Error("GET /search not in spec");
  const limitParam = getSearch.parameters?.find((p: any) => p.name === "limit");
  if (!limitParam) throw new Error("limit query param missing");
  if (limitParam.schema?.minimum !== 1)
    throw new Error(`expected schema.minimum:1, got ${limitParam.schema?.minimum}`);
  if (limitParam.schema?.maximum !== 100)
    throw new Error(`expected schema.maximum:100, got ${limitParam.schema?.maximum}`);
}

// ── Assertion 2: Coercion ─────────────────────────────────────────
async function assertCoercion() {
  const res = await app.request("/search?q=foo&limit=5");
  if (res.status !== 200) throw new Error(`search returned ${res.status}`);
  const body: any = await res.json();
  if (typeof body.limit !== "number")
    throw new Error(`expected limit to be number, got ${typeof body.limit}`);
  if (body.limit !== 5) throw new Error(`expected limit=5, got ${body.limit}`);
  if (body.q !== "foo") throw new Error(`expected q=foo, got ${body.q}`);
}

// ── Assertion 3: Validation error returns 400 ─────────────────────
async function assertValidation() {
  const res = await app.request("/things", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "", count: 0 }),
  });
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  const body: any = await res.json();
  if (!body.error) throw new Error(`expected error field in response`);
  if (typeof body.error !== "string" || body.error.length === 0)
    throw new Error(`error must be a non-empty string`);
}

// ── Assertion 4: Recursive schema $ref rewriting ──────────────────
async function assertRefRewriting() {
  const res = await app.request("/openapi.json");
  if (res.status !== 200) throw new Error(`spec endpoint returned ${res.status}`);
  const spec: any = await res.json();
  const specStr = JSON.stringify(spec);

  // No $defs key should remain anywhere in the spec
  if (specStr.includes('"$defs"')) throw new Error("spec still contains $defs key");

  // No $ref should point to #/$defs/ (all should be rewritten)
  if (specStr.includes("#/$defs/")) throw new Error("spec still contains #/$defs/ refs");

  // All $ref values must point to #/components/schemas/
  const refMatches = specStr.match(/"\$ref":"([^"]+)"/g) ?? [];
  for (const refMatch of refMatches) {
    const refValue = refMatch.match(/"\$ref":"([^"]+)"/)?.[1]!;
    if (!refValue.startsWith("#/components/schemas/"))
      throw new Error(`ref ${refValue} does not point to #/components/schemas/`);
  }

  // Component schema names must use stable hash format (schema_<12hex>)
  const schemaKeys = Object.keys(spec.components?.schemas ?? {});
  if (schemaKeys.length === 0) throw new Error("no schemas in components.schemas");
  for (const key of schemaKeys) {
    if (!/^schema_[a-f0-9]{12}$/.test(key))
      throw new Error(`schema name "${key}" does not match schema_<12hex> format`);
  }
}

// ── Assertion 5: Validation errors flow through app.onError ────────
// Regression guard for issue #4: arktypeValidator must throw (not return a
// Response) so a custom onError sees validation failures — single chokepoint
// for request IDs, structured logging, env-based message hiding, etc.
async function assertValidationErrorReachesOnError() {
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
  if (res.status !== 400) throw new Error(`expected 400, got ${res.status}`);
  if (!sawValidationError) throw new Error("onError was not invoked for validation failure");
  const body: any = await res.json();
  if (typeof body.error !== "string" || body.error.length === 0)
    throw new Error("error must be a non-empty string from onError");
}

// ── Assertion 6: debug mode reveals error details ──────────────────
async function assertDebugMode() {
  const { app, api } = createApi<undefined>({ debug: true });

  api({ method: "GET", path: "/crash" }, async () => {
    throw new Error("db connection failed");
  });

  const res = await app.request("/crash");
  if (res.status !== 500) throw new Error(`expected 500, got ${res.status}`);
  const body: any = await res.json();
  if (body.error !== "db connection failed")
    throw new Error(`expected error 'db connection failed', got '${body.error}'`);
  if (!body.stack) throw new Error("expected stack in debug mode");
}

// ── Assertion 7: framework error responses are accurate & controllable ──
// Grilling 06 / spec S2: 400 auto-doc on `:param` routes (auto-generated
// request.params validator), 404 ponytail heuristic on `:param`, both sharing
// one deduped error component. Declaring explicit `responses:{404}` REPLACES
// the auto 404 (custom schema) rather than suppressing it — guard
// `if(!responses["404"])` respects the explicit response.
async function assertFrameworkErrorControl() {
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
  if (res.status !== 200) throw new Error(`spec endpoint returned ${res.status}`);
  const spec: any = await res.json();

  const posts = spec.paths?.["/posts/{id}"]?.get;
  if (!posts) throw new Error("GET /posts/{id} not in spec");
  const posts400 = posts.responses?.["400"];
  const posts404 = posts.responses?.["404"];
  if (!posts400) throw new Error("param route missing auto-documented 400");
  if (!posts404) throw new Error("param route missing auto-documented 404 (ponytail heuristic)");
  const posts400Ref = posts400.content?.["application/json"]?.schema?.$ref ?? "";
  if (!posts400Ref.startsWith("#/components/schemas/schema_"))
    throw new Error(`400 should use shared error component, got ${posts400Ref}`);

  const docsRoute = spec.paths?.["/docs/{id}"]?.get;
  if (!docsRoute) throw new Error("GET /docs/{id} not in spec");
  const docs404 = docsRoute.responses?.["404"];
  if (!docs404)
    throw new Error("explicit responses:{404} must still document 404 (replace, not suppress)");
  const docs404Schema = docs404.content?.["application/json"]?.schema;
  if (!docs404Schema?.properties?.reason)
    throw new Error("explicit 404 should use the custom schema (replaces auto)");
  if (docs404Schema?.$ref === posts400Ref)
    throw new Error("explicit 404 must not reuse the auto error schema");
}

// ── Run ───────────────────────────────────────────────────────────
console.log("=== OpenAPIHono spike self-check ===");
console.log();

await check("OpenAPI spec has minimum/maximum", assertSpec);
await check("Query coercion string→number", assertCoercion);
await check("Validation error returns 400", assertValidation);
await check("Recursive schema $ref rewriting", assertRefRewriting);
await check("Validation errors reach app.onError", assertValidationErrorReachesOnError);
await check("debug mode reveals error details", assertDebugMode);
await check("Framework error responses are accurate & controllable", assertFrameworkErrorControl);

console.log();
console.log(`Result: ${passed}/7 passed, ${failed} failed`);

if (failed > 0) process.exit(1);
