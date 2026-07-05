import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type {
  Profile,
  ProfileInput,
  Provider,
  RestartPolicy,
  Transport
} from "../shared/types.js";

const PROFILE_SCHEMA_VERSION = 1;
const DEFAULT_HTTP_PORT = 3456;
const DEFAULT_CODEX_PORT = 8765;

interface ProfileDocument {
  schemaVersion: typeof PROFILE_SCHEMA_VERSION;
  profiles: Profile[];
}

export interface ProfileStoreOptions {
  fileName?: string;
  now?: () => Date;
  idFactory?: () => string;
}

export class ProfileStore {
  readonly filePath: string;

  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly loaded: Promise<void>;
  private profiles: Profile[] = [];
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string, options: ProfileStoreOptions = {}) {
    this.filePath = join(userDataDirectory, options.fileName ?? "profiles.json");
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
    this.loaded = this.load();
  }

  async list(): Promise<Profile[]> {
    await this.loaded;
    await this.operationQueue;
    return this.profiles.map(cloneProfile);
  }

  async get(id: string): Promise<Profile | null> {
    await this.loaded;
    await this.operationQueue;
    const profile = this.profiles.find((candidate) => candidate.id === id);
    return profile ? cloneProfile(profile) : null;
  }

  async save(input: ProfileInput): Promise<Profile> {
    return this.mutate(async () => {
      const before = this.profiles;
      const existingIndex = input.id
        ? this.profiles.findIndex((candidate) => candidate.id === input.id)
        : -1;

      const existing = existingIndex >= 0 ? this.profiles[existingIndex] : null;
      const now = this.now().toISOString();
      const profile = normalizeProfileInput(
        input,
        existing ?? undefined,
        this.profiles.filter((candidate) => candidate.id !== existing?.id),
        now,
        this.idFactory
      );

      this.profiles =
        existingIndex >= 0
          ? this.profiles.map((candidate, index) =>
              index === existingIndex ? profile : candidate
            )
          : [...this.profiles, profile];
      try {
        await this.persist();
      } catch (error) {
        this.profiles = before;
        throw error;
      }
      return cloneProfile(profile);
    });
  }

  async delete(id: string): Promise<void> {
    await this.mutate(async () => {
      const before = this.profiles;
      const next = this.profiles.filter((profile) => profile.id !== id);
      if (next.length === this.profiles.length) {
        return;
      }
      this.profiles = next;
      try {
        await this.persist();
      } catch (error) {
        this.profiles = before;
        throw error;
      }
    });
  }

  async updateLastStarted(id: string, startedAt = this.now()): Promise<Profile> {
    return this.mutate(async () => {
      const before = this.profiles;
      const index = this.profiles.findIndex((profile) => profile.id === id);
      const existing = this.profiles[index];
      if (!existing) {
        throw new Error(`Profile not found: ${id}`);
      }
      const timestamp = startedAt.toISOString();
      const updated: Profile = {
        ...existing,
        updatedAt: timestamp,
        lastStartedAt: timestamp
      };
      this.profiles = this.profiles.map((profile, profileIndex) =>
        profileIndex === index ? updated : profile
      );
      try {
        await this.persist();
      } catch (error) {
        this.profiles = before;
        throw error;
      }
      return cloneProfile(updated);
    });
  }

  private async load(): Promise<void> {
    let contents: string;
    try {
      contents = await readFile(this.filePath, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(contents);
    } catch (error) {
      throw new Error(`Unable to parse profile store at ${this.filePath}`, {
        cause: error
      });
    }
    if (!isRecord(parsed) || parsed.schemaVersion !== PROFILE_SCHEMA_VERSION) {
      throw new Error(`Unsupported profile store schema at ${this.filePath}`);
    }
    if (!Array.isArray(parsed.profiles)) {
      throw new Error(`Invalid profile store at ${this.filePath}`);
    }

    const normalized: Profile[] = [];
    for (const rawProfile of parsed.profiles) {
      normalized.push(normalizeStoredProfile(rawProfile, normalized));
    }
    this.profiles = normalized;
  }

  private async persist(): Promise<void> {
    const document: ProfileDocument = {
      schemaVersion: PROFILE_SCHEMA_VERSION,
      profiles: this.profiles
    };
    await atomicWriteJson(this.filePath, document);
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    await this.loaded;
    const result = this.operationQueue.then(operation, operation);
    this.operationQueue = result.then(
      () => undefined,
      () => undefined
    );
    return result;
  }
}

function normalizeProfileInput(
  input: ProfileInput,
  existing: Profile | undefined,
  otherProfiles: Profile[],
  now: string,
  idFactory: () => string
): Profile {
  const displayName = requiredText(input.displayName, "displayName");
  const projectDirectory = resolve(
    requiredText(input.projectDirectory, "projectDirectory")
  );
  const defaultProvider = normalizeProvider(input.defaultProvider);
  const occupiedPorts = new Set(
    otherProfiles.flatMap((profile) => [
      profile.httpPort,
      profile.codexAppServerPort
    ])
  );
  const httpPort = selectPort(
    input.httpPort ?? existing?.httpPort,
    DEFAULT_HTTP_PORT,
    occupiedPorts,
    "httpPort"
  );
  occupiedPorts.add(httpPort);
  const codexAppServerPort = selectPort(
    input.codexAppServerPort ?? existing?.codexAppServerPort,
    DEFAULT_CODEX_PORT,
    occupiedPorts,
    "codexAppServerPort"
  );

  return {
    id:
      existing?.id ??
      normalizeId(
        input.id,
        idFactory,
        new Set(otherProfiles.map((profile) => profile.id))
      ),
    displayName,
    projectDirectory,
    defaultProvider,
    httpPort,
    codexAppServerPort,
    clientName: optionalText(input.clientName) ?? existing?.clientName ?? displayName,
    transport: normalizeTransport(input.transport),
    autoStartWithLauncher:
      input.autoStartWithLauncher ?? existing?.autoStartWithLauncher ?? false,
    restartPolicy: normalizeRestartPolicy(
      input.restartPolicy ?? existing?.restartPolicy ?? "never"
    ),
    preferredEvenTerminalVersion:
      existing?.preferredEvenTerminalVersion ?? null,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    lastStartedAt: existing?.lastStartedAt ?? null
  };
}

