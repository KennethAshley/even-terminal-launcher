import { contextBridge, ipcRenderer } from "electron";
import type { AppSnapshot, ExecutableStatus, LauncherApi, ProfileInput } from "../shared/types.js";
import type { LocalePreference } from "../shared/i18n.js";
import { IPC } from "../shared/types.js";

const api: LauncherApi = {
  getSnapshot: () => ipcRenderer.invoke(IPC.snapshot) as Promise<AppSnapshot>,
  saveProfile: (input: ProfileInput) => ipcRenderer.invoke(IPC.saveProfile, input),
  deleteProfile: (id: string) => ipcRenderer.invoke(IPC.deleteProfile, id),
  startProfile: (id: string) => ipcRenderer.invoke(IPC.startProfile, id),
  stopProfile: (id: string) => ipcRenderer.invoke(IPC.stopProfile, id),
  restartProfile: (id: string) => ipcRenderer.invoke(IPC.restartProfile, id),
  getConnectionDetails: (id: string) => ipcRenderer.invoke(IPC.connectionDetails, id),
  chooseDirectory: () => ipcRenderer.invoke(IPC.chooseDirectory),
  chooseExecutable: (name: ExecutableStatus["name"]) =>
    ipcRenderer.invoke(IPC.chooseExecutable, name),
  runDiagnostics: () => ipcRenderer.invoke(IPC.diagnostics),
  setLaunchAtLogin: (enabled: boolean) => ipcRenderer.invoke(IPC.launchAtLogin, enabled),
  setLocale: (locale: LocalePreference) => ipcRenderer.invoke(IPC.locale, locale),
  exportConfiguration: () => ipcRenderer.invoke(IPC.configurationExport),
  importConfiguration: () => ipcRenderer.invoke(IPC.configurationImport),
  checkRuntimeUpdate: () => ipcRenderer.invoke(IPC.runtimeCheck),
  installRuntimeUpdate: (version?: string) =>
    version === undefined
      ? ipcRenderer.invoke(IPC.runtimeInstall)
      : ipcRenderer.invoke(IPC.runtimeInstall, version),
  rollbackRuntime: () => ipcRenderer.invoke(IPC.runtimeRollback),
  openLogFolder: (id: string) => ipcRenderer.invoke(IPC.openLogFolder, id),
  openMirror: (id: string) => ipcRenderer.invoke(IPC.openMirror, id),
  onSnapshot: (listener: (snapshot: AppSnapshot) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, value: AppSnapshot) => listener(value);
    ipcRenderer.on(IPC.snapshotChanged, handler);
    return () => ipcRenderer.removeListener(IPC.snapshotChanged, handler);
  }
};

contextBridge.exposeInMainWorld("launcher", api);
