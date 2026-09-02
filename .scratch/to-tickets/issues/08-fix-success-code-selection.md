# 08: Fix success-code selection — "first 2xx/3xx" is actually the lowest, and docs mislead

## Source

Prioritized DX review — M1 (success-code derivation uses JS integer-key ordering).

## What to build

The default success status must be deterministic and match what the docs say it does.

The handler derives status via `config.status ?? first 2xx/3xx in responses ?? 200` (`src/openapi.ts:458–461`, `594–597`). But `api()` re-keys responses to numbers (`responses[Number(code)]`, `src/api.ts:246`) and JavaScript always enumerates integer-like keys in **ascending numeric order**. So the "first 2xx/3xx" is actually the **lowest** 2xx/3xx code, independent of declaration order. Verified live:

- `responses: {200:…, 201:…}` → status 200
- `responses: {201:…, 200:…}` → **still 200** (not 201, though 201 was listed first)

The ADR/README phrase "first 2xx/3xx" is materially wrong, and a developer declaring multiple success codes expecting declaration order to win silently gets the lowest one. The only reliable way to get 201 is to set `status:201` explicitly.

## Acceptance criteria

- [ ] The doc (README + ADR-007 + `_buildResponses` comment) states the true rule: "lowest/declared-consistent 2xx/3xx," not "first."
- [ ] The behavior is deterministic and documented: when more than one 2xx/3xx code is declared, `status` must be set explicitly (optionally enforced/flagged).
- [ ] A committed selfcheck (`src/openapi.selfcheck.ts`) asserts the success status for a route with `{200, 201}` responses resolves to 200 and for a single `{201}` resolves to 201, with and without an explicit `status`.
- [ ] `nub run check:all` passes.

## Blocked by

None (can start immediately).
