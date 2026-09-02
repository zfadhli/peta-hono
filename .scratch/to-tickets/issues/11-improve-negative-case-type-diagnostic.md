# 11: Make the negative-case "auth not on handler" type error self-explanatory

## Source

Prioritized DX review — M5 (type errors leak internal types, unactionable).

## What to build

When a developer reads `auth` in a handler without the right config, the compile error should point to the fix, not to internal type machinery.

Today (verified live) reading `auth` on an authed app without `{auth:"required"}` produces:

```
Property 'auth' does not exist on type 'ReqFor<"/a", Type<any, any>, Type<any, any>, Type<any, any>, Env>'.
```

This is technically correct but references three non-exported internal types (`ReqFor`, `Type<any,any>`, `Env`) the consumer has never seen. The recent `ApiMethodHelper` two-overload work (referenced in `src/api.ts:110`) made this a real type error, but the diagnostic doesn't hint that the fix is to add `auth:'required'` to the config.

## Acceptance criteria

- [ ] The negative-case error message is actionable without reading source — e.g. the surface type used in the handler signature is named/friendlier, or a `@deprecated`-style hint/`@ts-expect-error` note accompanies the README so a user recognizes the diagnostic.
- [ ] No public API change is required — internal types can gain a leading comment or the handler `req` type can expose a hint (e.g. an `AuthRequired` branded type) without altering runtime.
- [ ] README "How it works" shows the negative case (the `@ts-expect-error` from `src/typecheck.selfcheck.ts`) so users recognize "auth is not on the handler because the route is not auth-required."
- [ ] `nub run typecheck` still passes for the positive cases (auth-required routes compile), and the negative case remains a type error.

## Blocked by

None (type-surface + docs; can start immediately).
