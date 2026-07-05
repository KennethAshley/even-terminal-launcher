const REDACTED = "[REDACTED]";
const ANSI_ESCAPE_SEQUENCE = new RegExp(
  `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
  "g"
);

function replaceLiteral(text: string, secret: string): string {
  if (secret.length < 6) return text;
  return text.split(secret).join(REDACTED);
}

/**
 * Redacts launcher tokens and common credential forms before a line reaches the
 * UI or disk. Secrets are replaced literally first, then generic forms catch
 * credentials emitted by child tools.
 */
export function redactSecrets(
  input: string,
  secrets: readonly (string | null | undefined)[] = []
): string {
  let output = input;

  for (const secret of secrets) {
    if (secret) output = replaceLiteral(output, secret);
  }

  output = output
    .replace(
      /(\bauthorization\s*:\s*bearer\s+)[^\s,;]+/gi,
      `$1${REDACTED}`
    )
    .replace(
      /([?&](?:token|access_token|auth)=)[^&#\s]+/gi,
      `$1${REDACTED}`
    )
    .replace(
      /(\b(?:bridge_token|api[_-]?key|auth[_-]?token)\s*[=:]\s*)[^\s,;]+/gi,
      `$1${REDACTED}`
    )
    .replace(/(\bfull token\s*:\s*)\S+/gi, `$1${REDACTED}`)
    .replace(/(\btoken\s*:\s*)\S+/gi, `$1${REDACTED}`);

  return output;
}

export function isQrCodeLogLine(line: string): boolean {
  const withoutAnsi = line.replace(ANSI_ESCAPE_SEQUENCE, "");
  if (!withoutAnsi.trim()) return false;

  const qrCharacters = withoutAnsi.match(/[█▀▄▌▐ ]/g)?.length ?? 0;
  return qrCharacters >= 8 && qrCharacters / withoutAnsi.length > 0.75;
}
