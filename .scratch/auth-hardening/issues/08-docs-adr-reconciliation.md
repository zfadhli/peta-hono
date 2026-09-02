# 08: Reconcile docs + ADR with the hardened auth contract

**Source:** repo convention — ADR-012, `docs/glossary.md`, `docs/domain-model.md`, `README.md`, `CHANGELOG.md`, `AGENTS.md`, and the existing `ponytail:`/spec-accuracy invariants.

## What to build

Make the documentation and the ADR describe the *hardened* auth contract once tickets 01–06 land (and 07 if adopted). This is the final integration/docs slice; it touches no behaviour, only the words that tell consumers and future contributors how the strategies now behave.

Concretely:
- Update ADR-012 (or add `docs/adr/013-auth-hardening.md`) to record the post-hardening defaults: CSRF default `"origin"`, `Secure`/host-prefix cookie defaults, idle + absolute session expiry, JWT key rotation/`kid` + optional access-token revocation + refresh-cookie transport, OAuth PKCE default-on + provider-`error` handling, and `documentFlowRoutes` opt-in.
- Fix any `docs/glossary.md` / `docs/domain-model.md` entries that now diverge (e.g. the `securitySchemes: Map<string, SecurityScheme>` read type, cookie-attribute terms, `csrf` modes).
- Update `README.md` "How it works" + the auth bullet, and the `examples/strategies/` docs, to state the new defaults and any migration note (dev-over-http `secure` opt-out; `origin` required when `csrf: "origin"`).
- Add a `CHANGELOG.md` `[Unreleased]` entry summarizing the hardening as a minor/security-oriented change, with the deliberate default changes called out plainly.
- Update `AGENTS.md` commands/structure/key-patterns if exports or the auth surface changed (e.g. new option types re-exported from the barrel).

## Blocked by

02, 03, 04, 05, 06 (the behavior tickets whose contract this documents); 07 if its ADR/doco is adopted.

## Status

ready-for-agent

## Acceptance criteria

- [ ] ADR-012 (or the new 013) matches the shipped code exactly; no remaining "this is opt-in" phrasing that is now wrong.
- [ ] `docs/glossary.md` / `docs/domain-model.md` have no stale `AuthScheme`-vs-`SecurityScheme` reads and describe the new auth options.
- [ ] `README.md` + `examples/strategies` show the hardened usage (CSRF origin mode, `secure`/`hostPrefix`, JWT `keys`/`refreshTransport`, OAuth PKCE default) and the dev-over-http caveat.
- [ ] `CHANGELOG.md` `[Unreleased]` documents the default changes + migration notes; `AGENTS.md` reflects any new exports.
- [ ] `nub run typecheck`, `nub run lint`, and `nub run check:all` pass. No version bump / no `dist/` build / no commit.

## Notes

Per repo convention, this is a docs ticket only — do not change behaviour here. If a docs statement disagrees with what tickets 01–06 implemented, fix the docs, not the code; if the code turns out to have drifted from the ADR, open a correction note rather than silently "fixing" the documentation to match incorrect behaviour.
