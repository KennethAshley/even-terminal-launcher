import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { AppSettings, ExecutableStatus } from "../shared/types.js";
import {
  isLocalePreference,
  type LocalePreference
} from "../shared/i18n.js";

const defaults: AppSettings = {
  schemaVersion: 1,
  launchAtLogin: false,
  locale: "system",
  executableOverrides: {}
};

export class SettingsStore {
  private readonly filePath: string;
  private settings: AppSettings = structuredClone(defaults);
  private readonly loaded: Promise<void>;

  constructor(userDataDirectory: string) {
    this.filePath = join(userDataDirectory, "settings.json");
    this.loaded = this.load();
  }

  async get(): Promise<AppSettings> {
    await this.loaded;
    return structuredClone(this.settings);
  }

  async setLaunchAtLogin(enabled: boolean): Promise<AppSettings> {
    await this.loaded;
    this.settings.launchAtLogin = enabled;
    await this.persist();
    return this.get();
  }

  async setLocale(locale: LocalePreference): Promise<AppSettings> {
    await this.loaded;
    if (!isLocalePreference(locale)) {
      throw new Error(`Unsupported locale: ${String(locale)}`);
    }
    this.settings.locale = locale;
    await this.persist();
    return this.get();
  }

  async setExecutableOverride(
    name: ExecutableStatus["name"],
    executablePath: string
  ): Promise<AppSettings> {
    await this.loaded;
    this.settings.executableOverrides[name] = resolve(executablePath);
    await this.persist();
    return this.get();
  }

  private async load(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as Partial<AppSettings>;
      if (parsed.schemaVersion !== 1) throw new Error("Unsupported settings schema");
      this.settings = {
        schemaVersion: 1,
        launchAtLogin: parsed.launchAtLogin === true,
        locale:
          isLocalePreference(parsed.locale) ? parsed.locale : "system",
        executableOverrides:
          typeof parsed.executableOverrides === "object" &&
          parsed.executableOverrides !== null
            ? { ...parsed.executableOverrides }
            : {}
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    await writeFile(temporary, `${JSON.stringify(this.settings, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    try {
      await rename(temporary, this.filePath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}
