import QRCode from "qrcode";
import {
  resolveLocale,
  translate,
  type AppLocale,
  type LocalePreference,
  type TranslationKey
} from "../shared/i18n.js";
import type {
  AppSnapshot, ConnectionDetails, ExecutableStatus, LauncherApi, ProcessPhase,
  Profile, ProfileInput, RuntimeInfo, Transport
} from "../shared/types.js";

declare global { interface Window { launcher: LauncherApi } }

const api = window.launcher;
let snapshot: AppSnapshot | null = null;
let activeId: string | null = null;
let busy = false;
let locale: AppLocale = resolveLocale("system", navigator.language);
const t = (
  key: TranslationKey,
  parameters: Record<string, string | number> = {}
): string => translate(locale, key, parameters);
const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id}`);
  return node as T;
};
const dialog = {
  profile: $<HTMLDialogElement>("profile-dialog"),
  connection: $<HTMLDialogElement>("connection-dialog"),
  diagnostics: $<HTMLDialogElement>("diagnostics-dialog"),
  runtime: $<HTMLDialogElement>("runtime-dialog")
};
const phaseText = (phase: ProcessPhase): string =>
  t(`phase.${phase}` as TranslationKey);
const message = (e: unknown): string => e instanceof Error ? e.message : String(e);
const notify = (text: string, bad = false): void => {
  const n = document.createElement("div");
  n.className = `toast${bad ? " bad" : ""}`;
  n.textContent = text;
  $("toasts").append(n);
  setTimeout(() => n.remove(), 3500);
};
const run = async (work: () => Promise<void>): Promise<void> => {
  if (busy) return;
  busy = true;
  try { await work(); } catch (e) { notify(message(e), true); } finally { busy = false; }
};
const current = (): Profile | null => snapshot?.profiles.find(p => p.id === activeId) ?? null;
const providerText = (p: Profile["defaultProvider"]): string => p === "claude" ? "Claude Code" : "Codex";
const statusClass = (p: ProcessPhase): string =>
  p === "ready" ? "ready" : p === "starting" || p === "stopping" ? "busy" :
    p === "crashed" || p === "error" ? "failed" : "";
const transportText = (t: Transport): string => {
  if (t.type === "lan") return "LAN";
  if (t.type === "tailscale") return "Tailscale";
  if (t.type === "interface") return t.name || "Interface";
  return t.provider;
};

function applyTranslations(): void {
  document.querySelectorAll<HTMLElement>("[data-i18n]").forEach((element) => {
    const key = element.dataset.i18n as TranslationKey | undefined;
    if (key) element.textContent = t(key);
  });
  document
    .querySelectorAll<HTMLElement>("[data-i18n-title]")
    .forEach((element) => {
      const key = element.dataset.i18nTitle as TranslationKey | undefined;
      if (key) element.title = t(key);
    });
  document
    .querySelectorAll<HTMLInputElement>("[data-i18n-placeholder]")
    .forEach((element) => {
      const key = element.dataset.i18nPlaceholder as TranslationKey | undefined;
      if (key) element.placeholder = t(key);
    });
}

function render(): void {
  if (!snapshot) return;
  locale = resolveLocale(snapshot.settings.locale, navigator.language);
  document.documentElement.lang = locale;
  document.body.classList.toggle("platform-win32", snapshot.platform === "win32");
  applyTranslations();
  $("app").setAttribute("aria-busy", "false");
  if (!activeId || !snapshot.profiles.some(p => p.id === activeId)) activeId = snapshot.profiles[0]?.id ?? null;
  const list = $("profile-list");
  list.replaceChildren();
  for (const profile of snapshot.profiles) {
    const phase = snapshot.states[profile.id]?.phase ?? "stopped";
    const item = document.createElement("button");
    item.type = "button";
    item.className = `profile-item${profile.id === activeId ? " active" : ""}`;
    item.dataset.profile = profile.id;
    const dot = document.createElement("i"); dot.className = `dot ${statusClass(phase)}`;
    const copy = document.createElement("span"); copy.className = "profile-copy";
    const name = document.createElement("strong"); name.textContent = profile.displayName;
    const sub = document.createElement("small"); sub.textContent = `${profile.httpPort} · ${phaseText(phase)}`;
    copy.append(name, sub);
    const tag = document.createElement("span"); tag.className = "provider"; tag.textContent = profile.defaultProvider;
    item.append(dot, copy, tag); list.append(item);
  }
  $<HTMLInputElement>("launch-at-login").checked = snapshot.settings.launchAtLogin;
  $<HTMLSelectElement>("locale-select").value = snapshot.settings.locale;
  $("update-dot").hidden = snapshot.runtime.updateAvailable !== true;
  renderDetail();
  renderRuntime(snapshot.runtime);
}

function renderDetail(): void {
  if (!snapshot) return;
  const profile = current();
  $("empty-state").hidden = profile !== null;
  $("profile-detail").hidden = profile === null;
  if (!profile) return;
  const state = snapshot.states[profile.id];
  const phase = state?.phase ?? "stopped";
  $("detail-name").textContent = profile.displayName;
  $("detail-directory").textContent = profile.projectDirectory;
  $("detail-phase").textContent = phaseText(phase);
  $("detail-status-dot").className = `dot ${statusClass(phase)}`;
  $("detail-provider").textContent = providerText(profile.defaultProvider);
  $("detail-client").textContent = profile.clientName;
  $("detail-http-port").textContent = String(profile.httpPort);
  $("detail-codex-port").textContent = String(profile.codexAppServerPort);
  $("detail-public-url").textContent = state?.publicUrl ?? t("runtime.local");
  $("detail-pid").textContent = state?.pid ? `PID ${state.pid}` : "PID —";
  $("detail-transport").textContent = transportText(profile.transport);
  $("detail-restart").textContent = profile.restartPolicy === "on-crash" ? t("runtime.crashRestart") : t("runtime.noAutoRestart");
  $("autostart-pill").textContent = profile.autoStartWithLauncher ? t("runtime.launcherAutostart") : t("runtime.manualStart");
  $("restart-pill").textContent = profile.restartPolicy === "on-crash" ? t("runtime.crashRecovery") : t("runtime.noRestart");
  const primary = $<HTMLButtonElement>("primary-process-action");
  const running = phase === "ready" || phase === "starting";
  primary.dataset.action = running ? "stop" : "start";
  primary.textContent = phase === "starting" ? t("phase.starting") : phase === "stopping" ? t("phase.stopping") : running ? t("action.stop") : t("action.start");
  primary.disabled = phase === "starting" || phase === "stopping";
  const descriptions: Record<ProcessPhase, string> = {
    stopped: t("session.stopped"),
    starting: t("session.starting"),
    ready: state?.startedAt
      ? t("session.readySince", {
          time: new Date(state.startedAt).toLocaleString(locale)
        })
      : t("session.ready"),
    stopping: t("session.stopping"),
    crashed: t("session.crashed", {
      code: state?.exitCode == null ? "" : ` (${state.exitCode})`
    }),
    error: t("session.error")
  };
  $("session-description").textContent = descriptions[phase];
  const error = $("error-banner"); error.hidden = !state?.error; error.textContent = state?.error ?? "";
  $("recent-logs").textContent = state?.recentLogs.length ? state.recentLogs.join("\n") : t("session.noLogs");
  document.querySelectorAll<HTMLButtonElement>('[data-action="restart"],[data-action="stop"],[data-action="connection"],[data-action="mirror"]')
    .forEach(button => {
      if (button === primary) return;
      button.disabled = button.dataset.action === "connection" || button.dataset.action === "mirror"
        ? phase !== "ready" : phase === "stopped" || phase === "stopping";
    });
}

function syncTransport(): void {
  const value = $<HTMLSelectElement>("profile-transport").value;
  const show = value === "interface";
  $("interface-field").hidden = !show;
  $<HTMLInputElement>("profile-interface").required = show;
  const disclosure = $("transport-disclosure");
  disclosure.textContent =
    value === "tailscale"
      ? t("transport.tailscale")
      : value.startsWith("expose:")
        ? t("transport.expose")
        : value === "interface"
          ? t("transport.interface")
          : t("transport.lan");
  disclosure.classList.toggle(
    "warning",
    value === "tailscale" || value.startsWith("expose:")
  );
}
function openEditor(profile?: Profile): void {
  $<HTMLInputElement>("profile-id").value = profile?.id ?? "";
  $("profile-dialog-title").textContent = profile ? t("profile.edit") : t("profile.new");
  $<HTMLInputElement>("profile-name").value = profile?.displayName ?? "";
  $<HTMLInputElement>("profile-directory").value = profile?.projectDirectory ?? "";
  $<HTMLSelectElement>("profile-provider").value = profile?.defaultProvider ?? "claude";
  $<HTMLInputElement>("profile-client").value = profile?.clientName ?? "Even Terminal";
  $<HTMLInputElement>("profile-http-port").value = profile ? String(profile.httpPort) : "";
  $<HTMLInputElement>("profile-codex-port").value = profile ? String(profile.codexAppServerPort) : "";
  $<HTMLSelectElement>("profile-restart").value = profile?.restartPolicy ?? "never";
  $<HTMLInputElement>("profile-autostart").checked = profile?.autoStartWithLauncher ?? false;
  const transport = profile?.transport;
  $<HTMLSelectElement>("profile-transport").value =
    !transport || transport.type === "lan" || transport.type === "tailscale" ? transport?.type ?? "lan" :
      transport.type === "interface" ? "interface" : `expose:${transport.provider}`;
  $<HTMLInputElement>("profile-interface").value = transport?.type === "interface" ? transport.name : "";
  $<HTMLButtonElement>("delete-profile").hidden = !profile;
  syncTransport(); dialog.profile.showModal(); $<HTMLInputElement>("profile-name").focus();
}
function readTransport(): Transport {
  const value = $<HTMLSelectElement>("profile-transport").value;
  if (value === "lan" || value === "tailscale") return { type: value };
  if (value === "interface") return { type: "interface", name: $<HTMLInputElement>("profile-interface").value.trim() };
  const provider = value.replace("expose:", "");
  if (provider !== "pinggy" && provider !== "bore" && provider !== "ngrok") throw new Error("Invalid expose provider");
  return { type: "expose", provider };
}
async function saveProfile(): Promise<void> {
  const id = $<HTMLInputElement>("profile-id").value;
  const http = $<HTMLInputElement>("profile-http-port").valueAsNumber;
  const codex = $<HTMLInputElement>("profile-codex-port").valueAsNumber;
  const client = $<HTMLInputElement>("profile-client").value.trim();
  const input: ProfileInput = {
    displayName: $<HTMLInputElement>("profile-name").value.trim(),
    projectDirectory: $<HTMLInputElement>("profile-directory").value.trim(),
    defaultProvider: $<HTMLSelectElement>("profile-provider").value as Profile["defaultProvider"],
    transport: readTransport(),
    autoStartWithLauncher: $<HTMLInputElement>("profile-autostart").checked,
    restartPolicy: $<HTMLSelectElement>("profile-restart").value as Profile["restartPolicy"],
    ...(id ? { id } : {}), ...(Number.isFinite(http) ? { httpPort: http } : {}),
    ...(Number.isFinite(codex) ? { codexAppServerPort: codex } : {}), ...(client ? { clientName: client } : {})
  };
  const saved = await api.saveProfile(input);
  activeId = saved.id; dialog.profile.close(); snapshot = await api.getSnapshot(); render();
  notify(id ? t("profile.updated") : t("profile.created"));
}

async function showConnection(profile: Profile): Promise<void> {
  const details: ConnectionDetails = await api.getConnectionDetails(profile.id);
  $("connection-title").textContent = details.displayName;
  $("connection-url").textContent = details.url;
  $("connection-token").textContent = details.token;
  $("connection-cwd").textContent = `${providerText(details.provider)} · ${details.cwd}`;
  $("connection-hint").textContent = t("connection.hint");
  dialog.connection.showModal();
  await QRCode.toCanvas($<HTMLCanvasElement>("connection-qr"), details.url, {
    width: 316, margin: 1, color: { dark: "#171719", light: "#ffffff" }, errorCorrectionLevel: "M"
  });
}
function renderDiagnostics(statuses: ExecutableStatus[]): void {
  const list = $("diagnostics-list"); list.replaceChildren();
  for (const status of statuses) {
    const row = document.createElement("div"); row.className = "diagnostic";
    const dot = document.createElement("i"); dot.className = `available${status.available ? " ok" : ""}`;
    const name = document.createElement("strong"); name.textContent = status.name;
    const copy = document.createElement("span"); copy.className = "copyline";
    const version = document.createElement("strong"); version.textContent = status.version ?? (status.available ? t("diagnostics.available") : t("diagnostics.missing"));
    const path = document.createElement("small"); path.textContent = status.path ?? t("diagnostics.choosePath");
    copy.append(version, path);
    const choose = document.createElement("button"); choose.className = "button quiet"; choose.textContent = t("action.choose"); choose.dataset.executable = status.name;
    row.append(dot, name, copy, choose); list.append(row);
  }
}
async function diagnostics(): Promise<void> {
  $("diagnostics-list").textContent = t("diagnostics.checking");
  renderDiagnostics(await api.runDiagnostics());
}
function renderRuntime(runtime: RuntimeInfo): void {
  $("runtime-active").textContent = runtime.activeVersion;
  $("runtime-bundled").textContent = t("runtime.bundled", { version: runtime.bundledVersion });
  const note = $("runtime-message");
  note.classList.toggle("error", runtime.updateError !== null);
  note.textContent = runtime.updateError ?? (runtime.updateAvailable === true
    ? t("runtime.available", { version: runtime.latestVersion ?? "" })
    : runtime.updateAvailable === false ? t("runtime.latest") : t("runtime.checkHint"));
  const versions = $("installed-versions"); versions.replaceChildren();
  for (const value of runtime.installedVersions) {
    const pill = document.createElement("span"); pill.className = `pill${value === runtime.activeVersion ? " active" : ""}`;
    pill.textContent = value === runtime.activeVersion
      ? t("notice.runtimeUsing", { version: value })
      : value;
    versions.append(pill);
  }
  $<HTMLButtonElement>("runtime-rollback").disabled = false;
  $("update-dot").hidden = runtime.updateAvailable !== true;
}
async function action(name: string): Promise<void> {
  const profile = current();
  if (name === "new") return openEditor();
  if (!profile) return;
  if (name === "edit") return openEditor(profile);
  if (name === "start") await api.startProfile(profile.id);
  if (name === "stop") await api.stopProfile(profile.id);
  if (name === "restart") await api.restartProfile(profile.id);
  if (name === "logs") await api.openLogFolder(profile.id);
  if (name === "mirror") await api.openMirror(profile.id);
  if (name === "connection") await showConnection(profile);
}

document.addEventListener("click", event => {
  const target = event.target as HTMLElement;
  const closer = target.closest<HTMLElement>("[data-close]");
  if (closer?.dataset.close) { $<HTMLDialogElement>(closer.dataset.close).close(); return; }
  const command = target.closest<HTMLElement>("[data-action]")?.dataset.action;
  if (command) void run(() => action(command));
});
$("new-profile").addEventListener("click", () => openEditor());
$("profile-list").addEventListener("click", event => {
  const id = (event.target as HTMLElement).closest<HTMLElement>("[data-profile]")?.dataset.profile;
  if (id) { activeId = id; render(); }
});
$("profile-transport").addEventListener("change", syncTransport);
$("choose-directory").addEventListener("click", () => void run(async () => {
  const selected = await api.chooseDirectory();
  if (selected) $<HTMLInputElement>("profile-directory").value = selected;
}));
$<HTMLFormElement>("profile-form").addEventListener("submit", event => {
  event.preventDefault();
  if ((event.currentTarget as HTMLFormElement).reportValidity()) void run(saveProfile);
});
$("delete-profile").addEventListener("click", () => {
  const profile = current();
  if (!profile || !confirm(t("profile.deleteConfirm", { name: profile.displayName }))) return;
  void run(async () => {
    await api.deleteProfile(profile.id); dialog.profile.close(); activeId = null;
    snapshot = await api.getSnapshot(); render(); notify(t("profile.deleted"));
  });
});
$("launch-at-login").addEventListener("change", event => void run(async () => {
  const enabled = (event.currentTarget as HTMLInputElement).checked;
  await api.setLaunchAtLogin(enabled); notify(enabled ? t("notice.loginEnabled") : t("notice.loginDisabled"));
}));
$("export-settings").addEventListener("click", () => void run(async () => {
  if (await api.exportConfiguration()) notify(t("notice.exported"));
}));
$("import-settings").addEventListener("click", () => void run(async () => {
  const count = await api.importConfiguration();
  if (count > 0) {
    snapshot = await api.getSnapshot();
    render();
    notify(t("notice.imported", { count }));
  }
}));
$<HTMLSelectElement>("locale-select").addEventListener("change", event => void run(async () => {
  const preference = (event.currentTarget as HTMLSelectElement).value as LocalePreference;
  await api.setLocale(preference);
  snapshot = await api.getSnapshot();
  render();
}));
$("show-diagnostics").addEventListener("click", () => { dialog.diagnostics.showModal(); void run(diagnostics); });
$("rerun-diagnostics").addEventListener("click", () => void run(diagnostics));
$("diagnostics-list").addEventListener("click", event => {
  const name = (event.target as HTMLElement).closest<HTMLElement>("[data-executable]")?.dataset.executable as ExecutableStatus["name"] | undefined;
  if (name) void run(async () => { if (await api.chooseExecutable(name)) await diagnostics(); });
});
$("show-runtime").addEventListener("click", () => { if (snapshot) renderRuntime(snapshot.runtime); dialog.runtime.showModal(); });
$("runtime-check").addEventListener("click", () => void run(async () => {
  const value = await api.checkRuntimeUpdate(); if (snapshot) snapshot.runtime = value; renderRuntime(value);
}));
$("runtime-install").addEventListener("click", () => void run(async () => {
  const requested = $<HTMLInputElement>("runtime-version-input").value.trim();
  const value = requested ? await api.installRuntimeUpdate(requested) : await api.installRuntimeUpdate();
  if (value.updateError) throw new Error(value.updateError);
  if (snapshot) snapshot.runtime = value; renderRuntime(value); notify(t("notice.runtimeUsing", { version: value.activeVersion }));
}));
$("runtime-rollback").addEventListener("click", () => void run(async () => {
  const value = await api.rollbackRuntime(); if (snapshot) snapshot.runtime = value;
  if (value.updateError) throw new Error(value.updateError);
  renderRuntime(value); notify(t("notice.runtimeRollback", { version: value.activeVersion }));
}));
document.querySelectorAll<HTMLElement>("[data-copy]").forEach(button => button.addEventListener("click", () => {
  const source = button.dataset.copy;
  if (source) void navigator.clipboard.writeText($(source).textContent ?? "").then(() => notify(t("notice.copied")), e => notify(message(e), true));
}));
Object.values(dialog).forEach(d => d.addEventListener("click", event => { if (event.target === d) d.close(); }));
const unsubscribe = api.onSnapshot(value => { snapshot = value; render(); });
window.addEventListener("beforeunload", unsubscribe);
void api.getSnapshot().then(value => { snapshot = value; render(); }, e => notify(t("notice.loadFailed", { error: message(e) }), true));
