import type { Context } from "hono";
import { APIError } from "../errors.js";
import type { SecurityScheme } from "../openapi.js";
import {
  type CookieSerializeOptions,
  cookieNameFor,
  expiredCookie,
  parseCookies,
  serializeCookie,
} from "./cookie.js";
import {
  base64urlUtf8,
  hmacSign,
  hmacVerify,
  randomToken,
  sha256Base64url,
  utf8FromBase64url,
} from "./crypto.js";

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

const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";

interface StatePayload {
  state: string;
  verifier?: string;
}

/**
 * Build a Google OAuth strategy handle.
 */
export function buildOAuthStrategy(name: string, opts: OAuthStrategyOptions): OAuthStrategy {
  const provider = opts.provider ?? "google";
  const clientId = opts.clientId;
  const clientSecret = opts.clientSecret;
  const redirectUri = opts.redirectUri;
  const scopes = opts.scopes ?? ["openid", "email", "profile"];
  const authorizationURL = opts.authorizationURL ?? GOOGLE_AUTHORIZE;
  const tokenURL = opts.tokenURL ?? GOOGLE_TOKEN;
  const userInfoURL = opts.userInfoURL ?? GOOGLE_USERINFO;
  const stateSecret = opts.stateSecret ?? clientSecret ?? randomToken(32);
  const stateCookieName = opts.stateCookieName ?? "oauth_state";
  const stateTtlSeconds = opts.stateTtlSeconds ?? 600;
  // PKCE on by default — confidential (clientSecret) clients get it too.
  const usePKCE = opts.usePKCE ?? true;
  const path = opts.path ?? `/auth/${provider}`;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const onSuccess = opts.onSuccess;
  const onError = opts.onError;

  // Hardened state cookie: Secure by default; `__Host-` prefix is opt-in.
  const stateCookieOptsRaw = opts.stateCookie ?? {};
  const stateHostPrefix = stateCookieOptsRaw.hostPrefix ?? false;
  const resolvedStateCookieName = cookieNameFor(stateCookieName, stateHostPrefix);
  const stateCookieOpts: CookieSerializeOptions = {
    maxAge: stateTtlSeconds,
    path: stateCookieOptsRaw.path ?? "/",
    httpOnly: stateCookieOptsRaw.httpOnly ?? true,
    secure: stateCookieOptsRaw.secure ?? true,
    sameSite: stateCookieOptsRaw.sameSite ?? "Lax",
    hostPrefix: stateHostPrefix,
  };

  async function signStatePayload(payload: StatePayload): Promise<string> {
    const data = base64urlUtf8(JSON.stringify(payload));
    const sig = await hmacSign(stateSecret, data);
    return `${data}.${sig}`;
  }

  async function readStatePayload(c: Context): Promise<StatePayload | null> {
    const raw = parseCookies(c.req.header("Cookie"))[resolvedStateCookieName];
    if (!raw) return null;
    const dot = raw.lastIndexOf(".");
    if (dot === -1) return null;
    const data = raw.slice(0, dot);
    const sig = raw.slice(dot + 1);
    if (!(await hmacVerify(stateSecret, data, sig))) return null;
    try {
      const parsed = JSON.parse(utf8FromBase64url(data));
      if (
        parsed &&
        typeof parsed === "object" &&
        typeof (parsed as StatePayload).state === "string"
      ) {
        return parsed as StatePayload;
      }
      return null;
    } catch {
      return null;
    }
  }

  function buildAuthorizeUrl(state: string, codeChallenge?: string): string {
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: scopes.join(" "),
      state,
      access_type: "offline",
    });
    if (codeChallenge) {
      params.set("code_challenge", codeChallenge);
      params.set("code_challenge_method", "S256");
    }
    return `${authorizationURL}?${params.toString()}`;
  }

  const scheme: SecurityScheme = {
    type: "oauth2",

    flows: {
      authorizationCode: {
        authorizationUrl: authorizationURL,
        tokenUrl: tokenURL,
        scopes: Object.fromEntries(scopes.map((s) => [s, s])),
      },
    },
  };

  async function doExchangeCode(
    code: string,
    codeVerifier?: string,
  ): Promise<Record<string, unknown>> {
    const body = new URLSearchParams();
    body.set("code", code);
    body.set("client_id", clientId);
    if (clientSecret) body.set("client_secret", clientSecret);
    body.set("redirect_uri", redirectUri);
    body.set("grant_type", "authorization_code");
    if (codeVerifier) body.set("code_verifier", codeVerifier);
    const res = await fetchFn(tokenURL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const json: Record<string, unknown> = await res.json().catch(() => ({}));
    if (!res.ok || json.error) {
      const msg =
        typeof json.error_description === "string"
          ? json.error_description
          : "OAuth token exchange failed";
      throw new APIError(400, msg);
    }
    return json;
  }

  async function doGetUser(tokens: Record<string, unknown>): Promise<Record<string, unknown>> {
    const accessToken = tokens.access_token;
    if (typeof accessToken !== "string") throw new APIError(400, "Missing access_token");
    const res = await fetchFn(userInfoURL, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    const json: Record<string, unknown> = await res.json().catch(() => ({}));
    if (!res.ok) throw new APIError(400, "Failed to fetch user info");
    return json;
  }

  return {
    name,
    scheme,
    authorizeUrl(state, codeChallenge) {
      return buildAuthorizeUrl(state, codeChallenge);
    },
    exchangeCode: doExchangeCode,
    getUser: doGetUser,
    mount(app) {
      app.get(`${path}/start`, async (_c) => {
        const state = randomToken(32);
        const verifier = usePKCE ? randomToken(48) : undefined;
        const challenge = verifier ? await sha256Base64url(verifier) : undefined;
        const stateCookie = serializeCookie(
          stateCookieName,
          await signStatePayload({ state, verifier }),
          stateCookieOpts,
        );
        // 302 to the provider with the state cookie attached to the returned
        // Response (c.redirect() would otherwise drop a c.header() cookie).
        return new Response(null, {
          status: 302,
          headers: { location: buildAuthorizeUrl(state, challenge), "set-cookie": stateCookie },
        });
      });

      app.get(`${path}/callback`, async (c) => {
        try {
          const code = c.req.query("code");
          const state = c.req.query("state");
          // A provider denial (`?error=access_denied`) is a deliberate user
          // action — surface it via onError rather than "Invalid OAuth state".
          const error = c.req.query("error");
          if (error) {
            const desc = c.req.query("error_description");
            throw new APIError(400, `OAuth provider error: ${error}${desc ? `: ${desc}` : ""}`);
          }
          const saved = await readStatePayload(c);
          if (!code || !state || !saved || saved.state !== state) {
            throw new APIError(400, "Invalid OAuth state");
          }
          const tokens = await doExchangeCode(code, saved.verifier);
          const user = await doGetUser(tokens);
          const event: OAuthSuccessEvent = {
            user,
            tokens,
            request: c.req.raw,
            c,
          };
          const result = await onSuccess(event);
          attachClearStateCookie(result);
          return result;
        } catch (err) {
          if (onError) {
            const result = await onError(err instanceof Error ? err : new Error(String(err)), c);
            attachClearStateCookie(result);
            return result;
          }
          const e = err instanceof APIError ? err : new APIError(400, "OAuth flow failed");
          const res = c.json({ error: e.message }, e.status);
          attachClearStateCookie(res);
          return res;
        }
      });
    },
  };

  function attachClearStateCookie(res: Response): void {
    res.headers.append("Set-Cookie", expiredCookie(stateCookieName, stateCookieOpts));
  }
}
