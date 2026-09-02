# 06: Harden the `debug` production gate so it cannot leak stack traces

## Source

Prioritized DX review — H4 (debug mode leaks on non-Node / unset NODE_ENV).

## What to build

`debug: true` must never leak error messages/stack traces to end users in a production deploy, independent of runtime.

Today `createErrorHandler` (`src/openapi.ts:109–118`) shows `{error, stack}` whenever `process.env.NODE_ENV !== "production"`. The pre-production gate is only `isProd = process.env.NODE_ENV === "production"`. Consequence (library claims to run on Node, Bun, Deno, Cloudflare Workers — README): on Bun/Deno/edge `process` may be undefined (or `NODE_ENV` unset), so `isProd=false` and `debug:true` **leaks stack traces in production**. A Node deploy that forgets `NODE_ENV=production` leaks too. The "debug" flag *feels* safe because it has a gate, but the gate is absent-by-default, not present-by-default.

## Acceptance criteria

- [ ] `debug: true` does **not** leak `message`/`stack` when running in a production-deployed context even if `NODE_ENV` is absent (e.g. Bun/Deno/edge or a Node deploy with `NODE_ENV` unset).
- [ ] `debug: true` still shows `{error, stack}` in an explicitly-development context (`NODE_ENV=development`), i.e. the dev ergonomics are preserved.
- [ ] If an unambiguous "production" signal is unavailable, the safe default is to **withhold** details unless an explicit development opt-in is present — not the current inverse.
- [ ] The chosen gate is documented in README/glossary (`debug` flag) with a clear "dev-only; strip in prod bundles" note.
- [ ] Existing `src/openapi.selfcheck.ts` `assertDebugMode` (which currently expects `debug` to reveal details) is updated to exercise the new gate, and `nub run check:all` passes.

## Blocked by

None (can start immediately).
