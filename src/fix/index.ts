import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ClassifiedFinding, ScanResult } from "../core/invocation.js";
import { hasFlag } from "../core/tokenizer.js";
import { tokenize } from "../core/tokenizer.js";

const FIXABLE_SOURCES = new Set([
  "github-actions-shell",
  "gitlab-ci",
  "shell-script",
  "circleci",
  "azure-pipelines",
  "jenkins",
]);

export type FixProposal = {
  file: string;
  line: number;
  before: string;
  after: string;
  applied: boolean;
};

export function isFixableHang(finding: ClassifiedFinding): boolean {
  if (finding.classification !== "HANG") return false;
  if (finding.ignored) return false;
  if (finding.sourceKind === "github-actions-action") return false;
  if (finding.sourceKind === "code-subprocess") return false;
  if (!FIXABLE_SOURCES.has(finding.sourceKind)) return false;

  const tok = tokenize(finding.invocation.startsWith("claude")
    ? finding.invocation
    : finding.invocation);
  // Prefer checking via a re-scan raw — use invocation snippet
  const argv = tok.tokens;
  if (hasFlag(argv, "--dangerously-skip-permissions")) return false;
  if (hasFlag(argv, "--permission-prompts")) return false;
  if (hasFlag(argv, "--permission-mode")) return false;
  if (hasFlag(argv, "--settings")) return false;
  return true;
}

/**
 * Propose appending `--permission-prompts none` to unambiguous raw-shell HANG findings.
 */
export function proposeFixes(
  result: ScanResult,
  repoRoot: string,
): FixProposal[] {
  const proposals: FixProposal[] = [];
  const root = resolve(repoRoot);

  for (const f of result.findings) {
    if (!isFixableHang(f)) continue;
    const abs = resolve(root, f.file);
    let text: string;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    const idx = f.line - 1;
    if (idx < 0 || idx >= lines.length) continue;
    const before = lines[idx]!;
    if (before.includes("--permission-prompts")) continue;
    if (!/\bclaude(?:-code)?\b/.test(before)) continue;

    const after = appendPermissionPromptsNone(before);
    if (after === before) continue;

    proposals.push({
      file: f.file,
      line: f.line,
      before,
      after,
      applied: false,
    });
  }

  return proposals;
}

function appendPermissionPromptsNone(line: string): string {
  const trimmedEnd = line.replace(/\s+$/, "");
  // Keep trailing comment if present
  const commentMatch = trimmedEnd.match(/(\s+#\s*(?!hangnone:).*)$/);
  if (commentMatch) {
    const body = trimmedEnd.slice(0, -commentMatch[1]!.length);
    return `${body} --permission-prompts none${commentMatch[1]}`;
  }
  return `${trimmedEnd} --permission-prompts none`;
}

export function formatFixDiff(proposals: FixProposal[]): string {
  if (proposals.length === 0) {
    return "No unambiguous HANG shell invocations to fix.";
  }
  const parts: string[] = [
    `Proposed fixes (${proposals.length}) — dry-run. Pass --write to apply.`,
    "",
  ];
  for (const p of proposals) {
    parts.push(`--- ${p.file}:${p.line}`);
    parts.push(`- ${p.before}`);
    parts.push(`+ ${p.after}`);
    parts.push("");
  }
  return parts.join("\n");
}

export function applyFixes(
  proposals: FixProposal[],
  repoRoot: string,
): FixProposal[] {
  const root = resolve(repoRoot);
  // Group by file
  const byFile = new Map<string, FixProposal[]>();
  for (const p of proposals) {
    const list = byFile.get(p.file) ?? [];
    list.push(p);
    byFile.set(p.file, list);
  }

  const applied: FixProposal[] = [];
  for (const [file, list] of byFile) {
    const abs = resolve(root, file);
    const text = readFileSync(abs, "utf8");
    const lines = text.split(/\r?\n/);
    // Apply from bottom to top so line numbers stay valid
    const sorted = [...list].sort((a, b) => b.line - a.line);
    for (const p of sorted) {
      const idx = p.line - 1;
      if (lines[idx] === p.before) {
        lines[idx] = p.after;
        applied.push({ ...p, applied: true });
      }
    }
    writeFileSync(abs, lines.join("\n"), "utf8");
  }
  return applied;
}
