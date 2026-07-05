import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsStore } from "../src/main/settings-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("SettingsStore", () => {
  it("persists locale preference and preserves existing schema files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "settings-store-test-"));
    temporaryDirectories.push(directory);
    const store = new SettingsStore(directory);
    expect((await store.get()).locale).toBe("system");

    await store.setLocale("en");
    await store.setLaunchAtLogin(true);

    const reloaded = new SettingsStore(directory);
    expect(await reloaded.get()).toMatchObject({
      schemaVersion: 1,
      locale: "en",
      launchAtLogin: true
    });
  });

  it("rejects unsupported locale values", async () => {
    const directory = await mkdtemp(join(tmpdir(), "settings-store-test-"));
    temporaryDirectories.push(directory);
    const store = new SettingsStore(directory);

    await expect(
      store.setLocale("fr" as never)
    ).rejects.toThrow("Unsupported locale");
  });

  it("persists every supported locale", async () => {
    const directory = await mkdtemp(join(tmpdir(), "settings-store-test-"));
    temporaryDirectories.push(directory);
    const store = new SettingsStore(directory);

    for (const locale of ["ja", "en", "zh-CN", "zh-TW", "ko", "es"] as const) {
      expect((await store.setLocale(locale)).locale).toBe(locale);
    }
  });
});
