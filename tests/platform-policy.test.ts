import { describe, expect, it } from "vitest";
import { platformWindowPolicy } from "../src/main/platform-policy.js";

describe("platform window policy", () => {
  it("uses macOS inset chrome and template tray icons", () => {
    expect(platformWindowPolicy("darwin", "/icon.png")).toMatchObject({
      browserWindow: { titleBarStyle: "hiddenInset" },
      usesTemplateTrayIcon: true
    });
  });

  it("starts Windows windows hidden from the taskbar", () => {
    expect(platformWindowPolicy("win32", "C:\\icon.png")).toMatchObject({
      browserWindow: {
        icon: "C:\\icon.png",
        skipTaskbar: true
      },
      usesTemplateTrayIcon: false
    });
  });
});
