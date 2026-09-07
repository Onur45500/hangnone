import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { scanRepository } from "../src/scan.js";
import { isLineIgnored } from "../src/core/ignore.js";
import { proposeFixes, applyFixes, isFixableHang } from "../src/fix/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("ignore directives", () => {
  it("suppresses findings with # hangnone:ignore above / ignore-next-line", () => {
    const hidden = scanRepository(join(fixtures, "09-ignore"));
    // Only the unignored shell step should remain
    expect(hidden.findings.length).toBe(1);
    expect(hidden.findings[0]!.classification).toBe("HANG");
    expect(hidden.findings[0]!.invocation).toMatch(/not ignored/);

    const all = scanRepository(join(fixtures, "09-ignore"), {
      includeIgnored: true,
    });
    expect(all.findings.length).toBeGreaterThanOrEqual(3);
    expect(all.findings.some((f) => f.ignored)).toBe(true);
  });

  it("detects same-line and next-line ignore", () => {
    const dir = mkdtempSync(join(tmpdir(), "hangnone-ign-"));
    try {
      writeFileSync(
        join(dir, "x.sh"),
        "#!/bin/bash\n# hangnone:ignore-next-line\nclaude -p hi\nclaude -p there # hangnone:ignore\n",
      );
      expect(isLineIgnored(dir, "x.sh", 3)).toBe(true);
      expect(isLineIgnored(dir, "x.sh", 4)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("fix", () => {
  it("proposes --permission-prompts none for raw shell HANG", () => {
    const root = join(fixtures, "10-fix-shell");
    const result = scanRepository(root);
    const hang = result.findings.find((f) => f.classification === "HANG");
    expect(hang).toBeDefined();
    expect(isFixableHang(hang!)).toBe(true);

    const proposals = proposeFixes(result, root);
    expect(proposals.length).toBe(1);
    expect(proposals[0]!.after).toContain("--permission-prompts none");
  });

  it("applies --write fixes", () => {
    const dir = mkdtempSync(join(tmpdir(), "hangnone-fix-"));
    try {
      mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
      const wf = join(dir, ".github", "workflows", "x.yml");
      writeFileSync(
        wf,
        "name: x\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: claude -p \"hi\"\n",
      );
      const result = scanRepository(dir);
      const proposals = proposeFixes(result, dir);
      expect(proposals.length).toBe(1);
      applyFixes(proposals, dir);
      const text = readFileSync(wf, "utf8");
      expect(text).toContain("--permission-prompts none");
      const after = scanRepository(dir);
      expect(after.findings.every((f) => f.classification === "DENY-CONTINUE")).toBe(
        true,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not auto-fix claude-code-action HANG", () => {
    const result = scanRepository(join(fixtures, "01-gha-action-hang"));
    const proposals = proposeFixes(result, join(fixtures, "01-gha-action-hang"));
    expect(proposals).toHaveLength(0);
  });
});

describe("platforms", () => {
  it("CircleCI: hang + deny-continue", () => {
    const result = scanRepository(join(fixtures, "11-circleci"));
    const classes = result.findings.map((f) => f.classification).sort();
    expect(classes).toEqual(["DENY-CONTINUE", "HANG"]);
    expect(result.findings.every((f) => f.sourceKind === "circleci")).toBe(true);
  });

  it("Azure Pipelines: hang + deny-continue", () => {
    const result = scanRepository(join(fixtures, "12-azure"));
    const classes = result.findings.map((f) => f.classification).sort();
    expect(classes).toEqual(["DENY-CONTINUE", "HANG"]);
  });

  it("Jenkinsfile: hang + deny-continue", () => {
    const result = scanRepository(join(fixtures, "13-jenkins"));
    expect(result.findings.length).toBeGreaterThanOrEqual(2);
    const classes = new Set(result.findings.map((f) => f.classification));
    expect(classes.has("HANG")).toBe(true);
    expect(classes.has("DENY-CONTINUE")).toBe(true);
  });
});

describe("code subprocess", () => {
  it("finds Python subprocess.run claude invocation", () => {
    const result = scanRepository(join(fixtures, "14-subprocess"));
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    expect(result.findings[0]!.sourceKind).toBe("code-subprocess");
    expect(result.findings[0]!.confidence).toBe("low");
    expect(result.findings[0]!.classification).toBe("HANG");
  });

  it("excludes code when --no-include-code", () => {
    const result = scanRepository(join(fixtures, "14-subprocess"), {
      includeCode: false,
    });
    expect(result.findings).toHaveLength(0);
  });
});

describe("bypass sandbox signals", () => {
  it("enriches BYPASS when sandbox signals present", () => {
    const result = scanRepository(join(fixtures, "15-bypass-sandbox"));
    expect(result.findings.length).toBeGreaterThanOrEqual(1);
    const bypass = result.findings.find((f) => f.classification === "BYPASS");
    expect(bypass).toBeDefined();
    expect(bypass!.bypassUnsafe).toBe(false);
    expect(bypass!.sandboxSignals!.length).toBeGreaterThan(0);
    expect(bypass!.reason).toMatch(/sandbox signals present/i);
  });

  it("marks BYPASS unsafe without sandbox evidence", () => {
    const result = scanRepository(join(fixtures, "04-shell-bypass"));
    const bypass = result.findings.find((f) => f.classification === "BYPASS");
    expect(bypass).toBeDefined();
    expect(bypass!.bypassUnsafe).toBe(true);
    expect(bypass!.reason).toMatch(/no sandbox evidence/i);
  });
});
