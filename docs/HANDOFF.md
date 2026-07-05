# Even Terminal Launcher handoff

Updated: 2026-07-05

Implementation baseline: public branch root snapshot

This is the canonical current-state document for future Codex, Claude Code, and
human contributors.

## Status vocabulary

- `implemented`: present in source.
- `verified-macOS`: executed successfully on the current Apple Silicon Mac.
- `prepared-unverified-Windows`: Windows branch and tests exist, but no Windows
  machine has run the complete application.
- `deferred`: intentionally excluded for now.
- `externally-blocked`: requires hardware, account, certificate, or external
  environment not currently available.

## Current product state

- `verified-macOS`: tray app, adaptive Dock visibility, profile CRUD,
  multi-process supervision, tokens, logging, transports, diagnostics, runtime
  update/rollback, login startup, and Japanese/English/Simplified Chinese/
  Traditional Chinese/Korean/Spanish UI.
- `implemented`: portable profile configuration export/import. Tokens and
  executable overrides are never exported.
- `prepared-unverified-Windows`: colored tray icon, taskbar visibility policy,
  native title bar, `.exe/.cmd/.bat` discovery, Windows search paths,
  `taskkill /T` process-tree shutdown, DPAPI-compatible Electron safeStorage,
  hidden login startup, Windows CI and unsigned host packaging.
- `externally-blocked`: Windows 11 VM/physical-machine acceptance and
  G2/R1/phone end-to-end testing.
- `deferred`: Developer ID, notarization, Windows code signing, installers,
  stores, public release automation, and launcher self-update.
- `implemented`: English-first public README with a Japanese companion,
  explicit MIT/brand/third-party boundaries, reproducible production dependency
  license inventory, secret-oriented ignore rules, security guidance, and a
  source/binary release-readiness checklist.

## Read next

1. [Architecture](./architecture.md)
2. [Even Terminal 0.8.1 snapshot](./upstream/even-terminal-0.8.1-snapshot.md)
3. [Windows readiness](./platform/windows-readiness.md)
4. [Verification index](./verification/README.md)
5. [Localization ADR](./adr/0002-localization.md)
6. [Cross-platform process ADR](./adr/0003-cross-platform-process-control.md)
7. [Release-readiness checklist](./releasing.md)
8. [Dependency license inventory](./legal/dependency-license-inventory.md)

## Local commands

```bash
npm ci
npm run typecheck
npm run lint
npm test
npm run license:check
npm run build
npm run smoke
npm run package
```

Node is pinned to 24.18.0 in `mise.toml`. `npm run clean` is implemented in
Node, so it works on Windows as well as Unix.

## Data boundaries

Electron `userData` contains:

- `profiles.json`: non-secret profile configuration.
- `settings.json`: locale, login preference, and local executable overrides.
- `secrets.json`: encrypted per-profile bridge tokens.
- `logs/`: redacted and rotated profile logs.
- `runtimes/`: downloaded Even Terminal versions and activation state.

Electron safeStorage maps to Keychain on macOS and DPAPI on Windows. Encrypted
tokens are not portable to another OS user or machine. Use configuration
export/import and let the destination create new tokens.

## Known limitations

- Windows behavior is prepared and unit-tested from macOS, not accepted on
  Windows.
- Upstream 0.8.1 always listens on `0.0.0.0`; transport options select the
  advertised address rather than restricting the bind interface.
- The published package exposes useful internal HTTP/SSE APIs, but its README
  does not promise API stability.
- Upstream README says MIT, while the npm manifest has no `license` field and
  the package contains no LICENSE text.
- The app and tray icons incorporate an Even Realities brand mark and are
  excluded from this repository's MIT License. Permission or replacement
  artwork is still required before public redistribution.
- The transitive Anthropic Claude Agent SDK is subject to Anthropic's
  commercial terms rather than an open-source SPDX license.
- The 2026-07-05 full npm audit reports development/build/runtime-tooling
  findings, including the packaged Electron runtime. Production dependency
  classification alone reports zero, but that narrower result is not
  sufficient evidence for binary release.
- Hardware/network E2E remains unverified.
