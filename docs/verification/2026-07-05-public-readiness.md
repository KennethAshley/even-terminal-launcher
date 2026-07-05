# Public repository readiness — 2026-07-05

Host: Apple Silicon macOS

Reviewed snapshot: pre-publication local development history

## Repository and secret review

- No Git remote was configured.
- The working tree was clean before the public-readiness changes.
- Current files and all ten pre-cleanup commits were searched for common
  private-key, access-token, API-key, bridge-token, credential, and sensitive
  filename patterns.
- Matches were limited to deliberate placeholders and redaction test values
  such as `BRIDGE_TOKEN=<secret>` and `third-secret`.
- No credential, private key, user profile, runtime log, certificate, or
  signing file was found in Git history.
- The original development history remains preserved on the local `main`
  branch. The public branch was created as a single root snapshot for
  publication; no secret-driven history rewrite was required.

The scan was pattern-based; Gitleaks and TruffleHog were not installed on this
host.

## License and brand review

- The root MIT License covers original launcher code and documentation, subject
  to the explicit exclusions in `NOTICE.md`.
- Even Realities brand assets are listed in `BRAND_ASSETS.md` and excluded from
  the MIT grant.
- The generated production dependency inventory contains 257 distinct
  package/version/platform records.
- Even Terminal 0.8.1 remains `NOASSERTION`: its README says MIT, but its npm
  metadata and tarball contain no authoritative license file.
- Anthropic Claude Agent SDK packages are recorded under
  `LicenseRef-Anthropic-Commercial-Terms`.
- `qrcode-terminal` is corrected to Apache-2.0 from its upstream repository
  because its npm metadata omits the license.

## Verification

Executed with the repository-pinned Node.js 24.18.0:

- `npm ci`: passed.
- `npm run typecheck`: passed.
- `npm run lint`: passed.
- `npm test`: 13 files / 36 tests passed.
- `npm run license:check`: 257-record inventory is current.
- `npm run build`: passed.
- `npm run smoke`: three profiles reached `ready`.
- `npm run package`: passed.
- macOS package: ad-hoc signature verified with `codesign --deep --strict`.
- packaged legal resources: `LICENSE`, `NOTICE.md`,
  `THIRD_PARTY_NOTICES.md`, and `BRAND_ASSETS.md` were present.
- local Markdown links: all resolved.
- `git diff --check`: passed.

## Dependency security audit

- `npm audit --omit=dev`: zero findings.
- Full `npm audit`: 24 findings (3 low, 21 high).

The full findings are in development/build dependencies, but Electron is
declared as a development dependency while becoming the packaged application
runtime. Findings included Electron 37, Electron Forge's dependency chain,
`tar`, and temporary/build tooling. They require review or upgrades before a
public binary release; the zero-production result must not be used alone to
claim that a packaged build is clear.

## Boundaries

- This verifies repository hygiene and a local macOS package, not permission to
  publish the Even Realities brand assets.
- It does not resolve Even Terminal redistribution terms or Anthropic's
  commercial terms.
- It does not verify Windows execution, G2/R1 hardware, the Even app, live
  network paths, notarization, production signing, or public binary release.
