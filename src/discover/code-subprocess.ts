import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import type { Invocation } from "../core/invocation.js";
import { tokenize } from "../core/tokenizer.js";

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "coverage",
  ".venv",
  "vendor",
  "fixtures",
]);

function toPosix(p: string): string {
  return p.split(sep).join("/");
}

/**
 * Best-effort scan of *.py / *.ts / *.js for subprocess/exec/spawn calling claude.
 */
export function discoverCodeSubprocess(repoRoot: string): Invocation[] {
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
    if (!/\.(py|ts|js|mjs|cjs)$/.test(name)) continue;
    if (name.endsWith(".d.ts")) continue;
    collectFile(abs, repoRoot, out);
  }
}

function collectFile(abs: string, repoRoot: string, out: Invocation[]): void {
  const text = readFileSync(abs, "utf8");
  if (!/\bclaude(?:-code)?\b/.test(text)) return;
  const rel = toPosix(relative(repoRoot, abs));
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    if (!/\bclaude(?:-code)?\b/.test(line)) continue;
    if (!isSubprocessish(line, text)) continue;

    const extracted = extractCommandFromCode(line);
    if (!extracted) continue;

    const tok = tokenize(extracted.command);
    const fullyDynamic =
      extracted.dynamic ||
      tok.decisionRelevantUnresolved ||
      /\$\{|%\(|f["']/.test(extracted.command);

    out.push({
      file: rel,
      line: i + 1,
      snippet: line.trim(),
      sourceKind: "code-subprocess",
      argv: fullyDynamic ? null : tok.tokens,
      raw: extracted.command,
      confidence: "low",
      hasUnresolvedVars: fullyDynamic || tok.decisionRelevantUnresolved,
      contextText: text,
    });
  }
}

function isSubprocessish(line: string, fileText: string): boolean {
  if (
    /\bsubprocess\.(?:run|call|Popen|check_call|check_output)\b/.test(line) ||
    /\bos\.system\b/.test(line) ||
    /\bchild_process\b/.test(line) ||
    /\b(?:exec(?:File|Sync)?|spawn(?:Sync)?|fork)\s*\(/.test(line)
  ) {
    return true;
  }
  // Multi-line: previous lines may have subprocess — check a small window via file
  // For v2 best-effort, also match array form ["claude", ...] near subprocess imports
  if (
    /\[["']claude(?:-code)?["']/.test(line) &&
    /\bsubprocess\b|\bchild_process\b|\bspawn\b|\bexec\b/.test(fileText)
  ) {
    return true;
  }
  return false;
}

function extractCommandFromCode(line: string): {
  command: string;
  dynamic: boolean;
} | null {
  // subprocess.run(["claude", "-p", "...", ...])
  const arr = line.match(
    /\[["']claude(?:-code)?["']\s*,\s*((?:[^[\]]|\[[^\]]*\])*)\]/,
  );
  if (arr) {
    const argsPart = arr[1] ?? "";
    const parts = ["claude"];
    const strRe = /["']([^"']*)["']/g;
    let m: RegExpExecArray | null;
    while ((m = strRe.exec(argsPart)) !== null) {
      parts.push(m[1]!);
    }
    const dynamic = /[a-zA-Z_][a-zA-Z0-9_]*\s*[,)\]]/.test(
      argsPart.replace(strRe, ""),
    ) && !strRe.test(argsPart);
    // simpler dynamic check: non-string tokens
    const hasIdent = /(?<!["'\w])[a-zA-Z_][a-zA-Z0-9_]*(?!["'\w])/.test(
      argsPart.replace(/["'][^"']*["']/g, ""),
    );
    return { command: parts.join(" "), dynamic: hasIdent };
  }

  // subprocess.run("claude -p ...") or os.system("claude ...")
  const str = line.match(
    /(?:subprocess\.\w+|os\.system|exec(?:File|Sync)?|spawn(?:Sync)?)\s*\(\s*(["'`])((?:claude(?:-code)?[^"'`]*)?)\1/,
  );
  if (str && str[2] && /\bclaude/.test(str[2])) {
    return { command: str[2], dynamic: false };
  }

  // Generic: quoted string containing claude -p
  const q = line.match(/(["'`])(claude(?:-code)?(?:\s|$)[^"'`]*)\1/);
  if (q?.[2]) {
    return { command: q[2], dynamic: /\$\{|%\(|\{/.test(q[2]) };
  }

  return null;
}
