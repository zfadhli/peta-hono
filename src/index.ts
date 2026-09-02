// peta-hono public API barrel

export type { AuthScheme, HttpMethod, Method, SecurityScheme } from "./api.js";
// --- High-level (primary API) ---
export { APIError, createApi, errors, fail, httpErrors } from "./api.js";
export type {
  AsymmetricJwtAlgorithm,
  AuthStrategySpec,
  CookieSerializeOptions,
  CookieTransport,
  CookieTransportOptions,
  FlowApp,
  GeneratedJwtKey,
  GenerateKeyOptions,
  IssuedTokens,
  JwtKey,
  JwtStrategy,
  JwtStrategyOptions,
  OAuthStateCookieOptions,
  OAuthStrategy,
  OAuthStrategyOptions,
  OAuthSuccessEvent,
  RefreshTokenRecord,
  RefreshTokenStore,
  RefreshTransportOptions,
  SessionCookieOptions,
  SessionCsrf,
  SessionStore,
  SessionStrategy,
  SessionStrategyOptions,
} from "./auth/index.js";
// --- Built-in auth strategies (store adapters + strategy types) ---
export {
  cookieNameFor,
  createCookieTransport,
  createMemoryRefreshTokenStore,
  createMemorySessionStore,
  generateKey,
} from "./auth/index.js";
export type { ArkType, OAuth2Flows, RouteConfig, RouteResolver } from "./openapi.js";
// --- Low-level (advanced use) ---
export { arktypeValidator, normalizeMethod, OpenAPIHono } from "./openapi.js";
