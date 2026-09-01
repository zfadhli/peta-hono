import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./password.js";

describe("opt-in peta-hono/password scrypt helper", () => {
  it("hashPassword / verifyPassword round-trip", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("scrypt$N=")).toBe(true);
    expect(hash.split("$")).toHaveLength(4);
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("wrong password fails", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("same password + different salt → different hashes", async () => {
    const a = await hashPassword("same-password");
    const b = await hashPassword("same-password");
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, "same-password")).toBe(true);
    expect(await verifyPassword(b, "same-password")).toBe(true);
  });

  it("hash/verify honors an explicit work-factor override", async () => {
    const hash = await hashPassword("pw", { N: 2 ** 14, r: 8, p: 1, dkLen: 32 });
    expect(hash).toContain("N=16384");
    expect(await verifyPassword(hash, "pw")).toBe(true);
  });

  it("malformed / unknown hash returns false (no throw)", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
    expect(await verifyPassword("argon2id$x$y$z", "anything")).toBe(false);
    expect(await verifyPassword("scrypt$N=0,r=1,p=1,dkLen=32$AAAA$AAAA", "x")).toBe(false);
  });
});
