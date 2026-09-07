import type { ScanResult } from "../core/invocation.js";

export type JsonOutput = {
  findings: Array<{
    file: string;
    line: number;
    invocation: string;
    classification: string;
    reason: string;
    confidence: string;
    ignored?: boolean;
    sandboxSignals?: string[];
    bypassUnsafe?: boolean;
  }>;
  summary: {
    hang: number;
    bypass: number;
    deny_continue: number;
    unknown: number;
    ignored?: number;
  };
  targets: string;
};

export function toJson(result: ScanResult): JsonOutput {
  return {
    findings: result.findings.map((f) => ({
      file: f.file,
      line: f.line,
      invocation: f.invocation,
      classification: f.classification,
      reason: f.reason,
      confidence: f.confidence,
      ...(f.ignored ? { ignored: true } : {}),
      ...(f.sandboxSignals ? { sandboxSignals: f.sandboxSignals } : {}),
      ...(f.bypassUnsafe !== undefined
        ? { bypassUnsafe: f.bypassUnsafe }
        : {}),
    })),
    summary: result.summary,
    targets: result.targets,
  };
}

export function formatJson(result: ScanResult): string {
  return JSON.stringify(toJson(result), null, 2);
}
