# Third-party notices

This file summarizes dependencies that require particular attention. It is not
a substitute for the license text shipped by each package.

## @evenrealities/even-terminal 0.8.1

Published by Even Realities.

- The package README labels Even Terminal as MIT.
- The 0.8.1 npm manifest has no `license` field.
- The 0.8.1 npm tarball contains no standalone LICENSE file.
- No public source repository is identified in the package metadata.

This repository does not relicense or claim ownership of Even Terminal.
Confirm the authoritative license text, required attribution, and packaged
redistribution permission with Even Realities before distributing this
launcher as a bundled application.

Project pages:

- <https://www.npmjs.com/package/@evenrealities/even-terminal>
- <https://www.evenrealities.com/en-GB/terminal>

## Anthropic Claude Agent SDK

Even Terminal 0.8.1 depends on `@anthropic-ai/claude-agent-sdk` and its optional
platform packages. These packages are not identified as open-source software
under MIT. Their license files state that Anthropic PBC reserves its rights and
that use is subject to Anthropic's legal/commercial terms.

- <https://github.com/anthropics/claude-agent-sdk-typescript>
- <https://www.anthropic.com/legal/commercial-terms>

Anyone distributing a packaged launcher must ensure that the intended
distribution and end-user use comply with those terms.

## qrcode-terminal 0.12.0

The npm manifest does not declare a license, but the upstream repository
contains the Apache License 2.0 and an additional notice for the bundled QRCode
for JavaScript code.

- <https://github.com/gtanner/qrcode-terminal>

The package's upstream license and notices must be preserved in distributions.

## Complete production dependency inventory

The lockfile currently resolves permissive open-source licenses including MIT,
ISC, Apache-2.0, BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, CC0-1.0, and
CC-BY-3.0, in addition to the reviewed exceptions above.

See
[`docs/legal/dependency-license-inventory.md`](./docs/legal/dependency-license-inventory.md)
for the package-by-package inventory. Regenerate it after dependency changes:

```bash
npm run license:report
npm run license:check
```
