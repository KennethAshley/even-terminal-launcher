# Repository instructions

Read `docs/HANDOFF.md` before changing code. It is the canonical project
status. Then read the relevant architecture, upstream snapshot, and platform
readiness documents linked from it.

## Scope

- Supported product target: macOS and Windows.
- macOS is locally verified. Windows code may be marked only
  `prepared-unverified-Windows` until it runs on Windows.
- Linux is outside the current implementation scope.
- Developer certificates, notarization, Windows code signing, store submission,
  and public release automation are intentionally deferred.

## Required verification

Run these before committing:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

On macOS, also run `npm run smoke`. Windows-specific work must keep the
`windows-2025` CI job valid and update `docs/platform/windows-readiness.md`.

Use Conventional Commits. Commit completed, verified work directly to the
current branch unless the user requests another workflow. Do not commit
credentials, user profiles, tokens, logs, `dist/`, or `out/`.

## Engineering rules

- Never pass the bridge token on argv. Use `BRIDGE_TOKEN`.
- Keep HTTP and Codex app-server ports unique across every profile.
- Preserve `cwd` explicitly; provider session behavior depends on it.
- Do not imply `--tailscale` restricts the listen interface. Upstream 0.8.1
  listens on `0.0.0.0`.
- Keep OS-specific behavior behind testable platform policies.
- Exported configuration must exclude tokens and executable overrides.
- Update `docs/HANDOFF.md` and the verification index when project status
  materially changes.
