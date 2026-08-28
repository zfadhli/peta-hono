/** Minimal RFC-6265 cookie parsing / serialization — no dependency. */
/** Split a raw `Cookie` header into `{ name: value }`. */
export function parseCookies(header) {
    const out = {};
    if (!header)
        return out;
    for (const part of header.split(";")) {
        const eq = part.indexOf("=");
        if (eq === -1)
            continue;
        const name = part.slice(0, eq).trim();
        let value = part.slice(eq + 1).trim();
        if (value.startsWith('"') && value.endsWith('"'))
            value = value.slice(1, -1);
        if (name)
            out[name] = decodeURIComponent(value);
    }
    return out;
}
/** Serialize a `Set-Cookie` value. */
export function serializeCookie(name, value, opts = {}) {
    let s = `${name}=${encodeURIComponent(value)}`;
    if (opts.maxAge !== undefined)
        s += `; Max-Age=${Math.floor(opts.maxAge)}`;
    if (opts.path)
        s += `; Path=${opts.path}`;
    if (opts.httpOnly)
        s += "; HttpOnly";
    if (opts.secure)
        s += "; Secure";
    if (opts.sameSite)
        s += `; SameSite=${opts.sameSite}`;
    return s;
}
/** A cookie that has expired (used to clear a client stored cookie). */
export function expiredCookie(name, opts = {}) {
    return serializeCookie(name, "", { ...opts, maxAge: 0 });
}
//# sourceMappingURL=cookie.js.map