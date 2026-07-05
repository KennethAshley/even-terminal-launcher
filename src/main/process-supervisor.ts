import { utilityProcess } from "electron";
import type { UtilityProcess } from "electron";
import { constants } from "node:fs";
import {
  access,
  appendFile,
  mkdir,
  rename,
  stat,
  unlink
} from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Profile, ProcessState } from "../shared/types.js";
import { ExecutableResolver } from "./executable-resolver.js";
import { isPortAvailable, PortAllocator } from "./port-allocator.js";
import { terminateWindowsProcessTree } from "./process-termination.js";
import { isQrCodeLogLine, redactSecrets } from "./redaction.js";

const DEFAULT_HEALTH_TIMEOUT_MS = 15_000;
const DEFAULT_STOP_TIMEOUT_MS = 5_000;
const DEFAULT_RECENT_LOG_LIMIT = 200;
const DEFAULT_LOG_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_LOG_BACKUPS = 3;

type MaybePromise<T> = T | Promise<T>;

export interface UtilityProcessLike {
  readonly pid: number | undefined;
  readonly stdout: NodeJS.ReadableStream | null;
  readonly stderr: NodeJS.ReadableStream | null;
  kill(): boolean;
  on(event: "spawn", listener: () => void): this;
  on(event: "exit", listener: (code: number) => void): this;
  on(
    event: "error",
    listener: (type: string, location: string, report: string) => void
  ): this;
}

export interface ProcessSupervisorOptions {
  cliPathForProfile(profile: Profile): MaybePromise<string>;
  tokenForProfile(profile: Profile): MaybePromise<string>;
  logRoot: string;
  executableResolver?: Pick<ExecutableResolver, "childEnvironment">;
  onStateChange?(state: ProcessState): void;
  portAllocator?: PortAllocator;
  forkProcess?: (
    modulePath: string,
    args: string[],
    options: Electron.ForkOptions
  ) => UtilityProcessLike;
  fetch?: typeof globalThis.fetch;
  healthTimeoutMs?: number;
  stopTimeoutMs?: number;
  recentLogLimit?: number;
  logMaxBytes?: number;
  logBackups?: number;
  workerPath?: string;
  platform?: NodeJS.Platform;
  terminateProcessTree?(pid: number, force: boolean): Promise<void>;
}

interface Deferred {
  promise: Promise<void>;
  resolve(): void;
  reject(error: Error): void;
  settled: boolean;
}

interface ManagedProcess {
  profile: Profile;
  token: string;
  child: UtilityProcessLike;
  log: RotatingLog;
  startedAt: string;
  expectedStop: boolean;
  preserveErrorOnExit: boolean;
  stdoutBuffer: string;
  stderrBuffer: string;
  qrOmitted: boolean;
  ready: Deferred;
  exited: Deferred;
}

function deferred(): Deferred {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: Error) => void;
  const value: Deferred = {
    promise: new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    resolve() {
      if (value.settled) return;
      value.settled = true;
      resolvePromise();
    },
    reject(error) {
      if (value.settled) return;
      value.settled = true;
      rejectPromise(error);
    },
    settled: false
  };
  return value;
}

function initialState(profileId: string): ProcessState {
  return {
    profileId,
    phase: "stopped",
    pid: null,
    startedAt: null,
    exitCode: null,
    error: null,
    publicUrl: null,
    recentLogs: []
  };
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_") || "profile";
}

