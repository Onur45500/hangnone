import { resolve } from "node:path";
import type {
  ClassifiedFinding,
  Invocation,
  ScanOptions,
  ScanResult,
} from "./core/invocation.js";
import { summarize, TARGETS } from "./core/invocation.js";
import { classifyAll } from "./core/rules.js";
import { isLineIgnored } from "./core/ignore.js";
import { discoverGitHubActions } from "./discover/github-actions.js";
import { discoverGitLabCi } from "./discover/gitlab-ci.js";
import { discoverShellScripts } from "./discover/shell-scripts.js";
import { discoverCircleCi } from "./discover/circleci.js";
import { discoverAzurePipelines } from "./discover/azure-pipelines.js";
import { discoverJenkins } from "./discover/jenkins.js";
import { discoverCodeSubprocess } from "./discover/code-subprocess.js";

export function scanRepository(
  path = ".",
  options: ScanOptions = {},
): ScanResult {
  const repoRoot = resolve(path);
  const includeCode = options.includeCode !== false;

  const invocations: Invocation[] = [
    ...discoverGitHubActions(repoRoot),
    ...discoverGitLabCi(repoRoot),
    ...discoverShellScripts(repoRoot),
    ...discoverCircleCi(repoRoot),
    ...discoverAzurePipelines(repoRoot),
    ...discoverJenkins(repoRoot),
    ...(includeCode ? discoverCodeSubprocess(repoRoot) : []),
  ];

  invocations.sort((a, b) => {
    if (a.file !== b.file) return a.file.localeCompare(b.file);
    return a.line - b.line;
  });

  let findings: ClassifiedFinding[] = classifyAll(invocations, repoRoot).map(
    (f) => {
      const ignored = isLineIgnored(repoRoot, f.file, f.line);
      return ignored ? { ...f, ignored: true } : f;
    },
  );

  if (!options.includeIgnored) {
    findings = findings.filter((f) => !f.ignored);
  }

  return {
    findings,
    summary: summarize(
      // summary should count only non-ignored when filtered; when includeIgnored,
      // summarize() skips ignored from hang/bypass counts and tracks ignored count
      options.includeIgnored
        ? findings
        : findings.map((f) => ({ ...f, ignored: false })),
    ),
    targets: options.assumeClaudeVersion
      ? `claude-code >= ${options.assumeClaudeVersion}`
      : TARGETS,
  };
}

/** Findings that should trip --fail-on (respects ignored + strict). */
export function findingsForFailOn(
  findings: ClassifiedFinding[],
  options: ScanOptions,
): ClassifiedFinding[] {
  return findings.filter((f) => {
    if (f.ignored) return false;
    if (!options.strict) {
      if (f.sourceKind === "code-subprocess" || f.confidence === "low") {
        return false;
      }
    }
    return true;
  });
}
