import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type Tray
} from "electron";
import { mkdtempSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import type {
  AppSnapshot,
  ConnectionDetails,
  ExecutableStatus,
  Profile,
  ProfileInput,
  RuntimeInfo
} from "../shared/types.js";
import { IPC } from "../shared/types.js";
import {
  resolveLocale,
  translate,
  type AppLocale,
  type LocalePreference
} from "../shared/i18n.js";
import { buildConnectionUrl } from "./connection.js";
import { buildMirrorTerminalCommand } from "./mirror-terminal.js";
import {
  parseConfiguration,
  serializeConfiguration
} from "./configuration-transfer.js";
import { ExecutableResolver } from "./executable-resolver.js";
import { cleanupStaleInstanceFiles } from "./instance-registry.js";
import { findAvailablePort, isPortAvailable } from "./port-allocator.js";
import { platformWindowPolicy } from "./platform-policy.js";
import { ProcessSupervisor } from "./process-supervisor.js";
import { ProfileStore } from "./profile-store.js";
import { RuntimeManager } from "./runtime-manager.js";
import { SecretStore } from "./secret-store.js";
import { SettingsStore } from "./settings-store.js";
import { createTray, loadTrayIcon, updateTrayMenu } from "./tray.js";

const isSmokeTest = process.argv.includes("--smoke-test");
const startHidden = process.argv.includes("--hidden");
if (isSmokeTest) {
  app.setPath("userData", mkdtempSync(join(tmpdir(), "even-terminal-launcher-")));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let allowQuit = false;
let snapshotTimer: NodeJS.Timeout | null = null;
let localePreference: LocalePreference = "system";
let shutdownPromise: Promise<void> | null = null;

interface Services {
  profileStore: ProfileStore;
  secretStore: SecretStore;
  settingsStore: SettingsStore;
  runtimeManager: RuntimeManager;
  resolver: ExecutableResolver;
  supervisor: ProcessSupervisor;
}

let services: Services | null = null;

app.on("second-instance", () => {
  showSettings();
});

app.on("activate", () => {
  showSettings();
});

app.on("window-all-closed", () => {
  // The menu bar app remains active without a BrowserWindow.
});

app.on("before-quit", (event) => {
  if (allowQuit || !services) return;
  event.preventDefault();
  void stopServicesAndQuit();
});


app.whenReady().then(bootstrap).catch((error) => {
  console.error(error);
  if (isSmokeTest) {
    app.exit(1);
    return;
  }
  void dialog.showErrorBox("Even Terminal Launcher", errorMessage(error));
});

async function bootstrap(): Promise<void> {
  if (process.platform === "darwin") app.dock?.hide();

  const cleanup = await cleanupStaleInstanceFiles();
  if (cleanup.removed.length > 0) {
    console.info(
      `Removed ${cleanup.removed.length} stale Even Terminal instance file(s)`
    );
  }

  const userData = app.getPath("userData");
  const profileStore = new ProfileStore(userData);
  const secretStore = new SecretStore(
    userData,
    isSmokeTest
      ? {
          safeStorage: {
            isEncryptionAvailable: () => true,
            encryptString: (value) => Buffer.from(value, "utf8"),
            decryptString: (value) => value.toString("utf8")
          }
        }
      : {}
  );
  const settingsStore = new SettingsStore(userData);
  const runtimeManager = new RuntimeManager(userData, {
    smokeTest: smokeTestRuntime
  });
  const settings = await settingsStore.get();
  localePreference = settings.locale;
  let resolver = new ExecutableResolver({
    overrides: settings.executableOverrides
  });

  const resolverProxy = {
    childEnvironment: () => resolver.childEnvironment()
  };
  const supervisor = new ProcessSupervisor({
    cliPathForProfile: (profile) =>
      runtimeManager.resolveCliPath(profile.preferredEvenTerminalVersion),
    tokenForProfile: (profile) => secretStore.getOrCreateToken(profile.id),
    logRoot: join(userData, "logs"),
    executableResolver: resolverProxy,
    workerPath: join(__dirname, "runtime-worker.cjs"),
    onStateChange: () => scheduleSnapshotBroadcast()
  });

  services = {
    profileStore,
    secretStore,
    settingsStore,
    runtimeManager,
    get resolver() {
      return resolver;
    },
    set resolver(value: ExecutableResolver) {
      resolver = value;
    },
    supervisor
  };

  registerIpc();

  if (isSmokeTest) {
    await runSmokeTest();
    return;
  }

  await ensureDefaultProfiles();
  createWindow();
  tray = createTray(trayActions());
  await broadcastSnapshot();

  const profiles = await profileStore.list();
  for (const profile of profiles.filter((item) => item.autoStartWithLauncher)) {
    void startProfile(profile.id).catch((error) => {
      console.error(`Auto-start failed for ${profile.displayName}:`, error);
    });
  }

  configureLoginItem(settings.launchAtLogin);
  if (!startHidden) showSettings();
}

function createWindow(): BrowserWindow {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;

  const platformPolicy = platformWindowPolicy(
    process.platform,
    join(__dirname, "app-icon.png")
  );
  mainWindow = new BrowserWindow({
    width: 1040,
    height: 780,
    minWidth: 820,
    minHeight: 620,
    show: false,
    title: "Even Terminal Launcher",
    ...platformPolicy.browserWindow,
    backgroundColor: "#f4f1e9",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow.setMenuBarVisibility(false);
  void mainWindow.loadFile(join(__dirname, "index.html"));
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("show", showDock);
  mainWindow.on("hide", hideDock);
  mainWindow.on("close", (event) => {
    if (allowQuit) return;
    event.preventDefault();
    mainWindow?.hide();
  });
  mainWindow.on("query-session-end", (event) => {
    if (allowQuit) return;
    event.preventDefault();
    void stopServicesAndQuit();
  });
  return mainWindow;
}

function showSettings(): void {
  if (!app.isReady()) return;
  showDock();
  const window = createWindow();
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function showDock(): void {
  if (process.platform === "darwin") {
    void app.dock?.show();
  }
  if (process.platform === "win32") {
    mainWindow?.setSkipTaskbar(false);
  }
}

function hideDock(): void {
  if (process.platform === "darwin" && !allowQuit) {
    app.dock?.hide();
  }
  if (process.platform === "win32" && !allowQuit) {
    mainWindow?.setSkipTaskbar(true);
  }
}

function trayActions() {
  return {
    showSettings,
    start: (id: string) => void startProfile(id).catch(showOperationError),
    stop: (id: string) => void stopProfile(id).catch(showOperationError),
    restart: (id: string) => void restartProfile(id).catch(showOperationError),
    showConnection: (id: string) => {
      showSettings();
      mainWindow?.webContents.send("launcher:show-connection", id);
    },
    checkUpdates: () => void checkRuntimeUpdate(true),
    quit: () => app.quit()
  };
}

function registerIpc(): void {
  ipcMain.handle(IPC.snapshot, getSnapshot);
  ipcMain.handle(IPC.saveProfile, async (_event, input: ProfileInput) => {
    if (input.id) assertProfileStopped(input.id);
    const prepared: ProfileInput = {
      ...input,
      httpPort:
        input.httpPort ??
        (await suggestAvailableProfilePort(3456, "httpPort", input.id)),
      codexAppServerPort:
        input.codexAppServerPort ??
        (await suggestAvailableProfilePort(
          8765,
          "codexAppServerPort",
          input.id
        ))
    };
    const profile = await requireServices().profileStore.save(prepared);
    await requireServices().secretStore.getOrCreateToken(profile.id);
    await broadcastSnapshot();
    return profile;
  });
  ipcMain.handle(IPC.deleteProfile, async (_event, id: string) => {
    await stopProfile(id);
    await requireServices().profileStore.delete(id);
    await requireServices().secretStore.deleteToken(id);
    await broadcastSnapshot();
  });
  ipcMain.handle(IPC.startProfile, (_event, id: string) => startProfile(id));
  ipcMain.handle(IPC.stopProfile, (_event, id: string) => stopProfile(id));
  ipcMain.handle(IPC.restartProfile, (_event, id: string) => restartProfile(id));
  ipcMain.handle(
    IPC.connectionDetails,
    (_event, id: string) => getConnectionDetails(id)
  );
  ipcMain.handle(IPC.chooseDirectory, async () => {
    const result = await dialog.showOpenDialog({
      properties: ["openDirectory", "createDirectory"],
      title: mainText("dialog.chooseDirectory")
    });
    return result.canceled ? null : result.filePaths[0] ?? null;
  });
  ipcMain.handle(
    IPC.chooseExecutable,
    async (_event, name: ExecutableStatus["name"]) => {
      const result = await dialog.showOpenDialog({
        properties: ["openFile"],
        title: mainText("dialog.chooseExecutable", { name })
      });
      const executablePath = result.canceled ? null : result.filePaths[0] ?? null;
      if (!executablePath) return null;
      const current = requireServices();
      const settings = await current.settingsStore.setExecutableOverride(
        name,
        executablePath
      );
      current.resolver = new ExecutableResolver({
        overrides: settings.executableOverrides
      });
      await broadcastSnapshot();
      return executablePath;
    }
  );
  ipcMain.handle(IPC.diagnostics, () =>
    requireServices().resolver.inspectAll()
  );
  ipcMain.handle(IPC.launchAtLogin, async (_event, enabled: boolean) => {
    configureLoginItem(enabled);
    await requireServices().settingsStore.setLaunchAtLogin(enabled);
    await broadcastSnapshot();
  });
  ipcMain.handle(IPC.locale, async (_event, locale: LocalePreference) => {
    const settings = await requireServices().settingsStore.setLocale(locale);
    localePreference = settings.locale;
    await broadcastSnapshot();
  });
  ipcMain.handle(IPC.configurationExport, async () => {
    const result = await dialog.showSaveDialog({
      title: mainText("dialog.exportTitle"),
      defaultPath: join(
        app.getPath("documents"),
        `even-terminal-launcher-${new Date().toISOString().slice(0, 10)}.json`
      ),
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    if (result.canceled || !result.filePath) return false;
    const current = requireServices();
    const contents = serializeConfiguration(
      await current.profileStore.list(),
      await current.settingsStore.get()
    );
    await writeFile(result.filePath, contents, { encoding: "utf8", mode: 0o600 });
    return true;
  });
  ipcMain.handle(IPC.configurationImport, async () => {
    const result = await dialog.showOpenDialog({
      title: mainText("dialog.importTitle"),
      properties: ["openFile"],
      filters: [{ name: "JSON", extensions: ["json"] }]
    });
    const filePath = result.canceled ? undefined : result.filePaths[0];
    if (!filePath) return 0;
    const current = requireServices();
    const configuration = parseConfiguration(await readFile(filePath, "utf8"));
    let imported = 0;
    for (const input of configuration.profiles) {
      const assigned = new Set(
        (await current.profileStore.list()).flatMap((profile) => [
          profile.httpPort,
          profile.codexAppServerPort
        ])
      );
      const requestedHttp = input.httpPort;
      const requestedCodex = input.codexAppServerPort;
      const httpPort =
        requestedHttp && !assigned.has(requestedHttp)
          ? requestedHttp
          : await suggestAvailableProfilePort(3456, "httpPort");
      assigned.add(httpPort);
      let codexAppServerPort =
        requestedCodex &&
        requestedCodex !== httpPort &&
        !assigned.has(requestedCodex)
          ? requestedCodex
          : await suggestAvailableProfilePort(8765, "codexAppServerPort");
      if (codexAppServerPort === httpPort) {
        codexAppServerPort = await suggestAvailableProfilePort(
          codexAppServerPort + 1,
          "codexAppServerPort"
        );
      }
      const profile = await current.profileStore.save({
        ...input,
        httpPort,
        codexAppServerPort
      });
      await current.secretStore.getOrCreateToken(profile.id);
      imported += 1;
    }
    const settings = await current.settingsStore.setLocale(configuration.locale);
    localePreference = settings.locale;
    await broadcastSnapshot();
    return imported;
  });
  ipcMain.handle(IPC.runtimeCheck, () => checkRuntimeUpdate(false));
  ipcMain.handle(IPC.runtimeInstall, async (_event, version?: string) => {
    const info = await requireServices().runtimeManager.installUpdate(version);
    await broadcastSnapshot();
    return info;
  });
  ipcMain.handle(IPC.runtimeRollback, async () => {
    const info = await requireServices().runtimeManager.rollback();
    await broadcastSnapshot();
    return info;
  });
  ipcMain.handle(IPC.openLogFolder, async (_event, id: string) => {
    const logPath = requireServices().supervisor.getLogPath(id);
    const result = await shell.openPath(dirname(logPath));
    if (result) throw new Error(result);
  });
  ipcMain.handle(IPC.openMirror, async (_event, id: string) => {
    const profile = await requireServices().profileStore.get(id);
    if (!profile) throw new Error("Profile not found");
    const appRoot = app.getAppPath();
    const command = buildMirrorTerminalCommand(process.platform, {
      appRoot,
      scriptPath: join(appRoot, "scripts", "mirror.mjs"),
      port: profile.httpPort,
      pathEnv: process.env.PATH ?? ""
    });
    await promisify(execFile)(command.file, command.args);
  });
}

async function ensureDefaultProfiles(): Promise<void> {
  const store = requireServices().profileStore;
  if ((await store.list()).length > 0) return;

  const codexHttpPort = await suggestAvailableProfilePort(3456, "httpPort");
  const codexInternalPort = await suggestAvailableProfilePort(
    8765,
    "codexAppServerPort"
  );
  await store.save({
    displayName: "Codex Main",
    projectDirectory: homedir(),
    defaultProvider: "codex",
    httpPort: codexHttpPort,
    codexAppServerPort: codexInternalPort,
    clientName: "Codex Main",
    transport: { type: "lan" },
    autoStartWithLauncher: false,
    restartPolicy: "never"
  });
  const claudeHttpPort = await suggestAvailableProfilePort(
    codexHttpPort + 1,
    "httpPort"
  );
  const claudeInternalPort = await suggestAvailableProfilePort(
    codexInternalPort + 1,
    "codexAppServerPort"
  );
  await store.save({
    displayName: "Claude Project",
    projectDirectory: homedir(),
    defaultProvider: "claude",
    httpPort: claudeHttpPort,
    codexAppServerPort: claudeInternalPort,
    clientName: "Claude Project",
    transport: { type: "lan" },
    autoStartWithLauncher: false,
    restartPolicy: "never"
  });
}

async function suggestAvailableProfilePort(
  start: number,
  field: "httpPort" | "codexAppServerPort",
  excludedProfileId?: string
): Promise<number> {
  const used = new Set(
    (await requireServices().profileStore.list())
      .filter((profile) => profile.id !== excludedProfileId)
      .map((profile) => profile[field])
  );
  for (let port = start; port <= Math.min(start + 500, 65_535); port += 1) {
    if (!used.has(port) && (await isPortAvailable(port))) return port;
  }
  throw new Error(`空いている${field}を見つけられませんでした`);
}

async function startProfile(id: string): Promise<void> {
  const current = requireServices();
  const profile = await requireProfile(id);
  await current.supervisor.start(profile);
  await current.profileStore.updateLastStarted(id);
  await broadcastSnapshot();
}

async function stopProfile(id: string): Promise<void> {
  await requireServices().supervisor.stop(id);
  await broadcastSnapshot();
}

async function restartProfile(id: string): Promise<void> {
  const current = requireServices();
  const profile = await requireProfile(id);
  await current.supervisor.restart(profile);
  await current.profileStore.updateLastStarted(id);
  await broadcastSnapshot();
}

async function getConnectionDetails(id: string): Promise<ConnectionDetails> {
  const current = requireServices();
  const profile = await requireProfile(id);
  const token = await current.secretStore.getOrCreateToken(id);
  const state = current.supervisor.getState(id);
  const tailscale = await current.resolver.resolve("tailscale");
  return {
    profileId: id,
    displayName: profile.displayName,
    cwd: profile.projectDirectory,
    provider: profile.defaultProvider,
    url: await buildConnectionUrl(profile, token, state, tailscale),
    token,
    phase: state.phase
  };
}

async function getSnapshot(): Promise<AppSnapshot> {
  const current = requireServices();
  return {
    platform: process.platform,
    profiles: await current.profileStore.list(),
    states: current.supervisor.getStates(),
    settings: await current.settingsStore.get(),
    runtime: await current.runtimeManager.getInfo()
  };
}

function scheduleSnapshotBroadcast(): void {
  if (snapshotTimer) return;
  snapshotTimer = setTimeout(() => {
    snapshotTimer = null;
    void broadcastSnapshot();
  }, 100);
}

async function broadcastSnapshot(): Promise<AppSnapshot> {
  const snapshot = await getSnapshot();
  if (tray) updateTrayMenu(tray, snapshot, trayActions(), mainLocale());
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(IPC.snapshotChanged, snapshot);
  }
  return snapshot;
}

async function checkRuntimeUpdate(showDialog: boolean): Promise<RuntimeInfo> {
  const info = await requireServices().runtimeManager.checkForUpdate();
  await broadcastSnapshot();
  if (showDialog) {
    const message = info.updateError
      ? mainText("runtime.checkFailed", { error: info.updateError })
      : info.updateAvailable
        ? mainText("runtime.availableDialog", {
            version: info.latestVersion ?? ""
          })
        : mainText("runtime.currentDialog", { version: info.activeVersion });
    await dialog.showMessageBox({ type: info.updateError ? "warning" : "info", message });
  }
  return info;
}

function assertProfileStopped(id: string): void {
  const state = requireServices().supervisor.getState(id);
  if (state.phase !== "stopped" && state.phase !== "error" && state.phase !== "crashed") {
    throw new Error(mainText("dialog.runningProfile"));
  }
}

async function requireProfile(id: string): Promise<Profile> {
  const profile = await requireServices().profileStore.get(id);
  if (!profile) throw new Error(`Profile not found: ${id}`);
  return profile;
}

function requireServices(): Services {
  if (!services) throw new Error("Launcher services are not ready");
  return services;
}

function showOperationError(error: unknown): void {
  void dialog.showMessageBox({
    type: "error",
    message: mainText("dialog.operationFailed"),
    detail: errorMessage(error)
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function configureLoginItem(enabled: boolean): void {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    ...(process.platform === "win32" && enabled ? { args: ["--hidden"] } : {})
  });
}

function stopServicesAndQuit(): Promise<void> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (services?.supervisor.stopAll() ?? Promise.resolve())
    .catch((error) => {
      console.error("Failed to stop all managed processes", error);
    })
    .finally(() => {
      allowQuit = true;
      app.quit();
    });
  return shutdownPromise;
}

function mainLocale(): AppLocale {
  return resolveLocale(
    localePreference,
    app.isReady() ? app.getLocale() : "en"
  );
}

function mainText(
  key: Parameters<typeof translate>[1],
  parameters: Record<string, string | number> = {}
): string {
  return translate(mainLocale(), key, parameters);
}

async function smokeTestRuntime(
  cliPath: string,
  expectedVersion: string
): Promise<void> {
  const { stdout, stderr } = await promisify(execFile)(
    process.execPath,
    [cliPath, "--version"],
    {
      env: {
        ...process.env,
        ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: "1" } : {})
      },
      timeout: 15_000,
      windowsHide: true
    }
  );
  const output = `${stdout}\n${stderr}`.trim();
  if (!output.split(/\r?\n/).some((line) => line.trim() === expectedVersion)) {
    throw new Error(
      `Even Terminal ${expectedVersion} smoke test returned: ${output || "(no output)"}`
    );
  }
}

async function runSmokeTest(): Promise<void> {
  const current = requireServices();
  try {
    loadTrayIcon();
    const httpStart = await findAvailablePort(35_460, 35_560);
    const codexStart = await findAvailablePort(38_760, 38_860);
    const profiles: Profile[] = [];
    for (let index = 0; index < 3; index += 1) {
      profiles.push(
        await current.profileStore.save({
          displayName: `Smoke ${index + 1}`,
          projectDirectory: process.cwd(),
          defaultProvider: index === 0 ? "codex" : "claude",
          httpPort: httpStart + index,
          codexAppServerPort: codexStart + index,
          clientName: `Smoke ${index + 1}`,
          transport: { type: "lan" },
          restartPolicy: "never"
        })
      );
    }
    await Promise.all(profiles.map((profile) => current.supervisor.start(profile)));
    const states = current.supervisor.getStates();
    if (profiles.some((profile) => states[profile.id]?.phase !== "ready")) {
      throw new Error(`Unexpected smoke states: ${JSON.stringify(states)}`);
    }
    console.log(
      `SMOKE_TEST_OK ${JSON.stringify(
        profiles.map((profile) => ({
          name: profile.displayName,
          httpPort: profile.httpPort,
          codexPort: profile.codexAppServerPort,
          phase: states[profile.id]?.phase
        }))
      )}`
    );
    await current.supervisor.stopAll();
    allowQuit = true;
    app.exit(0);
  } catch (error) {
    console.error("SMOKE_TEST_FAILED", error);
    await current.supervisor.stopAll();
    allowQuit = true;
    app.exit(1);
  }
}
