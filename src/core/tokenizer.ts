/**
 * Shell-word tokenizer for Claude Code command lines.
 * Handles quotes, escapes, line continuations, and detects unresolved $VAR / ${VAR}.
 */

const UNRESOLVED_VAR = /(?:^|[^\\])\$(?:\{[^}]*\}|[A-Za-z_][A-Za-z0-9_]*)/;

export type TokenizeResult = {
  tokens: string[];
  hasUnresolvedVars: boolean;
  /** True if a decision-relevant flag value could not be resolved statically */
  decisionRelevantUnresolved: boolean;
};

const DECISION_FLAGS = new Set([
  "--permission-prompts",
  "--permission-mode",
  "--settings",
  "--dangerously-skip-permissions",
]);

/**
 * Normalize a multi-line shell / YAML block scalar into a single logical line,
 * joining continued lines (trailing `\`) and collapsing whitespace between lines.
 */
export function normalizeCommandText(raw: string): string {
  return raw
    .replace(/\\\r?\n/g, " ")
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(raw: string): TokenizeResult {
  const text = normalizeCommandText(raw);
  const tokens: string[] = [];
  let i = 0;
  let hasUnresolvedVars = false;

  while (i < text.length) {
    while (i < text.length && /\s/.test(text[i]!)) i += 1;
    if (i >= text.length) break;

    let token = "";
    let quote: '"' | "'" | null = null;

    while (i < text.length) {
      const ch = text[i]!;

      if (quote) {
        if (ch === quote) {
          quote = null;
          i += 1;
          continue;
        }
        if (ch === "\\" && quote === '"' && i + 1 < text.length) {
          token += text[i + 1]!;
          i += 2;
          continue;
        }
        token += ch;
        i += 1;
        continue;
      }

      if (ch === '"' || ch === "'") {
        quote = ch;
        i += 1;
        continue;
      }

      if (/\s/.test(ch)) break;

      if (ch === "\\" && i + 1 < text.length) {
        token += text[i + 1]!;
        i += 2;
        continue;
      }

      token += ch;
      i += 1;
    }

    if (token.length > 0) {
      if (UNRESOLVED_VAR.test(token)) hasUnresolvedVars = true;
      tokens.push(token);
    }
  }

  const decisionRelevantUnresolved = hasDecisionRelevantUnresolved(tokens);

  return {
    tokens,
    hasUnresolvedVars,
    decisionRelevantUnresolved,
  };
}

function hasDecisionRelevantUnresolved(tokens: string[]): boolean {
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i]!;

    if (t === "--dangerously-skip-permissions" && UNRESOLVED_VAR.test(t)) {
      return true;
    }

    // --flag=value
    const eq = t.indexOf("=");
    if (eq > 0) {
      const flag = t.slice(0, eq);
      const value = t.slice(eq + 1);
      if (DECISION_FLAGS.has(flag) && UNRESOLVED_VAR.test(value)) return true;
      continue;
    }

    if (DECISION_FLAGS.has(t)) {
      if (t === "--dangerously-skip-permissions") continue;
      const next = tokens[i + 1];
      if (next && UNRESOLVED_VAR.test(next)) return true;
      if (!next) return true; // flag present but value missing / dynamic
    }
  }
  return false;
}

/**
 * Extract Claude Code flag values from argv tokens.
 */
export function getFlagValue(argv: string[], flag: string): string | null {
  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i]!;
    if (t === flag) {
      return argv[i + 1] ?? null;
    }
    if (t.startsWith(`${flag}=`)) {
      return t.slice(flag.length + 1);
    }
  }
  return null;
}

export function hasFlag(argv: string[], flag: string): boolean {
  return argv.some((t) => t === flag || t.startsWith(`${flag}=`));
}

/** Detect whether a tokenized command looks like a Claude Code CLI invocation. */
export function isClaudeInvocation(argv: string[]): boolean {
  if (argv.length === 0) return false;
  const cmd = argv[0]!;
  const base = cmd.replace(/^.*[\\/]/, "").replace(/\.exe$/i, "");
  return (
    base === "claude" ||
    base === "claude-code" ||
    base.endsWith("claude") ||
    base.endsWith("claude-code")
  );
}

/**
 * Find Claude Code invocations inside a multi-statement shell script body.
 * Returns raw command strings (not full argv yet).
 */
export function findClaudeCommandSnippets(body: string): Array<{
  raw: string;
  lineOffset: number;
}> {
  const results: Array<{ raw: string; lineOffset: number }> = [];
  const lines = body.split(/\r?\n/);
  let buffer = "";
  let startLine = 0;
  let continuing = false;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx]!;
    const trimmed = line.trim();

    if (continuing) {
      buffer += "\n" + line;
      if (!/\\\s*$/.test(line)) {
        maybePush(buffer, startLine);
        buffer = "";
        continuing = false;
      }
      continue;
    }

    if (/^\s*#/.test(line)) continue;

    // Match claude / claude-code as a command word (not as substring of another word)
    if (/(?:^|[;&|]\s*|\$\(|`)\s*(?:claude-code|claude)(?:\s|$)/.test(trimmed) ||
        /(?:^|\s)(?:claude-code|claude)(?:\s|$)/.test(trimmed)) {
      // Prefer lines that look non-interactive: -p, --print, piped, or background
      buffer = line;
      startLine = idx;
      if (/\\\s*$/.test(line)) {
        continuing = true;
      } else {
        maybePush(buffer, startLine);
        buffer = "";
      }
    }
  }

  function maybePush(raw: string, lineOffset: number): void {
    const normalized = normalizeCommandText(raw);
    if (/\bclaude(?:-code)?\b/.test(normalized)) {
      results.push({ raw: normalized, lineOffset });
    }
  }

  return results;
}
