import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { parseDocument, isMap, isSeq, isScalar, YAMLMap } from "yaml";
import type { Invocation } from "../core/invocation.js";
import {
  findClaudeCommandSnippets,
  tokenize,
} from "../core/tokenizer.js";

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

function collectScriptInvocations(
  script: string,
  scriptNode: unknown,
  text: string,
  rel: string,
  out: Invocation[],
  contextText?: string,
): void {
  if (!/\bclaude(?:-code)?\b/.test(script)) return;

  const snippets = findClaudeCommandSnippets(script);
  const baseLine = lineOf(
    scriptNode as { range?: [number, number, number] },
    text,
  );
  const ctx = contextText ?? text;

  if (snippets.length === 0) {
    const tok = tokenize(script);
    out.push({
      file: rel,
      line: baseLine,
      snippet: script,
      sourceKind: "gitlab-ci",
      argv: tok.tokens,
      raw: script,
      confidence: "high",
      hasUnresolvedVars: tok.decisionRelevantUnresolved,
      contextText: ctx,
    });
    return;
  }

  for (const snip of snippets) {
    const tok = tokenize(snip.raw);
    out.push({
      file: rel,
      line: baseLine + snip.lineOffset,
      snippet: snip.raw,
      sourceKind: "gitlab-ci",
      argv: tok.tokens,
      raw: snip.raw,
      confidence: "high",
      hasUnresolvedVars: tok.decisionRelevantUnresolved,
      contextText: ctx,
    });
  }
}

function walkJob(
  job: YAMLMap,
  text: string,
  rel: string,
  out: Invocation[],
): void {
  const jobText = text.slice(job.range?.[0] ?? 0, job.range?.[1] ?? text.length);
  // script: can be string or sequence
  const scriptNode = getMapValue(job, "script");
  if (isScalar(scriptNode)) {
    const s = scalarString(scriptNode);
    if (s) collectScriptInvocations(s, scriptNode, text, rel, out, jobText);
  } else if (isSeq(scriptNode)) {
    for (const item of scriptNode.items) {
      const s = scalarString(item);
      if (s) collectScriptInvocations(s, item, text, rel, out, jobText);
    }
  }

  // before_script / after_script
  for (const key of ["before_script", "after_script"]) {
    const node = getMapValue(job, key);
    if (isScalar(node)) {
      const s = scalarString(node);
      if (s) collectScriptInvocations(s, node, text, rel, out, jobText);
    } else if (isSeq(node)) {
      for (const item of node.items) {
        const s = scalarString(item);
        if (s) collectScriptInvocations(s, item, text, rel, out, jobText);
      }
    }
  }
}

export function discoverGitLabCiFile(
  absPath: string,
  repoRoot: string,
  seen: Set<string> = new Set(),
): Invocation[] {
  const abs = resolve(absPath);
  if (seen.has(abs)) return [];
  seen.add(abs);
  if (!existsSync(abs)) return [];

  const text = readFileSync(abs, "utf8");
  const rel = toPosix(relative(repoRoot, abs));
  const doc = parseDocument(text, { keepSourceTokens: true });
  if (!isMap(doc.contents)) return [];

  const out: Invocation[] = [];

  // Local includes
  const includeNode = getMapValue(doc.contents, "include");
  const includePaths = collectLocalIncludes(includeNode, dirname(abs), repoRoot);
  for (const inc of includePaths) {
    out.push(...discoverGitLabCiFile(inc, repoRoot, seen));
  }

  for (const item of doc.contents.items) {
    const key = isScalar(item.key) ? String(item.key.value) : "";
    // Skip reserved top-level keys
    if (
      [
        "include",
        "stages",
        "variables",
        "default",
        "workflow",
        "image",
        "services",
        "cache",
        "before_script",
        "after_script",
      ].includes(key)
    ) {
      // top-level before/after_script
      if ((key === "before_script" || key === "after_script") && isMap(doc.contents)) {
        // handled below via direct node
      }
      if (key === "before_script" || key === "after_script") {
        const node = item.value;
        if (isScalar(node)) {
          const s = scalarString(node);
          if (s) collectScriptInvocations(s, node, text, rel, out);
        } else if (isSeq(node)) {
          for (const it of node.items) {
            const s = scalarString(it);
            if (s) collectScriptInvocations(s, it, text, rel, out);
          }
        }
      }
      continue;
    }
    if (!isMap(item.value)) continue;
    // Job maps have script / extends / stage etc.
    walkJob(item.value, text, rel, out);
  }

  return out;
}

function collectLocalIncludes(
  includeNode: unknown,
  baseDir: string,
  repoRoot: string,
): string[] {
  const paths: string[] = [];

  const pushLocal = (local: string) => {
    const abs = resolve(baseDir, local);
    // Prefer under repo; also allow .gitlab/
    if (abs.startsWith(resolve(repoRoot))) {
      paths.push(abs);
    }
  };

  const handleOne = (node: unknown) => {
    if (isScalar(node)) {
      // short form: include: path.yml
      pushLocal(String(node.value));
      return;
    }
    if (!isMap(node)) return;
    const local = scalarString(getMapValue(node, "local"));
    if (local) pushLocal(local);
  };

  if (isSeq(includeNode)) {
    for (const item of includeNode.items) handleOne(item);
  } else {
    handleOne(includeNode);
  }

  return paths;
}

export function discoverGitLabCi(repoRoot: string): Invocation[] {
  const out: Invocation[] = [];
  const rootFile = join(repoRoot, ".gitlab-ci.yml");
  if (existsSync(rootFile)) {
    out.push(...discoverGitLabCiFile(rootFile, repoRoot));
  }
  // Also scan .gitlab/*.yml for standalone includes that mention claude
  // (already covered via include walk; also pick up orphans under .gitlab/)
  const gitlabDir = join(repoRoot, ".gitlab");
  if (existsSync(gitlabDir) && statSync(gitlabDir).isDirectory()) {
    walkDir(gitlabDir, (abs) => {
      if (!/\.ya?ml$/i.test(abs)) return;
      // Avoid double-scanning if already pulled via include — discoverGitLabCiFile dedupes via seen internally per call
      // Here we only scan files not already in root include tree by doing a fresh seen set... 
      // Simpler: only scan if content mentions claude and wasn't the root
      const text = readFileSync(abs, "utf8");
      if (!/\bclaude(?:-code)?\b/.test(text)) return;
      out.push(...discoverGitLabCiFile(abs, repoRoot));
    });
  }
  // Dedupe by file:line:snippet
  const seen = new Set<string>();
  return out.filter((inv) => {
    const key = `${inv.file}:${inv.line}:${inv.raw}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function walkDir(dir: string, fn: (abs: string) => void): void {
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkDir(abs, fn);
    else if (st.isFile()) fn(abs);
  }
}
