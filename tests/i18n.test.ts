import { describe, expect, it } from "vitest";
import { resolveLocale, translate } from "../src/shared/i18n.js";

describe("i18n", () => {
  it("resolves explicit and system locales", () => {
    expect(resolveLocale("system", "ja-JP")).toBe("ja");
    expect(resolveLocale("system", "en-US")).toBe("en");
    expect(resolveLocale("system", "zh-CN")).toBe("zh-CN");
    expect(resolveLocale("system", "zh-Hans-SG")).toBe("zh-CN");
    expect(resolveLocale("system", "zh-TW")).toBe("zh-TW");
    expect(resolveLocale("system", "zh-Hant-HK")).toBe("zh-TW");
    expect(resolveLocale("system", "ko-KR")).toBe("ko");
    expect(resolveLocale("system", "es-MX")).toBe("es");
    expect(resolveLocale("system", "fr-FR")).toBe("en");
    expect(resolveLocale("en", "ja-JP")).toBe("en");
  });

  it("translates and interpolates messages", () => {
    expect(translate("ja", "notice.imported", { count: 3 })).toBe(
      "3件のプロファイルを読み込みました。"
    );
    expect(translate("en", "notice.imported", { count: 3 })).toBe(
      "Imported 3 profiles."
    );
    expect(translate("zh-CN", "notice.imported", { count: 3 })).toContain("3");
    expect(translate("zh-TW", "notice.imported", { count: 3 })).toContain("3");
    expect(translate("ko", "notice.imported", { count: 3 })).toContain("3");
    expect(translate("es", "notice.imported", { count: 3 })).toContain("3");
  });
});
