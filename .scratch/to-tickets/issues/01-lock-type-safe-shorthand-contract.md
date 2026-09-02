# 01: Lock the type-safe shorthand contract with a committed type-level regression test

## Parent

[#19 Spec: Type-safe method shorthands and controllable framework error responses](https://github.com/zfadhli/peta-hono/issues/19)

## What to build

The shorthand endpoint declarations (`api.get/post/put/patch/del/delete`) behave exactly like the classic form at the type level, and that contract is enforced by the type checker so it cannot regress.

On a no-auth app (`createApi<undefined>`):
- `api.get(path, { auth: "required" }, ({ auth }) => ...)` is a **compile error** (no `auth` is injected).
- `api.get(path, {}, ({ auth }) => ...)` is a **compile error** (no `auth` config → no `auth` field).

On an authed app (`createApi<MyAuth>`):
- `api.get(path, { auth: "required" }, ({ auth }) => auth.user.id)` **compiles** and infers `auth: MyAuth`.

The classic form `api({ method, path, auth: "required" }, ({ auth }) => ...)` behaves identically, so a developer refactoring between forms gets the same types either way.

## Acceptance criteria

- [ ] `nub run typecheck` fails (compile error) on a no-auth app when a shorthand route declares `{ auth }` in its handler with no `auth` config, and when a shorthand route declares `{ auth: "required" }` but the handler reads `auth`.
- [ ] `nub run typecheck` passes on the same no-auth app when the handler does not read `auth`.
- [ ] `nub run typecheck` passes on an authed app when a shorthand route reads `auth: MyAuth`.
- [ ] The negative cases are represented by committed, CI-visible assertions (e.g. `@ts-expect-error`), not only manual verification, so the shorthand/classic divergence cannot silently recur.
- [ ] The vocabulary `ApiMethodHelper`, `ReqFor`, `AuthField` is used consistently in the assertion comments and matches `docs/glossary.md`.

## Blocked by

None (can start immediately).
