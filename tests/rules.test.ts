import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyInvocation,
  decisionTableMarkdownRows,
  DECISION_RULES,
} from "../src/core/rules.js";
import type { Invocation } from "../src/core/invocation.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function inv(partial: Partial<Invocation> & Pick<Invocation, "raw" | "argv">): Invocation {
  return {
    file: "x.yml",
    line: 1,
    snippet: partial.raw,
    sourceKind: "github-actions-shell",
    confidence: "high",
    hasUnresolvedVars: false,
    ...partial,
  };
}

describe("rules", () => {
  it("orders bypass before permission-prompts none", () => {
    const f = classifyInvocation(
      inv({
        raw: "claude -p x --dangerously-skip-permissions --permission-prompts none",
        argv: [
          "claude",
          "-p",
          "x",
          "--dangerously-skip-permissions",
          "--permission-prompts",
          "none",
        ],
      }),
      repoRoot,
    );
    expect(f.classification).toBe("BYPASS");
    expect(f.ruleId).toBe("bypass-flag");
    expect(f.bypassUnsafe).toBe(true);
  });

  it("classifies permission-prompts none as DENY-CONTINUE", () => {
    const f = classifyInvocation(
      inv({
        raw: "claude -p x --permission-prompts none",
        argv: ["claude", "-p", "x", "--permission-prompts", "none"],
      }),
      repoRoot,
    );
    expect(f.classification).toBe("DENY-CONTINUE");
  });

  it("uses action-specific hang reason", () => {
    const f = classifyInvocation(
      inv({
        raw: "claude --max-turns 5",
        argv: ["claude", "--max-turns", "5"],
        sourceKind: "github-actions-action",
      }),
      repoRoot,
    );
    expect(f.classification).toBe("HANG");
    expect(f.reason).toMatch(/silently auto-deny/i);
  });

  it("exposes five decision rules", () => {
    expect(DECISION_RULES).toHaveLength(5);
    expect(DECISION_RULES.map((r) => r.id)).toEqual([
      "bypass-flag",
      "permission-prompts-none",
      "settings-deny-by-default",
      "settings-missing-or-dynamic",
      "hang-default",
    ]);
  });
});

describe("README decision table consistency", () => {
  it("README contains the decision table rows from rules.ts", () => {
    const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
    for (const row of decisionTableMarkdownRows()) {
      expect(readme).toContain(row);
    }
  });
});
