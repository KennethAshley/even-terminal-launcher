import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  RuntimeManager,
  type RuntimeManagerOptions
} from "../src/main/runtime-manager.js";

const PACKAGE_NAME = "@evenrealities/even-terminal";
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createBundledRuntime(): Promise<string> {
  const root = await temporaryDirectory("runtime-bundled-test-");
  await writeRuntimePackage(root, "0.8.1");
  return root;
}

async function writeRuntimePackage(
  packageRoot: string,
  version: string
): Promise<void> {
  await mkdir(join(packageRoot, "bin"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify(
      {
        name: PACKAGE_NAME,
        version,
        bin: { "even-terminal": "bin/cli.js" }
      },
      null,
      2
    )}\n`
  );
  await writeFile(join(packageRoot, "bin", "cli.js"), "#!/usr/bin/env node\n");
}

function registryFetch(latestVersion: string): typeof fetch {
  return vi.fn(async () =>
    new Response(
      JSON.stringify({ name: PACKAGE_NAME, version: latestVersion }),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    )
  ) as typeof fetch;
}

function fakeArborist(
  failingVersions: Set<string> = new Set(),
  calls: Array<Record<string, unknown>> = []
): NonNullable<RuntimeManagerOptions["arborist"]> {
  return class {
    private readonly root: string;

    constructor(options: Record<string, unknown> = {}) {
      if (typeof options.path !== "string") {
        throw new Error("Fake Arborist needs a project path");
      }
      this.root = options.path;
      calls.push({ phase: "constructor", ...options });
    }

    async reify(options: Record<string, unknown> = {}): Promise<void> {
      calls.push({ phase: "reify", ...options });
      const rootManifest = JSON.parse(
        await readFile(join(this.root, "package.json"), "utf8")
      ) as { dependencies: Record<string, string> };
      const version = rootManifest.dependencies[PACKAGE_NAME];
      if (!version) throw new Error("Requested version is missing");
      if (failingVersions.has(version)) {
        throw new Error(`simulated install failure for ${version}`);
      }
      await writeRuntimePackage(
        join(
          this.root,
          "node_modules",
          "@evenrealities",
          "even-terminal"
        ),
        version
      );
    }
  };
}

describe("RuntimeManager", () => {
  it("detects bundled runtime and checks the npm registry", async () => {
    const userData = await temporaryDirectory("runtime-user-test-");
    const bundled = await createBundledRuntime();
    const fetchImplementation = registryFetch("0.9.0");
    const manager = new RuntimeManager(userData, {
      bundledPackageRoot: bundled,
      fetch: fetchImplementation,
      arborist: fakeArborist()
    });

    expect(await manager.getInfo()).toEqual({
      bundledVersion: "0.8.1",
      activeVersion: "0.8.1",
      installedVersions: [],
      latestVersion: null,
      updateAvailable: null,
      updateError: null
    });

    expect(await manager.checkForUpdate()).toMatchObject({
      bundledVersion: "0.8.1",
      activeVersion: "0.8.1",
      latestVersion: "0.9.0",
      updateAvailable: true,
      updateError: null
    });
    expect(fetchImplementation).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@evenrealities%2Feven-terminal/latest",
      expect.objectContaining({
        headers: { accept: "application/json" }
      })
    );
    expect(await manager.resolveCliPath()).toBe(join(bundled, "bin", "cli.js"));
  });

  it("installs into staging, atomically activates, and rolls back", async () => {
    const userData = await temporaryDirectory("runtime-user-test-");
    const bundled = await createBundledRuntime();
    const arboristCalls: Array<Record<string, unknown>> = [];
    const smokeTest = vi.fn(async () => undefined);
    const manager = new RuntimeManager(userData, {
      bundledPackageRoot: bundled,
      fetch: registryFetch("0.9.0"),
      arborist: fakeArborist(new Set(), arboristCalls),
      smokeTest
    });

    const installed = await manager.installUpdate();
    expect(installed).toMatchObject({
      activeVersion: "0.9.0",
      installedVersions: ["0.9.0"],
      latestVersion: "0.9.0",
      updateAvailable: false,
      updateError: null
    });
    expect(arboristCalls).toEqual([
      expect.objectContaining({
        phase: "constructor",
        ignoreScripts: true
      }),
      expect.objectContaining({
        phase: "reify",
        ignoreScripts: true
      })
    ]);
    expect(smokeTest).toHaveBeenCalledWith(
      expect.stringContaining(join("even-terminal", "bin", "cli.js")),
      "0.9.0"
    );

    const installedCli = await manager.resolveCliPath();
    expect(installedCli).toBe(
      join(
        userData,
        "runtimes",
        "installed",
        "0.9.0",
        "node_modules",
        "@evenrealities",
        "even-terminal",
        "bin",
        "cli.js"
      )
    );
    expect(await readdir(join(userData, "runtimes", "staging"))).toEqual([]);

    expect(await manager.rollback()).toMatchObject({
      activeVersion: "0.8.1",
      installedVersions: ["0.9.0"],
      updateError: null
    });
    expect(await manager.resolveCliPath()).toBe(join(bundled, "bin", "cli.js"));
  });

  it("keeps the active runtime when a staged install fails", async () => {
    const userData = await temporaryDirectory("runtime-user-test-");
    const bundled = await createBundledRuntime();
    const failures = new Set<string>();
    const manager = new RuntimeManager(userData, {
      bundledPackageRoot: bundled,
      fetch: registryFetch("0.9.0"),
      arborist: fakeArborist(failures)
    });

    expect(await manager.installUpdate("0.9.0")).toMatchObject({
      activeVersion: "0.9.0",
      updateError: null
    });
    const activeCli = await manager.resolveCliPath();

    failures.add("0.10.0");
    expect(await manager.installUpdate("0.10.0")).toMatchObject({
      activeVersion: "0.9.0",
      installedVersions: ["0.9.0"],
      updateError: "simulated install failure for 0.10.0"
    });
    expect(await manager.resolveCliPath()).toBe(activeCli);
    expect(await readdir(join(userData, "runtimes", "staging"))).toEqual([]);
  });
});
