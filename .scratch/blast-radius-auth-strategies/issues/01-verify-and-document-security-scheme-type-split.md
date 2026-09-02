# 01: Verify + document the input-vs-emitted security-scheme type split (blast-radius R1)

## Source

Blast-radius review — R1 (security-scheme type split), run after the built-in auth
strategies (ADR-012) landed. Implementation is DONE; this ticket is verification +
the remaining consumer-facing docs.

## Status

**Implementation DONE (uncommitted).** Do NOT redo the code change. Execute the
verification + docs items below. Do NOT run `nub run build` / touch `dist/`
(that is R2) and do NOT bump version / commit / publish.

## What to build

Confirm the type split is correct and make the public docs match it. The split keeps
the `auth(name, mw, scheme?)` *input* contract stable while the library now *emits*
more scheme kinds (cookie `apiKey` + `oauth2`).

Already implemented:
- `src/openapi.ts` — `AuthScheme` narrowed to the stable input
  (`http` bearer/basic + `apiKey` header/query); `SecurityScheme` widened (adds
  `apiKey in:"cookie"` + `oauth2`/`OAuth2Flows`). `OpenAPIComponents.securitySchemes`
  and `ComponentRegistry.securitySchemes` are typed `Map<string, SecurityScheme>`;
  `registerSecurityScheme(name, scheme: SecurityScheme)`.
- `src/api.ts` — internal `registerAuth(name, mw, scheme?: SecurityScheme)` (wide)
  vs public `auth(name, mw, scheme?: AuthScheme)` (narrow). `createApi` returns
  `{ app, api: apiWithHelpers, auth: authWithStrategies, docs }`.
- `src/index.ts` — barrel re-exports `AuthScheme`, `SecurityScheme`, `OAuth2Flows`.
- `src/typecheck.selfcheck.ts` — `@ts-expect-error` guard proving `apiKey in:"cookie"`
  and `oauth2` are NOT assignable to `AuthScheme` while `bearer` IS.

## Acceptance criteria

- [ ] `nub run typecheck` passes and the `@ts-expect-error` directives in
      `src/typecheck.selfcheck.ts` are *used* (not unused) — if the split ever
      regresses the guard becomes an error, pinning the contract.
- [ ] Barrel `src/index.ts` re-exports both `AuthScheme` and `SecurityScheme` (plus
      `OAuth2Flows`); `import type { SecurityScheme } from "peta-hono"` resolves.
- [ ] **Docs fix — `docs/glossary.md`:** the `ComponentRegistry` entry still reads
      `securitySchemes: Map<string, AuthScheme>`. It must be `Map<string, SecurityScheme>`
      to match the code (the registry holds the wide emitted type).
- [ ] **Docs fix — `CHANGELOG.md` `[Unreleased]`:** the bullet
      "**`AuthScheme` extended (additive)** — `apiKey` may now use `in: "cookie"`..."
      is now wrong. Replace it with the type-split note: `AuthScheme` (narrow input)
      is UNCHANGED since v0.5.4; the wide emitted set (cookie `apiKey` + `oauth2`)
      lives in the new `SecurityScheme`. Call out the compile-time-only break:
      consumers who read `components.securitySchemes` and typed it with `AuthScheme`
      must switch to `SecurityScheme` (reading the wide emitted type).
- [ ] **Docs fix — `README.md` "How it works"** (`auth(...)` bullet): state that
      `auth()` takes the narrow `AuthScheme`, while `components.securitySchemes`
      entries are typed `SecurityScheme` — read the emitted spec with `SecurityScheme`.
      Note an exhaustive switch over `AuthScheme` is unaffected by the
      built-in-strategy additions.
- [ ] `src/openapi.ts` and `docs/adr/012-built-in-auth-strategies.md` already
      describe the split — verify wording matches; edit only if drift is found.
- [ ] `nub run typecheck` + `nub run lint` pass. No `dist/` change, no commit.

## Blocked by

None for this verify+docs ticket. The stale `dist/` is tracked separately as R2 and
is not a blocker here.

## Notes

This is intentionally a compile-time-only break*: narrowing `AuthScheme` means a
consumer who previously typed a `components.securitySchemes` value (or a union over
it) with `AuthScheme` no longer type-checks against the newly wide emitted content.
Passing a scheme to `auth()` is unaffected (still narrow). The `@ts-expect-error`
guard is the regression pin for the *input* side; the docs tell consumers the
correct *read* type.
