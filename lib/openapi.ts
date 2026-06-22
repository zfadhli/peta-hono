import { ArkErrors, type JsonSchema, type Type, type } from "arktype";
import type { Context, Env, MiddlewareHandler } from "hono";
import { Hono } from "hono";
import type { Schema } from "hono/types";
import type { ContentfulStatusCode, StatusCode } from "hono/utils/http-status";
import { validator } from "hono/validator";

// --- Types ---

/** Any ArkType type instance — has toJsonSchema() and is callable for validation. */
export type ArkType = Type<any, any>;

// --- Auth scheme (for OpenAPI security scheme registration) ---

export type AuthScheme =
	| { type: "http"; scheme: "bearer" | "basic" }
	| { type: "apiKey"; in: "header" | "query"; name: string };

// --- OpenAPI output types (minimal: only what we emit) ---

interface OpenAPIParameter {
	name: string;
	in: "path" | "query" | "header";
	required: boolean;
	schema: JsonSchema;
	description?: string;
}

interface OpenAPIResponse {
	description?: string;
	content?: { "application/json": { schema: JsonSchema } };
}

interface OpenAPIRequestBody {
	required: boolean;
	content: { "application/json": { schema: JsonSchema } };
}

interface OpenAPIOperation {
	operationId: string;
	responses: Record<string, OpenAPIResponse>;
	tags?: string[];
	summary?: string;
	description?: string;
	security?: Record<string, string[]>[];
	parameters?: OpenAPIParameter[];
	requestBody?: OpenAPIRequestBody;
}

interface OpenAPIComponents {
	schemas?: Record<string, JsonSchema>;
	securitySchemes?: Record<string, AuthScheme>;
}

interface OpenAPISpec {
	openapi: string;
	info: { title: string; version: string };
	paths: Record<string, Record<string, OpenAPIOperation>>;
	components: OpenAPIComponents;
}

// --- Route config ---

export interface RouteConfig {
	method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
	path: string; // Hono-style /:param
	request?: {
		body?: ArkType;
		query?: ArkType;
		headers?: ArkType;
		params?: ArkType;
	};
	responses?: Record<number, ArkType>;
	tags?: string[];
	summary?: string;
	description?: string;
	security?: Record<string, string[]>[];
	middleware?: MiddlewareHandler[];
	status?: number;
}

/** Handler signature: receives flat request object, returns JSON-serializable object or null (→ 204). */
type RouteHandler = (
	req: Record<string, unknown>,
) => Record<string, unknown> | null | Promise<Record<string, unknown> | null>;

interface StoredRoute {
	method: string;
	oapiPath: string; // OpenAPI-style /{param}
	config: RouteConfig;
	handler: RouteHandler;
}

// --- Component registry ---

interface ComponentRegistry {
	schemas: Map<string, JsonSchema>;
	securitySchemes: Map<string, AuthScheme>;
}

type ComponentKind = keyof ComponentRegistry;

type ComponentValue<K extends ComponentKind> =
	ComponentRegistry[K] extends Map<string, infer V> ? V : never;

export interface OpenAPIRegistryAccessor {
	registerComponent: <K extends ComponentKind>(
		type: K,
		name: string,
		value: ComponentValue<K>,
	) => void;
}

// --- Helpers ---

/** Convert /:param → /{param} for OpenAPI 3.0 paths. */
function toOapiPath(path: string): string {
	return path.replace(/:(\w+)/g, "{$1}");
}

/** Normalize method to lowercase. */
function normalizeMethod(m: string): string {
	const lower = m.toLowerCase();
	if (!["get", "post", "put", "patch", "delete"].includes(lower)) {
		throw new Error(`Unsupported method: ${m}`);
	}
	return lower;
}

/** Type guard: JsonSchema with type "object". */
function isObjectSchema(json: JsonSchema): json is JsonSchema.Object {
	return "type" in json && json.type === "object";
}

/** Check if a JsonSchema property is numeric (number or integer). */
function isNumericType(prop: JsonSchema): boolean {
	if (!("type" in prop)) return false;
	const t = (prop as { type?: string | readonly string[] }).type;
	if (Array.isArray(t)) return t.includes("number") || t.includes("integer");
	return t === "number" || t === "integer";
}

/**
 * Build a set of field names expected to be numeric from an ArkType object schema.
 * Uses toJsonSchema() — public API, no internal AST access.
 */
function getNumericFields(schema: ArkType): Set<string> {
	const numeric = new Set<string>();
	const json = schema.toJsonSchema();
	if (!isObjectSchema(json) || !json.properties) return numeric;
	for (const [name, prop] of Object.entries(json.properties)) {
		if (prop && isNumericType(prop)) numeric.add(name);
	}
	return numeric;
}