function normalizeStoredProfile(
  value: unknown,
  precedingProfiles: Profile[]
): Profile {
  if (!isRecord(value)) {
    throw new Error("Invalid profile entry");
  }
  const id = requiredText(value.id, "id");
  if (precedingProfiles.some((profile) => profile.id === id)) {
    throw new Error(`Duplicate profile id: ${id}`);
  }
  const displayName = requiredText(value.displayName, "displayName");
  const httpPort = requiredPort(value.httpPort, "httpPort");
  const codexAppServerPort = requiredPort(
    value.codexAppServerPort,
    "codexAppServerPort"
  );
  if (httpPort === codexAppServerPort) {
    throw new Error(`Profile ${id} uses the same HTTP and Codex port`);
  }
  const precedingPorts = new Set(
    precedingProfiles.flatMap((profile) => [
      profile.httpPort,
      profile.codexAppServerPort
    ])
  );
  if (precedingPorts.has(httpPort) || precedingPorts.has(codexAppServerPort)) {
    throw new Error(`Profile ${id} uses a port assigned to another profile`);
  }

  return {
    id,
    displayName,
    projectDirectory: resolve(
      requiredText(value.projectDirectory, "projectDirectory")
    ),
    defaultProvider: normalizeProvider(value.defaultProvider),
    httpPort,
    codexAppServerPort,
    clientName: optionalText(value.clientName) ?? displayName,
    transport: normalizeTransport(value.transport),
    autoStartWithLauncher: optionalBoolean(
      value.autoStartWithLauncher,
      "autoStartWithLauncher",
      false
    ),
    restartPolicy: normalizeRestartPolicy(value.restartPolicy ?? "never"),
    preferredEvenTerminalVersion:
      value.preferredEvenTerminalVersion === null ||
      value.preferredEvenTerminalVersion === undefined
        ? null
        : requiredText(
            value.preferredEvenTerminalVersion,
            "preferredEvenTerminalVersion"
          ),
    createdAt: requiredIsoDate(value.createdAt, "createdAt"),
    updatedAt: requiredIsoDate(value.updatedAt, "updatedAt"),
    lastStartedAt:
      value.lastStartedAt === null || value.lastStartedAt === undefined
        ? null
        : requiredIsoDate(value.lastStartedAt, "lastStartedAt")
  };
}

function normalizeProvider(value: unknown): Provider {
  if (value === "claude" || value === "codex") {
    return value;
  }
  throw new Error(`Invalid provider: ${String(value)}`);
}

function normalizeRestartPolicy(value: unknown): RestartPolicy {
  if (value === "never" || value === "on-crash") {
    return value;
  }
  throw new Error(`Invalid restart policy: ${String(value)}`);
}

function normalizeTransport(value: unknown): Transport {
  if (!isRecord(value)) {
    throw new Error("Invalid transport");
  }
  if (value.type === "lan" || value.type === "tailscale") {
    return { type: value.type };
  }
  if (value.type === "interface") {
    return { type: "interface", name: requiredText(value.name, "transport.name") };
  }
  if (
    value.type === "expose" &&
    (value.provider === "pinggy" ||
      value.provider === "bore" ||
      value.provider === "ngrok")
  ) {
    return { type: "expose", provider: value.provider };
  }
  throw new Error("Invalid transport");
}

function normalizeId(
  value: unknown,
  idFactory: () => string,
  occupied: Set<string>
): string {
  if (value !== undefined) {
    const id = requiredText(value, "id");
    if (occupied.has(id)) {
      throw new Error(`Duplicate profile id: ${id}`);
    }
    return id;
  }
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const id = requiredText(idFactory(), "generated id");
    if (!occupied.has(id)) {
      return id;
    }
  }
  throw new Error("Unable to generate a unique profile id");
}

function selectPort(
  requested: number | undefined,
  firstCandidate: number,
  occupied: Set<number>,
  field: string
): number {
  if (requested !== undefined) {
    const port = requiredPort(requested, field);
    if (occupied.has(port)) {
      throw new Error(`${field} ${port} is already assigned to another profile`);
    }
    return port;
  }
  for (let candidate = firstCandidate; candidate <= 65_535; candidate += 1) {
    if (!occupied.has(candidate)) {
      return candidate;
    }
  }
  throw new Error(`No available ${field}`);
}

function requiredPort(value: unknown, field: string): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < 1 ||
    value > 65_535
  ) {
    throw new Error(`${field} must be an integer from 1 through 65535`);
  }
  return value;
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error("Expected a string");
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function optionalBoolean(
  value: unknown,
  field: string,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }
  if (typeof value !== "boolean") {
    throw new Error(`${field} must be a boolean`);
  }
  return value;
}

function requiredIsoDate(value: unknown, field: string): string {
  const text = requiredText(value, field);
  if (Number.isNaN(Date.parse(text))) {
    throw new Error(`${field} must be an ISO date`);
  }
  return new Date(text).toISOString();
}

function cloneProfile(profile: Profile): Profile {
  return {
    ...profile,
    transport: { ...profile.transport }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error;
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
