import { describe, expect, it } from "vitest";
import { buildMirrorTerminalCommand } from "../src/main/mirror-terminal.js";

const request = {
  appRoot: "/Users/dev/even-terminal-launcher",
  scriptPath: "/Users/dev/even-terminal-launcher/scripts/mirror.mjs",
  port: 3457,
  pathEnv: "/opt/node/bin:/usr/bin"
};

describe("mirror terminal command", () => {
  it("opens Terminal.app via osascript on macOS", () => {
    const command = buildMirrorTerminalCommand("darwin", request);
    expect(command.file).toBe("osascript");
    const script = command.args.join(" ");
    expect(script).toContain("do script");
    expect(script).toContain("--port 3457");
    expect(script).toContain("scripts/mirror.mjs");
  });

  it("never puts the bridge token on the command line", () => {
    const command = buildMirrorTerminalCommand("darwin", request);
    // Port and PATH are fine; a token must be discovered from the pidfile.
    expect(command.args.join(" ")).not.toMatch(/--token|BRIDGE_TOKEN/);
  });

  it("opens a cmd window on Windows", () => {
    const command = buildMirrorTerminalCommand("win32", request);
    expect(command.file).toBe("cmd.exe");
    expect(command.args).toContain("/k");
    expect(command.args.join(" ")).toContain("--port 3457");
  });

  it("rejects unsupported platforms", () => {
    expect(() => buildMirrorTerminalCommand("linux", request)).toThrow(
      /not supported/
    );
  });
});
