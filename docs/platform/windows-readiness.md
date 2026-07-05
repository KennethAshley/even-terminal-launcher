# Windows readiness

Updated: 2026-07-05

No Windows machine was available during this implementation. “Prepared” below
means the branch exists and is exercised by host-independent tests.

| Area | Status | Current evidence |
|---|---|---|
| Native Electron window/tray | prepared-unverified-Windows | colored PNG/ICO, native chrome, explicit taskbar policy |
| npm `.cmd` and PATHEXT lookup | prepared-unverified-Windows | injected-win32 unit test |
| Common executable directories | prepared-unverified-Windows | APPDATA npm, LOCALAPPDATA Programs/WindowsApps, Program Files nodejs |
| Process-tree stop | prepared-unverified-Windows | `taskkill /PID /T`, force fallback, unit test |
| Credential storage | prepared-unverified-Windows | Electron safeStorage/DPAPI; portability documented |
| Login startup | prepared-unverified-Windows | `--hidden` login argument |
| Node clean/build scripts | prepared-unverified-Windows | no Unix-only `rm` in npm clean |
| Windows native dependency install | prepared-unverified-Windows | Windows CI performs native `npm ci` and asserts the Claude SDK win32 x64 package metadata resolves |
| Unsigned host package | prepared-unverified-Windows | Windows CI runs `npm run package` |
| Installer/signing/store | deferred | explicitly outside current scope |
| Real Codex/Claude/G2 sessions | externally-blocked | requires Windows and device testing |

## Why builds must run on Windows

`@anthropic-ai/claude-agent-sdk` selects platform-specific optional packages.
A macOS `node_modules` contains the Darwin binary, so cross-packaging that tree
for Windows is invalid. Windows CI or a Windows VM must run a clean `npm ci`
before packaging.

## Windows 11 VM acceptance checklist

1. Run `npm ci`, typecheck, lint, tests, build, and package.
2. Launch without a terminal. Confirm tray icon in light/dark themes and 100%,
   150%, and 200% scaling.
3. Confirm taskbar icon appears with the window and disappears after close.
4. Create profiles under a path containing spaces and Japanese characters.
5. Discover both npm `.cmd` shims and direct `.exe` tools; test manual override.
6. Relaunch and confirm DPAPI token persistence for the same Windows user.
7. Confirm login startup remains hidden in the tray.
8. Start three profiles with distinct HTTP/Codex ports.
9. Stop, restart, and quit; verify Task Manager and `netstat` show no orphan
   Codex, Claude, Node, or listening ports.
10. Test runtime update and rollback from a clean Windows installation.
11. Test Tailscale/interface advertising and the Windows Firewall prompt.
12. Test sleep/wake, network change, logoff, and shutdown.

## Physical-device acceptance

Only after the VM checklist:

- connect G2/R1 through the Even app;
- exercise Codex and at least three cwd-distinct Claude sessions;
- verify LAN and Tailscale from phone to PC;
- run reconnect and eight-hour soak tests.

Do not relabel this document `verified-Windows` until the results are recorded
under `docs/verification/`.
