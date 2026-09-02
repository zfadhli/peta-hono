import { type JsonSchema, type Type } from "arktype";
import type { MiddlewareHandler } from "hono";
/** Any ArkType type instance — has toJsonSchema() and is callable for validation. */
export type ArkType = Type<any, any>;
/** Type guard: JsonSchema with type "object". */
export declare function isObjectSchema(json: JsonSchema): json is JsonSchema.Object;
/** Resolve $ref to its definition if present. */
export declare function resolveRef(prop: JsonSchema, defs: Record<string, JsonSchema> | undefined): JsonSchema;
/** Coerce a single value according to its expected JsonSchema. */
export declare function coerceValue(expected: JsonSchema, raw: unknown, defs: Record<string, JsonSchema> | undefined): unknown;
/**
 * Deep coercion: walk the ArkType JSON Schema and coerce strings → numbers/booleans
 * for query/header payloads. Handles nested objects, arrays (element-wise), and
 * booleans, preserving empty strings and missing keys so they 400.
 */
export declare function coerceDeep(schema: ArkType, data: Record<string, unknown>): Record<string, unknown>;
/**
 * Create a Hono validator middleware from an ArkType schema.
 * Coerces strings → numbers/booleans (deep, element-wise for arrays and nested objects)
 * before validation so query/header strings pass typed schemas.
 */
export declare function arktypeValidator(target: "json" | "query" | "header" | "param", schema: ArkType): MiddlewareHandler;
//# sourceMappingURL=validation.d.ts.map