import { ArkErrors, type } from "arktype";
import { Hono } from "hono";
import { validator } from "hono/validator";
// --- Web Crypto helpers ---
/** SHA-1 hex digest (first 12 chars) using Web Crypto API — no Node dependency. */
async function sha1Hex(data) {
    const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(data));
    const hex = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    return hex.slice(0, 12);
}
export function createErrorHandler(debug) {
    return (err, c) => {
        if (err instanceof APIError) {
            return c.json({ error: err.message }, err.status);
        }
        // ponytail: logs the full error server-side, sends generic message to client.
        console.error(err);
        const isProd = typeof process !== "undefined" &&
            process.env?.NODE_ENV === "production";
        if (debug && isProd) {
            console.warn("[peta-hono] debug enabled in production — redacting error details");
        }
        const effectiveDebug = !!debug && !isProd;
        if (effectiveDebug) {
            const message = err instanceof Error ? err.message : String(err);
            const body = { error: message };
            if (err instanceof Error && err.stack)
                body.stack = err.stack;
            return c.json(body, 500);
        }
        return c.json({ error: "Internal Server Error" }, 500);
    };
}
// --- Public error class ---
/**
 * Typed HTTP error. Thrown from handlers (and the validator) to route errors
 * through `app.onError` — the single chokepoint for all error responses.
 */
export class APIError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
        this.name = "APIError";
    }
}
// --- Helpers ---
const SUPPORTED_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
export function normalizeMethod(m) {
    const lower = m.toLowerCase();
    if (!SUPPORTED_METHODS.map((s) => s.toLowerCase()).includes(lower)) {
        throw new Error(`Unsupported method: ${m}. Use one of: ${SUPPORTED_METHODS.join(", ")}`);
    }
    return lower;
}
/**
 * Convert Hono-style /:param → OpenAPI 3.0 /{param} for all Hono token shapes.
 * Handles :name, :name{regex}, :name?, :name{regex}? and wildcard *.
 * ponytail: Hono lowercases header names via Fetch Headers; header schemas
 * must use lowercase keys (documented guidance). Edge path characters (//, *)
 * are normalized deterministically — * becomes {wildcard}.
 */
