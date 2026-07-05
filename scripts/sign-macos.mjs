import { execFile } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

if (process.platform === "darwin") {
  const manifest = JSON.parse(await readFile("package.json", "utf8"));
  const productName = manifest.productName ?? manifest.name;
  const candidates = [productName, manifest.name].map((name) =>
    join(process.cwd(), "out", `${name}-darwin-${process.arch}`, `${name}.app`)
  );
  const appPath = await firstExistingPath(candidates);
  await promisify(execFile)("/usr/bin/codesign", [
    "--force",
    "--deep",
    "--sign",
    "-",
    appPath
  ]);
  await promisify(execFile)("/usr/bin/codesign", [
    "--verify",
    "--deep",
    "--strict",
    appPath
  ]);
}

async function firstExistingPath(candidates) {
  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the package-name fallback used by Electron Packager.
    }
  }
  throw new Error(`Packaged macOS app not found:\n${candidates.join("\n")}`);
}
