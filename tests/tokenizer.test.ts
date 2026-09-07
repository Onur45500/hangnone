import { describe, expect, it } from "vitest";
import {
  getFlagValue,
  hasFlag,
  normalizeCommandText,
  tokenize,
} from "../src/core/tokenizer.js";

describe("tokenizer", () => {
  it("splits simple argv", () => {
    const r = tokenize('claude -p "hello world" --max-turns 10');
    expect(r.tokens).toEqual([
      "claude",
      "-p",
      "hello world",
      "--max-turns",
      "10",
    ]);
    expect(r.hasUnresolvedVars).toBe(false);
  });

  it("handles = style flags", () => {
    const r = tokenize("claude --settings=./ci.json -p hi");
    expect(getFlagValue(r.tokens, "--settings")).toBe("./ci.json");
  });

  it("joins line continuations", () => {
    const text = normalizeCommandText("claude -p hi \\\n  --permission-prompts none");
    expect(text).toContain("--permission-prompts none");
    const r = tokenize("claude -p hi \\\n  --permission-prompts none");
    expect(hasFlag(r.tokens, "--permission-prompts")).toBe(true);
    expect(getFlagValue(r.tokens, "--permission-prompts")).toBe("none");
  });

  it("detects unresolved vars in decision-relevant flags", () => {
    const r = tokenize("claude -p hi --settings $SETTINGS_PATH");
    expect(r.hasUnresolvedVars).toBe(true);
    expect(r.decisionRelevantUnresolved).toBe(true);
  });

  it("detects ${VAR} form", () => {
    const r = tokenize('claude -p x --permission-prompts "${MODE}"');
    expect(r.decisionRelevantUnresolved).toBe(true);
  });

  it("hasFlag for --dangerously-skip-permissions", () => {
    const r = tokenize("claude -p x --dangerously-skip-permissions");
    expect(hasFlag(r.tokens, "--dangerously-skip-permissions")).toBe(true);
  });
});
