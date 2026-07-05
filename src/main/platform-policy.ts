import type { BrowserWindowConstructorOptions } from "electron";

export interface PlatformWindowPolicy {
  browserWindow: Pick<
    BrowserWindowConstructorOptions,
    "icon" | "skipTaskbar" | "titleBarStyle"
  >;
  usesTemplateTrayIcon: boolean;
  hidesAppSurfaceWhenWindowCloses: boolean;
}

export function platformWindowPolicy(
  platform: NodeJS.Platform,
  iconPath: string
): PlatformWindowPolicy {
  if (platform === "darwin") {
    return {
      browserWindow: { titleBarStyle: "hiddenInset" },
      usesTemplateTrayIcon: true,
      hidesAppSurfaceWhenWindowCloses: true
    };
  }
  if (platform === "win32") {
    return {
      browserWindow: { icon: iconPath, skipTaskbar: true },
      usesTemplateTrayIcon: false,
      hidesAppSurfaceWhenWindowCloses: true
    };
  }
  return {
    browserWindow: { icon: iconPath },
    usesTemplateTrayIcon: false,
    hidesAppSurfaceWhenWindowCloses: true
  };
}