function rawLogSink(): string {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

export function buildEvenTerminalArgs(profile: Profile): string[] {
  const args = [
    "start",
    "--port",
    String(profile.httpPort),
    "--cwd",
    profile.projectDirectory,
    "--provider",
    profile.defaultProvider,
    "--name",
    profile.clientName,
    "--log-file",
    rawLogSink()
  ];

  switch (profile.transport.type) {
    case "lan":
      break;
    case "tailscale":
      args.push("--tailscale");
      break;
    case "interface":
      args.push("--interface", profile.transport.name);
      break;
    case "expose":
      args.push("--expose", profile.transport.provider);
      break;
  }

  return args;
}

class RotatingLog {
  private queue = Promise.resolve();

  constructor(
    readonly path: string,
    private readonly maxBytes: number,
    private readonly backups: number
  ) {}

  append(line: string): void {
    this.queue = this.queue
      .then(async () => {
        await mkdir(dirname(this.path), { recursive: true });
        await this.rotateIfNeeded(Buffer.byteLength(line));
        await appendFile(this.path, line, "utf8");
      })
      .catch(() => {
        // Logging must never bring down a managed profile.
      });
  }

  async close(): Promise<void> {
    await this.queue;
  }

  private async rotateIfNeeded(incomingBytes: number): Promise<void> {
    let currentBytes = 0;
    try {
      currentBytes = (await stat(this.path)).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }

    if (currentBytes + incomingBytes <= this.maxBytes) return;

    if (this.backups <= 0) {
      await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      });
      return;
    }

    await unlink(`${this.path}.${this.backups}`).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      }
    );

    for (let index = this.backups - 1; index >= 1; index -= 1) {
      await rename(`${this.path}.${index}`, `${this.path}.${index + 1}`).catch(
        (error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        }
      );
    }

    await rename(this.path, `${this.path}.1`).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      }
    );
  }
}

export class ProcessSupervisor {
  private readonly entries = new Map<string, ManagedProcess>();
  private readonly states = new Map<string, ProcessState>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly restartAttempts = new Map<string, number>();
  private readonly resolver: Pick<ExecutableResolver, "childEnvironment">;
  private readonly allocator: PortAllocator;
  private readonly forkProcess: NonNullable<ProcessSupervisorOptions["forkProcess"]>;
  private readonly fetchImpl: typeof globalThis.fetch;
  private readonly platform: NodeJS.Platform;
  private readonly terminateProcessTree: (
    pid: number,
    force: boolean
  ) => Promise<void>;

  constructor(private readonly options: ProcessSupervisorOptions) {
    this.resolver = options.executableResolver ?? new ExecutableResolver();
    this.allocator = options.portAllocator ?? new PortAllocator();
    this.forkProcess =
      options.forkProcess ??
      ((modulePath, args, forkOptions) =>
        utilityProcess.fork(modulePath, args, forkOptions) as UtilityProcess);
    this.fetchImpl = options.fetch ?? globalThis.fetch;
    this.platform = options.platform ?? process.platform;
    this.terminateProcessTree =
      options.terminateProcessTree ?? terminateWindowsProcessTree;
  }

