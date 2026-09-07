import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Invocation } from "../core/invocation.js";
import { findClaudeCommandSnippets, tokenize } from "../core/tokenizer.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".venv",
  "vendor",
  "fixtures", // avoid scanning our own test fixtures when scanning the hangnone repo itself
]);

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

function looksNonInteractive(raw: string, surrounding: string): boolean {
  // -p / --print, pipes, background, cron comments, CI env hints
  if (/\s-p(?:\s|=|$)/.test(raw) || /\s--print(?:\s|=|$)/.test(raw)) return true;
  if (raw.includes("|") || /&\s*$/.test(raw)) return true;
  if (/cron|ci|headless|unattended|noninteractive/i.test(surrounding)) return true;
  if (/\$\{?CI\}?/.test(surrounding)) return true;
  return false;
}

export function discoverShellScripts(repoRoot: string): Invocation[] {
  const out: Invocation[] = [];
  walk(repoRoot, repoRoot, out);
  return out;
}

function walk(dir: string, repoRoot: string, out: Invocation[]): void {
  if (!existsSync(dir)) return;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const abs = join(dir, name);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walk(abs, repoRoot, out);
      continue;
    }
    if (!st.isFile()) continue;
    if (!name.endsWith(".sh")) continue;
    collectFile(abs, repoRoot, out);
  }
}

function collectFile(abs: string, repoRoot: string, out: Invocation[]): void {
  const text = readFileSync(abs, "utf8");
  if (!/\bclaude(?:-code)?\b/.test(text)) return;
  const rel = toPosix(relative(repoRoot, abs));
  const snippets = findClaudeCommandSnippets(text);

  for (const snip of snippets) {
    if (!looksNonInteractive(snip.raw, text)) continue;
    const tok = tokenize(snip.raw);
    // Prefer invocations that look like headless (-p) for shell scripts
    const isHeadless =
      /\s-p(?:\s|=|$)/.test(snip.raw) ||
      /\s--print(?:\s|=|$)/.test(snip.raw) ||
      snip.raw.includes("|") ||
      /&\s*$/.test(snip.raw);

    out.push({
      file: rel,
      line: snip.lineOffset + 1,
      snippet: snip.raw,
      sourceKind: "shell-script",
      argv: tok.tokens,
      raw: snip.raw,
      confidence: isHeadless ? "medium" : "low",
      hasUnresolvedVars: tok.decisionRelevantUnresolved,
      contextText: text,
    });
  }
}

export function discoverShellScriptFile(
  absPath: string,
  repoRoot: string,
): Invocation[] {
  const out: Invocation[] = [];
  collectFile(absPath, repoRoot, out);
  return out;
}
