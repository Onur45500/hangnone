import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { parseDocument, isMap, isSeq, isScalar, YAMLMap } from "yaml";
import type { Invocation } from "../core/invocation.js";
import {
  findClaudeCommandSnippets,
  isClaudeInvocation,
  tokenize,
} from "../core/tokenizer.js";

const CLAUDE_ACTION_RE = /anthropics\/claude-code-action(?:@|$)/i;

function lineOf(node: { range?: [number, number, number] | null } | null | undefined, text: string): number {
  if (!node?.range) return 1;
  const offset = node.range[0];
  return text.slice(0, offset).split(/\r?\n/).length;
}

function scalarString(node: unknown): string | null {
  if (isScalar(node) && (typeof node.value === "string" || typeof node.value === "number")) {
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

/**
 * Walk GitHub Actions workflow YAML and collect Claude Code invocations.
 */
export function discoverGitHubActionsFile(
  absPath: string,
  repoRoot: string,
): Invocation[] {
  const text = readFileSync(absPath, "utf8");
  const rel = toPosix(relative(repoRoot, absPath));
  const doc = parseDocument(text, { keepSourceTokens: true });
  if (!isMap(doc.contents)) return [];

  const findings: Invocation[] = [];
  const jobs = getMapValue(doc.contents, "jobs");
  if (!isMap(jobs)) return [];

  for (const jobItem of jobs.items) {
    if (!isMap(jobItem.value)) continue;
    const jobText = text.slice(
      (jobItem.value.range?.[0] ?? 0),
      (jobItem.value.range?.[1] ?? text.length),
    );
    const steps = getMapValue(jobItem.value, "steps");
    if (!isSeq(steps)) continue;

    for (const step of steps.items) {
      if (!isMap(step)) continue;
      collectStep(step, text, rel, findings, jobText);
    }
  }

  return findings;
}

function collectStep(
  step: YAMLMap,
  text: string,
  rel: string,
  out: Invocation[],
  jobText: string,
): void {
  const uses = scalarString(getMapValue(step, "uses"));
  if (uses && CLAUDE_ACTION_RE.test(uses)) {
    const withNode = getMapValue(step, "with");
    let claudeArgs = "";
    let argsNode: unknown = null;
    if (isMap(withNode)) {
      argsNode = getMapValue(withNode, "claude_args");
      claudeArgs = scalarString(argsNode) ?? "";
      // Also check legacy / alternate keys
      if (!claudeArgs) {
        for (const key of ["claude_args", "prompt", "direct_prompt"]) {
          const v = scalarString(getMapValue(withNode, key));
          if (key === "claude_args" && v) claudeArgs = v;
        }
      }
    }

    const line = lineOf(
      (argsNode && typeof argsNode === "object" && "range" in (argsNode as object)
        ? (argsNode as { range?: [number, number, number] })
        : null) ??
        (getMapValue(step, "uses") as { range?: [number, number, number] }) ??
        step,
      text,
    );

    // Tokenize as if `claude ${claude_args}` for flag extraction
    const argsTrimmed = claudeArgs.trim();
    const raw = argsTrimmed
      ? `claude ${argsTrimmed}`
      : `claude-code-action ${uses}`;
    const tok = tokenize(argsTrimmed ? `claude ${argsTrimmed}` : "claude");
    const snippet = argsTrimmed
      ? `claude-code-action ${argsTrimmed}`
      : uses;

    out.push({
      file: rel,
      line,
      snippet,
      sourceKind: "github-actions-action",
      argv: tok.tokens,
      raw,
      confidence: "high",
      hasUnresolvedVars: tok.decisionRelevantUnresolved,
      contextText: jobText,
    });
    return;
  }

  // run: shell steps
  const runNode = getMapValue(step, "run");
  const run = scalarString(runNode);
  if (run && /\bclaude(?:-code)?\b/.test(run)) {
    const snippets = findClaudeCommandSnippets(run);
    if (snippets.length === 0) {
      // Whole run block mentions claude — treat as one invocation
      const tok = tokenize(run);
      if (isClaudeInvocation(tok.tokens) || /\bclaude(?:-code)?\b/.test(run)) {
        // Extract the claude subcommand from a multi-line script
        const extracted = extractClaudeArgv(run);
        out.push({
          file: rel,
          line: lineOf(runNode as { range?: [number, number, number] }, text),
          snippet: extracted.snippet,
          sourceKind: "github-actions-shell",
          argv: extracted.argv,
          raw: extracted.raw,
          confidence: "high",
          hasUnresolvedVars: extracted.hasUnresolvedVars,
          contextText: jobText,
        });
      }
    } else {
      const baseLine = lineOf(runNode as { range?: [number, number, number] }, text);
      for (const snip of snippets) {
        const tok = tokenize(snip.raw);
        out.push({
          file: rel,
          line: baseLine + snip.lineOffset,
          snippet: snip.raw,
          sourceKind: "github-actions-shell",
          argv: tok.tokens,
          raw: snip.raw,
          confidence: "high",
          hasUnresolvedVars: tok.decisionRelevantUnresolved,
          contextText: jobText,
        });
      }
    }
  }
}

function extractClaudeArgv(run: string): {
  argv: string[];
  raw: string;
  snippet: string;
  hasUnresolvedVars: boolean;
} {
  const snippets = findClaudeCommandSnippets(run);
  if (snippets.length > 0) {
    const raw = snippets[0]!.raw;
    const tok = tokenize(raw);
    return {
      argv: tok.tokens,
      raw,
      snippet: raw,
      hasUnresolvedVars: tok.decisionRelevantUnresolved,
    };
  }
  const tok = tokenize(run);
  return {
    argv: tok.tokens,
    raw: run,
    snippet: run,
    hasUnresolvedVars: tok.decisionRelevantUnresolved,
  };
}

export function discoverGitHubActions(repoRoot: string): Invocation[] {
  const dir = join(repoRoot, ".github", "workflows");
  if (!existsSync(dir)) return [];
  const out: Invocation[] = [];
  for (const name of readdirSync(dir)) {
    if (!/\.ya?ml$/i.test(name)) continue;
    const abs = join(dir, name);
    if (!statSync(abs).isFile()) continue;
    out.push(...discoverGitHubActionsFile(abs, repoRoot));
  }
  return out;
}

function toPosix(p: string): string {
  return p.split(sep).join("/");
}
