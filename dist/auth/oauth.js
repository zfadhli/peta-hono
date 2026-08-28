import { APIError } from "../openapi.js";
import { cookieNameFor, expiredCookie, parseCookies, serializeCookie, } from "./cookie.js";
import { base64urlUtf8, hmacSign, hmacVerify, randomToken, sha256Base64url, utf8FromBase64url, } from "./crypto.js";
const GOOGLE_AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v3/userinfo";
/**
 * Build a Google OAuth strategy handle.
 */
export function buildOAuthStrategy(name, opts) {
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
    const stateCookieOpts = {
        maxAge: stateTtlSeconds,
        path: stateCookieOptsRaw.path ?? "/",
        httpOnly: stateCookieOptsRaw.httpOnly ?? true,
        secure: stateCookieOptsRaw.secure ?? true,
        sameSite: stateCookieOptsRaw.sameSite ?? "Lax",
        hostPrefix: stateHostPrefix,
    };
    async function signStatePayload(payload) {
        const data = base64urlUtf8(JSON.stringify(payload));
        const sig = await hmacSign(stateSecret, data);
        return `${data}.${sig}`;
    }
    async function readStatePayload(c) {
        const raw = parseCookies(c.req.header("Cookie"))[resolvedStateCookieName];
        if (!raw)
            return null;
        const dot = raw.lastIndexOf(".");
        if (dot === -1)
            return null;
        const data = raw.slice(0, dot);
        const sig = raw.slice(dot + 1);
        if (!(await hmacVerify(stateSecret, data, sig)))
            return null;
        try {
            const parsed = JSON.parse(utf8FromBase64url(data));
            if (parsed &&
                typeof parsed === "object" &&
                typeof parsed.state === "string") {
                return parsed;
            }
            return null;
        }
        catch {
            return null;
        }
    }
    function buildAuthorizeUrl(state, codeChallenge) {
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
    const scheme = {
        type: "oauth2",
        flows: {
            authorizationCode: {
                authorizationUrl: authorizationURL,
                tokenUrl: tokenURL,
                scopes: Object.fromEntries(scopes.map((s) => [s, s])),
            },
        },
    };
    async function doExchangeCode(code, codeVerifier) {
        const body = new URLSearchParams();
        body.set("code", code);
        body.set("client_id", clientId);
        if (clientSecret)
            body.set("client_secret", clientSecret);
        body.set("redirect_uri", redirectUri);
        body.set("grant_type", "authorization_code");
        if (codeVerifier)
            body.set("code_verifier", codeVerifier);
        const res = await fetchFn(tokenURL, {
            method: "POST",
            headers: { "content-type": "application/x-www-form-urlencoded" },
            body: body.toString(),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || json.error) {
            const msg = typeof json.error_description === "string"
                ? json.error_description
                : "OAuth token exchange failed";
            throw new APIError(400, msg);
        }
        return json;
    }
    async function doGetUser(tokens) {
        const accessToken = tokens.access_token;
        if (typeof accessToken !== "string")
            throw new APIError(400, "Missing access_token");
        const res = await fetchFn(userInfoURL, {
            headers: { authorization: `Bearer ${accessToken}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok)
            throw new APIError(400, "Failed to fetch user info");
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
                const stateCookie = serializeCookie(stateCookieName, await signStatePayload({ state, verifier }), stateCookieOpts);
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
                    const event = {
                        user,
                        tokens,
                        request: c.req.raw,
                        c,
                    };
                    const result = await onSuccess(event);
                    attachClearStateCookie(result);
                    return result;
                }
                catch (err) {
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
    function attachClearStateCookie(res) {
        res.headers.append("Set-Cookie", expiredCookie(stateCookieName, stateCookieOpts));
    }
}
//# sourceMappingURL=oauth.js.map