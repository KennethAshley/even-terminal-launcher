# @evenrealities/even-terminal 0.8.1 snapshot

Snapshot date: 2026-07-05

## Sources

- npm page: <https://www.npmjs.com/package/@evenrealities/even-terminal>
- registry latest: <https://registry.npmjs.org/@evenrealities%2Feven-terminal/latest>
- exact tarball: <https://registry.npmjs.org/@evenrealities/even-terminal/-/even-terminal-0.8.1.tgz>
- official GitHub organization: <https://github.com/even-realities>

Registry latest and this repository's lockfile both resolve to 0.8.1.
Integrity:
`sha512-7g+xfe2nyv1wsNUQPqn1yz12R17Zv6w4PODKYIx+vkipNr7rpMVgjDUNFYLLNeOQWi2KT8ZJK81DL6jePYPmQA==`.

No public Even Terminal source repository is linked from the package. Findings
below marked “published artifact” come from the npm contents.

## Public CLI contract

The README claims macOS, Linux, and Windows support with Node 18+.

Commands:

- default / `start`
- `complete bash|zsh|fish|powershell`
- `codex` exists in the artifact/changelog but is omitted from the main help
  command list.

Options:

- `-p, --port` (default 3456)
- `-t, --token`
- `-n, --name`
- `-d, --cwd`
- `--provider claude|codex`
- `--tailscale`
- `-i, --interface, --if`
- `--expose pinggy|bore|ngrok`
- `--log-file`, `--verbose`, `--help`, `--version`

`CODEX_APP_SERVER_PORT` is environment-only and defaults to 8765. Concurrent
instances therefore require both unique HTTP and unique Codex ports.

## Provider and session behavior

- `--provider` selects the default; one server exposes both providers.
- Claude session queries are strongly tied to the supplied working directory.
- New Codex threads also need an explicit cwd for reliable project separation.
- Codex global history may be listed without cwd, but that does not remove the
  need to preserve cwd when creating/resuming work.
- 0.8.1 lazily starts Codex app-server when first needed.

## Network behavior

Published 0.8.1 code always binds Express to `0.0.0.0:<port>`.
`--tailscale` and `--interface` choose the advertised IP used in URLs/QR output;
they do not restrict the listen interface. This differs from the README's
“bind” wording.

Every `/api` route requires bearer/query token authentication, while CORS is
open. Public tunnel URLs contain the token and must be treated as credentials.

Expose helpers:

- pinggy: system SSH reverse tunnel;
- bore: `bore local`;
- ngrok: `ngrok http`.

Program overrides are accepted through `PINGGY_PROGRAM_PATH`,
`BORE_PROGRAM_PATH`, and `NGROK_PROGRAM_PATH`.

## Internal API snapshot

Published routes include sessions, info, update-check, status, messages, SSE
events, session history, metrics, prompts, permission/question responses,
interrupt, and Codex app-server wake-up. These are useful implementation facts,
not a documented stable SDK contract.

## Windows evidence and boundary

The README claims Windows support and the published package contains a win32
spawn shim for PATHEXT `.cmd/.bat` commands. Version 0.8.1 mentions Windows
Codex-history optimization. This is upstream evidence, not validation of this
launcher. See the repository Windows matrix.

## License boundary

The README says MIT. The npm manifest has no `license` field and the published
package does not include a LICENSE file. Reconfirm redistribution terms before
public distribution.
