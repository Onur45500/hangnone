import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, normalize, resolve } from "node:path";
import type { ResolvedSettings } from "./invocation.js";
import { getFlagValue, hasFlag } from "./tokenizer.js";

/** Modes that deny by default / allowlist-only (no interactive prompts). */
const DENY_BY_DEFAULT_MODES = new Set([
  "dontAsk",
  "dontask",
  "deny",
  "plan", // plan mode doesn't run mutating tools interactively in CI contexts
]);

const BYPASS_MODES = new Set(["bypassPermissions", "bypasspermissions", "yolo"]);

export function resolveSettingsPath(
  repoRoot: string,
  settingsPath: string,
): string {
  if (isAbsolute(settingsPath)) return normalize(settingsPath);
  return resolve(repoRoot, settingsPath);
}

export function loadSettingsFile(
  repoRoot: string,
  settingsPath: string,
): ResolvedSettings {
  const abs = resolveSettingsPath(repoRoot, settingsPath);
  if (!existsSync(abs)) {
    return {
      path: settingsPath,
      exists: false,
      defaultMode: null,
      isBypass: false,
      isDenyByDefault: false,
      hasSandboxConfig: false,
      raw: null,
    };
  }

  try {
    const text = readFileSync(abs, "utf8");
    const raw = JSON.parse(text) as Record<string, unknown>;
    return parseSettingsObject(settingsPath, raw);
  } catch {
    return {
      path: settingsPath,
      exists: true,
      defaultMode: null,
      isBypass: false,
      isDenyByDefault: false,
      hasSandboxConfig: false,
      raw: null,
    };
  }
}

export function parseSettingsObject(
  path: string,
  raw: Record<string, unknown>,
): ResolvedSettings {
  const permissions =
    typeof raw.permissions === "object" && raw.permissions !== null
      ? (raw.permissions as Record<string, unknown>)
      : {};

  const defaultMode =
    typeof permissions.defaultMode === "string"
      ? permissions.defaultMode
      : typeof raw.defaultMode === "string"
        ? raw.defaultMode
        : null;

  const modeLower = defaultMode?.toLowerCase() ?? "";
  const isBypass =
    BYPASS_MODES.has(defaultMode ?? "") || BYPASS_MODES.has(modeLower);

  const isDenyByDefault =
    DENY_BY_DEFAULT_MODES.has(defaultMode ?? "") ||
    DENY_BY_DEFAULT_MODES.has(modeLower) ||
    raw.dontAsk === true ||
    permissions.dontAsk === true;

  const hasSandboxConfig = hasSandboxKeys(raw) || hasSandboxKeys(permissions);

  return {
    path,
    exists: true,
    defaultMode,
    isBypass,
    isDenyByDefault,
    hasSandboxConfig,
    raw,
  };
}

function hasSandboxKeys(obj: Record<string, unknown>): boolean {
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (
      lower === "sandbox" ||
      lower === "networkallowlist" ||
      lower === "network_allowlist" ||
      lower.includes("sandbox")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Resolve settings for an invocation: CLI --settings path first, else repo .claude/settings.json.
 */
export function resolveInvocationSettings(
  repoRoot: string,
  argv: string[] | null,
): {
  settings: ResolvedSettings | null;
  settingsRef: string | null;
  settingsMissing: boolean;
  hasBypassFlag: boolean;
  hasPermissionPromptsNone: boolean;
  permissionMode: string | null;
} {
  const hasBypassFlag =
    argv !== null &&
    (hasFlag(argv, "--dangerously-skip-permissions") ||
      getFlagValue(argv, "--permission-mode")?.toLowerCase() ===
        "bypasspermissions");

  const permissionPrompts = argv
    ? getFlagValue(argv, "--permission-prompts")
    : null;
  const hasPermissionPromptsNone =
    permissionPrompts?.toLowerCase() === "none";

  const permissionMode = argv
    ? getFlagValue(argv, "--permission-mode")
    : null;

  const settingsRef = argv ? getFlagValue(argv, "--settings") : null;

  if (settingsRef) {
    const settings = loadSettingsFile(repoRoot, settingsRef);
    return {
      settings,
      settingsRef,
      settingsMissing: !settings.exists,
      hasBypassFlag,
      hasPermissionPromptsNone,
      permissionMode,
    };
  }

  // Fall back to committed project settings
  const projectSettings = join(repoRoot, ".claude", "settings.json");
  if (existsSync(projectSettings)) {
    const settings = loadSettingsFile(repoRoot, ".claude/settings.json");
    return {
      settings,
      settingsRef: ".claude/settings.json",
      settingsMissing: false,
      hasBypassFlag,
      hasPermissionPromptsNone,
      permissionMode,
    };
  }

  return {
    settings: null,
    settingsRef: null,
    settingsMissing: false,
    hasBypassFlag,
    hasPermissionPromptsNone,
    permissionMode,
  };
}

export { DENY_BY_DEFAULT_MODES, BYPASS_MODES };
