import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ safeStorage: undefined }));

import {
  SecretStore,
  type SafeStorageAdapter
} from "../src/main/secret-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "secret-store-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function fakeSafeStorage(): SafeStorageAdapter {
  return {
    isEncryptionAvailable: () => true,
    encryptString: (plainText) => Buffer.from(`encrypted:${plainText}`, "utf8"),
    decryptString: (encrypted) =>
      encrypted.toString("utf8").replace(/^encrypted:/, "")
  };
}

describe("SecretStore", () => {
  it("encrypts a generated token and reuses it after reload", async () => {
    const directory = await temporaryDirectory();
    const encryption = fakeSafeStorage();
    const firstFactory = vi.fn(() => "a".repeat(43));
    const firstStore = new SecretStore(directory, {
      safeStorage: encryption,
      tokenFactory: firstFactory
    });

    const token = await firstStore.getOrCreateToken("profile-1");
    expect(token).toBe("a".repeat(43));
    expect(firstFactory).toHaveBeenCalledTimes(1);

    const contents = await readFile(join(directory, "secrets.json"), "utf8");
    expect(contents).not.toContain(token);
    expect(JSON.parse(contents)).toMatchObject({
      schemaVersion: 1,
      profileTokens: {
        "profile-1": expect.any(String)
      }
    });

    const secondFactory = vi.fn(() => "b".repeat(43));
    const reloadedStore = new SecretStore(directory, {
      safeStorage: encryption,
      tokenFactory: secondFactory
    });
    expect(await reloadedStore.getOrCreateToken("profile-1")).toBe(token);
    expect(secondFactory).not.toHaveBeenCalled();
  });

  it("deletes a profile token so a later request generates a new one", async () => {
    const directory = await temporaryDirectory();
    const tokens = ["a".repeat(43), "b".repeat(43)];
    const store = new SecretStore(directory, {
      safeStorage: fakeSafeStorage(),
      tokenFactory: () => {
        const token = tokens.shift();
        if (!token) throw new Error("No test token available");
        return token;
      }
    });

    expect(await store.getOrCreateToken("profile-1")).toBe("a".repeat(43));
    await store.deleteToken("profile-1");
    expect(await store.getOrCreateToken("profile-1")).toBe("b".repeat(43));
  });

  it("refuses to create tokens when OS encryption is unavailable", async () => {
    const directory = await temporaryDirectory();
    const store = new SecretStore(directory, {
      safeStorage: {
        ...fakeSafeStorage(),
        isEncryptionAvailable: () => false
      }
    });

    await expect(store.getOrCreateToken("profile-1")).rejects.toThrow(
      "Secure token storage is unavailable"
    );
  });
});
