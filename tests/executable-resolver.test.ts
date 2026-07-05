import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rm } from "node:fs/promises";
import {
  ExecutableResolver,
  executableFilenames
} from "../src/main/executable-resolver.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("ExecutableResolver", () => {
  it("honors an executable override and reports its version", async () => {
    const resolver = new ExecutableResolver({
      overrides: { codex: process.execPath },
      env: { PATH: "" }
    });

    await expect(resolver.resolve("codex")).resolves.toBe(process.execPath);
    const status = await resolver.inspect("codex");
    expect(status).toMatchObject({
      name: "codex",
      path: process.execPath,
      available: true
    });
    expect(status.version).toMatch(/^v?\d+\./);
  });

  it("does not silently fall back when an override is invalid", async () => {
    const directory = await mkdtemp(join(tmpdir(), "resolver-test-"));
    temporaryDirectories.push(directory);
    const missing = join(directory, "missing-codex");
    const resolver = new ExecutableResolver({
      overrides: { codex: missing },
      env: { PATH: dirname(process.execPath) }
    });

    await expect(resolver.resolve("codex")).resolves.toBeNull();
    await expect(resolver.inspect("codex")).resolves.toEqual({
      name: "codex",
      path: null,
      version: null,
      available: false
    });
  });

  it("adds override directories and expose helper paths to child env", async () => {
    const resolver = new ExecutableResolver({
      overrides: { ssh: process.execPath },
      env: { PATH: "" }
    });

    const env = await resolver.childEnvironment();

    expect(env.PATH?.split(delimiter)).toContain(dirname(process.execPath));
    expect(env.PINGGY_PROGRAM_PATH).toBe(process.execPath);
  });

  it("discovers npm .cmd shims using Windows PATHEXT rules", async () => {
    const directory = await mkdtemp(join(tmpdir(), "resolver-win-test-"));
    temporaryDirectories.push(directory);
    const shim = join(directory, "codex.cmd");
    await writeFile(shim, "@echo off\r\n", "utf8");
    const resolver = new ExecutableResolver({
      platform: "win32",
      env: {
        PATH: directory,
        PATHEXT: ".EXE;.CMD"
      },
      homeDirectory: directory
    });

    expect(executableFilenames("codex", "win32", ".EXE;.CMD")).toEqual([
      "codex.exe",
      "codex.cmd",
      "codex"
    ]);
    await expect(resolver.resolve("codex")).resolves.toBe(shim);
  });
});
