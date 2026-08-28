/**
 * Opt-in password hashing (`peta-hono/password`).
 *
 * Backed by `@noble/hashes` `scrypt` (audited, zero-dependency, portable). The
 * hash is self-describing — the work factors, salt, and derived key are all
 * encoded in the returned string, so `verifyPassword` re-derives from the
 * parameters without losing anything. A fresh random salt is generated per call.
 *
 * ponytail: this is credential *hashing only* — it does not manage users,
 * passwords, or sessions (the auth strategies stay transport-level). The user
 * model / registration flow remains the caller's responsibility. scrypt is the
 * default because `argon2id` is ~5x slower than native in pure JS
 * (`@noble/hashes` exposes `argon2id`); the interface is shaped so argon2id could
 * be swapped in later without changing call sites.
 */
/** Scrypt work-factor overrides for `hashPassword`. */
export interface PasswordHashOptions {
    /** CPU/memory work factor — a power of two (default `2**15` = 32768, ~32 MiB). */
    N?: number;
    /** Block size (default 8). */
    r?: number;
    /** Parallelization factor (default 1). */
    p?: number;
    /** Derived key length in bytes (default 32). */
    dkLen?: number;
}
/** Hash a password to a self-describing `scrypt$N=…,r=…,p=…,dkLen=…$<salt>$<hash>` string. */
export declare function hashPassword(password: string, opts?: PasswordHashOptions): Promise<string>;
/** Constant-time verify a password against a hash produced by `hashPassword`. */
export declare function verifyPassword(hash: string, password: string): Promise<boolean>;
//# sourceMappingURL=password.d.ts.map