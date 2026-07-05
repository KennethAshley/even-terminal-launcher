import { execFile } from "node:child_process";
import { networkInterfaces } from "node:os";
import { promisify } from "node:util";
import { translate, type AppLocale } from "../shared/i18n.js";
import type { Profile, ProcessState } from "../shared/types.js";

const execFileAsync = promisify(execFile);

function firstLanAddress(): string {
  for (const interfaces of Object.values(networkInterfaces())) {
    for (const entry of interfaces ?? []) {
      if (entry.family === "IPv4" && !entry.internal) return entry.address;
    }
  }
  return "127.0.0.1";
}

function interfaceAddress(name: string): string | null {
  for (const entry of networkInterfaces()[name] ?? []) {
    if (entry.family === "IPv4") return entry.address;
  }
  return null;
}

async function tailscaleAddress(executable: string | null): Promise<string | null> {
  if (!executable) return null;
  try {
    const { stdout } = await execFileAsync(executable, ["ip", "-4"], {
      timeout: 3_000,
      windowsHide: true
    });
    return stdout.trim().split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

export async function buildConnectionUrl(
  profile: Profile,
  token: string,
  state: ProcessState | undefined,
  tailscaleExecutable: string | null
): Promise<string> {
  if (profile.transport.type === "expose" && state?.publicUrl) {
    return appendConnectionQuery(state.publicUrl, profile, token);
  }

  let host = firstLanAddress();
  if (profile.transport.type === "tailscale") {
    host = (await tailscaleAddress(tailscaleExecutable)) ?? host;
  } else if (profile.transport.type === "interface") {
    host = interfaceAddress(profile.transport.name) ?? host;
  }

  return appendConnectionQuery(`http://${host}:${profile.httpPort}`, profile, token);
}

function appendConnectionQuery(base: string, profile: Profile, token: string): string {
  const url = new URL(base);
  url.searchParams.set("token", token);
  url.searchParams.set("defaultProvider", profile.defaultProvider);
  if (profile.clientName) url.searchParams.set("name", profile.clientName);
  return url.toString();
}

export function networkDisclosure(
  profile: Profile,
  locale: AppLocale = "ja"
): string {
  if (profile.transport.type === "tailscale") {
    return translate(locale, "transport.tailscale");
  }
  if (profile.transport.type === "expose") {
    return translate(locale, "transport.expose");
  }
  return translate(locale, "transport.lan");
}
