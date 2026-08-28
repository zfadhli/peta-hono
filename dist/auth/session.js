import { APIError } from "../openapi.js";
import { expiredCookie, parseCookies, serializeCookie } from "./cookie.js";
import { hmacSign, hmacVerify, randomToken, timingSafeEqual } from "./crypto.js";
import { createMemorySessionStore } from "./store.js";
const CSRF_FIELD = "_csrf";
/**
 * Build a session strategy handle.
 */
export function buildSessionStrategy(name, opts) {
    const secret = opts.secret;
    const cookieName = opts.cookieName ?? "sid";
    const ttlSeconds = opts.ttlSeconds ?? 604800;
    const httpOnly = opts.httpOnly ?? true;
    const sameSite = opts.sameSite ?? "Lax";
    const secure = opts.secure ?? false;
    const path = opts.path ?? "/";
    const csrf = opts.csrf ?? false;
    const store = opts.store ?? createMemorySessionStore();
    const cookieBase = { maxAge: ttlSeconds, path, httpOnly, secure, sameSite };
    async function readSid(c) {
        const cookies = parseCookies(c.req.header("Cookie"));
        const raw = cookies[cookieName];
        if (!raw)
            return null;
        const dot = raw.lastIndexOf(".");
        if (dot === -1)
            return null;
        const sid = raw.slice(0, dot);
        const sig = raw.slice(dot + 1);
        if (!(await hmacVerify(secret, sid, sig)))
            return null;
        return sid;
    }
    async function getSession(c) {
        const sid = await readSid(c);
        if (!sid)
            return null;
        return store.get(sid);
    }
    async function verifyCsrfToken(c, data) {
        if (csrf === false)
            return true;
        const expected = data[CSRF_FIELD];
        if (typeof expected !== "string")
            return false;
        const provided = c.req.header("x-csrf-token");
        if (!provided)
            return false;
        return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(provided));
    }
    return {
        name,
        scheme: { type: "apiKey", in: "cookie", name: cookieName },
        async middleware(c) {
            const sid = await readSid(c);
            if (!sid)
                throw new APIError(401, "Unauthorized");
            const data = await store.get(sid);
            if (!data)
                throw new APIError(401, "Session expired");
            if (isMutating(c.req.method) && !(await verifyCsrfToken(c, data))) {
                throw new APIError(403, "CSRF token invalid");
            }
            return data;
        },
        async create(c, data) {
            const sid = randomToken(32);
            const signature = await hmacSign(secret, sid);
            // When CSRF is enforced, seed a token so the session always has a `_csrf`
            // to validate against. The client fetches it via generateCsrf()/a GET
            // endpoint before a mutating request.
            const sessionData = csrf ? { ...data, [CSRF_FIELD]: randomToken(24) } : { ...data };
            await store.set(sid, sessionData, ttlSeconds);
            const cookie = serializeCookie(cookieName, `${sid}.${signature}`, cookieBase);
            c.header("Set-Cookie", cookie);
            return cookie;
        },
        async destroy(c) {
            const sid = await readSid(c);
            if (sid)
                await store.delete(sid);
            const cookie = expiredCookie(cookieName, { path, httpOnly, secure, sameSite });
            c.header("Set-Cookie", cookie);
            return cookie;
        },
        async get(c) {
            return getSession(c);
        },
        async generateCsrf(c) {
            const sid = await readSid(c);
            if (!sid)
                throw new APIError(401, "No active session");
            const data = (await store.get(sid)) ?? {};
            const token = randomToken(24);
            await store.set(sid, { ...data, [CSRF_FIELD]: token }, ttlSeconds);
            return token;
        },
        async verifyCsrf(c, token) {
            const data = await getSession(c);
            if (!data)
                return false;
            const expected = data[CSRF_FIELD];
            if (typeof expected !== "string")
                return false;
            return timingSafeEqual(new TextEncoder().encode(expected), new TextEncoder().encode(token));
        },
    };
}
function isMutating(method) {
    return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}
//# sourceMappingURL=session.js.map