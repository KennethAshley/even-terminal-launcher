import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { ProfileStore } from "../src/main/profile-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "profile-store-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("ProfileStore", () => {
  it("persists normalized profiles and supports CRUD", async () => {
    const directory = await temporaryDirectory();
    let sequence = 0;
    const store = new ProfileStore(directory, {
      idFactory: () => `profile-${++sequence}`,
      now: () => new Date("2026-07-03T01:02:03.000Z")
    });

    const created = await store.save({
      displayName: "  Project A  ",
      projectDirectory: ".",
      defaultProvider: "claude",
      transport: { type: "interface", name: "  en0  " }
    });

    expect(created).toMatchObject({
      id: "profile-1",
      displayName: "Project A",
      projectDirectory: resolve("."),
      defaultProvider: "claude",
      clientName: "Project A",
      transport: { type: "interface", name: "en0" },
      autoStartWithLauncher: false,
      restartPolicy: "never",
      lastStartedAt: null
    });

    const updated = await store.save({
      id: created.id,
      displayName: "Project A renamed",
      projectDirectory: created.projectDirectory,
      defaultProvider: "codex",
      httpPort: created.httpPort,
      codexAppServerPort: created.codexAppServerPort,
      clientName: "Client A",
      transport: { type: "tailscale" },
      autoStartWithLauncher: true,
      restartPolicy: "on-crash"
    });
    expect(updated).toMatchObject({
      id: created.id,
      displayName: "Project A renamed",
      defaultProvider: "codex",
      clientName: "Client A",
      transport: { type: "tailscale" },
      autoStartWithLauncher: true,
      restartPolicy: "on-crash"
    });
    expect(updated.createdAt).toBe(created.createdAt);

    const startedAt = new Date("2026-07-03T04:05:06.000Z");
    expect(await store.updateLastStarted(created.id, startedAt)).toMatchObject({
      lastStartedAt: startedAt.toISOString(),
      updatedAt: startedAt.toISOString()
    });

    const reloaded = new ProfileStore(directory);
    expect(await reloaded.get(created.id)).toMatchObject({
      displayName: "Project A renamed",
      lastStartedAt: startedAt.toISOString()
    });
    expect(await reloaded.list()).toHaveLength(1);

    const onDisk = JSON.parse(
      await readFile(join(directory, "profiles.json"), "utf8")
    ) as { schemaVersion: number; profiles: unknown[] };
    expect(onDisk.schemaVersion).toBe(1);
    expect(onDisk.profiles).toHaveLength(1);

    await reloaded.delete(created.id);
    expect(await reloaded.get(created.id)).toBeNull();
    expect(await reloaded.list()).toEqual([]);
  });

  it("automatically allocates globally unique HTTP and Codex ports", async () => {
    const directory = await temporaryDirectory();
    let sequence = 0;
    const store = new ProfileStore(directory, {
      idFactory: () => `profile-${++sequence}`
    });

    const first = await store.save({
      displayName: "First",
      projectDirectory: ".",
      defaultProvider: "codex",
      transport: { type: "lan" }
    });
    const second = await store.save({
      displayName: "Second",
      projectDirectory: ".",
      defaultProvider: "claude",
      transport: { type: "lan" }
    });

    expect([
      first.httpPort,
      first.codexAppServerPort,
      second.httpPort,
      second.codexAppServerPort
    ]).toEqual([3456, 8765, 3457, 8766]);

    await expect(
      store.save({
        id: second.id,
        displayName: second.displayName,
        projectDirectory: second.projectDirectory,
        defaultProvider: second.defaultProvider,
        httpPort: first.codexAppServerPort,
        codexAppServerPort: second.codexAppServerPort,
        clientName: second.clientName,
        transport: second.transport,
        autoStartWithLauncher: second.autoStartWithLauncher,
        restartPolicy: second.restartPolicy
      })
    ).rejects.toThrow("already assigned");

    expect(await store.get(second.id)).toMatchObject({
      httpPort: 3457,
      codexAppServerPort: 8766
    });
  });
});
