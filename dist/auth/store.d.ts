/**
 * Pluggable storage abstractions for the built-in auth strategies.
 *
 * The strategies accept any object implementing these interfaces, so users can
 * back sessions/refresh tokens with a database, Redis, KV, etc. Two in-memory
 * adapters are provided for development, tests, and single-replica deploys.
 *
 * ponytail: in-memory stores are process-local and lost on restart — a real
 * deployment should supply a durable store (Postgres/Redis/KV). No TTL sweep
 * runs in the background; expired records are lazily pruned on read.
 */
/** A session is an opaque record keyed by a session id. */
export interface SessionStore {
    /** Look up a session. Returns `null` when missing or expired. */
    get(sid: string): Promise<Record<string, unknown> | null>;
    /** Store a session. `ttlSeconds` (optional) sets an absolute expiry. */
    set(sid: string, data: Record<string, unknown>, ttlSeconds?: number): Promise<void>;
    /** Delete a session by id. */
    delete(sid: string): Promise<void>;
}
/** In-memory session store — dev/tests/single-replica. */
export declare function createMemorySessionStore(): SessionStore;
/** A persisted refresh-token record. `used: true` marks a rotated (single-use) token. */
export interface RefreshTokenRecord {
    /** SHA-256 of the opaque token — the store never holds the raw token. */
    tokenHash: string;
    /** Subject (user id) the refresh token is bound to. */
    sub: string;
    /** Groups tokens issued together for reuse-detection (all revoked on reuse). */
    familyId: string;
    /** Absolute expiry in ms since epoch. */
    expiresAt: number;
    /** True once the token has been rotated (single-use); replay ⇒ reuse attack. */
    used: boolean;
}
/** Storage for refresh tokens, keyed by token hash. */
export interface RefreshTokenStore {
    get(tokenHash: string): Promise<RefreshTokenRecord | null>;
    save(record: RefreshTokenRecord): Promise<void>;
    delete(tokenHash: string): Promise<void>;
    /** All tokens in a family (for reuse-revocation). */
    getFamily(familyId: string): Promise<RefreshTokenRecord[]>;
    /** Revoke every token in a family. */
    deleteFamily(familyId: string): Promise<void>;
}
/** In-memory refresh-token store — dev/tests/single-replica. */
export declare function createMemoryRefreshTokenStore(): RefreshTokenStore;
//# sourceMappingURL=store.d.ts.map