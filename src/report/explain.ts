import pc from "picocolors";
import type { ClassifiedFinding, ScanResult } from "../core/invocation.js";
import { DECISION_RULES } from "../core/rules.js";

export function formatExplain(
  result: ScanResult,
  fileFilter: string,
  lineFilter?: number,
  useColor = true,
): string {
  const findings = result.findings.filter((f) => {
    const matchFile =
      f.file === fileFilter ||
      f.file.endsWith(fileFilter) ||
      fileFilter.endsWith(f.file);
    if (!matchFile) return false;
    if (lineFilter !== undefined && f.line !== lineFilter) return false;
    return true;
  });

  if (findings.length === 0) {
    return `No findings matching ${fileFilter}${lineFilter !== undefined ? `:${lineFilter}` : ""}.`;
  }

  return findings.map((f) => explainOne(f, useColor)).join("\n\n");
}

function explainOne(f: ClassifiedFinding, useColor: boolean): string {
  const bold = (s: string) => (useColor ? pc.bold(s) : s);
  const dim = (s: string) => (useColor ? pc.dim(s) : s);
  const lines: string[] = [];
  lines.push(bold(`${f.file}:${f.line}`));
  lines.push(`  invocation:     ${f.invocation}`);
  lines.push(`  classification: ${f.classification}`);
  lines.push(`  confidence:     ${f.confidence}`);
  lines.push(`  source:         ${f.sourceKind}`);
  lines.push(`  reason:         ${f.reason}`);
  lines.push(`  rule:           ${f.ruleId}`);
  lines.push(dim("  rule trace:"));
  for (const step of f.ruleTrace) {
    lines.push(dim(`    - ${step}`));
  }
  lines.push("");
  lines.push(dim("  decision table (ordered):"));
  for (const rule of DECISION_RULES) {
    const marker = rule.id === f.ruleId ? "→" : " ";
    lines.push(dim(`    ${marker} [${rule.id}] ${rule.summary} → ${rule.classification}`));
  }
  return lines.join("\n");
}
