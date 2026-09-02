// Component registry & stable-name hoisting — extracted from src/openapi.ts
// (ADR-011 step 4, triggered: openapi.ts exceeded 800 LOC and the WeakMap
// schema cache was added, both named in ADR-011's revisit gate).
//
// Owns the ArkType → OpenAPI Schema Object conversion: content-hash stable
// names (sha1Hex), $defs hoisting into an instance's components.schemas map,
// $ref rewriting and the module-scoped WeakMap cache. Functions are pure over
// their `components` argument — the per-instance mutable map is owned by the
// caller (OpenAPIHono._components) and passed in explicitly, so an instance's
// registration state is never shared behind a module singleton.

import { type JsonSchema, type } from "arktype";
import type { SecurityScheme } from "./openapi.js";
import type { ArkType } from "./validation.js";

// --- Web Crypto helpers ---

/** SHA-1 hex digest (first 12 chars) using Web Crypto API — no Node dependency. */
export async function sha1Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(data));
  const hex = Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return hex.slice(0, 12);
}

// --- Component registry ---

/** Per-instance component maps: schemas hoisted from $defs + registered security schemes. */
export interface ComponentRegistry {
  schemas: Map<string, JsonSchema>;
  securitySchemes: Map<string, SecurityScheme>;
}

/**
 * Cache entry for {@link schemaCache}: a fully-processed OpenAPI Schema Object plus
 * the hoisted $defs needed to re-register them into any instance's component map.
 * The `schema` is immutable after derivation (callers only read and embed it), so
 * sharing the object across routes and instances is safe and JSON-serializes
 * byte-identical to a fresh derivation. Re-registering `defs` on a cache hit keeps
 * each OpenAPIHono instance's per-instance `components.schemas` complete so refs
 * never dangle (the cache is module-scoped/shared; `components` is per-instance).
 */
interface SchemaCacheEntry {
  /** The processed schema: no $schema, no $defs, all $refs rewritten to components. */
  schema: JsonSchema;
  /** Stable-name → def entries to (re)register into an instance's components.schemas. */
  defs: ReadonlyArray<readonly [string, JsonSchema]>;
}

/** Cache of ArkType Type → processed OpenAPI Schema, keyed by Type object identity. */
const schemaCache = new WeakMap<ArkType, SchemaCacheEntry>();

/**
 * Recursively rewrite all $ref: "#/$defs/X" → "#/components/schemas/<stableName>" in-place.
 * Used during {@link schemaToOA} to fix dangling refs after hoisting $defs to components.
 */
export function rewriteRefs(node: unknown, rename: Map<string, string>): void {
  if (typeof node !== "object" || node === null) return;
  if (Array.isArray(node)) {
    for (const item of node) rewriteRefs(item, rename);
    return;
  }
  const obj = node as Record<string, unknown>;
  const ref = obj.$ref;
  if (typeof ref === "string") {
    const m = ref.match(/^#\/\$defs\/(.+)$/);
    if (m && rename.has(m[1]!)) {
      obj.$ref = `#/components/schemas/${rename.get(m[1]!)}`;
    }
  }
  for (const key of Object.keys(obj)) {
    rewriteRefs(obj[key], rename);
  }
}

/**
 * Convert an ArkType schema → OpenAPI Schema Object, hoisting its $defs into
 * `components.schemas` under content-hash stable names and rewriting all refs.
 *
 * Cache: the derived schema is byte-identical to a fresh derivation and immutable
 * after derivation, so it is shared across routes/instances via a module-scoped
 * WeakMap keyed by Type identity. On a cache hit the hoisted defs are re-registered
 * into the passed instance map so THIS instance's components resolve every ref.
 */
export async function schemaToOA(
  schema: ArkType,
  components: ComponentRegistry,
): Promise<JsonSchema> {
  const cached = schemaCache.get(schema);
  if (cached) {
    for (const [stableName, def] of cached.defs) {
      if (!components.schemas.has(stableName)) {
        components.schemas.set(stableName, def);
      }
    }
    return cached.schema;
  }

  const json = schema.toJsonSchema();
  // Remove JSON Schema draft meta-schema (not valid in OpenAPI 3.0)
  delete json.$schema;

  if (!json.$defs) {
    schemaCache.set(schema, { schema: json, defs: [] });
    return json;
  }

  // Build stable names: originalName → schema_<sha1(normalizedContent).slice(0,12)>
  // ArkType's auto-generated def names (e.g. "intersection216") are counter-based
  // and unstable across runs. Since those names also appear inside $ref strings
  // in the def content, we normalize refs to positional indices before hashing
  // so the hash depends only on structure, not generated names.
  const defEntries = Object.entries(json.$defs);
  const nameToIndex = new Map<string, string>();
  for (let i = 0; i < defEntries.length; i++) {
    nameToIndex.set(defEntries[i]![0], String(i));
  }
  const normalizeRefs = (s: string): string =>
    s.replace(/#\/\$defs\/([^"]+)/g, (_, name) => `#/$defs/${nameToIndex.get(name) ?? name}`);

  const rename = new Map<string, string>();
  for (const [name, def] of defEntries) {
    const hash = await sha1Hex(normalizeRefs(JSON.stringify(def)));
    rename.set(name, `schema_${hash}`);
  }

  // Rewrite all $ref pointers in-place (main body + nested defs)
  rewriteRefs(json, rename);

  // Hoist $defs to components/schemas under stable names, capturing the entries so
  // a later cache hit can re-register them into another instance's component map.
  const defs: [string, JsonSchema][] = [];
  for (const [name, def] of Object.entries(json.$defs)) {
    const stableName = rename.get(name)!;
    defs.push([stableName, def]);
    if (!components.schemas.has(stableName)) {
      components.schemas.set(stableName, def);
    }
  }
  delete json.$defs;

  schemaCache.set(schema, { schema: json, defs });

  return json;
}

/**
 * The shared framework-error schema `{ error: string }` as a $ref into
 * `components.schemas`, registering the def into the passed instance map.
 *
 * The ref is memoized per-ComponentRegistry (WeakMap), preserving the original
 * lazy per-instance memo semantics: the name derives from the fixed schema's
 * content hash, which is deterministic, so every instance publishes the same
 * `schema_<hash>` entry and refs never dangle.
 */
export async function getErrorSchemaRef(components: ComponentRegistry): Promise<JsonSchema> {
  const cached = errorSchemaRefCache.get(components);
  if (cached) return cached;
  const errorSchema = type({ error: "string" });
  const json = errorSchema.toJsonSchema() as JsonSchema & {
    $defs?: Record<string, JsonSchema>;
  };
  delete (json as { $schema?: string }).$schema;
  const hash = await sha1Hex(JSON.stringify(json));
  const name = `schema_${hash}`;
  if (!components.schemas.has(name)) {
    components.schemas.set(name, json as JsonSchema);
  }
  const ref = { $ref: `#/components/schemas/${name}` } as JsonSchema;
  errorSchemaRefCache.set(components, ref);
  return ref;
}

/** Per-instance memo of the framework-error schema ref (see getErrorSchemaRef). */
const errorSchemaRefCache = new WeakMap<ComponentRegistry, JsonSchema>();
