import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const electronRoot = join(process.cwd(), "node_modules", "electron");
const pathFile = join(electronRoot, "path.txt");
const relativeExecutable =
  process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : process.platform === "win32"
      ? "electron.exe"
      : "electron";

const executablePath = join(electronRoot, "dist", relativeExecutable);
const require = createRequire(import.meta.url);

try {
  await ensureCompleteMacInstall();
  await access(executablePath);
  let configured = "";
  try {
    configured = await readFile(pathFile, "utf8");
  } catch {
    // The Electron postinstall did not create path.txt on this npm runtime.
  }
  if (configured !== relativeExecutable) {
    await writeFile(pathFile, relativeExecutable, "utf8");
  }
} catch {
  // Electron may be intentionally omitted for production-only installs.
}

async function ensureCompleteMacInstall() {
  if (process.platform !== "darwin") return;
  const framework = join(
    electronRoot,
    "dist",
    "Electron.app",
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Electron Framework"
  );
  try {
    await Promise.all([access(executablePath), access(framework)]);
    return;
  } catch {
    // Node 26 can let Electron's legacy postinstall exit during extract-zip.
    // Await the download ourselves and use macOS ditto for a complete bundle.
  }

  const { downloadArtifact } = require("@electron/get");
  const { version } = require(join(electronRoot, "package.json"));
  const zipPath = await downloadArtifact({
    version,
    artifactName: "electron",
    platform: "darwin",
    arch: process.arch
  });
  const dist = join(electronRoot, "dist");
  await rm(dist, { recursive: true, force: true });
  await mkdir(dist, { recursive: true });
  await promisify(execFile)("/usr/bin/ditto", ["-x", "-k", zipPath, dist]);
  await Promise.all([access(executablePath), access(framework)]);
}
