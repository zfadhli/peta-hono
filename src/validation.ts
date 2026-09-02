// Validation & coercion — extracted from src/openapi.ts (ADR-011 step 3).
//
// Owns the ArkType → JsonSchema inspection helpers and the deep coercion walk
// that turns query/header strings into typed values before validation. The only
// library dependency is the error kernel (src/errors.ts) so the validator can
// throw APIError(400) without creating a circular `api ↔ openapi ↔ validation
// ↔ errors` edge. openapi.ts imports `arktypeValidator` for middleware assembly
// and re-exports `ArkType` for barrel stability.

import { ArkErrors, type JsonSchema, type Type } from "arktype";
import type { MiddlewareHandler } from "hono";
import { validator } from "hono/validator";
import { APIError } from "./errors.js";

/** Any ArkType type instance — has toJsonSchema() and is callable for validation. */
export type ArkType = Type<any, any>;

/** Type guard: JsonSchema with type "object". */
export function isObjectSchema(json: JsonSchema): json is JsonSchema.Object {
  return "type" in json && json.type === "object";
}

/** Check if a JsonSchema property is numeric (number or integer). */
function isNumericType(prop: JsonSchema): boolean {
  if (!("type" in prop)) return false;
  const t = (prop as { type?: string | readonly string[] }).type;
  if (Array.isArray(t)) return t.includes("number") || t.includes("integer");
  return t === "number" || t === "integer";
}

/** Check if a JsonSchema property is boolean. */
function isBooleanType(prop: JsonSchema): boolean {
  if (!("type" in prop)) return false;
  const t = (prop as { type?: string | readonly string[] }).type;
  if (Array.isArray(t)) return t.includes("boolean");
  return t === "boolean";
}

/** Check if a JsonSchema property is array. */
function isArrayType(prop: JsonSchema): boolean {
  return "type" in prop && (prop as { type?: string }).type === "array";
}

/** Check if a JsonSchema property is object. */
function isObjectType(prop: JsonSchema): boolean {
  return "type" in prop && (prop as { type?: string }).type === "object";
}

/** Resolve $ref to its definition if present. */
export function resolveRef(
  prop: JsonSchema,
  defs: Record<string, JsonSchema> | undefined,
): JsonSchema {
  if (prop && typeof prop === "object" && "$ref" in prop) {
    const ref = (prop as { $ref?: string }).$ref;
    if (typeof ref === "string") {
      const m = ref.match(/^#\/\$defs\/(.+)$/);
      if (m && defs?.[m[1]!]) return defs[m[1]!] as JsonSchema;
    }
  }
  return prop;
}

/** Coerce a single value according to its expected JsonSchema. */
export function coerceValue(
  expected: JsonSchema,
  raw: unknown,
  defs: Record<string, JsonSchema> | undefined,
): unknown {
  // Empty string (and whitespace-only) and missing values must not coerce to 0/false — preserve for validation to 400.
  if (raw === undefined) return raw;
  if (typeof raw === "string" && raw.trim() === "") return raw;
  const prop = resolveRef(expected, defs);

  if (isNumericType(prop)) {
    if (typeof raw === "string") {
      const num = Number(raw);
      if (!Number.isNaN(num)) return num;
      return raw;
    }
    return raw;
  }

  if (isBooleanType(prop)) {
    if (typeof raw === "string") {
      if (raw === "true") return true;
      if (raw === "false") return false;
      return raw;
    }
    return raw;
  }

  if (isArrayType(prop)) {
    const items = (prop as { items?: JsonSchema }).items;
    if (!items) return raw;
    if (Array.isArray(raw)) {
      return raw.map((el) => {
        if (el === undefined) return el;
        if (typeof el === "string" && el.trim() === "") return el;
        return coerceValue(items, el, defs);
      });
    }
    if (typeof raw === "string") {
      // Hono delivers a single string for `?ids=1` but an array for `?ids=1&ids=2`.
      // When the schema expects an array but we received a lone string, coerce the
      // element and wrap it so `?ids=1` still validates as number[] with element-wise coercion.
      // Leave empty handled above.
      const coerced = coerceValue(items, raw, defs);
      // Only wrap if coercion produced a different type or raw was a valid element string.
      // For non-array expectations, wrapping is desired for query-array shapes.
      return [coerced];
    }
    return raw;
  }

  if (isObjectType(prop)) {
    // If raw is a JSON string that looks like an object, try parsing it.
    let obj: unknown = raw;
    if (typeof raw === "string" && raw.trim().startsWith("{")) {
      try {
        obj = JSON.parse(raw);
      } catch {
        return raw;
      }
    }
    if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
      const out: Record<string, unknown> = { ...(obj as Record<string, unknown>) };
      const subProps = (prop as JsonSchema.Object).properties;
      if (subProps) {
        for (const [k, subSchema] of Object.entries(subProps)) {
          if (k in (obj as Record<string, unknown>)) {
            const v = (obj as Record<string, unknown>)[k];
            // Preserve empty/missing inside nested as well
            if (v === undefined) continue;
            if (typeof v === "string" && v.trim() === "") continue;
            out[k] = coerceValue(subSchema as JsonSchema, v, defs);
          }
        }
      }
      return out;
    }
    return raw;
  }

  return raw;
}

/**
 * Deep coercion: walk the ArkType JSON Schema and coerce strings → numbers/booleans
 * for query/header payloads. Handles nested objects, arrays (element-wise), and
 * booleans, preserving empty strings and missing keys so they 400.
 */
export function coerceDeep(
  schema: ArkType,
  data: Record<string, unknown>,
): Record<string, unknown> {
  const json = schema.toJsonSchema() as JsonSchema & { $defs?: Record<string, JsonSchema> };
  // Strip $schema — not relevant for coercion.
  const defs = json.$defs;
  if (!isObjectSchema(json) || !json.properties) return data;
  const out: Record<string, unknown> = { ...data };
  for (const [key, prop] of Object.entries(json.properties)) {
    if (!(key in data)) continue;
    const raw = data[key];
    if (raw === undefined) continue;
    if (typeof raw === "string" && raw.trim() === "") continue;
    out[key] = coerceValue(prop as JsonSchema, raw, defs);
  }
  return out;
}

/**
 * Create a Hono validator middleware from an ArkType schema.
 * Coerces strings → numbers/booleans (deep, element-wise for arrays and nested objects)
 * before validation so query/header strings pass typed schemas.
 */
export function arktypeValidator(
  target: "json" | "query" | "header" | "param",
  schema: ArkType,
): MiddlewareHandler {
  return validator(target, (value, _c) => {
    const data = coerceDeep(schema, (value ?? {}) as Record<string, unknown>);
    const result = schema(data);
    if (result instanceof ArkErrors) {
      // Throw (don't return) so validation failures route through app.onError —
      // the single chokepoint for all errors (request IDs, logging, etc.).
      throw new APIError(400, result.summary);
    }
    return result;
  });
}
