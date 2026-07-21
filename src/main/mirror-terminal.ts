export interface MirrorTerminalRequest {
  /** Directory to run the mirror from (the launcher app root). */
  appRoot: string;
  /** Absolute path to scripts/mirror.mjs. */
  scriptPath: string;
  /** The profile's HTTP port. Not secret; the token is discovered from the
   *  server's instance pidfile, never passed on argv. */
  port: number;
  /** PATH to inject so `node` resolves in a fresh terminal session. */
  pathEnv: string;
}

export interface TerminalCommand {
  file: string;
  args: string[];
}

/** POSIX single-quote a value for safe embedding in a shell command. */
function posixQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/** Escape a string for use inside an AppleScript double-quoted literal. */
function appleStringEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build the command that opens a terminal running the live mirror against a
 * profile's server. The token is intentionally absent — the mirror discovers it
 * from the running server's instance pidfile.
 */
export function buildMirrorTerminalCommand(
  platform: NodeJS.Platform,
  request: MirrorTerminalRequest
): TerminalCommand {
  const { appRoot, scriptPath, port, pathEnv } = request;

  if (platform === "darwin") {
    const shellCommand =
      `cd ${posixQuote(appRoot)} && ` +
      `PATH=${posixQuote(pathEnv)} ` +
      `node ${posixQuote(scriptPath)} --port ${port}`;
    const script = appleStringEscape(shellCommand);
    return {
      file: "osascript",
      args: [
        "-e",
        `tell application "Terminal" to do script "${script}"`,
        "-e",
        `tell application "Terminal" to activate`
      ]
    };
  }

  if (platform === "win32") {
    const shellCommand = `cd /d ${appRoot} && node ${scriptPath} --port ${port}`;
    return {
      file: "cmd.exe",
      args: ["/c", "start", "Even Terminal Mirror", "cmd", "/k", shellCommand]
    };
  }

  throw new Error(`Live mirror is not supported on platform "${platform}"`);
}
