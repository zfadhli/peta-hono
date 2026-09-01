import type { Context } from "hono";
import type { SecurityScheme } from "../openapi.js";
/**
 * Built-in Google OAuth2 authorization-code strategy (+ optional PKCE).
 *
 * Registers two flow routes (default `{path}/start` and `{path}/callback`):
 *  - `start` generates a `state` (CSRF) and, when PKCE is enabled, a
 *    `code_verifier`, stores both in a short-lived signed HttpOnly cookie, and
 *    redirects to Google's authorization endpoint.
 *  - `callback` verifies the `state` against the signed cookie, exchanges the
 *    `code` for tokens, fetches the user profile, then invokes the user's
 *    `onSuccess` (which is where you issue a JWT / create a session).
 *
 * The strategy emits an OpenAPI `oauth2` security scheme for
 * `components.securitySchemes`; it is a *flow*, not a request guard — protect
 * downstream routes with a `jwt` or `session` strategy's `{ auth: name }`.
 *
 * PKCE is enabled by default (even for confidential clients with a
 * `clientSecret`). The `code_verifier` is never leaked: it travels only in the
 * signed, HttpOnly, short-lived state cookie (now `Secure` by default). A
 * provider `error` query param (user denies consent) is routed to `onError`.
 *
 * ponytail: `onSuccess` is the only integration point (no automatic JWT/session
 * issuance wired in). Token endpoint / userinfo are plain `fetch` calls —
 * override `tokenURL`/`userInfoURL`/`fetchFn` for tests or a proxy.
 */
/** Cookie attribute block for the OAuth state cookie (defaults to `Secure`). */
export interface OAuthStateCookieOptions {
    /** `Secure` flag. Default `true`. */
    secure?: boolean;
    /** Rename to `__Host-<name>` and force `Secure` + `Path=/` + no `Domain`. */
    hostPrefix?: boolean;
    /** Cookie path (default `"/"`). */
    path?: string;
    /** `HttpOnly` flag (default true). */
    httpOnly?: boolean;
    /** `SameSite` attribute (default `"Lax"`). */
    sameSite?: "Lax" | "Strict" | "None";
}
export interface OAuthStrategyOptions {
    provider?: "google";
    clientId: string;
    /** Keep confidential — never expose in a browser bundle. */
    clientSecret?: string;
    redirectUri: string;
    /** Defaults to `["openid", "email", "profile"]`. */
    scopes?: string[];
    authorizationURL?: string;
    tokenURL?: string;
    userInfoURL?: string;
    /** Secret signing the state cookie. Defaults to `clientSecret` or ephemeral. */
    stateSecret?: string;
    stateCookieName?: string;
    stateTtlSeconds?: number;
    /** PKCE (default `true`). */
    usePKCE?: boolean;
    /** State-cookie attribute block (defaults to `secure: true`, host prefix off). */
    stateCookie?: OAuthStateCookieOptions;
    /** Base path for the flow routes (default `"/auth/google"`). */
    path?: string;
    /** Override `fetch` (tests / proxy). Defaults to `globalThis.fetch`. */
    fetchFn?: typeof fetch;
    /** Called on a successful callback. Return your response (issue JWT/session). */
    onSuccess: (event: OAuthSuccessEvent) => Response | Promise<Response>;
    /** Optional callback-error handler. Defaults to a JSON 400. */
    onError?: (error: Error, c: Context) => Response | Promise<Response>;
}
export interface OAuthSuccessEvent {
    /** Normalized provider user profile (Google: `sub`, `email`, `name`, ...). */
    user: Record<string, unknown>;
    /** Raw token response (`access_token`, `id_token`, `expires_in`, ...). */
    tokens: Record<string, unknown>;
    /** The raw request (useful for redirects / cookies). */
    request: Request;
    /** Hono context (useful to set cookies, call `jwt.issue`, etc.). */
    c: Context;
}
export interface OAuthStrategy {
    name: string;
    /** OpenAPI `oauth2` security scheme (authorizationCode flow). */
    scheme: SecurityScheme;
    /** Build a provider authorization URL for a given state (+ PKCE challenge). */
    authorizeUrl(state: string, codeChallenge?: string): string;
    /** Exchange an authorization code for tokens. */
    exchangeCode(code: string, codeVerifier?: string): Promise<Record<string, unknown>>;
    /** Fetch the provider user profile for an access token. */
    getUser(tokens: Record<string, unknown>): Promise<Record<string, unknown>>;
    /** Register the `/start` + `/callback` flow routes on the app. */
    mount(app: FlowApp): void;
}
/** Minimal app surface needed to mount the flow routes (avoids `OpenAPIHono` generic variance). */
export interface FlowApp {
    get(path: string, handler: (c: Context) => Response | Promise<Response>): unknown;
    post(path: string, handler: (c: Context) => Response | Promise<Response>): unknown;
}
/**
 * Build a Google OAuth strategy handle.
 */
export declare function buildOAuthStrategy(name: string, opts: OAuthStrategyOptions): OAuthStrategy;
//# sourceMappingURL=oauth.d.ts.map