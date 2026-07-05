import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import {
  access,
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm
} from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { gt as semverGt, rcompare as semverRcompare, valid as validSemver } from "semver";

import type { RuntimeInfo } from "../shared/types.js";

const PACKAGE_NAME = "@evenrealities/even-terminal";
const EXPECTED_BUNDLED_VERSION = "0.8.1";
const RUNTIME_STATE_SCHEMA_VERSION = 1;
const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org";

type RuntimePointer =
  | { kind: "bundled" }
  | { kind: "installed"; version: string };

interface RuntimeStateDocument {
  schemaVersion: typeof RUNTIME_STATE_SCHEMA_VERSION;
  active: RuntimePointer;
  previous: RuntimePointer | null;
}

interface PackageManifest {
  name: string;
  version: string;
  bin: string | Record<string, string>;
}

interface ArboristInstance {
  reify(options?: Record<string, unknown>): Promise<unknown>;
}

interface ArboristConstructor {
  new (options?: Record<string, unknown>): ArboristInstance;
}

export interface RuntimeManagerOptions {
  bundledPackageRoot?: string;
  registryUrl?: string;
  fetch?: typeof fetch;
  arborist?: ArboristConstructor;
  smokeTest?: (cliPath: string, version: string) => Promise<void>;
}

export class RuntimeManager {
  readonly runtimeRoot: string;
  readonly installedRoot: string;
  readonly stagingRoot: string;
  readonly statePath: string;

