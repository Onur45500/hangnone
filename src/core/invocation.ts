export type Classification = "HANG" | "BYPASS" | "DENY-CONTINUE" | "UNKNOWN";

export type Confidence = "high" | "medium" | "low";

export type SourceKind =
  | "github-actions-action"
  | "github-actions-shell"
  | "gitlab-ci"
  | "shell-script"
  | "circleci"
  | "azure-pipelines"
  | "jenkins"
  | "code-subprocess";

export type Invocation = {
  /** Path relative to repo root */
  file: string;
  /** 1-based line number of the invocation */
  line: number;
  /** Truncated display snippet */
  snippet: string;
  /** How the invocation was discovered */
  sourceKind: SourceKind;
  /** Tokenized argv (command + flags), or null if unparseable */
  argv: string[] | null;
  /** Raw command / claude_args text */
  raw: string;
  /** Confidence that this is a real Claude Code headless invocation */
  confidence: Confidence;
  /** Whether decision-relevant tokens contain unresolved shell variables */
  hasUnresolvedVars: boolean;
  /**
   * Surrounding job/step text used for sandbox-signal heuristics (BYPASS enrichment).
   * Optional — discoverers should attach when cheap.
   */
  contextText?: string;
};

export type ResolvedSettings = {
  path: string | null;
  exists: boolean;
  defaultMode: string | null;
  isBypass: boolean;
  isDenyByDefault: boolean;
  hasSandboxConfig: boolean;
  raw: Record<string, unknown> | null;
};

export type ClassifiedFinding = {
  file: string;
  line: number;
  invocation: string;
  classification: Classification;
  reason: string;
  confidence: Confidence;
  sourceKind: SourceKind;
  ruleId: string;
  ruleTrace: string[];
  /** Suppressed by # hangnone:ignore */
  ignored?: boolean;
  /** For BYPASS: whether sandbox-related signals were found nearby */
  sandboxSignals?: string[];
  /** BYPASS with no sandbox signals — used by --fail-on bypass-unsafe */
  bypassUnsafe?: boolean;
};

export type ScanSummary = {
  hang: number;
  bypass: number;
  deny_continue: number;
  unknown: number;
  ignored?: number;
};

export type ScanOptions = {
  includeIgnored?: boolean;
  /** Include code-subprocess findings in the report (default true) */
  includeCode?: boolean;
  /**
   * When true, low-confidence / code-subprocess findings count toward --fail-on.
   * Default false: they appear in the report but do not fail the gate.
   */
  strict?: boolean;
  /** Reserved for forward-compatible rule packs */
  assumeClaudeVersion?: string;
};

export type ScanResult = {
  findings: ClassifiedFinding[];
  summary: ScanSummary;
  targets: string;
};

export const TARGETS = "claude-code >= 2.1.259";

export function emptySummary(): ScanSummary {
  return { hang: 0, bypass: 0, deny_continue: 0, unknown: 0, ignored: 0 };
}

export function summarize(findings: ClassifiedFinding[]): ScanSummary {
  const summary = emptySummary();
  for (const f of findings) {
    if (f.ignored) {
      summary.ignored = (summary.ignored ?? 0) + 1;
      continue;
    }
    switch (f.classification) {
      case "HANG":
        summary.hang += 1;
        break;
      case "BYPASS":
        summary.bypass += 1;
        break;
      case "DENY-CONTINUE":
        summary.deny_continue += 1;
        break;
      case "UNKNOWN":
        summary.unknown += 1;
        break;
    }
  }
  return summary;
}
