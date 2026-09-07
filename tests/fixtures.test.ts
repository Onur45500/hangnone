import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { scanRepository } from "../src/scan.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

function fixture(name: string): string {
  return resolve(root, name);
}

describe("fixture classifications", () => {
  it("01: claude-code-action with no unattended flag → HANG", () => {
    const result = scanRepository(fixture("01-gha-action-hang"));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.classification).toBe("HANG");
    expect(result.findings[0]!.reason).toMatch(/silently auto-deny/i);
    expect(result.summary.hang).toBe(1);
  });

  it("02: claude_args with --permission-prompts none → DENY-CONTINUE", () => {
    const result = scanRepository(fixture("02-gha-action-deny"));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.classification).toBe("DENY-CONTINUE");
    expect(result.findings[0]!.ruleId).toBe("permission-prompts-none");
  });

  it("03: raw shell claude -p with no flags → HANG", () => {
    const result = scanRepository(fixture("03-shell-hang"));
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const hang = result.findings.find((f) => f.classification === "HANG");
    expect(hang).toBeDefined();
    expect(hang!.reason).toMatch(/will hang/i);
    expect(hang!.file).toMatch(/run-claude\.sh$/);
  });

  it("04: --dangerously-skip-permissions without sandbox → BYPASS", () => {
    const result = scanRepository(fixture("04-shell-bypass"));
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings.some((f) => f.classification === "BYPASS")).toBe(true);
  });

  it("05: GitLab --settings with dontAsk → DENY-CONTINUE", () => {
    const result = scanRepository(fixture("05-gitlab-settings-deny"));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.classification).toBe("DENY-CONTINUE");
    expect(result.findings[0]!.ruleId).toBe("settings-deny-by-default");
  });

  it("06: GitLab --settings missing file → UNKNOWN", () => {
    const result = scanRepository(fixture("06-gitlab-settings-missing"));
    expect(result.findings).toHaveLength(1);
    expect(result.findings[0]!.classification).toBe("UNKNOWN");
    expect(result.findings[0]!.reason).toMatch(/does not exist/i);
  });

  it("07: mixed workflow → one HANG and one DENY-CONTINUE", () => {
    const result = scanRepository(fixture("07-gha-mixed"));
    expect(result.findings).toHaveLength(2);
    const classes = result.findings.map((f) => f.classification).sort();
    expect(classes).toEqual(["DENY-CONTINUE", "HANG"]);
  });

  it("08: non-Claude workflow → no findings", () => {
    const result = scanRepository(fixture("08-non-claude"));
    expect(result.findings).toHaveLength(0);
    expect(result.summary).toEqual({
      hang: 0,
      bypass: 0,
      deny_continue: 0,
      unknown: 0,
      ignored: 0,
    });
  });
});
