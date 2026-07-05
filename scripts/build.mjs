import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });

await Promise.all([
  build({
    entryPoints: ["src/main/index.ts"],
    outfile: "dist/main.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron", "@evenrealities/even-terminal", "@npmcli/arborist"],
    sourcemap: true
  }),
  build({
    entryPoints: ["src/preload/index.ts"],
    outfile: "dist/preload.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    external: ["electron"],
    sourcemap: true
  }),
  build({
    entryPoints: ["src/main/runtime-worker.ts"],
    outfile: "dist/runtime-worker.cjs",
    bundle: true,
    platform: "node",
    format: "cjs",
    target: "node22",
    sourcemap: true
  }),
  build({
    entryPoints: ["src/renderer/index.ts"],
    outfile: "dist/renderer.js",
    bundle: true,
    platform: "browser",
    format: "iife",
    target: "chrome136",
    sourcemap: true
  })
]);

await Promise.all([
  cp("src/renderer/index.html", "dist/index.html"),
  cp("src/renderer/styles.css", "dist/styles.css"),
  cp("assets/app-icon.png", "dist/app-icon.png"),
  cp("assets/trayTemplate.png", "dist/trayTemplate.png"),
  cp("assets/trayTemplate@2x.png", "dist/trayTemplate@2x.png")
]);