  async start(profile: Profile): Promise<void> {
    this.cancelRestart(profile.id);

    const existing = this.entries.get(profile.id);
    if (existing) {
      if (
        this.getState(profile.id).phase === "starting" ||
        this.getState(profile.id).phase === "ready"
      ) {
        return existing.ready.promise;
      }
      throw new Error(`Profile ${profile.id} is already stopping`);
    }

    const state = this.getState(profile.id);
    this.setState({
      ...state,
      phase: "starting",
      pid: null,
      startedAt: new Date().toISOString(),
      exitCode: null,
      error: null,
      publicUrl: null
    });

    try {
      await this.validateProfile(profile);
      if (!(await isPortAvailable(profile.httpPort, "0.0.0.0"))) {
        throw new Error(`Port ${profile.httpPort} is already in use`);
      }
      await this.allocator.claim(profile.id, [
        profile.httpPort,
        profile.codexAppServerPort
      ]);

      const [cliPath, token, childEnvironment] = await Promise.all([
        this.options.cliPathForProfile(profile),
        this.options.tokenForProfile(profile),
        this.resolver.childEnvironment()
      ]);
      if (!token.trim()) throw new Error("Bridge token is empty");
      await access(cliPath, constants.R_OK);

      const log = new RotatingLog(
        this.getLogPath(profile.id),
        this.options.logMaxBytes ?? DEFAULT_LOG_MAX_BYTES,
        this.options.logBackups ?? DEFAULT_LOG_BACKUPS
      );
      const startedAt = new Date().toISOString();
      const modulePath = this.options.workerPath ?? cliPath;
      const childArguments = this.options.workerPath
        ? ["--launcher-cli", cliPath, "--", ...buildEvenTerminalArgs(profile)]
        : buildEvenTerminalArgs(profile);
      const child = this.forkProcess(
        modulePath,
        childArguments,
        {
          cwd: profile.projectDirectory,
          env: {
            ...childEnvironment,
            BRIDGE_TOKEN: token,
            CODEX_APP_SERVER_PORT: String(profile.codexAppServerPort),
            PORT: String(profile.httpPort),
            PROJECT_DIR: profile.projectDirectory,
            DEFAULT_PROVIDER: profile.defaultProvider,
            EVEN_TERMINAL_NAME: profile.clientName
          },
          stdio: ["ignore", "pipe", "pipe"],
          serviceName: `Even Terminal - ${profile.displayName}`
        }
      );

      const entry: ManagedProcess = {
        profile,
        token,
        child,
        log,
        startedAt,
        expectedStop: false,
        preserveErrorOnExit: false,
        stdoutBuffer: "",
        stderrBuffer: "",
        qrOmitted: false,
        ready: deferred(),
        exited: deferred()
      };
      this.entries.set(profile.id, entry);
      this.attachProcess(entry);
      void this.waitUntilHealthy(entry);
      return await entry.ready.promise;
    } catch (error) {
      if (!this.entries.has(profile.id)) this.allocator.release(profile.id);
      const message = error instanceof Error ? error.message : String(error);
      const current = this.getState(profile.id);
      this.setState({
        ...current,
        phase: "error",
        pid: null,
        error: message
      });
      throw error;
    }
  }