/**
 * Coerce string values to numbers for fields the schema expects as numeric.
 * Query params always arrive as strings; this bridges the gap.
 */
function coerceNumbers(
	schema: ArkType,
	data: Record<string, unknown>,
): Record<string, unknown> {
	const numeric = getNumericFields(schema);
	if (numeric.size === 0) return data;
	const out: Record<string, unknown> = { ...data };
	for (const key of numeric) {
		const val = data[key];
		if (typeof val === "string" && val !== "") {
			const num = Number(val);
			if (!isNaN(num)) out[key] = num;
		}
	}
	return out;
}

/**
 * Create a Hono validator middleware from an ArkType schema.
 * Coerces strings → numbers for numeric fields before validation.
 */
export function arktypeValidator(
	target: "json" | "query" | "header" | "param",
	schema: ArkType,
): MiddlewareHandler {
	return validator(target, (value, c) => {
		const data = coerceNumbers(
			schema,
			(value ?? {}) as Record<string, unknown>,
		);
		const result = schema(data);
		if (result instanceof ArkErrors) {
			return c.json({ error: result.summary }, 400);
		}
		return result;
	});
}

// --- OpenAPIHono ---

export class OpenAPIHono<
	E extends Env = Env,
	S extends Schema = Schema,
	BasePath extends string = "/",
