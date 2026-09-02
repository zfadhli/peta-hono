// Colocated unit test for src/registry.ts (ADR-011 step 4): stable-name hashing,
// $ref rewriting, $defs hoisting into an injected ComponentRegistry, the
// module-scoped schema cache, and the per-instance framework-error ref memo.
import { scope } from "arktype";
import { describe, expect, it } from "vitest";
import {
  type ComponentRegistry,
  getErrorSchemaRef,
  rewriteRefs,
  schemaToOA,
  sha1Hex,
} from "./registry.js";

const STABLE_NAME_RE = /^schema_[a-f0-9]{12}$/;

function createRegistry(): ComponentRegistry {
  return { schemas: new Map(), securitySchemes: new Map() };
}

// The recursive shape is the one ArkType emits $defs + $ref for (openapi.test.ts
// uses the same fixture for the spec-level assertion).
const Tree = scope({ Tree: { label: "string", children: "Tree[]" } }).export().Tree;

describe("sha1Hex", () => {
  it("is deterministic and 12 hex chars long", async () => {
    const a = await sha1Hex("hello");
    const b = await sha1Hex("hello");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{12}$/);
  });

  it("differs for different content", async () => {
    expect(await sha1Hex("hello")).not.toBe(await sha1Hex("world"));
  });
});

describe("rewriteRefs", () => {
  it("rewrites #/$defs/X refs in-place using the rename map", () => {
    const node = {
      $ref: "#/$defs/foo",
      items: { $ref: "#/$defs/bar" },
      other: "#/$defs/bar",
    };
    rewriteRefs(
      node,
      new Map([
        ["foo", "schema_aaa"],
        ["bar", "schema_bbb"],
      ]),
    );
    expect(node.$ref).toBe("#/components/schemas/schema_aaa");
    expect(node.items).toEqual({ $ref: "#/components/schemas/schema_bbb" });
    // Non-$ref string values are untouched (it rewrites $ref keys only).
    expect(node.other).toBe("#/$defs/bar");
  });

  it("leaves unknown refs untouched", () => {
    const node = { $ref: "#/$defs/unknown" };
    rewriteRefs(node, new Map([["foo", "schema_aaa"]]));
    expect(node.$ref).toBe("#/$defs/unknown");
  });
});

describe("schemaToOA", () => {
  it("hoists $defs into the injected registry under stable names with rewritten refs", async () => {
    const registry = createRegistry();
    const json = await schemaToOA(Tree, registry);

    expect(json.$defs).toBeUndefined();
    expect(registry.schemas.size).toBeGreaterThan(0);
    for (const name of registry.schemas.keys()) {
      expect(name).toMatch(STABLE_NAME_RE);
    }

    const specStr = JSON.stringify(json);
    expect(specStr).not.toContain("#/$defs/");
    const refs = specStr.match(/"\$ref":"([^"]+)"/g) ?? [];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      expect(ref.startsWith('"$ref":"#/components/schemas/')).toBe(true);
    }
  });

  it("re-registers cached defs into a second, fresh registry without recomputing names", async () => {
    const first = createRegistry();
    const json1 = await schemaToOA(Tree, first);

    const second = createRegistry();
    const json2 = await schemaToOA(Tree, second);
    expect(json1).toBe(json2); // identical processed object from the module cache
    expect(second.schemas.size).toBe(first.schemas.size);
    for (const [name, def] of first.schemas) {
      expect(second.schemas.get(name)).toBe(def);
    }
  });

  it("registers schemas without $defs without hoisting anything", async () => {
    const registry = createRegistry();
    const json = await schemaToOA(scope({ T: { a: "number" } }).export().T, registry);
    expect(json.$defs).toBeUndefined();
    expect(registry.schemas.size).toBe(0);
  });

  it("uses the same stable name for equal content regardless of generated def names", async () => {
    // Two separate scopes generate equal-shaped trees; content-hash names must match.
    const TreeA = scope({ Tree: { label: "string", children: "Tree[]" } }).export().Tree;
    const TreeB = scope({ Tree: { label: "string", children: "Tree[]" } }).export().Tree;
    const registryA = createRegistry();
    const registryB = createRegistry();
    await schemaToOA(TreeA, registryA);
    await schemaToOA(TreeB, registryB);
    expect([...registryA.schemas.keys()].sort()).toEqual([...registryB.schemas.keys()].sort());
  });
});

describe("getErrorSchemaRef", () => {
  it("registers the { error: string } schema under a stable name and returns a components ref", async () => {
    const registry = createRegistry();
    const ref = (await getErrorSchemaRef(registry)) as { $ref?: string };

    const name = ref.$ref?.split("/").pop();
    expect(name).toMatch(STABLE_NAME_RE);
    expect(registry.schemas.get(name!)).toEqual({
      type: "object",
      properties: { error: { type: "string" } },
      required: ["error"],
    });
  });

  it("memoizes the ref per registry (same object on second call)", async () => {
    const registry = createRegistry();
    const ref1 = await getErrorSchemaRef(registry);
    const ref2 = await getErrorSchemaRef(registry);
    expect(ref1).toBe(ref2);
  });

  it("registers the same entry in a different registry without sharing the ref memo", async () => {
    const a = createRegistry();
    const b = createRegistry();
    const refA = (await getErrorSchemaRef(a)) as { $ref?: string };
    const refB = (await getErrorSchemaRef(b)) as { $ref?: string };
    expect(refA).toEqual(refB);
    expect(a.schemas.get(refA.$ref!.split("/").pop()!)).toBeDefined();
    expect(b.schemas.get(refB.$ref!.split("/").pop()!)).toBeDefined();
  });
});
