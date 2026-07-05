# Release-readiness checklist

This checklist separates publishing the source repository from distributing a
packaged application.

## Before publishing the source repository

- [ ] Review `git status` and all tracked files.
- [ ] Run a secret scan across the current tree and Git history.
- [ ] Confirm that `.env`, `.npmrc`, profiles, tokens, logs, certificates, and
      signing files are not tracked.
- [ ] Decide whether the Git author email in existing commits is acceptable to
      publish.
- [ ] Confirm that the Even Realities brand assets may be published, or replace
      every file listed in `BRAND_ASSETS.md`.
- [ ] Run `npm ci` and the required verification commands.
- [ ] Run `npm run license:check`.
- [ ] Review the full `npm audit` result, including Electron even though npm
      classifies it as a development dependency.
- [ ] Confirm that README status labels still match actual platform testing.
- [ ] Create the GitHub repository and add its URL only after the owner and
      repository name are final.

## Before distributing a packaged application

- [ ] Obtain authoritative redistribution terms for
      `@evenrealities/even-terminal`.
- [ ] Confirm compliance with the Anthropic Claude Agent SDK terms.
- [ ] Include applicable third-party license texts and notices in the package.
- [ ] Obtain permission for the Even Realities brand assets or replace them.
- [ ] Complete the Windows acceptance checklist on Windows before describing
      Windows as verified.
- [ ] Complete device/network acceptance with G2, R1, and the Even app.
- [ ] Add production signing and notarization for macOS.
- [ ] Add production signing and installer validation for Windows.
- [ ] Resolve or explicitly assess full-audit findings in Electron, packaging,
      and build dependencies.
- [ ] Re-run typecheck, lint, tests, license check, build, smoke tests, and
      package verification from a clean checkout.

Source publication does not by itself establish permission to redistribute
third-party binaries or brand assets.
