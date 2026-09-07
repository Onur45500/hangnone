import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/** Bare ignore on a line (does not match ignore-next-line). */
const BARE_IGNORE = /#\s*hangnone:\s*ignore(?:\s|$)/;
const IGNORE_NEXT = /#\s*hangnone:\s*ignore-next-line\b/;

/**
 * True if the finding at 1-based `line` is suppressed by an inline directive.
 * - `# hangnone:ignore` on the same line
 * - `# hangnone:ignore-next-line` on the immediately preceding non-empty line
 * - `# hangnone:ignore` as a full-line comment above the YAML step containing this line
 */
export function isLineIgnored(
  repoRoot: string,
  relativeFile: string,
  line: number,
): boolean {
  const abs = resolve(repoRoot, relativeFile);
  if (!existsSync(abs)) return false;

  let text: string;
  try {
    text = readFileSync(abs, "utf8");
  } catch {
    return false;
  }

  const lines = text.split(/\r?\n/);
  const idx = line - 1;
  if (idx < 0 || idx >= lines.length) return false;

  const current = lines[idx] ?? "";
  if (BARE_IGNORE.test(current)) return true;

  // ignore-next-line only applies to the immediately following non-empty line
  for (let i = idx - 1; i >= 0; i -= 1) {
    const prev = (lines[i] ?? "").trim();
    if (prev === "") continue;
    if (IGNORE_NEXT.test(prev)) return true;
    break;
  }

  // Walk up through nested YAML to a full-line # hangnone:ignore above this step
  let seenListItem = false;
  for (let i = idx - 1; i >= Math.max(0, idx - 30); i -= 1) {
    const raw = lines[i] ?? "";
    const prev = raw.trim();
    if (prev === "") continue;

    if (/^\s*#/.test(raw)) {
      if (BARE_IGNORE.test(prev)) return true;
      continue;
    }

    // Nested YAML keys / values inside the current step
    if (/^\s+\S/.test(raw) && !/^\s*-\s/.test(raw)) {
      continue;
    }

    // Step list item — keep scanning for a comment above it once
    if (/^\s*-\s/.test(raw)) {
      if (seenListItem) return false;
      seenListItem = true;
      continue;
    }

    break;
  }

  return false;
}

export function lineHasIgnoreDirective(line: string): boolean {
  return BARE_IGNORE.test(line);
}

export function lineHasIgnoreNextDirective(line: string): boolean {
  return IGNORE_NEXT.test(line);
}