  async stop(profileId: string): Promise<void> {
    this.cancelRestart(profileId);
    this.restartAttempts.delete(profileId);

    const entry = this.entries.get(profileId);
    if (!entry) {
      const state = this.getState(profileId);
      if (state.phase !== "stopped") {
        this.setState({
          ...state,
          phase: "stopped",
          pid: null,
          startedAt: null,
          error: null
        });
      }
      this.allocator.release(profileId);
      return;
    }

    if (!entry.expectedStop) {
      entry.expectedStop = true;
      this.setState({ ...this.getState(profileId), phase: "stopping" });
      await this.requestTermination(entry, false);
    }

    const timeoutMs = this.options.stopTimeoutMs ?? DEFAULT_STOP_TIMEOUT_MS;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => {
        resolve();
      }, timeoutMs);
      timer.unref();
    });

    const exitedBeforeTimeout =
      (await Promise.race([
        entry.exited.promise.then(() => true),
        timeout.then(() => false)
      ])) === true;
    if (timer) clearTimeout(timer);
    if (!exitedBeforeTimeout && this.entries.get(profileId) === entry) {
      await this.requestTermination(entry, true);
      await Promise.race([
        entry.exited.promise,
        new Promise<void>((resolve) => {
          const fallback = setTimeout(resolve, 1_000);
          fallback.unref();
        })
      ]);
      if (this.entries.get(profileId) === entry) {
        this.entries.delete(profileId);
        this.allocator.release(profileId);
        this.setState({
          ...this.getState(profileId),
          phase: "stopped",
          pid: null,
          startedAt: null,
          error: null
        });
        entry.exited.resolve();
      }
    }
  }

  async restart(profile: Profile): Promise<void> {
    await this.stop(profile.id);
    await this.start(profile);
  }

  async stopAll(): Promise<void> {
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
    await Promise.all([...this.entries.keys()].map((id) => this.stop(id)));
  }

  getState(profileId: string): ProcessState {
    return this.cloneState(this.states.get(profileId) ?? initialState(profileId));
  }

  getStates(): Record<string, ProcessState> {
    return Object.fromEntries(
      [...this.states].map(([id, state]) => [id, this.cloneState(state)])
    );
  }

  getLogPath(profileId: string): string {
    return join(this.options.logRoot, `${safeFilename(profileId)}.log`);
  }

  private async validateProfile(profile: Profile): Promise<void> {
    if (profile.httpPort === profile.codexAppServerPort) {
      throw new Error("HTTP and Codex app-server ports must be different");
    }
    const directory = await stat(profile.projectDirectory);
    if (!directory.isDirectory()) {
      throw new Error(`Project path is not a directory: ${profile.projectDirectory}`);
    }
  }

  private attachProcess(entry: ManagedProcess): void {
    const { child, profile } = entry;

    child.on("spawn", () => {
      this.setState({
        ...this.getState(profile.id),
        pid: child.pid ?? null,
        startedAt: entry.startedAt
      });
    });

    child.on("error", (type, location, report) => {
      const detail = [type, location, report].filter(Boolean).join(": ");
      this.recordLine(entry, "stderr", `Utility process error: ${detail}`);
    });

    child.on("exit", (code) => {
      void this.handleExit(entry, code);
    });

    child.stdout?.on("data", (chunk: Buffer | string) => {
      this.consumeChunk(entry, "stdout", chunk.toString());
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      this.consumeChunk(entry, "stderr", chunk.toString());
    });

    if (child.pid) {
      this.setState({
        ...this.getState(profile.id),
        pid: child.pid,
        startedAt: entry.startedAt
      });
    }
  }

  private consumeChunk(
    entry: ManagedProcess,
    stream: "stdout" | "stderr",
    chunk: string
  ): void {
    const key = stream === "stdout" ? "stdoutBuffer" : "stderrBuffer";
    const combined = entry[key] + chunk;
    const lines = combined.split(/\r?\n/);
    entry[key] = lines.pop() ?? "";
    for (const line of lines) this.recordLine(entry, stream, line);
  }

  private recordLine(
    entry: ManagedProcess,
    stream: "stdout" | "stderr",
    rawLine: string
  ): void {
    const publicUrl = this.extractPublicUrl(rawLine);
    if (publicUrl && publicUrl !== this.getState(entry.profile.id).publicUrl) {
      this.setState({ ...this.getState(entry.profile.id), publicUrl });
    }

    if (isQrCodeLogLine(rawLine)) {
      if (entry.qrOmitted) return;
      entry.qrOmitted = true;
      rawLine = "[QR code redacted]";
    } else {
      entry.qrOmitted = false;
    }

    const line = redactSecrets(rawLine, [entry.token]);
    if (!line.trim()) return;

    const rendered = `${new Date().toISOString()} [${stream}] ${line}`;
    entry.log.append(`${rendered}\n`);

    const state = this.getState(entry.profile.id);
    const limit = this.options.recentLogLimit ?? DEFAULT_RECENT_LOG_LIMIT;
    this.setState({
      ...state,
      recentLogs: [...state.recentLogs, rendered].slice(-limit)
    });
  }

  private extractPublicUrl(line: string): string | null {
    const match = line.match(
      /Public expose \([^)]+\):\s*(https?:\/\/[^\s?]+)(?:\?[^\s]*)?/i
    );
    return match?.[1] ?? null;
  }

  private async waitUntilHealthy(entry: ManagedProcess): Promise<void> {
    const timeoutMs =
      this.options.healthTimeoutMs ?? DEFAULT_HEALTH_TIMEOUT_MS;
    const deadline = Date.now() + timeoutMs;
    const url =
      `http://127.0.0.1:${entry.profile.httpPort}/api/metrics?token=` +
      encodeURIComponent(entry.token);

    while (
      Date.now() < deadline &&
      this.entries.get(entry.profile.id) === entry &&
      !entry.expectedStop
    ) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 1_000);
        timer.unref();
        try {
          const response = await this.fetchImpl(url, {
            signal: controller.signal,
            cache: "no-store"
          });
          if (response.ok) {
            this.restartAttempts.delete(entry.profile.id);
            this.setState({
              ...this.getState(entry.profile.id),
              phase: "ready",
              pid: entry.child.pid ?? null,
              startedAt: entry.startedAt,
              error: null
            });
            entry.ready.resolve();
            return;
          }
        } finally {
          clearTimeout(timer);
        }
      } catch {
        // The server is expected to refuse connections while it is booting.
      }
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 250);
        timer.unref();
      });
    }

    if (entry.expectedStop || this.entries.get(entry.profile.id) !== entry) return;

    const error = new Error(
      `Even Terminal did not become healthy on port ${entry.profile.httpPort} within ${timeoutMs}ms`
    );
    entry.preserveErrorOnExit = true;
    entry.expectedStop = true;
    this.setState({
      ...this.getState(entry.profile.id),
      phase: "error",
      error: error.message
    });
    entry.ready.reject(error);
    entry.child.kill();
  }

  private async handleExit(entry: ManagedProcess, code: number): Promise<void> {
    const { profile } = entry;
    this.consumeChunk(entry, "stdout", "\n");
    this.consumeChunk(entry, "stderr", "\n");
    await entry.log.close();

    if (this.entries.get(profile.id) !== entry) return;
    this.entries.delete(profile.id);
    this.allocator.release(profile.id);

    const state = this.getState(profile.id);
    if (entry.expectedStop) {
      this.setState({
        ...state,
        phase: entry.preserveErrorOnExit ? "error" : "stopped",
        pid: null,
        startedAt: entry.preserveErrorOnExit ? state.startedAt : null,
        exitCode: code,
        error: entry.preserveErrorOnExit ? state.error : null
      });
    } else {
      const error = `Even Terminal exited unexpectedly with code ${code}`;
      this.setState({
        ...state,
        phase: "crashed",
        pid: null,
        exitCode: code,
        error
      });
      this.scheduleRestart(profile);
    }

    if (!entry.ready.settled) {
      entry.ready.reject(
        new Error(this.getState(profile.id).error ?? "Even Terminal exited during startup")
      );
    }
    entry.exited.resolve();
  }

  private scheduleRestart(profile: Profile): void {
    if (profile.restartPolicy !== "on-crash") return;
    const attempt = (this.restartAttempts.get(profile.id) ?? 0) + 1;
    this.restartAttempts.set(profile.id, attempt);
    const delayMs = Math.min(1_000 * 2 ** (attempt - 1), 30_000);
    const timer = setTimeout(() => {
      this.restartTimers.delete(profile.id);
      void this.start(profile).catch(() => {
        this.scheduleRestart(profile);
      });
    }, delayMs);
    timer.unref();
    this.restartTimers.set(profile.id, timer);
  }

  private cancelRestart(profileId: string): void {
    const timer = this.restartTimers.get(profileId);
    if (timer) clearTimeout(timer);
    this.restartTimers.delete(profileId);
  }

  private async requestTermination(
    entry: ManagedProcess,
    force: boolean
  ): Promise<void> {
    const pid = entry.child.pid;
    if (this.platform === "win32" && pid) {
      try {
        await this.terminateProcessTree(pid, force);
        return;
      } catch (error) {
        this.recordLine(
          entry,
          "stderr",
          `Windows process-tree termination failed: ${String(error)}`
        );
      }
    }
    if (force && pid) {
      try {
        process.kill(pid, "SIGKILL");
        return;
      } catch {
        // It may have exited between the timeout and force-kill.
      }
    }
    entry.child.kill();
  }

  private setState(state: ProcessState): void {
    const stored = this.cloneState(state);
    this.states.set(state.profileId, stored);
    this.options.onStateChange?.(this.cloneState(stored));
  }

  private cloneState(state: ProcessState): ProcessState {
    return { ...state, recentLogs: [...state.recentLogs] };
  }
}
