import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
/** Single error policy — shared by OpenAPIHono and createApi (via createErrorHandler). */
export type ErrorHandler = (err: Error, c: Context) => Response | Promise<Response>;
export declare function createErrorHandler(debug?: boolean): ErrorHandler;
/**
 * Typed HTTP error. Thrown from handlers (and the validator) to route errors
 * through `app.onError` — the single chokepoint for all error responses.
 */
export declare class APIError extends Error {
    status: ContentfulStatusCode;
    constructor(status: ContentfulStatusCode, message: string);
}
export declare const fail: {
    badRequest: (msg?: string) => APIError;
    unauthorized: (msg?: string) => APIError;
    forbidden: (msg?: string) => APIError;
    notFound: (msg?: string) => APIError;
    conflict: (msg?: string) => APIError;
    unprocessableEntity: (msg?: string) => APIError;
    tooManyRequests: (msg?: string) => APIError;
    internalServerError: (msg?: string) => APIError;
    badGateway: (msg?: string) => APIError;
    serviceUnavailable: (msg?: string) => APIError;
    gatewayTimeout: (msg?: string) => APIError;
};
/**
 * @deprecated Use `fail` instead — `errors` is a pure synonym kept for callers
 * who prefer the noun form. The single canonical helper is `fail`.
 */
export declare const errors: {
    badRequest: (msg?: string) => APIError;
    unauthorized: (msg?: string) => APIError;
    forbidden: (msg?: string) => APIError;
    notFound: (msg?: string) => APIError;
    conflict: (msg?: string) => APIError;
    unprocessableEntity: (msg?: string) => APIError;
    tooManyRequests: (msg?: string) => APIError;
    internalServerError: (msg?: string) => APIError;
    badGateway: (msg?: string) => APIError;
    serviceUnavailable: (msg?: string) => APIError;
    gatewayTimeout: (msg?: string) => APIError;
};
/**
 * @deprecated Use `fail` instead — `httpErrors` is a pure synonym kept for
 * backward compatibility. The single canonical helper is `fail`.
 */
export declare const httpErrors: {
    badRequest: (msg?: string) => APIError;
    unauthorized: (msg?: string) => APIError;
    forbidden: (msg?: string) => APIError;
    notFound: (msg?: string) => APIError;
    conflict: (msg?: string) => APIError;
    unprocessableEntity: (msg?: string) => APIError;
    tooManyRequests: (msg?: string) => APIError;
    internalServerError: (msg?: string) => APIError;
    badGateway: (msg?: string) => APIError;
    serviceUnavailable: (msg?: string) => APIError;
    gatewayTimeout: (msg?: string) => APIError;
};
//# sourceMappingURL=errors.d.ts.map