# Security policy

This project does not yet publish supported release binaries.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository when it is
available. If private reporting is unavailable, contact the maintainer through
the GitHub profile without including exploit details or credentials in a public
issue.

Never attach bridge tokens, connection URLs containing tokens, exported user
profiles, local logs, signing credentials, or package-manager credentials to a
public issue. If a token has been disclosed, stop the affected profile, replace
the token, and treat the previous value as compromised.

## Security boundary

- Bridge tokens are stored with Electron `safeStorage`.
- Tokens are passed to Even Terminal through `BRIDGE_TOKEN`, not process
  arguments.
- Configuration exports omit tokens and executable overrides.
- Even Terminal 0.8.1 listens on `0.0.0.0`; selecting Tailscale changes the
  advertised address but does not restrict the listening interface.
- Packaged builds are not currently notarized or production-signed.

Security reports should identify the affected commit, operating system, and
the smallest safe reproduction. Do not include real secrets.
