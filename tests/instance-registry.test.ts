import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanupStaleInstanceFiles } from "../src/main/instance-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

async function makeRegistry(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "instance-registry-"));
  temporaryDirectories.push(root);
  const directory = join(root, "instances");
  await mkdir(directory);
  return directory;
}

describe("cleanupStaleInstanceFiles", () => {
  it("removes stopped instances and retains live instances", async () => {
    const directory = await makeRegistry();
    await writeFile(join(directory, "101.json"), JSON.stringify({ pid: 101 }));
    await writeFile(join(directory, "202.json"), JSON.stringify({ pid: 202 }));
    const isProcessAlive = vi.fn((pid: number) => pid === 202);

    const result = await cleanupStaleInstanceFiles({
      directory,
      isProcessAlive
    });

    expect(result).toEqual({
      removed: ["101.json"],
      retained: ["202.json"]
    });
    await expect(readFile(join(directory, "101.json"))).rejects.toMatchObject({
      code: "ENOENT"
    });
    await expect(readFile(join(directory, "202.json"), "utf8")).resolves.toContain(
      '"pid":202'
    );
  });

  it("removes malformed and mismatched registry files", async () => {
    const directory = await makeRegistry();
    await writeFile(join(directory, "bad.json"), "{");
    await writeFile(join(directory, "303.json"), JSON.stringify({ pid: 404 }));

    const result = await cleanupStaleInstanceFiles({
      directory,
      isProcessAlive: () => true
    });

    expect(result.removed).toEqual(["303.json", "bad.json"]);
    expect(result.retained).toEqual([]);
  });

  it("does nothing when the registry directory does not exist", async () => {
    const root = await mkdtemp(join(tmpdir(), "instance-registry-missing-"));
    temporaryDirectories.push(root);

    await expect(
      cleanupStaleInstanceFiles({ directory: join(root, "missing") })
    ).resolves.toEqual({ removed: [], retained: [] });
  });
});
