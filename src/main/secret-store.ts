import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";

import { safeStorage } from "electron";

const SECRET_SCHEMA_VERSION = 1;

interface SecretDocument {
  schemaVersion: typeof SECRET_SCHEMA_VERSION;
  profileTokens: Record<string, string>;
}

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean;
  encryptString(plainText: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

export interface SecretStoreOptions {
  fileName?: string;
  safeStorage?: SafeStorageAdapter;
  tokenFactory?: () => string;
}

export class SecretStore {
  readonly filePath: string;

  private readonly encryption: SafeStorageAdapter;
  private readonly tokenFactory: () => string;
  private readonly loaded: Promise<void>;
  private profileTokens: Record<string, string> = {};
  private operationQueue: Promise<void> = Promise.resolve();

  constructor(userDataDirectory: string, options: SecretStoreOptions = {}) {
    this.filePath = join(userDataDirectory, options.fileName ?? "secrets.json");
    this.encryption = options.safeStorage ?? safeStorage;
    this.tokenFactory =
      options.tokenFactory ?? (() => randomBytes(32).toString("base64url"));
    this.loaded = this.load();
  }

  async getOrCreateToken(profileId: string): Promise<string> {
    const normalizedId = normalizeProfileId(profileId);
    return this.mutate(async () => {
      this.assertEncryptionAvailable();
      const encrypted = this.profileTokens[normalizedId];
      if (encrypted) {
        try {
          return this.encryption.decryptString(Buffer.from(encrypted, "base64"));
        } catch (error) {
          throw new Error(`Unable to decrypt token for profile ${normalizedId}`, {
            cause: error
          });
        }
      }

      const token = this.tokenFactory();
      if (token.length < 32) {
        throw new Error("Generated profile token is unexpectedly short");
      }
      const encryptedToken = this.encryption
        .encryptString(token)
        .toString("base64");
      const before = this.profileTokens;
      this.profileTokens = {
        ...before,
        [normalizedId]: encryptedToken
      };
      try {
        await this.persist();
      } catch (error) {
        this.profileTokens = before;
        throw error;
      }
      return token;
    });
  }

  async deleteToken(profileId: string): Promise<void> {
    const normalizedId = normalizeProfileId(profileId);
    await this.mutate(async () => {
      if (!(normalizedId in this.profileTokens)) {
        return;
      }
      const before = this.profileTokens;
      const remaining = { ...before };
      delete remaining[normalizedId];
      this.profileTokens = remaining;
      try {
        await this.persist();
      } catch (error) {
        this.profileTokens = before;
        throw error;
      }
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
      throw new Error(`Unable to parse secret store at ${this.filePath}`, {
        cause: error
      });
    }
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== SECRET_SCHEMA_VERSION ||
      !isRecord(parsed.profileTokens)
    ) {
      throw new Error(`Unsupported or invalid secret store at ${this.filePath}`);
    }

    const tokens: Record<string, string> = {};
    for (const [profileId, encrypted] of Object.entries(parsed.profileTokens)) {
      if (typeof encrypted !== "string" || encrypted.length === 0) {
        throw new Error(`Invalid encrypted token for profile ${profileId}`);
      }
      tokens[normalizeProfileId(profileId)] = encrypted;
    }
    this.profileTokens = tokens;
  }

  private assertEncryptionAvailable(): void {
    if (!this.encryption.isEncryptionAvailable()) {
      throw new Error(
        "Secure token storage is unavailable. Unlock the operating system credential store and try again."
      );
    }
  }

  private async persist(): Promise<void> {
    const document: SecretDocument = {
      schemaVersion: SECRET_SCHEMA_VERSION,
      profileTokens: this.profileTokens
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

function normalizeProfileId(value: string): string {
  const normalized = value.trim();
  if (normalized.length === 0) {
    throw new Error("profileId must be a non-empty string");
  }
  return normalized;
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
