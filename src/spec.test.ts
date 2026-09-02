// Colocated unit test for src/spec.ts (ADR-011 step 5): pure spec emission over
// an injected routes array + ComponentRegistry — success-code policy, framework
// error injection, operationId dedup and parameter/requestBody emission. The
// same behaviors are covered end-to-end in openapi.test.ts; these pin the pure
// functions directly without a Hono app.
import { type JsonSchema, type } from "arktype";
import { describe, expect, it } from "vitest";
import type { ComponentRegistry, RouteConfig, StoredRoute } from "./spec.js";
import { buildSpec, resolveSuccessCode } from "./spec.js";

function createRegistry(): ComponentRegistry {
  return { schemas: new Map(), securitySchemes: new Map() };
}

// Deterministic oapiPath (same rule as toOapiPath): /things/:id → /things/{id}
function oapiPath(path: string): string {
  return path.replace(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/g, "{$1}");
}

function storedRoute(config: RouteConfig): StoredRoute {
  return {
    method: config.method,
    oapiPath: oapiPath(config.path),
    config,
    handler: async () => ({ ok: true }),
  };
}

describe("resolveSuccessCode", () => {
  it("uses explicit status over declared responses", () => {
    expect(resolveSuccessCode(201, ["200", "201"])).toBe("201");
  });

  it("returns the first declared 2xx/3xx (keys arrive ascending via Object.keys)", () => {
    expect(resolveSuccessCode(undefined, ["200", "201", "204"])).toBe("200");
  });

  it("defaults to 200 when no 2xx/3xx is declared", () => {
    expect(resolveSuccessCode(undefined, ["400", "500"])).toBe("200");
    expect(resolveSuccessCode(undefined, [])).toBe("200");
  });
});

describe("buildSpec", () => {
  it("emits paths, operationIds and dedupes collisions with _n suffixes", async () => {
    const registry = createRegistry();
    const spec = await buildSpec(
      [
        storedRoute({ method: "get", path: "/things", responses: { 200: type({ id: "string" }) } }),
        storedRoute({
          method: "get",
          path: "/things/:id",
          request: { params: type({ id: "string" }) },
          responses: { 200: type({ id: "string" }) },
        }),
      ],
      registry,
      { info: { title: "t", version: "1" } },
    );

    expect(spec.openapi).toBe("3.0.0");
    expect(Object.keys(spec.paths)).toEqual(["/things", "/things/{id}"]);
    const ids = Object.values(spec.paths).map((p) => p.get!.operationId);
    expect(ids[0]).not.toBe(ids[1]);
  });

  it("honors an explicit operationId", async () => {
    const spec = await buildSpec(
      [
        storedRoute({
          method: "get",
          path: "/a",
          operationId: "myOp",
          responses: { 200: type("string") },
        }),
      ],
      createRegistry(),
      { info: { title: "t", version: "1" } },
    );
    expect(spec.paths["/a"]?.get?.operationId).toBe("myOp");
  });

  it("emits parameters (query/header lowercased) and requestBody", async () => {
    const spec = await buildSpec(
      [
        storedRoute({
          method: "post",
          path: "/search",
          request: {
            query: type({ q: "string", limit: "number" }),
            headers: type({ "x-api-key": "string" }),
            body: type({ term: "string" }),
          },
          responses: { 200: type("string") },
        }),
      ],
      createRegistry(),
      { info: { title: "t", version: "1" } },
    );
    const op = spec.paths["/search"]?.post;
    // Hono/ArkType property order is not guaranteed; compare as a set.
    expect(op?.parameters?.map((p) => p.name).sort()).toEqual(["x-api-key", "q", "limit"].sort());
    expect(op?.requestBody?.required).toBe(true);
    expect(op?.requestBody?.content?.["application/json"]?.schema).toBeDefined();
  });

  it("injects framework error responses: 400 (validation), 404 (:param), 500 always", async () => {
    const spec = await buildSpec(
      [storedRoute({ method: "get", path: "/items/:id", responses: { 200: type("string") } })],
      createRegistry(),
      { info: { title: "t", version: "1" } },
    );
    const responses = spec.paths["/items/{id}"]?.get?.responses ?? {};
    expect(responses["200"]).toBeDefined();
    expect(responses["400"]?.description).toBe("Bad Request");
    expect(responses["404"]?.description).toBe("Not Found");
    expect(responses["500"]?.description).toBe("Internal Server Error");
    expect(responses["401"]).toBeUndefined();
  });

  it("injects 401 for auth-protected routes and respects hide400", async () => {
    const spec = await buildSpec(
      [
        storedRoute({
          method: "get",
          path: "/secure",
          security: [{ token: [] as string[] }],
          responses: { 200: type("string") },
        }),
        storedRoute({
          method: "get",
          path: "/bare/:id",
          hide400: true,
          responses: { 200: type("string") },
        }),
      ],
      createRegistry(),
      { info: { title: "t", version: "1" } },
    );
    const secureResponses = spec.paths["/secure"]?.get?.responses ?? {};
    expect(secureResponses["401"]?.description).toBe("Unauthorized");
    const bareResponses = spec.paths["/bare/{id}"]?.get?.responses ?? {};
    expect(bareResponses["400"]).toBeUndefined();
  });

  it("merges components: schemas hoisted from $defs + registered security schemes", async () => {
    const registry = createRegistry();
    registry.securitySchemes.set("token", { type: "http", scheme: "bearer" });
    const spec = await buildSpec(
      [
        storedRoute({
          method: "get",
          path: "/tree",
          responses: { 200: type({ label: "string", children: type("string[]") }) },
        }),
      ],
      registry,
      { info: { title: "t", version: "1" } },
    );
    expect(spec.components.securitySchemes?.token).toEqual({ type: "http", scheme: "bearer" });
    const keys = Object.keys(spec.components.schemas ?? {});
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) expect(key).toMatch(/^schema_[a-f0-9]{12}$/);
  });

  it("keeps the shared framework-error schema as a single deduped component", async () => {
    const registry = createRegistry();
    await buildSpec(
      [
        storedRoute({ method: "get", path: "/a/:id", responses: { 200: type("string") } }),
        storedRoute({
          method: "post",
          path: "/b",
          request: { body: type({ n: "number" }) },
          responses: { 200: type("string") },
        }),
      ],
      registry,
      { info: { title: "t", version: "1" } },
    );
    const errorSchemas = [...registry.schemas.values()].filter((s) => {
      const json = s as JsonSchema & { properties?: Record<string, unknown> };
      return json.properties && "error" in json.properties;
    });
    expect(errorSchemas.length).toBe(1);
  });
});
