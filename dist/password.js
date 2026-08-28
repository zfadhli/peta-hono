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
import { scryptAsync } from "@noble/hashes/scrypt.js";
import { randomBytes } from "@noble/hashes/utils.js";
import { base64urlDecode, base64urlEncode, timingSafeEqual } from "./auth/crypto.js";
const DEFAULT_N = 2 ** 15;
const DEFAULT_R = 8;
const DEFAULT_P = 1;
const DEFAULT_DK_LEN = 32;
const ALGORITHM = "scrypt";
/** Hash a password to a self-describing `scrypt$N=…,r=…,p=…,dkLen=…$<salt>$<hash>` string. */
export async function hashPassword(password, opts = {}) {
    const N = opts.N ?? DEFAULT_N;
    const r = opts.r ?? DEFAULT_R;
    const p = opts.p ?? DEFAULT_P;
    const dkLen = opts.dkLen ?? DEFAULT_DK_LEN;
    const salt = randomBytes(16);
    const derived = await scryptAsync(password, salt, { N, r, p, dkLen });
    const params = `N=${N},r=${r},p=${p},dkLen=${dkLen}`;
    return `${ALGORITHM}$${params}$${base64urlEncode(salt)}$${base64urlEncode(derived)}`;
}
/** Constant-time verify a password against a hash produced by `hashPassword`. */
export async function verifyPassword(hash, password) {
    const parsed = parseHash(hash);
    if (!parsed)
        return false;
    const derived = await scryptAsync(password, parsed.salt, {
        N: parsed.N,
        r: parsed.r,
        p: parsed.p,
        dkLen: parsed.dkLen,
    });
    return timingSafeEqual(derived, parsed.key);
}
/** Parse the self-describing hash string; returns `null` on any malformed/unknown input. */
function parseHash(hash) {
    const parts = hash.split("$");
    if (parts.length !== 4 || parts[0] !== ALGORITHM)
        return null;
    const params = parts[1];
    const saltB64 = parts[2];
    const keyB64 = parts[3];
    const map = new Map();
    for (const pair of params.split(",")) {
        const eq = pair.indexOf("=");
        if (eq === -1)
            return null;
        map.set(pair.slice(0, eq), pair.slice(eq + 1));
    }
    const N = Number(map.get("N"));
    const r = Number(map.get("r"));
    const p = Number(map.get("p"));
    const dkLen = Number(map.get("dkLen"));
    if (!Number.isInteger(N) ||
        !Number.isInteger(r) ||
        !Number.isInteger(p) ||
        !Number.isInteger(dkLen) ||
        N <= 0 ||
        r <= 0 ||
        p <= 0 ||
        dkLen <= 0 ||
        (N & (N - 1)) !== 0) {
        return null;
    }
    let salt;
    let key;
    try {
        salt = base64urlDecode(saltB64);
        key = base64urlDecode(keyB64);
    }
    catch {
        return null;
    }
    if (key.length !== dkLen)
        return null;
    return { N, r, p, dkLen, salt, key };
}
//# sourceMappingURL=password.js.map