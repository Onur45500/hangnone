import type { ResolvedSettings } from "./invocation.js";

/**
 * Heuristic sandbox / isolation signals. Presence only — not a security audit.
 */
const SIGNAL_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: "bubblewrap", re: /\b(?:bwrap|bubblewrap)\b/i },
  { id: "docker-network-none", re: /network:\s*['"]?none['"]?/i },
  { id: "docker-network-none-flag", re: /--network(?:=|\s+)none\b/i },
  { id: "firejail", re: /\bfirejail\b/i },
  { id: "nsjail", re: /\bnsjail\b/i },
  { id: "claude-sandbox-flag", re: /--sandbox\b/i },
];

export function detectSandboxSignals(
  contextText: string | undefined,
  settings: ResolvedSettings | null,
): string[] {
  const found = new Set<string>();

  if (contextText) {
    for (const { id, re } of SIGNAL_PATTERNS) {
      if (re.test(contextText)) found.add(id);
    }
  }

  if (settings?.hasSandboxConfig) {
    found.add("settings-sandbox");
  }

  if (settings?.raw) {
    const raw = settings.raw;
    if (hasSandboxKeys(raw)) found.add("settings-sandbox");
    const perms =
      typeof raw.permissions === "object" && raw.permissions !== null
        ? (raw.permissions as Record<string, unknown>)
        : {};
    if (hasSandboxKeys(perms)) found.add("settings-sandbox");
  }

  return [...found];
}

function hasSandboxKeys(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (
      lower === "sandbox" ||
      lower === "networkallowlist" ||
      lower === "network_allowlist" ||
      lower === "allowednetwork" ||
      lower.includes("sandbox")
    ) {
      return true;
    }
  }
  return false;
}
