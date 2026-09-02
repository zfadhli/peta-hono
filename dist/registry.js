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
import { type } from "arktype";
// --- Web Crypto helpers ---
/** SHA-1 hex digest (first 12 chars) using Web Crypto API — no Node dependency. */
export async function sha1Hex(data) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(data));
    const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return hex.slice(0, 12);
}
/** Cache of ArkType Type → processed OpenAPI Schema, keyed by Type object identity. */
const schemaCache = new WeakMap();
/**
 * Recursively rewrite all $ref: "#/$defs/X" → "#/components/schemas/<stableName>" in-place.
 * Used during {@link schemaToOA} to fix dangling refs after hoisting $defs to components.
 */
export function rewriteRefs(node, rename) {
    if (typeof node !== "object" || node === null)
        return;
    if (Array.isArray(node)) {
        for (const item of node)
            rewriteRefs(item, rename);
        return;
    }
    const obj = node;
    const ref = obj.$ref;
    if (typeof ref === "string") {
        const m = ref.match(/^#\/\$defs\/(.+)$/);
        if (m && rename.has(m[1])) {
            obj.$ref = `#/components/schemas/${rename.get(m[1])}`;
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
export async function schemaToOA(schema, components) {
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
    const nameToIndex = new Map();
    for (let i = 0; i < defEntries.length; i++) {
        nameToIndex.set(defEntries[i][0], String(i));
    }
    const normalizeRefs = (s) => s.replace(/#\/\$defs\/([^"]+)/g, (_, name) => `#/$defs/${nameToIndex.get(name) ?? name}`);
    const rename = new Map();
    for (const [name, def] of defEntries) {
        const hash = await sha1Hex(normalizeRefs(JSON.stringify(def)));
        rename.set(name, `schema_${hash}`);
    }
    // Rewrite all $ref pointers in-place (main body + nested defs)
    rewriteRefs(json, rename);
    // Hoist $defs to components/schemas under stable names, capturing the entries so
    // a later cache hit can re-register them into another instance's component map.
    const defs = [];
    for (const [name, def] of Object.entries(json.$defs)) {
        const stableName = rename.get(name);
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
export async function getErrorSchemaRef(components) {
    const cached = errorSchemaRefCache.get(components);
    if (cached)
        return cached;
    const errorSchema = type({ error: "string" });
    const json = errorSchema.toJsonSchema();
    delete json.$schema;
    const hash = await sha1Hex(JSON.stringify(json));
    const name = `schema_${hash}`;
    if (!components.schemas.has(name)) {
        components.schemas.set(name, json);
    }
    const ref = { $ref: `#/components/schemas/${name}` };
    errorSchemaRefCache.set(components, ref);
    return ref;
}
/** Per-instance memo of the framework-error schema ref (see getErrorSchemaRef). */
const errorSchemaRefCache = new WeakMap();
//# sourceMappingURL=registry.js.map