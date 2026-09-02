// Validation & coercion — extracted from src/openapi.ts (ADR-011 step 3).
//
// Owns the ArkType → JsonSchema inspection helpers and the deep coercion walk
// that turns query/header strings into typed values before validation. The only
// library dependency is the error kernel (src/errors.ts) so the validator can
// throw APIError(400) without creating a circular `api ↔ openapi ↔ validation
// ↔ errors` edge. openapi.ts imports `arktypeValidator` for middleware assembly
// and re-exports `ArkType` for barrel stability.
import { ArkErrors } from "arktype";
import { validator } from "hono/validator";
import { APIError } from "./errors.js";
/** Type guard: JsonSchema with type "object". */
export function isObjectSchema(json) {
    return "type" in json && json.type === "object";
}
/** Check if a JsonSchema property is numeric (number or integer). */
function isNumericType(prop) {
    if (!("type" in prop))
        return false;
    const t = prop.type;
    if (Array.isArray(t))
        return t.includes("number") || t.includes("integer");
    return t === "number" || t === "integer";
}
/** Check if a JsonSchema property is boolean. */
function isBooleanType(prop) {
    if (!("type" in prop))
        return false;
    const t = prop.type;
    if (Array.isArray(t))
        return t.includes("boolean");
    return t === "boolean";
}
/** Check if a JsonSchema property is array. */
function isArrayType(prop) {
    return "type" in prop && prop.type === "array";
}
/** Check if a JsonSchema property is object. */
function isObjectType(prop) {
    return "type" in prop && prop.type === "object";
}
/** Resolve $ref to its definition if present. */
export function resolveRef(prop, defs) {
    if (prop && typeof prop === "object" && "$ref" in prop) {
        const ref = prop.$ref;
        if (typeof ref === "string") {
            const m = ref.match(/^#\/\$defs\/(.+)$/);
            if (m && defs?.[m[1]])
                return defs[m[1]];
        }
    }
    return prop;
}
/** Coerce a single value according to its expected JsonSchema. */
export function coerceValue(expected, raw, defs) {
    // Empty string (and whitespace-only) and missing values must not coerce to 0/false — preserve for validation to 400.
    if (raw === undefined)
        return raw;
    if (typeof raw === "string" && raw.trim() === "")
        return raw;
    const prop = resolveRef(expected, defs);
    if (isNumericType(prop)) {
        if (typeof raw === "string") {
            const num = Number(raw);
            if (!Number.isNaN(num))
                return num;
            return raw;
        }
        return raw;
    }
    if (isBooleanType(prop)) {
        if (typeof raw === "string") {
            if (raw === "true")
                return true;
            if (raw === "false")
                return false;
            return raw;
        }
        return raw;
    }
    if (isArrayType(prop)) {
        const items = prop.items;
        if (!items)
            return raw;
        if (Array.isArray(raw)) {
            return raw.map((el) => {
                if (el === undefined)
                    return el;
                if (typeof el === "string" && el.trim() === "")
                    return el;
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
        let obj = raw;
        if (typeof raw === "string" && raw.trim().startsWith("{")) {
            try {
                obj = JSON.parse(raw);
            }
            catch {
                return raw;
            }
        }
        if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
            const out = { ...obj };
            const subProps = prop.properties;
            if (subProps) {
                for (const [k, subSchema] of Object.entries(subProps)) {
                    if (k in obj) {
                        const v = obj[k];
                        // Preserve empty/missing inside nested as well
                        if (v === undefined)
                            continue;
                        if (typeof v === "string" && v.trim() === "")
                            continue;
                        out[k] = coerceValue(subSchema, v, defs);
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
export function coerceDeep(schema, data) {
    const json = schema.toJsonSchema();
    // Strip $schema — not relevant for coercion.
    const defs = json.$defs;
    if (!isObjectSchema(json) || !json.properties)
        return data;
    const out = { ...data };
    for (const [key, prop] of Object.entries(json.properties)) {
        if (!(key in data))
            continue;
        const raw = data[key];
        if (raw === undefined)
            continue;
        if (typeof raw === "string" && raw.trim() === "")
            continue;
        out[key] = coerceValue(prop, raw, defs);
    }
    return out;
}
/**
 * Create a Hono validator middleware from an ArkType schema.
 * Coerces strings → numbers/booleans (deep, element-wise for arrays and nested objects)
 * before validation so query/header strings pass typed schemas.
 */
export function arktypeValidator(target, schema) {
    return validator(target, (value, _c) => {
        const data = coerceDeep(schema, (value ?? {}));
        const result = schema(data);
        if (result instanceof ArkErrors) {
            // Throw (don't return) so validation failures route through app.onError —
            // the single chokepoint for all errors (request IDs, logging, etc.).
            throw new APIError(400, result.summary);
        }
        return result;
    });
}
//# sourceMappingURL=validation.js.map