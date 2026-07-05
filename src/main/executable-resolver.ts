import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { ExecutableStatus } from "../shared/types.js";

const execFileAsync = promisify(execFile);
type ExecutableName = ExecutableStatus["name"];

export interface ExecutableResolverOptions {
  overrides?: Partial<Record<ExecutableName, string>>;
  env?: NodeJS.ProcessEnv;
  extraSearchDirectories?: readonly string[];
  platform?: NodeJS.Platform;
  homeDirectory?: string;
}

const MAC_SEARCH_DIRECTORIES = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  join(homedir(), ".local", "bin"),
  join(homedir(), ".local", "share", "mise", "shims"),
  join(homedir(), ".asdf", "shims"),
  join(homedir(), ".npm-global", "bin"),
  join(homedir(), ".bun", "bin"),
  join(homedir(), ".cargo", "bin")
];

async function isExecutable(
  path: string,
  platform: NodeJS.Platform
): Promise<boolean> {
  try {
    await access(
      path,
      platform === "win32" ? constants.F_OK : constants.X_OK
    );
    return true;
  } catch {
    return false;
  }
}

export class ExecutableResolver {
  private readonly overrides: Partial<Record<ExecutableName, string>>;
  private readonly env: NodeJS.ProcessEnv;
  private readonly searchDirectories: string[];
  private readonly platform: NodeJS.Platform;

  constructor(options: ExecutableResolverOptions = {}) {
    this.overrides = { ...options.overrides };
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    const home = options.homeDirectory ?? homedir();

    const pathDirectories = (this.env.PATH ?? "")
      .split(delimiter)
      .filter(Boolean);
    this.searchDirectories = [
      ...(options.extraSearchDirectories ?? []),
      ...pathDirectories,
      ...(this.platform === "darwin" ? MAC_SEARCH_DIRECTORIES : []),
      ...(this.platform === "win32"
        ? windowsSearchDirectories(this.env, home)
        : []),
      dirname(process.execPath)
    ].filter((value, index, all) => all.indexOf(value) === index);
  }

  async resolve(name: ExecutableName): Promise<string | null> {
    const override = this.overrides[name];
    if (override) {
      const overridePath = resolve(override);
      return (await isExecutable(overridePath, this.platform))
        ? overridePath
        : null;
    }

    for (const directory of this.searchDirectories) {
      for (const filename of executableFilenames(
        name,
        this.platform,
        this.env.PATHEXT
      )) {
        if (isAbsolute(filename) && (await isExecutable(filename, this.platform))) {
          return filename;
        }
        const candidate = join(directory, filename);
        if (await isExecutable(candidate, this.platform)) return candidate;
      }
    }
    return null;
  }

  async inspect(name: ExecutableName): Promise<ExecutableStatus> {
    const path = await this.resolve(name);
    if (!path) return { name, path: null, version: null, available: false };

    let version: string | null = null;
    try {
      const command = inspectionCommand(path, this.platform, this.env);
      const result = await execFileAsync(command.file, command.args, {
        env: this.env,
        timeout: 4_000,
        windowsHide: true
      });
      const text = `${result.stdout}\n${result.stderr}`.trim();
      version = text.split(/\r?\n/, 1)[0]?.trim() || null;
    } catch {
      // Availability is still useful when a tool has no conventional version flag.
    }

    return { name, path, version, available: true };
  }

  async inspectAll(): Promise<ExecutableStatus[]> {
    const names: ExecutableName[] = [
      "claude",
      "codex",
      "tailscale",
      "ssh",
      "bore",
      "ngrok"
    ];
    return Promise.all(names.map((name) => this.inspect(name)));
  }

  /**
   * Returns an environment suitable for a GUI-launched child process. macOS apps
   * do not inherit the interactive shell PATH, so discovered tool directories are
   * explicitly prepended.
   */
  async childEnvironment(): Promise<NodeJS.ProcessEnv> {
    const paths = [...this.searchDirectories];
    const resolved = await Promise.all(
      (["claude", "codex", "ssh", "bore", "ngrok"] as const).map(async (name) => ({
        name,
        path: await this.resolve(name)
      }))
    );

    for (const item of resolved) {
      if (item.path) paths.unshift(dirname(item.path));
    }

    const env: NodeJS.ProcessEnv = {
      ...this.env,
      PATH: paths.filter((value, index, all) => all.indexOf(value) === index).join(delimiter)
    };

    const ssh = resolved.find((item) => item.name === "ssh")?.path;
    const bore = resolved.find((item) => item.name === "bore")?.path;
    const ngrok = resolved.find((item) => item.name === "ngrok")?.path;
    if (ssh) env.PINGGY_PROGRAM_PATH = ssh;
    if (bore) env.BORE_PROGRAM_PATH = bore;
    if (ngrok) env.NGROK_PROGRAM_PATH = ngrok;

    return env;
  }
}

export function executableFilenames(
  name: ExecutableName,
  platform: NodeJS.Platform,
  pathExt?: string
): string[] {
  if (platform !== "win32") return [name];
  const extensions = (pathExt ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim().toLowerCase())
    .filter(Boolean);
  const candidates = extensions.map((extension) => `${name}${extension}`);
  return [...new Set([...candidates, name])];
}

function windowsSearchDirectories(
  env: NodeJS.ProcessEnv,
  home: string
): string[] {
  return [
    env.APPDATA ? join(env.APPDATA, "npm") : "",
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs") : "",
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "Codex") : "",
    env.LOCALAPPDATA ? join(env.LOCALAPPDATA, "Programs", "Claude") : "",
    env.LOCALAPPDATA
      ? join(env.LOCALAPPDATA, "Microsoft", "WindowsApps")
      : "",
    env.ProgramFiles ? join(env.ProgramFiles, "nodejs") : "",
    env.ProgramFiles ? join(env.ProgramFiles, "Tailscale") : "",
    env.ProgramFiles ? join(env.ProgramFiles, "ngrok") : "",
    env["ProgramFiles(x86)"]
      ? join(env["ProgramFiles(x86)"], "Tailscale")
      : "",
    join(home, ".local", "bin"),
    join(home, ".bun", "bin")
  ].filter(Boolean);
}

function inspectionCommand(
  executablePath: string,
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv
): { file: string; args: string[] } {
  if (
    platform === "win32" &&
    (executablePath.toLowerCase().endsWith(".cmd") ||
      executablePath.toLowerCase().endsWith(".bat"))
  ) {
    if (executablePath.includes('"')) {
      throw new Error("Windows executable path contains an invalid quote");
    }
    return {
      file: env.ComSpec ?? env.COMSPEC ?? "cmd.exe",
      args: ["/d", "/s", "/c", `"${executablePath}" --version`]
    };
  }
  return { file: executablePath, args: ["--version"] };
}
