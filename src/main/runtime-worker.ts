import { pathToFileURL } from "node:url";

async function main(): Promise<void> {
  const marker = process.argv.indexOf("--launcher-cli");
  const separator = process.argv.indexOf("--", marker + 2);
  if (marker < 0 || separator < 0) {
    throw new Error(`Invalid runtime worker arguments: ${JSON.stringify(process.argv)}`);
  }

  const cliPath = process.argv[marker + 1];
  if (!cliPath) throw new Error("Even Terminal CLI path is missing");
  const cliArguments = process.argv.slice(separator + 1);

  // yargs detects a bundled Electron process and strips one argv item instead
  // of Node's usual two. Give it the bundled-Electron shape it expects.
  process.argv = [cliPath, ...cliArguments];
  await import(pathToFileURL(cliPath).href);
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
  );
  process.exitCode = 1;
});
