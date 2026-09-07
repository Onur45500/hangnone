import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

function collectScript(
  scriptNode: unknown,
  text: string,
  rel: string,
  contextText: string,
  out: Invocation[],
): void {
  const script = scalarString(scriptNode);
  if (!script || !/\bclaude(?:-code)?\b/.test(script)) return;

  const snippets = findClaudeCommandSnippets(script);
  const baseLine = lineOf(
    scriptNode as { range?: [number, number, number] },
    text,
  );

  if (snippets.length === 0) {
    const tok = tokenize(script);
    out.push({
      file: rel,
      line: baseLine,
      snippet: script,
      sourceKind: "azure-pipelines",
      argv: tok.tokens,
      raw: script,
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
      sourceKind: "azure-pipelines",
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
    // script: "..." or bash: "..." or pwsh — we care about script/bash
    for (const key of ["script", "bash", "pwsh"]) {
      collectScript(getMapValue(step, key), text, rel, contextText, out);
    }
  }
}

function walkJobs(
  jobs: unknown,
  text: string,
  rel: string,
  out: Invocation[],
): void {
  if (!isSeq(jobs)) return;
  for (const job of jobs.items) {
    if (!isMap(job)) continue;
    const jobText = text.slice(
      job.range?.[0] ?? 0,
      job.range?.[1] ?? text.length,
    );
    walkSteps(getMapValue(job, "steps"), text, rel, jobText, out);
    // nested jobs under deployment strategies — best-effort skip
  }
}

export function discoverAzurePipelinesFile(
  absPath: string,
  repoRoot: string,
): Invocation[] {
  const text = readFileSync(absPath, "utf8");
  if (!/\bclaude(?:-code)?\b/.test(text)) return [];
  const rel = toPosix(relative(repoRoot, absPath));
  const doc = parseDocument(text, { keepSourceTokens: true });
  if (!isMap(doc.contents)) return [];

  const out: Invocation[] = [];
  walkJobs(getMapValue(doc.contents, "jobs"), text, rel, out);

  // stages → jobs
  const stages = getMapValue(doc.contents, "stages");
  if (isSeq(stages)) {
    for (const stage of stages.items) {
      if (!isMap(stage)) continue;
      walkJobs(getMapValue(stage, "jobs"), text, rel, out);
    }
  }

  // top-level steps (simple pipelines)
  walkSteps(getMapValue(doc.contents, "steps"), text, rel, text, out);

  return out;
}

export function discoverAzurePipelines(repoRoot: string): Invocation[] {
  const out: Invocation[] = [];
  const names = [
    "azure-pipelines.yml",
    "azure-pipelines.yaml",
    "azure-pipelines.ci.yml",
  ];
  for (const name of names) {
    const abs = join(repoRoot, name);
    if (existsSync(abs) && statSync(abs).isFile()) {
      out.push(...discoverAzurePipelinesFile(abs, repoRoot));
    }
  }
  // Also azure-pipelines*.yml at root
  try {
    for (const name of readdirSync(repoRoot)) {
      if (!/^azure-pipelines.*\.ya?ml$/i.test(name)) continue;
      if (names.includes(name)) continue;
      const abs = join(repoRoot, name);
      if (statSync(abs).isFile()) {
        out.push(...discoverAzurePipelinesFile(abs, repoRoot));
      }
    }
  } catch {
    // ignore
  }
  return out;
}
