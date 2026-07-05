import {
  Menu,
  type NativeImage,
  Tray,
  nativeImage,
  type MenuItemConstructorOptions
} from "electron";
import { join } from "node:path";
import { translate, type AppLocale } from "../shared/i18n.js";
import type { AppSnapshot, Profile } from "../shared/types.js";

export interface TrayActions {
  showSettings(): void;
  start(id: string): void;
  stop(id: string): void;
  restart(id: string): void;
  showConnection(id: string): void;
  checkUpdates(): void;
  quit(): void;
}

export function createTray(actions: TrayActions): Tray {
  const icon = loadTrayIcon();
  const tray = new Tray(icon);
  tray.setToolTip("Even Terminal Launcher");
  tray.on("click", actions.showSettings);
  return tray;
}

export function loadTrayIcon(
  platform: NodeJS.Platform = process.platform,
  resourceDirectory = __dirname
): NativeImage {
  const template = platform === "darwin";
  const icon = nativeImage.createFromPath(
    join(resourceDirectory, template ? "trayTemplate.png" : "app-icon.png")
  );
  if (icon.isEmpty()) {
    throw new Error("Bundled tray icon could not be loaded");
  }
  if (template) {
    const alpha = icon
      .getScaleFactors()
      .flatMap((scaleFactor) => {
        const bitmap = icon.toBitmap({ scaleFactor });
        const values: number[] = [];
        for (let index = 3; index < bitmap.length; index += 4) {
          values.push(bitmap[index] ?? 0);
        }
        return values;
      });
    if (!alpha.some((value) => value === 0) || !alpha.some((value) => value > 0)) {
      throw new Error("Bundled menu bar icon must have a transparent background");
    }
    icon.setTemplateImage(true);
  }
  return template ? icon : icon.resize({ width: 20, height: 20 });
}

export function updateTrayMenu(
  tray: Tray,
  snapshot: AppSnapshot,
  actions: TrayActions,
  locale: AppLocale = "en"
): void {
  const items: MenuItemConstructorOptions[] = [
    {
      label: "Even Terminal Launcher",
      enabled: false
    },
    { type: "separator" }
  ];

  if (snapshot.profiles.length === 0) {
    items.push({ label: translate(locale, "tray.noProfiles"), enabled: false });
  }

  for (const profile of snapshot.profiles) {
    items.push(profileMenu(profile, snapshot, actions, locale));
  }

  items.push(
    { type: "separator" },
    { label: translate(locale, "tray.settings"), click: actions.showSettings },
    { label: translate(locale, "action.checkUpdate"), click: actions.checkUpdates },
    { type: "separator" },
    { label: translate(locale, "tray.quit"), role: "quit", click: actions.quit }
  );

  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function profileMenu(
  profile: Profile,
  snapshot: AppSnapshot,
  actions: TrayActions,
  locale: AppLocale
): MenuItemConstructorOptions {
  const state = snapshot.states[profile.id];
  const phase = state?.phase ?? "stopped";
  const running = phase === "ready" || phase === "starting";
  const marker =
    phase === "ready" ? "●" :
    phase === "starting" || phase === "stopping" ? "◐" :
    phase === "crashed" || phase === "error" ? "!" : "○";

  return {
    label: `${marker} ${profile.displayName}  ${phase}${running ? ` :${profile.httpPort}` : ""}`,
    submenu: [
      {
        label: translate(locale, "tray.connection"),
        enabled: running,
        click: () => actions.showConnection(profile.id)
      },
      {
        label: translate(locale, "action.start"),
        enabled: !running,
        click: () => actions.start(profile.id)
      },
      {
        label: translate(locale, "action.restart"),
        enabled: running,
        click: () => actions.restart(profile.id)
      },
      {
        label: translate(locale, "action.stop"),
        enabled: running,
        click: () => actions.stop(profile.id)
      }
    ]
  };
}
