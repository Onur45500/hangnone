import pc from "picocolors";
import type { ClassifiedFinding, ScanResult } from "../core/invocation.js";

function colorFor(classification: ClassifiedFinding["classification"]): (s: string) => string {
  switch (classification) {
    case "HANG":
      return pc.red;
    case "BYPASS":
      return pc.yellow;
    case "DENY-CONTINUE":
      return pc.green;
    case "UNKNOWN":
      return pc.gray;
  }
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s;
  return s + " ".repeat(n - s.length);
}

export function formatTable(result: ScanResult, useColor = true): string {
  if (result.findings.length === 0) {
    return "No Claude Code invocations found.";
  }

  const paint = (fn: (s: string) => string, s: string) => (useColor ? fn(s) : s);
  const lines: string[] = [];

  const byFile = new Map<string, ClassifiedFinding[]>();
  for (const f of result.findings) {
    const list = byFile.get(f.file) ?? [];
    list.push(f);
    byFile.set(f.file, list);
  }

  for (const [file, findings] of byFile) {
    lines.push(paint(pc.bold, file));
    const locWidth = Math.max(
      ...findings.map((f) => `${f.file}:${f.line}`.length),
      12,
    );
    const classWidth = 14;

    for (const f of findings) {
      const loc = pad(`${f.file}:${f.line}`, locWidth);
      const klass = paint(colorFor(f.classification), pad(f.classification, classWidth));
      const snippet = f.invocation.length > 50 ? f.invocation.slice(0, 49) + "…" : f.invocation;
      lines.push(`  ${loc}  ${snippet.padEnd(52)}  ${klass}  ${f.reason}`);
    }
    lines.push("");
  }

  const { hang, bypass, deny_continue, unknown } = result.summary;
  const parts = [
    paint(pc.red, `${hang} HANG`),
    paint(pc.yellow, `${bypass} BYPASS`),
    paint(pc.green, `${deny_continue} DENY-CONTINUE`),
    paint(pc.gray, `${unknown} UNKNOWN`),
  ];
  lines.push(`Summary: ${parts.join(", ")}`);
  return lines.join("\n");
}
