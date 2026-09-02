// Colocated unit test for src/validation.ts (ADR-011 step 3): coercion walk,
// $ref resolution through $defs, and the validator's throw-to-onError contract.
import { type JsonSchema, type } from "arktype";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { APIError } from "./errors.js";
import { arktypeValidator, coerceDeep, coerceValue, resolveRef } from "./validation.js";

describe("coerceDeep", () => {
  it("coerces query strings to numbers", () => {
    const schema = type({ limit: "number" });
    expect(coerceDeep(schema, { limit: "5" })).toEqual({ limit: 5 });
  });

  it("coerces only strict true/false strings to booleans", () => {
    const schema = type({ on: "boolean" });
    expect(coerceDeep(schema, { on: "true" })).toEqual({ on: true });
    expect(coerceDeep(schema, { on: "false" })).toEqual({ on: false });
    expect(coerceDeep(schema, { on: "yes" })).toEqual({ on: "yes" });
  });

  it("preserves empty and whitespace-only strings for validation to 400", () => {
    const schema = type({ n: "number", flag: "boolean" });
    expect(coerceDeep(schema, { n: "", flag: "  " })).toEqual({ n: "", flag: "  " });
  });

  it("preserves missing keys and undefined values", () => {
    const schema = type({ n: "number" });
    expect(coerceDeep(schema, { n: undefined })).toEqual({ n: undefined });
    expect(coerceDeep(schema, { other: "x" })).toEqual({ other: "x" });
  });

  it("wraps a single string into an array and coerces element-wise", () => {
    const schema = type({ ids: "number[]" });
    expect(coerceDeep(schema, { ids: "1" })).toEqual({ ids: [1] });
  });

  it("coerces arrays element-wise and preserves empty elements", () => {
    const schema = type({ ids: "number[]" });
    expect(coerceDeep(schema, { ids: ["1", "2"] })).toEqual({ ids: [1, 2] });
    expect(coerceDeep(schema, { ids: ["1", ""] })).toEqual({ ids: [1, ""] });
  });

  it("coerces nested object properties", () => {
    const schema = type({ meta: { count: "number" } });
    expect(coerceDeep(schema, { meta: { count: "3" } })).toEqual({ meta: { count: 3 } });
  });

  it("parses a JSON-object string for object-shaped values", () => {
    const schema = type({ meta: { count: "number" } });
    expect(coerceDeep(schema, { meta: '{"count":"4"}' })).toEqual({ meta: { count: 4 } });
  });

  it("returns data unchanged when the schema root is not an object", () => {
    const schema = type("number");
    const data = { n: "5" };
    expect(coerceDeep(schema, data)).toBe(data);
  });
});

describe("resolveRef", () => {
  const numDef = { type: "number" } as const satisfies JsonSchema;
  const defs = { num: numDef } satisfies Record<string, JsonSchema>;

  it("resolves a $defs ref to its definition", () => {
    const ref = { $ref: "#/$defs/num" } as const satisfies JsonSchema;
    expect(resolveRef(ref, defs)).toEqual(numDef);
  });

  it("leaves an unresolvable ref untouched", () => {
    const ref = { $ref: "#/$defs/missing" } as const satisfies JsonSchema;
    expect(resolveRef(ref, defs)).toBe(ref);
  });

  it("passes a plain schema through", () => {
    const prop = { type: "string" } as const satisfies JsonSchema;
    expect(resolveRef(prop, undefined)).toBe(prop);
  });
});

describe("coerceValue", () => {
  it("coerces through a $defs ref", () => {
    const numDef = { type: "number" } as const satisfies JsonSchema;
    const defs = { num: numDef } satisfies Record<string, JsonSchema>;
    const ref = { $ref: "#/$defs/num" } as const satisfies JsonSchema;
    expect(coerceValue(ref, "7", defs)).toBe(7);
    expect(coerceValue(ref, "x", defs)).toBe("x");
  });
});

describe("arktypeValidator", () => {
  it("coerces and validates a query through a real Hono app", async () => {
    const app = new Hono();
    app.get("/", arktypeValidator("query", type({ limit: "number" })), (c) => {
      const valid = (c.req as unknown as { valid(target: string): unknown }).valid("query");
      return c.json({ limit: (valid as { limit: number }).limit });
    });

    const res = await app.request("/?limit=5");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ limit: 5 });
  });

  it("throws APIError(400) instead of returning a Response, so onError sees it", async () => {
    const app = new Hono();
    let sawAPIError: APIError | undefined;
    app.onError((err) => {
      if (err instanceof APIError) sawAPIError = err;
      return new Response(JSON.stringify({ error: "x" }), {
        status: err instanceof APIError ? err.status : 500,
      });
    });
    app.get("/", arktypeValidator("query", type({ limit: "number" })), (c) => c.json({ ok: true }));

    const res = await app.request("/?limit=abc");
    expect(res.status).toBe(400);
    expect(sawAPIError?.status).toBe(400);
  });
});
