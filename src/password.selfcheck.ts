/**
 * Self-check for the opt-in `peta-hono/password` scrypt helper.
 *
 * ponytail: no test framework — runnable self-check with asserts, matching
 * src/auth.selfcheck.ts and the example selfchecks. Uses the default scrypt work
 * factors (2^15 / r=8 / p=1 / dkLen=32).
 */

import { hashPassword, verifyPassword } from "./password.js";

let passed = 0;
let failed = 0;
let total = 0;

async function check(name: string, fn: () => Promise<void>) {
  total++;
  try {
    await fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

function assert(cond: boolean, label: string): void {
  if (!cond) throw new Error(label);
}

await check("hashPassword / verifyPassword round-trip", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert(hash.startsWith("scrypt$N="), "hash is self-describing scrypt");
  assert(hash.split("$").length === 4, "hash has params/salt/derived-key sections");
  assert(
    (await verifyPassword(hash, "correct horse battery staple")) === true,
    "correct password verifies",
  );
});

await check("wrong password fails", async () => {
  const hash = await hashPassword("correct horse battery staple");
  assert((await verifyPassword(hash, "wrong password")) === false, "wrong password fails");
});

await check("same password + different salt → different hashes", async () => {
  const a = await hashPassword("same-password");
  const b = await hashPassword("same-password");
  assert(a !== b, "fresh salt produces a distinct hash each call");
  assert((await verifyPassword(a, "same-password")) === true, "hash a verifies");
  assert((await verifyPassword(b, "same-password")) === true, "hash b verifies");
});

await check("hash/verify honors an explicit work-factor override", async () => {
  const hash = await hashPassword("pw", { N: 2 ** 14, r: 8, p: 1, dkLen: 32 });
  assert(hash.includes("N=16384"), "override N is encoded in the hash");
  assert((await verifyPassword(hash, "pw")) === true, "override hash verifies");
});

await check("malformed / unknown hash returns false (no throw)", async () => {
  assert((await verifyPassword("not-a-hash", "anything")) === false, "garbage hash returns false");
  assert(
    (await verifyPassword("argon2id$x$y$z", "anything")) === false,
    "unknown algorithm returns false",
  );
  assert(
    (await verifyPassword("scrypt$N=0,r=1,p=1,dkLen=32$AAAA$AAAA", "x")) === false,
    "invalid params returns false",
  );
});

console.log("=== opt-in peta-hono/password self-check ===");
console.log();
console.log(`Result: ${passed}/${total} passed, ${failed} failed`);

if (failed > 0) process.exit(1);
