import { EventEmitter } from "node:events";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile, ProcessState } from "../src/shared/types.js";

vi.mock("electron", () => ({
  utilityProcess: { fork: vi.fn() }
}));

import {
  buildEvenTerminalArgs,
  ProcessSupervisor,
  type UtilityProcessLike
} from "../src/main/process-supervisor.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

class FakeUtilityProcess extends EventEmitter implements UtilityProcessLike {
  pid: number | undefined = 4242;
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  killCalls = 0;

  kill(): boolean {
    this.killCalls += 1;
    queueMicrotask(() => {
      this.pid = undefined;
      this.emit("exit", 0);
    });
    return true;
  }
}

async function twoFreePorts(): Promise<[number, number]> {
  const first = createServer();
  const second = createServer();
  await Promise.all([
    new Promise<void>((resolve, reject) => {
      first.once("error", reject);
      first.listen(0, "127.0.0.1", resolve);
    }),
    new Promise<void>((resolve, reject) => {
      second.once("error", reject);
      second.listen(0, "127.0.0.1", resolve);
    })
  ]);
  const firstAddress = first.address();
  const secondAddress = second.address();
  if (
    !firstAddress ||
    typeof firstAddress === "string" ||
    !secondAddress ||
    typeof secondAddress === "string"
  ) {
    throw new Error("Failed to reserve test ports");
  }
  const ports: [number, number] = [firstAddress.port, secondAddress.port];
  await Promise.all([
    new Promise<void>((resolve) => first.close(() => resolve())),
    new Promise<void>((resolve) => second.close(() => resolve()))
  ]);
  return ports;
}

async function makeProfile(
  transport: Profile["transport"] = { type: "tailscale" }
): Promise<Profile> {
  const projectDirectory = await mkdtemp(join(tmpdir(), "supervisor-project-"));
  temporaryDirectories.push(projectDirectory);
  const [httpPort, codexAppServerPort] = await twoFreePorts();
  const now = new Date().toISOString();
  return {
    id: "profile-a",
    displayName: "Project A",
    projectDirectory,
    defaultProvider: "codex",
    httpPort,
    codexAppServerPort,
    clientName: "Project A on Mac",
    transport,
    autoStartWithLauncher: false,
    restartPolicy: "never",
    preferredEvenTerminalVersion: null,
    createdAt: now,
    updatedAt: now,
    lastStartedAt: null
  };
}

describe("ProcessSupervisor", () => {
  it("builds transport arguments without placing the token on argv", async () => {
    const profile = await makeProfile({
      type: "expose",
      provider: "ngrok"
    });

    expect(buildEvenTerminalArgs(profile)).toEqual([
      "start",
      "--port",
      String(profile.httpPort),
      "--cwd",
      profile.projectDirectory,
      "--provider",
      "codex",
      "--name",
      "Project A on Mac",
      "--log-file",
      process.platform === "win32" ? "NUL" : "/dev/null",
      "--expose",
      "ngrok"
    ]);
  });

  it("reaches ready, redacts logs, and stops the utility process", async () => {
    const profile = await makeProfile();
    const logRoot = join(profile.projectDirectory, "launcher-logs");
    const token = "super-secret-bridge-token-123";
    const child = new FakeUtilityProcess();
    const states: ProcessState[] = [];
    let invocation:
      | {
          modulePath: string;
          args: string[];
          options: Electron.ForkOptions;
        }
      | undefined;
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));

    const supervisor = new ProcessSupervisor({
      cliPathForProfile: () => process.execPath,
      tokenForProfile: () => token,
      logRoot,
      executableResolver: {
        childEnvironment: async () => ({ PATH: process.env.PATH })
      },
      forkProcess: (modulePath, args, options) => {
        invocation = { modulePath, args, options };
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
      fetch: fetchMock,
      onStateChange: (state) => states.push(state)
    });

    await supervisor.start(profile);

    expect(supervisor.getState(profile.id)).toMatchObject({
      phase: "ready",
      pid: 4242,
      error: null
    });
    expect(invocation).toBeDefined();
    if (!invocation) throw new Error("Expected utility process invocation");
    expect(invocation.modulePath).toBe(process.execPath);
    expect(invocation.args).toContain("--tailscale");
    expect(invocation.args).not.toContain(token);
    expect(invocation.options.env).toMatchObject({
      BRIDGE_TOKEN: token,
      CODEX_APP_SERVER_PORT: String(profile.codexAppServerPort),
      PORT: String(profile.httpPort)
    });
    expect(fetchMock).toHaveBeenCalledWith(
      `http://127.0.0.1:${profile.httpPort}/api/metrics?token=${encodeURIComponent(token)}`,
      expect.objectContaining({ cache: "no-store" })
    );

    child.stdout.write(`Full token: ${token}\n`);
    child.stdout.write("\u001B[40m████████████\u001B[0m\n");

    await supervisor.stop(profile.id);

    expect(child.killCalls).toBe(1);
    expect(supervisor.getState(profile.id)).toMatchObject({
      phase: "stopped",
      pid: null,
      error: null
    });
    expect(states.map((state) => state.phase)).toEqual(
      expect.arrayContaining(["starting", "ready", "stopping", "stopped"])
    );

    const log = await readFile(supervisor.getLogPath(profile.id), "utf8");
    expect(log).not.toContain(token);
    expect(log).toContain("Full token: [REDACTED]");
    expect(log).toContain("[QR code redacted]");
  });

  it("terminates the full process tree on Windows", async () => {
    const profile = await makeProfile({ type: "lan" });
    const child = new FakeUtilityProcess();
    const terminate = vi.fn(async () => {
      queueMicrotask(() => child.emit("exit", 0));
    });
    const supervisor = new ProcessSupervisor({
      cliPathForProfile: () => process.execPath,
      tokenForProfile: () => "windows-test-token".repeat(3),
      logRoot: join(profile.projectDirectory, "logs"),
      platform: "win32",
      terminateProcessTree: terminate,
      executableResolver: { childEnvironment: async () => ({ PATH: "" }) },
      forkProcess: () => {
        queueMicrotask(() => child.emit("spawn"));
        return child;
      },
      fetch: async () => new Response("{}", { status: 200 })
    });

    await supervisor.start(profile);
    await supervisor.stop(profile.id);

    expect(terminate).toHaveBeenCalledWith(4242, false);
    expect(child.killCalls).toBe(0);
    expect(supervisor.getState(profile.id).phase).toBe("stopped");
  });
});
