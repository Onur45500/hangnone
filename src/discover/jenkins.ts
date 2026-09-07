import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Invocation } from "../core/invocation.js";
import { findClaudeCommandSnippets, tokenize } from "../core/tokenizer.js";

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Best-effort Jenkinsfile scanner: find shell string literals / sh '''...''' blocks
 * that invoke claude.
 */
export function discoverJenkins(repoRoot: string): Invocation[] {
  const abs = join(repoRoot, "Jenkinsfile");
  if (!existsSync(abs)) return [];

  const text = readFileSync(abs, "utf8");
  if (!/\bclaude(?:-code)?\b/.test(text)) return [];

  const rel = toPosix(relative(repoRoot, abs));
  const out: Invocation[] = [];

  // Match sh '...' / sh "..." / sh '''...''' / sh """..."""
  const blockRe =
    /\bsh\s*(?:\(\s*)?('''[\s\S]*?'''|"""[\s\S]*?"""|'[^']*'|"[^"]*")/g;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(text)) !== null) {
    let body = match[1] ?? "";
    // strip quotes
    if (body.startsWith("'''") || body.startsWith('"""')) {
      body = body.slice(3, -3);
    } else if (
      (body.startsWith("'") && body.endsWith("'")) ||
      (body.startsWith('"') && body.endsWith('"'))
    ) {
      body = body.slice(1, -1);
    }
    if (!/\bclaude(?:-code)?\b/.test(body)) continue;

    const line = text.slice(0, match.index).split(/\r?\n/).length;
    const snippets = findClaudeCommandSnippets(body);
    if (snippets.length === 0) {
      const tok = tokenize(body.trim());
      out.push({
        file: rel,
        line,
        snippet: body.trim(),
        sourceKind: "jenkins",
        argv: tok.tokens,
        raw: body.trim(),
        confidence: "medium",
        hasUnresolvedVars: tok.decisionRelevantUnresolved,
        contextText: text,
      });
    } else {
      for (const snip of snippets) {
        const tok = tokenize(snip.raw);
        out.push({
          file: rel,
          line: line + snip.lineOffset,
          snippet: snip.raw,
          sourceKind: "jenkins",
          argv: tok.tokens,
          raw: snip.raw,
          confidence: "medium",
          hasUnresolvedVars: tok.decisionRelevantUnresolved,
          contextText: text,
        });
      }
    }
  }

  return out;
}