> extends Hono<E, S, BasePath> {
	private _routes: StoredRoute[] = [];
	private _components: ComponentRegistry = {
		schemas: new Map<string, JsonSchema>(),
		securitySchemes: new Map<string, AuthScheme>(),
	};

	/** Register an API endpoint with ArkType validation and OpenAPI metadata. */
	openapi(config: RouteConfig, handler: RouteHandler): void {
		const method = normalizeMethod(config.method);
		const oapiPath = toOapiPath(config.path);
		const paramNames = [...config.path.matchAll(/:(\w+)/g)].map((m) => m[1]!);

		// Build middlewares from request schemas
		const mws: MiddlewareHandler[] = [];

		if (config.request?.params) {
			mws.push(arktypeValidator("param", config.request.params));
		} else if (paramNames.length > 0) {
			// Auto-generate params schema from path tokens
			const paramsDef: Record<string, string> = {};
			for (const name of paramNames) paramsDef[name] = "string";
			mws.push(arktypeValidator("param", type(paramsDef)));
		}

		if (config.request?.query)
			mws.push(arktypeValidator("query", config.request.query));
		if (config.request?.headers)
			mws.push(arktypeValidator("header", config.request.headers));
		if (config.request?.body)
			mws.push(arktypeValidator("json", config.request.body));

		// User-defined middlewares
		if (config.middleware) mws.push(...config.middleware);

		// Store route for spec generation
		this._routes.push({ method, oapiPath, config, handler });

		// Register the Hono route
		// ponytail: Hono's .on() has 5+ overloads; typed spread dispatch not worth the complexity
		const dispatch = this.on.bind(this) as unknown as (
			method: string,
			path: string,
			...handlers: MiddlewareHandler[]
		) => void;
		dispatch(method, config.path, ...mws, async (c: Context) => {
			// Hono's valid() is typed via Input generics that don't apply to our dynamic
			// validator registration; narrow c.req to a simple callable signature.
			// Cast is on c.req (not extracting valid) to preserve `this` binding.
			const creq = c.req as unknown as {
				valid(target: string): Record<string, unknown>;
			};
			const req: Record<string, unknown> = {};

			// Flatten path params to top level (Encore-style: handler({ name }) not handler({ params: { name } }))
			if (paramNames.length > 0) {
				Object.assign(req, creq.valid("param"));
			}
			if (config.request?.body) req.body = creq.valid("json");
			if (config.request?.query) req.query = creq.valid("query");
			if (config.request?.headers) req.headers = creq.valid("header");

			const result = await handler(req);

			// Determine status: explicit status, first 2xx/3xx in declared responses, or 200
			const successCode =
				config.status?.toString() ??
				Object.keys(config.responses ?? {}).find(
					(k) => k.startsWith("2") || k.startsWith("3"),
				) ??
				"200";

			if (result === null) {
				return c.body(null, Number(successCode) as StatusCode);
			}
			return c.json(result, Number(successCode) as ContentfulStatusCode);
		});
	}

	/** Emit an OpenAPI 3.0 JSON endpoint. */
	doc(
		url: string,
		config: { openapi?: string; info: { title: string; version: string } },
	): void {
		this.get(url, (c) => {
			return c.json(this._buildSpec(config));
		});
	}

	/** Access to the component registry. */
	get openAPIRegistry(): OpenAPIRegistryAccessor {
		const components = this._components;
		return {
			registerComponent: <K extends ComponentKind>(
				type: K,
				name: string,
				value: ComponentValue<K>,
			): void => {
				// ponytail: correlated union — TypeScript can't verify K ↔ value relation
				components[type].set(name, value as never);
			},
		};
	}

	// --- Spec building ---

	private _buildSpec(config: {
		openapi?: string;
		info: { title: string; version: string };
	}): OpenAPISpec {
		const paths: Record<string, Record<string, OpenAPIOperation>> = {};

		for (const route of this._routes) {
			const pathItem = paths[route.oapiPath] ?? {};
			const op: OpenAPIOperation = {
				operationId: `${route.method}_${route.oapiPath.replace(/[{}]/g, "").replace(/\//g, "_")}`,
				responses: this._buildResponses(route.config),
			};

			if (route.config.tags) op.tags = route.config.tags;
			if (route.config.summary) op.summary = route.config.summary;
			if (route.config.description) op.description = route.config.description;
			if (route.config.security) op.security = route.config.security;

			// Parameters (path + query + header)
			const params: OpenAPIParameter[] = [];
			if (route.config.request?.params) {
				this._addObjectParams(params, route.config.request.params, "path");
			}
			if (route.config.request?.query) {
				this._addObjectParams(params, route.config.request.query, "query");
			}
			if (route.config.request?.headers) {
				this._addObjectParams(params, route.config.request.headers, "header");
			}
			if (params.length > 0) op.parameters = params;

			// Request body
			if (route.config.request?.body) {
				op.requestBody = {
					required: true,
					content: {
						"application/json": {
							schema: this._schemaToOA(route.config.request.body),
						},
					},
				};
			}

			pathItem[route.method] = op;
			paths[route.oapiPath] = pathItem;
		}

		const spec: OpenAPISpec = {
			openapi: config.openapi ?? "3.0.0",
			info: config.info,
			paths,
			components: {},
		};

		// Register named security schemes
		if (this._components.securitySchemes.size > 0) {
			spec.components.securitySchemes = Object.fromEntries(
				this._components.securitySchemes,
			);
		}

		// Register named schemas
		if (this._components.schemas.size > 0) {
			spec.components.schemas = Object.fromEntries(this._components.schemas);
		}

		return spec;
	}

	private _buildResponses(
		config: RouteConfig,
	): Record<string, OpenAPIResponse> {
		const responses: Record<string, OpenAPIResponse> = {};

		if (config.responses) {
			for (const [code, schema] of Object.entries(config.responses)) {
				if (code === "204") {
					responses[code] = { description: "No Content" };
				} else {
					responses[code] = {
						content: {
							"application/json": { schema: this._schemaToOA(schema) },
						},
					};
				}
			}
		}

		// Determine success code: explicit status, first 2xx/3xx in declared responses, or 200
		const successCode =
			config.status?.toString() ??
			Object.keys(responses).find(
				(k) => k.startsWith("2") || k.startsWith("3"),
			) ??
			"200";
		if (!responses[successCode]) {
			responses[successCode] = { description: "Success" };
		}

		// Default 500 (if not already declared by the user)
		if (!responses["500"]) {
			const errSchema = type({ error: "string" });
			responses["500"] = {
				content: {
					"application/json": { schema: this._schemaToOA(errSchema) },
				},
			};
		}

		return responses;
	}

	/**
	 * Convert an ArkType schema → OpenAPI Schema Object.
	 * Uses ArkType's toJsonSchema(), strips $schema, hoists $defs to components.
	 */
	private _schemaToOA(schema: ArkType): JsonSchema {
		const json = schema.toJsonSchema();
		// Remove JSON Schema draft meta-schema (not valid in OpenAPI 3.0)
		delete json.$schema;

		// Hoist $defs to components/schemas (registered inline)
		if (json.$defs) {
			for (const [name, def] of Object.entries(json.$defs)) {
				if (!this._components.schemas.has(name)) {
					this._components.schemas.set(name, def);
				}
			}
			delete json.$defs;
		}

		// ponytail: $defs are emitted inline for now; $ref rewriting is a follow-up
		return json;
	}

	/** Walk an ArkType object schema and produce OpenAPI parameter objects. */
	private _addObjectParams(
		params: OpenAPIParameter[],
		schema: ArkType,
		inLocation: "path" | "query" | "header",
	): void {
		const json = schema.toJsonSchema();
		if (!isObjectSchema(json) || !json.properties) return;

		const required = new Set<string>(json.required ?? []);
		for (const [name, prop] of Object.entries(json.properties)) {
			if (!prop) continue;
			const param: OpenAPIParameter = {
				name,
				in: inLocation,
				required: required.has(name),
				schema: prop,
			};
			const desc = (prop as { description?: string }).description;
			if (desc) param.description = desc;
			params.push(param);
		}
	}
}

/** Create a route config (type-check helper). */
export function createRoute(config: RouteConfig): RouteConfig {
	return config;
}