  private readonly bundledPackageRoot: string;
  private readonly bundledManifest: PackageManifest;
  private readonly registryUrl: string;
  private readonly fetchImplementation: typeof fetch;
  private readonly Arborist: ArboristConstructor;
  private readonly smokeTest?: RuntimeManagerOptions["smokeTest"];
  private latestVersion: string | null = null;
  private updateError: string | null = null;
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string, options: RuntimeManagerOptions = {}) {
    this.runtimeRoot = join(userDataDirectory, "runtimes");
    this.installedRoot = join(this.runtimeRoot, "installed");
    this.stagingRoot = join(this.runtimeRoot, "staging");
    this.statePath = join(this.runtimeRoot, "runtime-state.json");
    this.bundledPackageRoot = resolve(
      options.bundledPackageRoot ?? locateBundledPackageRoot()
    );
    this.bundledManifest = readManifestSync(this.bundledPackageRoot);
    if (
      this.bundledManifest.name !== PACKAGE_NAME ||
      this.bundledManifest.version !== EXPECTED_BUNDLED_VERSION
    ) {
      throw new Error(
        `Expected bundled ${PACKAGE_NAME} ${EXPECTED_BUNDLED_VERSION}, found ` +
          `${this.bundledManifest.name} ${this.bundledManifest.version}`
      );
    }
    this.registryUrl = (options.registryUrl ?? DEFAULT_REGISTRY_URL).replace(
      /\/+$/,
      ""
    );
    this.fetchImplementation = options.fetch ?? fetch;
    this.Arborist = options.arborist ?? loadArborist();
    this.smokeTest = options.smokeTest;
  }

  async getInfo(): Promise<RuntimeInfo> {
    await this.operationQueue;
    return this.buildInfo();
  }

  async checkForUpdate(): Promise<RuntimeInfo> {
    return this.runExclusive(async () => {
      try {
        this.latestVersion = await this.fetchLatestVersion();
        this.updateError = null;
      } catch (error) {
        this.latestVersion = null;
        this.updateError = errorMessage(error);
      }
      return this.buildInfo();
    });
  }

  async installUpdate(version?: string): Promise<RuntimeInfo> {
    return this.runExclusive(async () => {
      let stagingDirectory: string | null = null;
      try {
        const targetVersion = normalizeVersion(
          version ?? (await this.fetchLatestVersion())
        );
        if (version === undefined) {
          this.latestVersion = targetVersion;
        }

        const destination = this.installedDirectory(targetVersion);
        if (await pathExists(destination)) {
          try {
            await validateRuntimePackage(destination, targetVersion);
          } catch {
            await rm(destination, { recursive: true, force: true });
          }
        }
        if (!(await pathExists(destination))) {
          await mkdir(this.stagingRoot, { recursive: true });
          stagingDirectory = join(
            this.stagingRoot,
            `${targetVersion}-${randomUUID()}`
          );
          await mkdir(stagingDirectory, { recursive: false });
          await atomicWriteJson(join(stagingDirectory, "package.json"), {
            name: "even-terminal-launcher-runtime",
            version: "0.0.0",
            private: true,
            dependencies: {
              [PACKAGE_NAME]: targetVersion
            }
          });

          const arborist = new this.Arborist({
            path: stagingDirectory,
            registry: `${this.registryUrl}/`,
            ignoreScripts: true,
            audit: false,
            fund: false,
            packageLock: false,
            save: false
          });
          await arborist.reify({
            ignoreScripts: true,
            audit: false,
            fund: false,
            save: false
          });

          const stagedRuntime = await validateRuntimePackage(
            stagingDirectory,
            targetVersion
          );
          await this.smokeTest?.(stagedRuntime.cliPath, targetVersion);
          await mkdir(this.installedRoot, { recursive: true });
          await rename(stagingDirectory, destination);
          stagingDirectory = null;
        }

        await this.activate({ kind: "installed", version: targetVersion });
        this.updateError = null;
      } catch (error) {
        this.updateError = errorMessage(error);
      } finally {
        if (stagingDirectory) {
          await rm(stagingDirectory, { recursive: true, force: true });
        }
      }
      return this.buildInfo();
    });
  }

  async rollback(): Promise<RuntimeInfo> {
    return this.runExclusive(async () => {
      try {
        const state = await this.readState();
        if (!state.previous) {
          throw new Error("No previous Even Terminal runtime is available");
        }
        await this.validatePointer(state.previous);
        await this.writeState({
          schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
          active: state.previous,
          previous: state.active
        });
        this.updateError = null;
      } catch (error) {
        this.updateError = errorMessage(error);
      }
      return this.buildInfo();
    });
  }

  async resolveCliPath(version?: string | null): Promise<string> {
    await this.operationQueue;
    if (version) {
      const normalizedVersion = normalizeVersion(version);
      const installed = this.installedDirectory(normalizedVersion);
      if (await pathExists(installed)) {
        return (await validateRuntimePackage(installed, normalizedVersion)).cliPath;
      }
      if (normalizedVersion === this.bundledManifest.version) {
        return (
          await validatePackageRoot(
            this.bundledPackageRoot,
            this.bundledManifest.version
          )
        ).cliPath;
      }
      throw new Error(`Even Terminal runtime ${normalizedVersion} is not installed`);
    }

    const state = await this.readState();
    if (state.active.kind === "bundled") {
      return (
        await validatePackageRoot(
          this.bundledPackageRoot,
          this.bundledManifest.version
        )
      ).cliPath;
    }
    return (
      await validateRuntimePackage(
        this.installedDirectory(state.active.version),
        state.active.version
      )
    ).cliPath;
  }

  private async buildInfo(): Promise<RuntimeInfo> {
    const state = await this.readState();
    const installedVersions = await this.listInstalledVersions();
    const activeVersion =
      state.active.kind === "bundled"
        ? this.bundledManifest.version
        : state.active.version;
    const latestVersion = this.latestVersion;
    return {
      bundledVersion: this.bundledManifest.version,
      activeVersion,
      installedVersions,
      latestVersion,
      updateAvailable:
        latestVersion === null ? null : semverGt(latestVersion, activeVersion),
      updateError: this.updateError
    };
  }

  private async listInstalledVersions(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.installedRoot, { withFileTypes: true });
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const versions: string[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || validSemver(entry.name) !== entry.name) {
        continue;
      }
      try {
        await validateRuntimePackage(
          join(this.installedRoot, entry.name),
          entry.name
        );
        versions.push(entry.name);
      } catch {
        // An interrupted or externally modified directory is not executable.
      }
    }
    return versions.sort(semverRcompare);
  }

  private async fetchLatestVersion(): Promise<string> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetchImplementation(
        `${this.registryUrl}/@evenrealities%2Feven-terminal/latest`,
        {
          headers: {
            accept: "application/json"
          },
          signal: controller.signal
        }
      );
      if (!response.ok) {
        throw new Error(
          `npm registry returned ${response.status} ${response.statusText}`
        );
      }
      const manifest: unknown = await response.json();
      if (
        !isRecord(manifest) ||
        manifest.name !== PACKAGE_NAME ||
        typeof manifest.version !== "string"
      ) {
        throw new Error("npm registry returned an invalid package manifest");
      }
      return normalizeVersion(manifest.version);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async activate(pointer: RuntimePointer): Promise<void> {
    await this.validatePointer(pointer);
    const current = await this.readState();
    if (pointersEqual(pointer, current.active)) {
      return;
    }
    await this.writeState({
      schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
      active: pointer,
      previous: current.active
    });
  }

  private async validatePointer(pointer: RuntimePointer): Promise<void> {
    if (pointer.kind === "bundled") {
      await validatePackageRoot(
        this.bundledPackageRoot,
        this.bundledManifest.version
      );
      return;
    }
    await validateRuntimePackage(
      this.installedDirectory(pointer.version),
      pointer.version
    );
  }

  private installedDirectory(version: string): string {
    return join(this.installedRoot, normalizeVersion(version));
  }

  private async readState(): Promise<RuntimeStateDocument> {
    let contents: string;
    try {
      contents = await readFile(this.statePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return defaultRuntimeState();
      }
      throw error;
    }

    let value: unknown;
    try {
      value = JSON.parse(contents);
    } catch (error) {
      throw new Error(`Unable to parse runtime state at ${this.statePath}`, {
        cause: error
      });
    }
    if (
      !isRecord(value) ||
      value.schemaVersion !== RUNTIME_STATE_SCHEMA_VERSION
    ) {
      throw new Error(`Unsupported runtime state at ${this.statePath}`);
    }
    return {
      schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
      active: normalizePointer(value.active),
      previous:
        value.previous === null ? null : normalizePointer(value.previous)
    };
  }

  private async writeState(document: RuntimeStateDocument): Promise<void> {
    await atomicWriteJson(this.statePath, document);
  }

  private async runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

