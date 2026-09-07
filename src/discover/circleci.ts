import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseDocument, isMap, isSeq, isScalar, YAMLMap } from "yaml";
import type { Invocation } from "../core/invocation.js";
import { findClaudeCommandSnippets, tokenize } from "../core/tokenizer.js";

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function lineOf(
  node: { range?: [number, number, number] | null } | null | undefined,
  text: string,
): number {
  if (!node?.range) return 1;
  return text.slice(0, node.range[0]).split(/\r?\n/).length;
}

function scalarString(node: unknown): string | null {
  if (
    isScalar(node) &&
    (typeof node.value === "string" || typeof node.value === "number")
  ) {
    return String(node.value);
  }
  return null;
}

function getMapValue(map: YAMLMap, key: string): unknown {
  for (const item of map.items) {
    if (isScalar(item.key) && String(item.key.value) === key) {
      return item.value;
    }
  }
  return undefined;
}

function collectFromRunNode(
  runNode: unknown,
  text: string,
  rel: string,
  contextText: string,
  out: Invocation[],
): void {
  const run = scalarString(runNode);
  if (!run || !/\bclaude(?:-code)?\b/.test(run)) return;

  const snippets = findClaudeCommandSnippets(run);
  const baseLine = lineOf(
    runNode as { range?: [number, number, number] },
    text,
  );

  if (snippets.length === 0) {
    const tok = tokenize(run);
    out.push({
      file: rel,
      line: baseLine,
      snippet: run,
      sourceKind: "circleci",
      argv: tok.tokens,
      raw: run,
      confidence: "high",
      hasUnresolvedVars: tok.decisionRelevantUnresolved,
      contextText,
    });
    return;
  }

  for (const snip of snippets) {
    const tok = tokenize(snip.raw);
    out.push({
      file: rel,
      line: baseLine + snip.lineOffset,
      snippet: snip.raw,
      sourceKind: "circleci",
      argv: tok.tokens,
      raw: snip.raw,
      confidence: "high",
      hasUnresolvedVars: tok.decisionRelevantUnresolved,
      contextText,
    });
  }
}

function walkSteps(
  steps: unknown,
  text: string,
  rel: string,
  contextText: string,
  out: Invocation[],
): void {
  if (!isSeq(steps)) return;
  for (const step of steps.items) {
    if (!isMap(step)) continue;
    const runNode = getMapValue(step, "run");
    if (isScalar(runNode)) {
      collectFromRunNode(runNode, text, rel, contextText, out);
    } else if (isMap(runNode)) {
      // CircleCI: run: { command: "..." }
      const cmd = getMapValue(runNode, "command");
      collectFromRunNode(cmd, text, rel, contextText, out);
    }
  }
}

export function discoverCircleCi(repoRoot: string): Invocation[] {
  const abs = join(repoRoot, ".circleci", "config.yml");
  if (!existsSync(abs)) return [];

  const text = readFileSync(abs, "utf8");
  const rel = toPosix(relative(repoRoot, abs));
  const doc = parseDocument(text, { keepSourceTokens: true });
  if (!isMap(doc.contents)) return [];

  const out: Invocation[] = [];

  const jobs = getMapValue(doc.contents, "jobs");
  if (isMap(jobs)) {
    for (const jobItem of jobs.items) {
      if (!isMap(jobItem.value)) continue;
      const jobText = text.slice(
        jobItem.value.range?.[0] ?? 0,
        jobItem.value.range?.[1] ?? text.length,
      );
      walkSteps(getMapValue(jobItem.value, "steps"), text, rel, jobText, out);
    }
  }

  // Also scan workflows → jobs inline steps (rare)
  return out;
}
