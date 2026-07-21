import type { LocalePreference } from "./i18n.js";

export type Provider = "claude" | "codex";

export type Transport =
  | { type: "lan" }
  | { type: "tailscale" }
  | { type: "interface"; name: string }
  | { type: "expose"; provider: "pinggy" | "bore" | "ngrok" };

export type RestartPolicy = "never" | "on-crash";

export interface Profile {
  id: string;
  displayName: string;
  projectDirectory: string;
  defaultProvider: Provider;
  httpPort: number;
  codexAppServerPort: number;
  clientName: string;
  transport: Transport;
  autoStartWithLauncher: boolean;
  restartPolicy: RestartPolicy;
  preferredEvenTerminalVersion: string | null;
  createdAt: string;
  updatedAt: string;
  lastStartedAt: string | null;
}

export type ProcessPhase =
  | "stopped"
  | "starting"
  | "ready"
  | "stopping"
  | "crashed"
  | "error";

export interface ProcessState {
  profileId: string;
  phase: ProcessPhase;
  pid: number | null;
  startedAt: string | null;
  exitCode: number | null;
  error: string | null;
  publicUrl: string | null;
  recentLogs: string[];
}

export interface ExecutableStatus {
  name: "claude" | "codex" | "tailscale" | "ssh" | "bore" | "ngrok";
  path: string | null;
  version: string | null;
  available: boolean;
}

export interface RuntimeInfo {
  bundledVersion: string;
  activeVersion: string;
  installedVersions: string[];
  latestVersion: string | null;
  updateAvailable: boolean | null;
  updateError: string | null;
}

export interface AppSettings {
  schemaVersion: 1;
  launchAtLogin: boolean;
  locale: LocalePreference;
  executableOverrides: Partial<Record<ExecutableStatus["name"], string>>;
}

export interface AppSnapshot {
  platform: NodeJS.Platform;
  profiles: Profile[];
  states: Record<string, ProcessState>;
  settings: AppSettings;
  runtime: RuntimeInfo;
}

export interface ProfileInput {
  id?: string;
  displayName: string;
  projectDirectory: string;
  defaultProvider: Provider;
  httpPort?: number;
  codexAppServerPort?: number;
  clientName?: string;
  transport: Transport;
  autoStartWithLauncher?: boolean;
  restartPolicy?: RestartPolicy;
}

export interface ConnectionDetails {
  profileId: string;
  displayName: string;
  cwd: string;
  provider: Provider;
  url: string;
  token: string;
  phase: ProcessPhase;
}

export interface LauncherApi {
  getSnapshot(): Promise<AppSnapshot>;
  saveProfile(input: ProfileInput): Promise<Profile>;
  deleteProfile(id: string): Promise<void>;
  startProfile(id: string): Promise<void>;
  stopProfile(id: string): Promise<void>;
  restartProfile(id: string): Promise<void>;
  getConnectionDetails(id: string): Promise<ConnectionDetails>;
  chooseDirectory(): Promise<string | null>;
  chooseExecutable(name: ExecutableStatus["name"]): Promise<string | null>;
  runDiagnostics(): Promise<ExecutableStatus[]>;
  setLaunchAtLogin(enabled: boolean): Promise<void>;
  setLocale(locale: LocalePreference): Promise<void>;
  exportConfiguration(): Promise<boolean>;
  importConfiguration(): Promise<number>;
  checkRuntimeUpdate(): Promise<RuntimeInfo>;
  installRuntimeUpdate(version?: string): Promise<RuntimeInfo>;
  rollbackRuntime(): Promise<RuntimeInfo>;
  openLogFolder(id: string): Promise<void>;
  openMirror(id: string): Promise<void>;
  onSnapshot(listener: (snapshot: AppSnapshot) => void): () => void;
}

export const IPC = {
  snapshot: "launcher:snapshot",
  saveProfile: "launcher:profile:save",
  deleteProfile: "launcher:profile:delete",
  startProfile: "launcher:profile:start",
  stopProfile: "launcher:profile:stop",
  restartProfile: "launcher:profile:restart",
  connectionDetails: "launcher:profile:connection-details",
  chooseDirectory: "launcher:choose-directory",
  chooseExecutable: "launcher:choose-executable",
  diagnostics: "launcher:diagnostics",
  launchAtLogin: "launcher:launch-at-login",
  locale: "launcher:locale",
  configurationExport: "launcher:configuration:export",
  configurationImport: "launcher:configuration:import",
  runtimeCheck: "launcher:runtime:check",
  runtimeInstall: "launcher:runtime:install",
  runtimeRollback: "launcher:runtime:rollback",
  openLogFolder: "launcher:logs:open",
  openMirror: "launcher:mirror:open",
  snapshotChanged: "launcher:snapshot-changed"
} as const;
