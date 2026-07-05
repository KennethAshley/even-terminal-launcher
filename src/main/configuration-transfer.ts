import {
  isLocalePreference,
  type LocalePreference
} from "../shared/i18n.js";
import type { AppSettings, Profile, ProfileInput, Transport } from "../shared/types.js";

const CONFIGURATION_SCHEMA_VERSION = 1;

export interface PortableConfiguration {
  schemaVersion: typeof CONFIGURATION_SCHEMA_VERSION;
  exportedAt: string;
  locale: LocalePreference;
  profiles: ProfileInput[];
}

export function serializeConfiguration(
  profiles: Profile[],
  settings: AppSettings,
  now = new Date()
): string {
  const document: PortableConfiguration = {
    schemaVersion: CONFIGURATION_SCHEMA_VERSION,
    exportedAt: now.toISOString(),
    locale: settings.locale,
    profiles: profiles.map((profile) => ({
      displayName: profile.displayName,
      projectDirectory: profile.projectDirectory,
      defaultProvider: profile.defaultProvider,
      httpPort: profile.httpPort,
      codexAppServerPort: profile.codexAppServerPort,
      clientName: profile.clientName,
      transport: { ...profile.transport },
      autoStartWithLauncher: profile.autoStartWithLauncher,
      restartPolicy: profile.restartPolicy
    }))
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseConfiguration(contents: string): PortableConfiguration {
  let value: unknown;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error("Configuration file is not valid JSON", { cause: error });
  }
  if (
    !isRecord(value) ||
    value.schemaVersion !== CONFIGURATION_SCHEMA_VERSION ||
    !Array.isArray(value.profiles)
  ) {
    throw new Error("Unsupported or invalid configuration file");
  }
  const locale = normalizeLocale(value.locale);
  return {
    schemaVersion: CONFIGURATION_SCHEMA_VERSION,
    exportedAt:
      typeof value.exportedAt === "string"
        ? value.exportedAt
        : new Date(0).toISOString(),
    locale,
    profiles: value.profiles.map(normalizeProfileInput)
  };
}

function normalizeProfileInput(value: unknown): ProfileInput {
  if (!isRecord(value)) throw new Error("Invalid profile in configuration");
  const input: ProfileInput = {
    displayName: requiredString(value.displayName, "displayName"),
    projectDirectory: requiredString(value.projectDirectory, "projectDirectory"),
    defaultProvider:
      value.defaultProvider === "claude" || value.defaultProvider === "codex"
        ? value.defaultProvider
        : invalid("defaultProvider"),
    transport: normalizeTransport(value.transport),
    autoStartWithLauncher: value.autoStartWithLauncher === true,
    restartPolicy: value.restartPolicy === "on-crash" ? "on-crash" : "never"
  };
  if (typeof value.clientName === "string" && value.clientName.trim()) {
    input.clientName = value.clientName.trim();
  }
  if (validPort(value.httpPort)) input.httpPort = value.httpPort;
  if (validPort(value.codexAppServerPort)) {
    input.codexAppServerPort = value.codexAppServerPort;
  }
  return input;
}

function normalizeTransport(value: unknown): Transport {
  if (!isRecord(value)) return { type: "lan" };
  if (value.type === "lan" || value.type === "tailscale") {
    return { type: value.type };
  }
  if (value.type === "interface") {
    return {
      type: "interface",
      name: requiredString(value.name, "transport.name")
    };
  }
  if (
    value.type === "expose" &&
    (value.provider === "pinggy" ||
      value.provider === "bore" ||
      value.provider === "ngrok")
  ) {
    return { type: "expose", provider: value.provider };
  }
  throw new Error("Invalid transport in configuration");
}

function normalizeLocale(value: unknown): LocalePreference {
  return isLocalePreference(value) ? value : "system";
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Invalid ${field} in configuration`);
  }
  return value.trim();
}

function validPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1024 &&
    value <= 65_535
  );
}

function invalid(field: string): never {
  throw new Error(`Invalid ${field} in configuration`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
