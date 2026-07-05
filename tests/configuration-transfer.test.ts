import { describe, expect, it } from "vitest";
import {
  parseConfiguration,
  serializeConfiguration
} from "../src/main/configuration-transfer.js";
import type { AppSettings, Profile } from "../src/shared/types.js";

const profile: Profile = {
  id: "private-id",
  displayName: "Windows Project",
  projectDirectory: "C:\\Users\\dev\\project",
  defaultProvider: "codex",
  httpPort: 3456,
  codexAppServerPort: 8765,
  clientName: "Even Terminal",
  transport: { type: "tailscale" },
  autoStartWithLauncher: true,
  restartPolicy: "on-crash",
  preferredEvenTerminalVersion: null,
  createdAt: "2026-07-05T00:00:00.000Z",
  updatedAt: "2026-07-05T00:00:00.000Z",
  lastStartedAt: null
};

const settings: AppSettings = {
  schemaVersion: 1,
  launchAtLogin: true,
  locale: "en",
  executableOverrides: { codex: "C:\\private\\codex.cmd" }
};

describe("configuration transfer", () => {
  it("exports portable profile settings without secrets or machine overrides", () => {
    const contents = serializeConfiguration(
      [profile],
      settings,
      new Date("2026-07-05T01:02:03.000Z")
    );
    expect(contents).not.toContain("private-id");
    expect(contents).not.toContain("C:\\\\private");
    expect(contents).not.toContain("token");

    const parsed = parseConfiguration(contents);
    expect(parsed.locale).toBe("en");
    expect(parsed.profiles).toEqual([
      expect.objectContaining({
        displayName: "Windows Project",
        projectDirectory: "C:\\Users\\dev\\project",
        httpPort: 3456,
        codexAppServerPort: 8765,
        transport: { type: "tailscale" }
      })
    ]);
  });

  it("rejects invalid files", () => {
    expect(() => parseConfiguration("{}")).toThrow(
      "Unsupported or invalid configuration"
    );
    expect(() =>
      parseConfiguration(
        JSON.stringify({
          schemaVersion: 1,
          profiles: [{ displayName: "", projectDirectory: "." }]
        })
      )
    ).toThrow("displayName");
  });

  it("preserves supported imported locales and falls back for unknown ones", () => {
    const base = {
      schemaVersion: 1,
      profiles: []
    };
    expect(
      parseConfiguration(JSON.stringify({ ...base, locale: "zh-TW" })).locale
    ).toBe("zh-TW");
    expect(
      parseConfiguration(JSON.stringify({ ...base, locale: "fr" })).locale
    ).toBe("system");
  });
});
