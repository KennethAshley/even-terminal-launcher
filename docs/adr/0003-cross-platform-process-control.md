# ADR-0003: Cross-platform process control

Status: accepted for Windows beta preparation

Even Terminal launches provider descendants. Killing only the Electron utility
worker can orphan Codex/Claude or leave ports occupied.

- Unix: request utility-process termination, then use bounded SIGKILL fallback.
- Windows: invoke `taskkill.exe /PID <pid> /T`; after timeout add `/F`.
- The supervisor has an injected platform and terminator so win32 behavior is
  unit-tested on macOS.

This is the practical beta strategy. A Windows Job Object would provide a
stronger kernel-enforced lifetime boundary and remains an option if VM testing
finds orphan processes during crash, logoff, or forced shutdown.

Windows acceptance requires Task Manager and `netstat` evidence after stop,
restart, quit, logoff, and shutdown.
