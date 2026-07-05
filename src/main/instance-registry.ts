import { readdir, readFile, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface InstanceRegistryCleanupOptions {
  directory?: string;
  isProcessAlive?: (pid: number) => boolean;
}

export interface InstanceRegistryCleanupResult {
  removed: string[];
  retained: string[];
}

export async function cleanupStaleInstanceFiles(
  options: InstanceRegistryCleanupOptions = {}
): Promise<InstanceRegistryCleanupResult> {
  const directory =
    options.directory ?? join(homedir(), ".even-terminal", "instances");
  const isProcessAlive = options.isProcessAlive ?? defaultIsProcessAlive;
  const result: InstanceRegistryCleanupResult = { removed: [], retained: [] };

  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return result;
    throw error;
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) continue;

    const path = join(directory, entry.name);
    let pid: number | null = null;
    try {
      const value: unknown = JSON.parse(await readFile(path, "utf8"));
      if (
        typeof value === "object" &&
        value !== null &&
        "pid" in value &&
        Number.isSafeInteger(value.pid) &&
        Number(value.pid) > 0 &&
        entry.name === `${String(value.pid)}.json`
      ) {
        pid = Number(value.pid);
      }
    } catch {
      // Invalid registry files cannot represent a live instance.
    }

    if (pid !== null && isProcessAlive(pid)) {
      result.retained.push(entry.name);
      continue;
    }

    try {
      await unlink(path);
      result.removed.push(entry.name);
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") throw error;
    }
  }

  return result;
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return isNodeError(error) && error.code === "EPERM";
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
