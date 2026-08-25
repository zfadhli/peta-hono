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
/** Convert /:param → /{param} for OpenAPI 3.0 paths. */
function toOapiPath(path) {
    return path.replace(/:(\w+)/g, "{$1}");
}
/** Normalize method to lowercase. */
function normalizeMethod(m) {
    const lower = m.toLowerCase();
    if (!["get", "post", "put", "patch", "delete"].includes(lower)) {
        throw new Error(`Unsupported method: ${m}`);
    }
    return lower;
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
/**
 * Build a set of field names expected to be numeric from an ArkType object schema.
 * Uses toJsonSchema() — public API, no internal AST access.
 */
function getNumericFields(schema) {
    const numeric = new Set();
    const json = schema.toJsonSchema();
    if (!isObjectSchema(json) || !json.properties)
        return numeric;
    for (const [name, prop] of Object.entries(json.properties)) {
        if (prop && isNumericType(prop))
            numeric.add(name);
    }
    return numeric;
}
/**
 * Coerce string values to numbers for fields the schema expects as numeric.
 * Query params always arrive as strings; this bridges the gap.
 */
function coerceNumbers(schema, data) {
    const numeric = getNumericFields(schema);
    if (numeric.size === 0)
        return data;
    const out = { ...data };
    for (const key of numeric) {
        const val = data[key];
        if (typeof val === "string" && val !== "") {
            const num = Number(val);
            if (!Number.isNaN(num))
                out[key] = num;
        }
    }
    return out;
}
/**
 * Create a Hono validator middleware from an ArkType schema.
 * Coerces strings → numbers for numeric fields before validation.
 */
export function arktypeValidator(target, schema) {
    return validator(target, (value, _c) => {
        const data = coerceNumbers(schema, (value ?? {}));
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
        // by arktypeValidator) and any other thrown errors. createApi() overrides
        // this with its own identical policy; advanced users can override further.
        this.onError((err, c) => {
            if (err instanceof APIError) {
                return c.json({ error: err.message }, err.status);
            }
            // ponytail: logs the full error server-side, sends generic message to client.
            console.error(err);
            return c.json({ error: "Internal Server Error" }, 500);
        });
    }
    /** Register an API endpoint with ArkType validation and OpenAPI metadata. */
    openapi(config, handler) {
        const method = normalizeMethod(config.method);
        const oapiPath = toOapiPath(config.path);
        const paramNames = [...config.path.matchAll(/:(\w+)/g)].map((m) => m[1]);
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
        for (const route of this._routes) {
            const pathItem = paths[route.oapiPath] ?? {};
            const op = {
                operationId: `${route.method}_${route.oapiPath.replace(/[{}]/g, "").replace(/\//g, "_")}`,
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
        const errorSchema = type({ error: "string" });
        const addFrameworkError = async (code, description) => {
            const key = String(code);
            if (!responses[key]) {
                responses[key] = {
                    description,
                    content: {
                        "application/json": { schema: await this._schemaToOA(errorSchema) },
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
        if (!responses["404"] && config.path.match(/:(\w+)/)) {
            await addFrameworkError(404, "Not Found");
        }
        // Default 500 (if not already declared by the user)
        if (!responses["500"]) {
            responses["500"] = {
                description: "Internal Server Error",
                content: {
                    "application/json": { schema: await this._schemaToOA(errorSchema) },
                },
            };
        }
        return responses;
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
            const param = {
                name,
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