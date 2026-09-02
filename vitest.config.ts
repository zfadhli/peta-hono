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
    // Type-level regression guards live in `*.test-d.ts` (e.g. src/api.test-d.ts,
    // the createApi overload contract). Runs under `vitest run`/`check:all` and
    // is ALSO covered by `nub run typecheck` (tsc --noEmit over src/ + examples/).
    typecheck: {
      enabled: true,
      include: ["src/**/*.test-d.ts"],
    },
  },
});
