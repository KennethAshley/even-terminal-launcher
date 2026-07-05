# Architecture

## Trust boundary

```text
renderer (sandboxed)
    │ typed IPC through preload
    ▼
main process
    ├─ ProfileStore / SettingsStore / SecretStore
    ├─ RuntimeManager
    ├─ ExecutableResolver
    └─ ProcessSupervisor
          ▼
      Electron utility process
          ▼
      @evenrealities/even-terminal CLI
          ├─ Claude Code / Claude Agent SDK
          └─ Codex app-server
```

The renderer has no Node integration. The preload exposes only `LauncherApi`.
File pickers, settings import/export, process management, credentials, and
runtime installation stay in the main process.

## Profile lifecycle

Each profile owns:

- one HTTP port used by Even Terminal;
- one Codex app-server WebSocket port;
- an explicit working directory;
- a stable encrypted bridge token;
- a provider default and transport policy.

`ProcessSupervisor` claims both ports before spawn, passes secrets via
environment, waits for the authenticated metrics endpoint, redacts logs, and
releases ports after stop or crash. Windows stop uses `taskkill /PID /T` so
descendant Codex/Claude processes are included; Unix uses utility-process
termination followed by bounded force termination.

## Platform policies

- macOS: Template Image tray asset; Dock appears only with the window.
- Windows: colored icon; native window chrome; taskbar button appears only with
  the window; login startup uses `--hidden`.
- Linux: colored icon and standard Electron window behavior; not a current
  supported target.

## Runtime updates

The launcher embeds 0.8.1 and can install isolated npm versions under
`userData/runtimes`. Arborist runs with lifecycle scripts disabled. A candidate
must pass manifest validation and CLI smoke testing before atomic activation.
One-step rollback is supported.

This is separate from upstream `/api/update-check`, which only reports whether
a version exists.
