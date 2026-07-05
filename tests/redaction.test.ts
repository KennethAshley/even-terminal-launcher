import { describe, expect, it } from "vitest";
import {
  isQrCodeLogLine,
  redactSecrets
} from "../src/main/redaction.js";

describe("log redaction", () => {
  it("removes literal bridge tokens and common credential forms", () => {
    const token = "bridge-secret-token-123";
    const input = [
      `Full token: ${token}`,
      `GET /api/metrics?token=${token}&mode=full`,
      "Authorization: Bearer another-secret",
      "BRIDGE_TOKEN=third-secret"
    ].join("\n");

    const output = redactSecrets(input, [token]);

    expect(output).not.toContain(token);
    expect(output).not.toContain("another-secret");
    expect(output).not.toContain("third-secret");
    expect(output.match(/\[REDACTED\]/g)).toHaveLength(4);
    expect(output).toContain("mode=full");
  });

  it("recognizes QR raster rows, including ANSI-colored rows", () => {
    expect(isQrCodeLogLine("████ ▀▄ ████")).toBe(true);
    expect(isQrCodeLogLine("\u001B[40m████████████\u001B[0m")).toBe(true);
    expect(isQrCodeLogLine("Even Terminal v0.8.1")).toBe(false);
    expect(isQrCodeLogLine("")).toBe(false);
  });
});
