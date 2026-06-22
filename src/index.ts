// peta-hono public API barrel

export type { AuthScheme } from "./api.js";
// --- High-level (primary API) ---
export { APIError, createApi, fail } from "./api.js";
export type { ArkType, RouteConfig } from "./openapi.js";
// --- Low-level (advanced use) ---
export { arktypeValidator, createRoute, OpenAPIHono } from "./openapi.js";
