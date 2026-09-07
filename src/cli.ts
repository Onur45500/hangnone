import { resolve } from "node:path";
import { Command } from "commander";
import { findingsForFailOn, scanRepository } from "./scan.js";
import { formatTable } from "./report/table.js";
import { formatJson } from "./report/json.js";
import { formatExplain } from "./report/explain.js";
import {
  applyFixes,
  formatFixDiff,
  proposeFixes,
} from "./fix/index.js";
import type { Classification, ScanOptions } from "./core/invocation.js";

type FailOnTarget = Classification | "BYPASS-UNSAFE";

const FAIL_ON_MAP: Record<string, FailOnTarget> = {
  hang: "HANG",
  bypass: "BYPASS",
  "deny-continue": "DENY-CONTINUE",
  deny_continue: "DENY-CONTINUE",
  unknown: "UNKNOWN",
  "bypass-unsafe": "BYPASS-UNSAFE",
  bypass_unsafe: "BYPASS-UNSAFE",
};

function shouldFail(
  failOn: string | undefined,
  findings: ReturnType<typeof findingsForFailOn>,
): boolean {
  if (!failOn) return false;
  const target = FAIL_ON_MAP[failOn.toLowerCase()];
  if (!target) {
    console.error(
      `Unknown --fail-on value "${failOn}". Use: hang, bypass, deny-continue, unknown, bypass-unsafe`,
    );
    process.exit(2);
  }
  if (target === "BYPASS-UNSAFE") {
    return findings.some(
      (f) => f.classification === "BYPASS" && f.bypassUnsafe === true,
    );
  }
  return findings.some((f) => f.classification === target);
}

function scanOpts(opts: {
  includeIgnored?: boolean;
  includeCode?: boolean;
  strict?: boolean;
  assumeClaudeVersion?: string;
}): ScanOptions {
  return {
    includeIgnored: Boolean(opts.includeIgnored),
    includeCode: opts.includeCode !== false,
    strict: Boolean(opts.strict),
    assumeClaudeVersion: opts.assumeClaudeVersion,
  };
}

export function createProgram(): Command {
  const program = new Command();
  program
    .name("hangnone")
    .description(
      "Find Claude Code CI jobs that will hang waiting for a permission prompt nobody can answer.",
    )
    .version("2.0.0");

  program
    .command("scan")
    .description("Scan a repository for Claude Code hang / bypass risks")
    .argument("[path]", "repository root to scan", ".")
    .option("--json", "machine-readable JSON output")
    .option(
      "--fail-on <classification>",
      "exit non-zero if any finding matches (hang|bypass|deny-continue|unknown|bypass-unsafe)",
    )
    .option(
      "--include-ignored",
      "include findings suppressed by # hangnone:ignore",
    )
    .option("--no-include-code", "exclude Python/Node subprocess discoveries")
    .option(
      "--strict",
      "count low-confidence / code-subprocess findings toward --fail-on",
    )
    .option(
      "--assume-claude-version <version>",
      "override targets string for forward-compatible rule packs",
    )
    .option("--no-color", "disable colored output")
    .action(
      (
        path: string,
        opts: {
          json?: boolean;
          failOn?: string;
          color?: boolean;
          includeIgnored?: boolean;
          includeCode?: boolean;
          strict?: boolean;
          assumeClaudeVersion?: string;
        },
      ) => {
        const options = scanOpts(opts);
        const result = scanRepository(path, options);
        const useColor =
          opts.color !== false && !opts.json && Boolean(process.stdout.isTTY);

        if (opts.json) {
          console.log(formatJson(result));
        } else {
          console.log(formatTable(result, useColor));
        }

        const gateFindings = findingsForFailOn(result.findings, options);
        if (shouldFail(opts.failOn, gateFindings)) {
          process.exitCode = 1;
        }
      },
    );

  program
    .command("explain")
    .description("Verbose explanation of findings in a specific file")
    .argument("<file>", "file path (relative to repo or absolute)")
    .option("--line <n>", "only explain the finding at this line", (v) =>
      parseInt(v, 10),
    )
    .option("--repo <path>", "repository root", ".")
    .option("--include-ignored", "include ignored findings")
    .option("--no-color", "disable colored output")
    .action(
      (
        file: string,
        opts: {
          line?: number;
          repo?: string;
          color?: boolean;
          includeIgnored?: boolean;
        },
      ) => {
        const repoRoot = resolve(opts.repo ?? ".");
        const result = scanRepository(repoRoot, {
          includeIgnored: Boolean(opts.includeIgnored),
        });
        const useColor = opts.color !== false && Boolean(process.stdout.isTTY);
        console.log(formatExplain(result, file, opts.line, useColor));
      },
    );

  program
    .command("fix")
    .description(
      "Propose (or apply) --permission-prompts none on unambiguous raw-shell HANG findings",
    )
    .argument("[path]", "repository root to scan", ".")
    .option("--write", "apply changes (default is dry-run preview)")
    .option("--no-color", "disable colored output")
    .action((path: string, opts: { write?: boolean }) => {
      const repoRoot = resolve(path);
      const result = scanRepository(repoRoot);
      const proposals = proposeFixes(result, repoRoot);
      if (!opts.write) {
        console.log(formatFixDiff(proposals));
        return;
      }
      const applied = applyFixes(proposals, repoRoot);
      console.log(`Applied ${applied.length} fix(es).`);
      for (const p of applied) {
        console.log(`  ${p.file}:${p.line}`);
      }
    });

  return program;
}

export async function main(argv = process.argv): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}

const isDirect =
  process.argv[1] &&
  (process.argv[1].endsWith("cli.ts") ||
    process.argv[1].endsWith("cli.js") ||
    process.argv[1].includes("hangnone"));

if (isDirect) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
