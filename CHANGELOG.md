# Changelog

## 2.0.0

Platform coverage and smarter BYPASS analysis.

- Discoverers for CircleCI (`.circleci/config.yml`), Azure Pipelines (`azure-pipelines*.yml`), and Jenkins (`Jenkinsfile`)
- Best-effort Python/Node subprocess / `exec` / `spawn` scan (`code-subprocess`, confidence `low`)
- `--no-include-code` to skip code scan; `--strict` to count low-confidence findings toward `--fail-on`
- BYPASS reason enrichment via sandbox-signal heuristics; `--fail-on bypass-unsafe` for BYPASS with no signals
- `--assume-claude-version` overrides the JSON `targets` string

## 1.1.0

Adoption features (also included in 2.0.0).

- Inline suppression: `# hangnone:ignore` and `# hangnone:ignore-next-line`
- `--include-ignored` to surface suppressed findings in output / JSON
- `hangnone fix` dry-run and `hangnone fix --write` for unambiguous raw-shell HANG → append `--permission-prompts none`
- Never auto-fixes BYPASS or `claude-code-action` steps

## 1.0.0

Initial release of **hangnone**, a static scanner for Claude Code CI hang / bypass risks.

- Scans GitHub Actions workflows (`claude-code-action` + `run:` shells), GitLab CI (including local includes), and headless-looking `*.sh` scripts
- Classifies each invocation as `HANG`, `BYPASS`, `DENY-CONTINUE`, or `UNKNOWN` via an ordered decision table
- Context-aware HANG reasons: timeout hang for raw CLI vs silent auto-deny for `claude-code-action`
- CLI: `scan` (table / `--json` / `--fail-on`) and `explain`
- Targets Claude Code CLI behavior as of **v2.1.259+** (`--permission-prompts none`)
