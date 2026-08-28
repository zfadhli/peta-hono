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
/** In-memory session store — dev/tests/single-replica. */
export function createMemorySessionStore() {
    const sessions = new Map();
    return {
        async get(sid) {
            const s = sessions.get(sid);
            if (!s)
                return null;
            if (s.expiresAt !== null && s.expiresAt < Date.now()) {
                sessions.delete(sid);
                return null;
            }
            return { ...s.data };
        },
        async set(sid, data, ttlSeconds) {
            const expiresAt = ttlSeconds ? Date.now() + ttlSeconds * 1000 : null;
            sessions.set(sid, { data: { ...data }, expiresAt });
        },
        async delete(sid) {
            sessions.delete(sid);
        },
    };
}
/** In-memory refresh-token store — dev/tests/single-replica. */
export function createMemoryRefreshTokenStore() {
    const tokens = new Map();
    return {
        async get(tokenHash) {
            return tokens.get(tokenHash) ?? null;
        },
        async save(record) {
            tokens.set(record.tokenHash, { ...record });
        },
        async delete(tokenHash) {
            tokens.delete(tokenHash);
        },
        async getFamily(familyId) {
            return [...tokens.values()].filter((t) => t.familyId === familyId);
        },
        async deleteFamily(familyId) {
            for (const t of [...tokens.values()])
                if (t.familyId === familyId)
                    tokens.delete(t.tokenHash);
        },
    };
}
//# sourceMappingURL=store.js.map