function locateBundledPackageRoot(): string {
  const localRequire = createRequire(__filename);
  return dirname(localRequire.resolve(`${PACKAGE_NAME}/package.json`));
}

function loadArborist(): ArboristConstructor {
  const localRequire = createRequire(__filename);
  return localRequire("@npmcli/arborist") as ArboristConstructor;
}

function readManifestSync(packageRoot: string): PackageManifest {
  const localRequire = createRequire(__filename);
  let value: unknown;
  try {
    value = localRequire(join(packageRoot, "package.json")) as unknown;
  } catch (error) {
    throw new Error(`Unable to read runtime package at ${packageRoot}`, {
      cause: error
    });
  }
  return normalizeManifest(value);
}

async function validateRuntimePackage(
  projectRoot: string,
  expectedVersion: string
): Promise<{ manifest: PackageManifest; cliPath: string }> {
  return validatePackageRoot(
    join(projectRoot, "node_modules", "@evenrealities", "even-terminal"),
    expectedVersion
  );
}

async function validatePackageRoot(
  packageRoot: string,
  expectedVersion: string
): Promise<{ manifest: PackageManifest; cliPath: string }> {
  const packagePath = join(packageRoot, "package.json");
  let value: unknown;
  try {
    value = JSON.parse(await readFile(packagePath, "utf8"));
  } catch (error) {
    throw new Error(`Unable to read runtime manifest at ${packagePath}`, {
      cause: error
    });
  }
  const manifest = normalizeManifest(value);
  if (manifest.name !== PACKAGE_NAME) {
    throw new Error(`Unexpected runtime package name: ${manifest.name}`);
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `Expected runtime ${expectedVersion}, found ${manifest.version}`
    );
  }
  const bin =
    typeof manifest.bin === "string"
      ? manifest.bin
      : manifest.bin["even-terminal"];
  if (!bin) {
    throw new Error("Runtime package does not define the even-terminal binary");
  }
  const cliPath = resolve(packageRoot, bin);
  const relativeCliPath = relative(packageRoot, cliPath);
  if (
    relativeCliPath === ".." ||
    relativeCliPath.startsWith(`..${sep}`) ||
    isAbsolute(relativeCliPath)
  ) {
    throw new Error("Runtime binary points outside its package");
  }
  const stat = await lstat(cliPath);
  if (!stat.isFile()) {
    throw new Error(`Runtime binary is not a file: ${cliPath}`);
  }
  await access(cliPath);
  return { manifest, cliPath };
}

function normalizeManifest(value: unknown): PackageManifest {
  if (
    !isRecord(value) ||
    typeof value.name !== "string" ||
    typeof value.version !== "string" ||
    (typeof value.bin !== "string" && !isStringRecord(value.bin))
  ) {
    throw new Error("Invalid Even Terminal package manifest");
  }
  return {
    name: value.name,
    version: normalizeVersion(value.version),
    bin: value.bin
  };
}

function normalizePointer(value: unknown): RuntimePointer {
  if (!isRecord(value)) {
    throw new Error("Invalid runtime pointer");
  }
  if (value.kind === "bundled") {
    return { kind: "bundled" };
  }
  if (value.kind === "installed" && typeof value.version === "string") {
    return { kind: "installed", version: normalizeVersion(value.version) };
  }
  throw new Error("Invalid runtime pointer");
}

function normalizeVersion(value: string): string {
  const normalized = validSemver(value);
  if (normalized === null || normalized !== value) {
    throw new Error(`Invalid exact runtime version: ${value}`);
  }
  return normalized;
}

function defaultRuntimeState(): RuntimeStateDocument {
  return {
    schemaVersion: RUNTIME_STATE_SCHEMA_VERSION,
    active: { kind: "bundled" },
    previous: null
  };
}

function pointersEqual(left: RuntimePointer, right: RuntimePointer): boolean {
  return (
    left.kind === right.kind &&
    (left.kind === "bundled" ||
      (right.kind === "installed" && left.version === right.version))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    isRecord(value) &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
