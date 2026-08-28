/** Minimal RFC-6265 cookie parsing / serialization — no dependency. */
export interface CookieSerializeOptions {
    maxAge?: number;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
}
/** Split a raw `Cookie` header into `{ name: value }`. */
export declare function parseCookies(header: string | null | undefined): Record<string, string>;
/** Serialize a `Set-Cookie` value. */
export declare function serializeCookie(name: string, value: string, opts?: CookieSerializeOptions): string;
/** A cookie that has expired (used to clear a client stored cookie). */
export declare function expiredCookie(name: string, opts?: CookieSerializeOptions): string;
//# sourceMappingURL=cookie.d.ts.map