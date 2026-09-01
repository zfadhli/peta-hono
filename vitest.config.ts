import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "examples/**/*.test.ts"],
    environment: "node",
    globals: false,
    // Scrypt hashing (@noble/hashes) is CPU-bound; v8 coverage instrumentation
    // makes it exceed Vitest's 5s default by a wide margin. Integration tests
    // (real crypto, SQLite, JWTs) deserve generous headroom.
    testTimeout: 60_000,
  },
});
