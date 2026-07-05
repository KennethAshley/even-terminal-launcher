import { describe, expect, it } from "vitest";
import type { ProcessState, Profile } from "../src/shared/types.js";
import { buildConnectionUrl, networkDisclosure } from "../src/main/connection.js";

const profile: Profile = {
  id: "profile-1",
  displayName: "Project A",
  projectDirectory: "/tmp",
  defaultProvider: "claude",
  httpPort: 3456,
  codexAppServerPort: 8765,
  clientName: "Project A",
  transport: { type: "lan" },
  autoStartWithLauncher: false,
  restartPolicy: "never",
  preferredEvenTerminalVersion: null,
  createdAt: "2026-07-03T00:00:00.000Z",
  updatedAt: "2026-07-03T00:00:00.000Z",
  lastStartedAt: null
};

const state: ProcessState = {
  profileId: profile.id,
  phase: "ready",
  pid: 123,
  startedAt: "2026-07-03T00:00:00.000Z",
  exitCode: null,
  error: null,
  publicUrl: "https://example.test",
  recentLogs: []
};

describe("connection URL", () => {
  it("includes the token and client metadata", async () => {
    const value = new URL(
      await buildConnectionUrl(profile, "fixed-secret", state, null)
    );
    expect(value.port).toBe("3456");
    expect(value.searchParams.get("token")).toBe("fixed-secret");
    expect(value.searchParams.get("defaultProvider")).toBe("claude");
    expect(value.searchParams.get("name")).toBe("Project A");
  });

  it("uses a parsed public expose URL", async () => {
    const exposed: Profile = {
      ...profile,
      transport: { type: "expose", provider: "pinggy" }
    };
    const value = new URL(
      await buildConnectionUrl(exposed, "fixed-secret", state, null)
    );
    expect(value.origin).toBe("https://example.test");
    expect(value.searchParams.get("token")).toBe("fixed-secret");
  });

  it("does not describe Tailscale as an exclusive bind", () => {
    const warning = networkDisclosure({
      ...profile,
      transport: { type: "tailscale" }
    });
    expect(warning).toContain("0.0.0.0");
    expect(warning).toContain("LAN側");
  });
});
