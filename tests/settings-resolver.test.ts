import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadSettingsFile,
  parseSettingsObject,
  resolveInvocationSettings,
} from "../src/core/settings-resolver.js";

describe("settings-resolver", () => {
  it("parses dontAsk as deny-by-default", () => {
    const s = parseSettingsObject("x.json", {
      permissions: { defaultMode: "dontAsk", allow: ["Read"] },
    });
    expect(s.isDenyByDefault).toBe(true);
    expect(s.isBypass).toBe(false);
  });

  it("parses bypassPermissions", () => {
    const s = parseSettingsObject("x.json", {
      permissions: { defaultMode: "bypassPermissions" },
    });
    expect(s.isBypass).toBe(true);
  });

  it("loads settings relative to repo root", () => {
    const dir = mkdtempSync(join(tmpdir(), "hangnone-"));
    try {
      writeFileSync(
        join(dir, "ci-settings.json"),
        JSON.stringify({ permissions: { defaultMode: "dontAsk" } }),
      );
      const s = loadSettingsFile(dir, "./ci-settings.json");
      expect(s.exists).toBe(true);
      expect(s.isDenyByDefault).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("reports missing settings", () => {
    const dir = mkdtempSync(join(tmpdir(), "hangnone-"));
    try {
      const s = loadSettingsFile(dir, "./nope.json");
      expect(s.exists).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("falls back to .claude/settings.json", () => {
    const dir = mkdtempSync(join(tmpdir(), "hangnone-"));
    try {
      mkdirSync(join(dir, ".claude"));
      writeFileSync(
        join(dir, ".claude", "settings.json"),
        JSON.stringify({ permissions: { defaultMode: "dontAsk" } }),
      );
      const r = resolveInvocationSettings(dir, ["claude", "-p", "hi"]);
      expect(r.settingsRef).toBe(".claude/settings.json");
      expect(r.settings?.isDenyByDefault).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("detects bypass and permission-prompts none flags", () => {
    const dir = mkdtempSync(join(tmpdir(), "hangnone-"));
    try {
      const bypass = resolveInvocationSettings(dir, [
        "claude",
        "--dangerously-skip-permissions",
      ]);
      expect(bypass.hasBypassFlag).toBe(true);

      const none = resolveInvocationSettings(dir, [
        "claude",
        "--permission-prompts",
        "none",
      ]);
      expect(none.hasPermissionPromptsNone).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