function toOapiPath(path) {
    let out = path.replace(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/g, "{$1}");
    out = out.replace(/\*/g, "{wildcard}");
    return out;
}
/** Type guard: JsonSchema with type "object". */
function isObjectSchema(json) {
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
function resolveRef(prop, defs) {
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
function coerceValue(expected, raw, defs) {
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
function coerceDeep(schema, data) {
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
/**
 * Recursively rewrite all $ref: "#/$defs/X" → "#/components/schemas/<stableName>" in-place.
 * Used during _schemaToOA to fix dangling refs after hoisting $defs to components.
 */
function rewriteRefs(node, rename) {
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
// --- OpenAPIHono ---
export class OpenAPIHono extends Hono {
    _routes = [];
    _components = {
        schemas: new Map(),
        securitySchemes: new Map(),
    };
    constructor(...args) {
        super(...args);
        // Default error handler — single chokepoint for validation errors (thrown
        // by arktypeValidator) and any other thrown errors. Uses the shared
        // createErrorHandler policy; createApi() overrides with debug-aware variant.
        this.onError(createErrorHandler());
    }
    /** Register an API endpoint with ArkType validation and OpenAPI metadata. */
    openapi(config, handler) {
        const method = normalizeMethod(config.method);
        if (!config.path.startsWith("/")) {
            throw new Error(`Path must start with "/": ${config.path}`);
        }
        const oapiPath = toOapiPath(config.path);
        const paramNames = [...config.path.matchAll(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/g)].map((m) => m[1]);
        // Build middlewares from request schemas
        const mws = [];
        if (config.request?.params) {
            mws.push(arktypeValidator("param", config.request.params));
        }
        else if (paramNames.length > 0) {
            // Auto-generate params schema from path tokens
            const paramsDef = {};
            for (const name of paramNames)
                paramsDef[name] = "string";
            mws.push(arktypeValidator("param", type(paramsDef)));
        }
        if (config.request?.query)
            mws.push(arktypeValidator("query", config.request.query));
        if (config.request?.headers)
            mws.push(arktypeValidator("header", config.request.headers));
        if (config.request?.body)
            mws.push(arktypeValidator("json", config.request.body));
        // User-defined middlewares
        if (config.middleware)
            mws.push(...config.middleware);
        // Store route for spec generation
        this._routes.push({ method, oapiPath, config, handler });
        // Register the Hono route
        // ponytail: Hono's .on() has 5+ overloads; typed spread dispatch not worth the complexity
        const dispatch = this.on.bind(this);
        dispatch(method, config.path, ...mws, async (c) => {
            // Hono's valid() is typed via Input generics that don't apply to our dynamic
            // validator registration; narrow c.req to a simple callable signature.
            // Cast is on c.req (not extracting valid) to preserve `this` binding.
            const creq = c.req;
            const req = {};
            // Flatten path params to top level (Encore-style: handler({ name }) not handler({ params: { name } }))
            if (paramNames.length > 0) {
                Object.assign(req, creq.valid("param"));
            }
            if (config.request?.body)
                req.body = creq.valid("json");
            if (config.request?.query)
                req.query = creq.valid("query");
            if (config.request?.headers)
                req.headers = creq.valid("header");
            // Inject auth context set by auth middleware via c.set('auth', ctx)
            const authCtx = c.get("auth");
            if (authCtx !== undefined)
                req.auth = authCtx;
            // Expose Hono context for handlers that need it (e.g., session save/destroy)
            req.c = c;
            const result = await handler(req);
            // If handler returned a Response directly, use it as-is
            if (result instanceof Response)
                return result;
            // Determine status: explicit status, first 2xx/3xx in declared responses, or 200
            const successCode = config.status?.toString() ??
                Object.keys(config.responses ?? {}).find((k) => k.startsWith("2") || k.startsWith("3")) ??
                "200";
            if (result === null) {
                return c.body(null, Number(successCode));
            }
            return c.json(result, Number(successCode));
        });
    }
    /** Emit an OpenAPI 3.0 JSON endpoint. */
    doc(url, config) {
        this.get(url, async (c) => {
            return c.json(await this._buildSpec(config));
        });
    }
    /** Register an OpenAPI security scheme (e.g. bearer, apiKey). */
    registerSecurityScheme(name, scheme) {
        this._components.securitySchemes.set(name, scheme);
    }
    // --- Spec building ---
    async _buildSpec(config) {
        const paths = {};
        const seenOperationIds = new Set();
        const baseCounts = new Map();
        for (const route of this._routes) {
            const pathItem = paths[route.oapiPath] ?? {};
            const baseId = `${route.method}_${route.oapiPath.replace(/[{}]/g, "").replace(/\//g, "_").replace(/\*/g, "wildcard")}`;
            let operationId = baseId;
            if (seenOperationIds.has(operationId)) {
                let n = (baseCounts.get(baseId) ?? 1) + 1;
                while (seenOperationIds.has(`${baseId}_${n}`))
                    n++;
                operationId = `${baseId}_${n}`;
                baseCounts.set(baseId, n);
            }
            else {
                baseCounts.set(baseId, 1);
            }
            seenOperationIds.add(operationId);
            const op = {
                operationId,
                responses: await this._buildResponses(route.config),
            };
            if (route.config.tags)
                op.tags = route.config.tags;
            if (route.config.summary)
                op.summary = route.config.summary;
            if (route.config.description)
                op.description = route.config.description;
            if (route.config.security)
                op.security = route.config.security;
            // Parameters (path + query + header)
            const params = [];
            if (route.config.request?.params) {
                await this._addObjectParams(params, route.config.request.params, "path");
            }
            if (route.config.request?.query) {
                await this._addObjectParams(params, route.config.request.query, "query");
            }
            if (route.config.request?.headers) {
                await this._addObjectParams(params, route.config.request.headers, "header");
            }
            if (params.length > 0)
                op.parameters = params;
            // Request body
            if (route.config.request?.body) {
                op.requestBody = {
                    required: true,
                    content: {
                        "application/json": {
                            schema: await this._schemaToOA(route.config.request.body),
                        },
                    },
                };
            }
            pathItem[route.method] = op;
            paths[route.oapiPath] = pathItem;
        }
        const spec = {
            openapi: config.openapi ?? "3.0.0",
            info: config.info,
            paths,
            components: {},
        };
        // Register named security schemes
        if (this._components.securitySchemes.size > 0) {
            spec.components.securitySchemes = Object.fromEntries(this._components.securitySchemes);
        }
        // Register named schemas
        if (this._components.schemas.size > 0) {
            spec.components.schemas = Object.fromEntries(this._components.schemas);
        }
        return spec;
    }
    async _buildResponses(config) {
        const responses = {};
        // Standard OpenAPI descriptions for user-declared success codes
        const descByCode = {
            "200": "OK",
            "201": "Created",
            "202": "Accepted",
            "204": "No Content",
        };
        if (config.responses) {
            for (const [code, schema] of Object.entries(config.responses)) {
                if (code === "204") {
                    responses[code] = { description: "No Content" };
                }
                else {
                    responses[code] = {
                        description: descByCode[code] ?? `Response ${code}`,
                        content: {
                            "application/json": { schema: await this._schemaToOA(schema) },
                        },
                    };
                }
            }
        }
        // Determine success code: explicit status, first 2xx/3xx in declared responses, or 200
        const successCode = config.status?.toString() ??
            Object.keys(responses).find((k) => k.startsWith("2") || k.startsWith("3")) ??
            "200";
        if (!responses[successCode]) {
            responses[successCode] = {
                description: descByCode[successCode] ?? "Success",
            };
        }
        // Framework-guaranteed error responses (zero-config, share one schema component)
        // 400 Bad Request — any endpoint with validated body/query/headers/params
        // 401 Unauthorized — any endpoint behind a registered auth scheme
        const errorRef = await this._getErrorSchemaRef();
        const addFrameworkError = async (code, description) => {
            const key = String(code);
            if (!responses[key]) {
                responses[key] = {
                    description,
                    content: {
                        "application/json": { schema: errorRef },
                    },
                };
            }
        };
        if (config.request && !responses["400"]) {
            if (config.request.body ||
                config.request.query ||
                config.request.headers ||
                config.request.params) {
                await addFrameworkError(400, "Bad Request");
            }
        }
        if (config.security && !responses["401"]) {
            await addFrameworkError(401, "Unauthorized");
        }
        // 404 Not Found — auto-inject when endpoint has path params (:id → resource lookup)
        // ponytail: heuristic — path params strongly imply resource lookup. User can override
        // by declaring an explicit 404 response, which the guard above (`!responses[key]`)
        // respects. False positives (documenting 404 on endpoints that never throw it) are
        // benign spec noise.
        if (!responses["404"] && config.path.match(/:([a-zA-Z0-9_]+)(?:\{[^}]+\})?\??/)) {
            await addFrameworkError(404, "Not Found");
        }
        // Default 500 (if not already declared by the user)
        if (!responses["500"]) {
            responses["500"] = {
                description: "Internal Server Error",
                content: {
                    "application/json": { schema: errorRef },
                },
            };
        }
        return responses;
    }
    _errorSchemaRef = null;
    async _getErrorSchemaRef() {
        if (this._errorSchemaRef)
            return this._errorSchemaRef;
        const errorSchema = type({ error: "string" });
        const json = errorSchema.toJsonSchema();
        delete json.$schema;
        const hash = await sha1Hex(JSON.stringify(json));
        const name = `schema_${hash}`;
        if (!this._components.schemas.has(name)) {
            this._components.schemas.set(name, json);
        }
        this._errorSchemaRef = { $ref: `#/components/schemas/${name}` };
        return this._errorSchemaRef;
    }
    /**
     * Convert an ArkType schema → OpenAPI Schema Object.
     * Uses ArkType's toJsonSchema(), strips $schema, hoists $defs to components/schemas
     * with content-hash stable names, and rewrites all $ref pointers accordingly.
     */
    async _schemaToOA(schema) {
        const json = schema.toJsonSchema();
        // Remove JSON Schema draft meta-schema (not valid in OpenAPI 3.0)
        delete json.$schema;
        if (!json.$defs)
            return json;
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
        // Hoist $defs to components/schemas under stable names
        for (const [name, def] of Object.entries(json.$defs)) {
            const stableName = rename.get(name);
            if (!this._components.schemas.has(stableName)) {
                this._components.schemas.set(stableName, def);
            }
        }
        delete json.$defs;
        return json;
    }
    /** Walk an ArkType object schema and produce OpenAPI parameter objects. */
    async _addObjectParams(params, schema, inLocation) {
        // Use _schemaToOA (not raw toJsonSchema) so $defs are hoisted and refs rewritten
        const json = await this._schemaToOA(schema);
        if (!isObjectSchema(json) || !json.properties)
            return;
        const required = new Set(json.required ?? []);
        for (const [name, prop] of Object.entries(json.properties)) {
            if (!prop)
                continue;
            // ponytail: Hono's c.req.header() lowercases via Fetch Headers; spec
            // emits lowercase header param names so runtime and docs match. Users
            // should declare header schemas with lowercase keys.
            const paramName = inLocation === "header" ? name.toLowerCase() : name;
            const param = {
                name: paramName,
                in: inLocation,
                required: required.has(name),
                schema: prop,
            };
            const desc = prop.description;
            if (desc)
                param.description = desc;
            params.push(param);
        }
    }
}
//# sourceMappingURL=openapi.js.map