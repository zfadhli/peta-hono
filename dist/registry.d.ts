import { type JsonSchema } from "arktype";
import type { ArkType } from "./validation.js";
/** SHA-1 hex digest (first 12 chars) using Web Crypto API — no Node dependency. */
export declare function sha1Hex(data: string): Promise<string>;
/**
 * The schemas half of the per-instance component registry. The full aggregate
 * (schemas + securitySchemes) is spec.ts's `ComponentRegistry`; registry.ts
 * only ever reads/writes `schemas`, so a structural contract keeps this module
 * independent of the security-scheme type and the openapi.ts orchestrator.
 * The registry object is owned by the caller and passed in explicitly, so
 * registration state is never shared behind a module singleton.
 */
export interface SchemaHost {
    schemas: Map<string, JsonSchema>;
}
/**
 * Recursively rewrite all $ref: "#/$defs/X" → "#/components/schemas/<stableName>" in-place.
 * Used during {@link schemaToOA} to fix dangling refs after hoisting $defs to components.
 */
export declare function rewriteRefs(node: unknown, rename: Map<string, string>): void;
/**
 * Convert an ArkType schema → OpenAPI Schema Object, hoisting its $defs into
 * `components.schemas` under content-hash stable names and rewriting all refs.
 *
 * Cache: the derived schema is byte-identical to a fresh derivation and immutable
 * after derivation, so it is shared across routes/instances via a module-scoped
 * WeakMap keyed by Type identity. On a cache hit the hoisted defs are re-registered
 * into the passed instance map so THIS instance's components resolve every ref.
 */
export declare function schemaToOA(schema: ArkType, components: SchemaHost): Promise<JsonSchema>;
/**
 * The shared framework-error schema `{ error: string }` as a $ref into
 * `components.schemas`, registering the def into the passed instance map.
 *
 * The ref is memoized per-ComponentRegistry (WeakMap), preserving the original
 * lazy per-instance memo semantics: the name derives from the fixed schema's
 * content hash, which is deterministic, so every instance publishes the same
 * `schema_<hash>` entry and refs never dangle.
 */
export declare function getErrorSchemaRef(components: SchemaHost): Promise<JsonSchema>;
//# sourceMappingURL=registry.d.ts.map