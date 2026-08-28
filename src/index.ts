// peta-hono public API barrel

export type { AuthScheme, HttpMethod, Method, SecurityScheme } from "./api.js";
// --- High-level (primary API) ---
export { APIError, createApi, errors, fail, httpErrors } from "./api.js";
export type {
  AuthStrategySpec,
  CookieSerializeOptions,
  FlowApp,
  IssuedTokens,
  JwtStrategy,
  JwtStrategyOptions,
  OAuthStrategy,
  OAuthStrategyOptions,
  OAuthSuccessEvent,
  RefreshTokenRecord,
  RefreshTokenStore,
  SessionStore,
  SessionStrategy,
  SessionStrategyOptions,
} from "./auth/index.js";
// --- Built-in auth strategies (store adapters + strategy types) ---
export {
  createMemoryRefreshTokenStore,
  createMemorySessionStore,
} from "./auth/index.js";
export type { ArkType, OAuth2Flows, RouteConfig } from "./openapi.js";
// --- Low-level (advanced use) ---
export { arktypeValidator, normalizeMethod, OpenAPIHono } from "./openapi.js";
