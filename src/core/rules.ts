import type {
  ClassifiedFinding,
  Classification,
  Invocation,
} from "./invocation.js";
import { resolveInvocationSettings } from "./settings-resolver.js";
import { detectSandboxSignals } from "./sandbox-signals.js";
import { tokenize } from "./tokenizer.js";

/**
 * Ordered decision table — single source of truth.
 * README documents this table; tests assert README stays in sync.
 *
 * Precedence:
 *   1. explicit bypass flag / bypassPermissions
 *   2. --permission-prompts none
 *   3. --settings file with deny-by-default / dontAsk
 *   4. unresolvable settings / vars → UNKNOWN
 *   5. otherwise → HANG (context-aware reason)
 *
 * BYPASS reasons are enriched with sandbox-signal heuristics (not a 6th bucket).
 */
export const DECISION_RULES = [
  {
    id: "bypass-flag",
    classification: "BYPASS" as Classification,
    summary:
      "explicit --dangerously-skip-permissions or bypassPermissions without mandatory sandbox evidence",
  },
  {
    id: "permission-prompts-none",
    classification: "DENY-CONTINUE" as Classification,
    summary: "--permission-prompts none present (clean deny, no hang)",
  },
  {
    id: "settings-deny-by-default",
    classification: "DENY-CONTINUE" as Classification,
    summary:
      "--settings (or project settings) with deny-by-default / dontAsk mode",
  },
  {
    id: "settings-missing-or-dynamic",
    classification: "UNKNOWN" as Classification,
    summary:
      "--settings path does not resolve, or decision-relevant flags use unresolved variables",
  },
  {
    id: "hang-default",
    classification: "HANG" as Classification,
    summary:
      "no --permission-prompts none, no dontAsk settings, no bypass flag",
  },
] as const;

export type DecisionRuleId = (typeof DECISION_RULES)[number]["id"];

function hangReason(inv: Invocation): string {
  if (inv.sourceKind === "github-actions-action") {
    return "no unattended permission handling; claude-code-action will silently auto-deny tool calls and may report success";
  }
  return "no --permission-prompts none, no dontAsk settings, no bypass flag; will hang waiting for a prompt";
}

function bypassReason(signals: string[]): string {
  if (signals.length > 0) {
    return `BYPASS with sandbox signals present (${signals.join(", ")}); heuristics only — not a security audit`;
  }
  return "BYPASS with no sandbox evidence; --dangerously-skip-permissions / bypassPermissions without nearby isolation signals";
}

export function classifyInvocation(
  inv: Invocation,
  repoRoot: string,
): ClassifiedFinding {
  const trace: string[] = [];

  // Re-tokenize if needed
  let argv = inv.argv;
  let hasUnresolved = inv.hasUnresolvedVars;
  if (argv === null && inv.raw) {
    const tok = tokenize(inv.raw);
    argv = tok.tokens;
    hasUnresolved = tok.decisionRelevantUnresolved || tok.hasUnresolvedVars;
  }

  const resolved = resolveInvocationSettings(repoRoot, argv);
  const mode = resolved.permissionMode?.toLowerCase() ?? null;

  // Rule 1: bypass
  trace.push("check bypass-flag");
  if (
    resolved.hasBypassFlag ||
    mode === "bypasspermissions" ||
    resolved.settings?.isBypass
  ) {
    const signals = detectSandboxSignals(inv.contextText, resolved.settings);
    trace.push(
      signals.length > 0
        ? `sandbox signals: ${signals.join(", ")}`
        : "sandbox signals: none",
    );
    return finding(
      inv,
      "BYPASS",
      "bypass-flag",
      trace,
      bypassReason(signals),
      signals,
    );
  }

  // Rule 2: --permission-prompts none
  trace.push("check permission-prompts-none");
  if (resolved.hasPermissionPromptsNone) {
    return finding(
      inv,
      "DENY-CONTINUE",
      "permission-prompts-none",
      trace,
      DECISION_RULES[1].summary,
    );
  }

  // Also treat --permission-mode dontAsk as deny-continue
  if (mode === "dontask") {
    trace.push("permission-mode dontAsk on CLI");
    return finding(
      inv,
      "DENY-CONTINUE",
      "settings-deny-by-default",
      trace,
      "--permission-mode dontAsk present (allowlist-only, no prompts)",
    );
  }

  // Rule 3: settings deny-by-default
  trace.push("check settings-deny-by-default");
  if (resolved.settings?.exists && resolved.settings.isDenyByDefault) {
    return finding(
      inv,
      "DENY-CONTINUE",
      "settings-deny-by-default",
      trace,
      `settings at ${resolved.settingsRef} use deny-by-default / dontAsk mode`,
    );
  }

  // Rule 4: missing settings or dynamic vars
  trace.push("check settings-missing-or-dynamic");
  if (resolved.settingsMissing) {
    return finding(
      inv,
      "UNKNOWN",
      "settings-missing-or-dynamic",
      trace,
      `--settings ${resolved.settingsRef} does not exist in the repository`,
    );
  }
  if (hasUnresolved || (argv === null && inv.raw.includes("$"))) {
    return finding(
      inv,
      "UNKNOWN",
      "settings-missing-or-dynamic",
      trace,
      "decision-relevant flags contain unresolved shell variables",
    );
  }

  // Rule 5: hang
  trace.push("fallthrough hang-default");
  return finding(inv, "HANG", "hang-default", trace, hangReason(inv));
}

function finding(
  inv: Invocation,
  classification: Classification,
  ruleId: string,
  ruleTrace: string[],
  reason: string,
  sandboxSignals?: string[],
): ClassifiedFinding {
  const base: ClassifiedFinding = {
    file: inv.file,
    line: inv.line,
    invocation: truncate(inv.snippet || inv.raw, 80),
    classification,
    reason,
    confidence: inv.confidence,
    sourceKind: inv.sourceKind,
    ruleId,
    ruleTrace: [...ruleTrace, `fired: ${ruleId}`],
  };
  if (classification === "BYPASS") {
    const signals = sandboxSignals ?? [];
    base.sandboxSignals = signals;
    base.bypassUnsafe = signals.length === 0;
  }
  return base;
}

function truncate(s: string, max: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  if (one.length <= max) return one;
  return one.slice(0, max - 1) + "…";
}

export function classifyAll(
  invocations: Invocation[],
  repoRoot: string,
): ClassifiedFinding[] {
  return invocations.map((inv) => classifyInvocation(inv, repoRoot));
}

/** Stable markdown rows for README consistency tests. */
export function decisionTableMarkdownRows(): string[] {
  return [
    "| Priority | Condition | Classification |",
    "| --- | --- | --- |",
    "| 1 | `--dangerously-skip-permissions` or `bypassPermissions` (flag or settings) | **BYPASS** |",
    "| 2 | `--permission-prompts none` present | **DENY-CONTINUE** |",
    "| 3 | `--settings` / project settings with deny-by-default (`dontAsk`) mode | **DENY-CONTINUE** |",
    "| 4 | `--settings` path missing, or decision-relevant unresolved `$VAR` | **UNKNOWN** |",
    "| 5 | Otherwise (Claude Code invocation with none of the above) | **HANG** |",
  ];
}
