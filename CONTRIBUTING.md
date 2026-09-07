# Contributing to hangnone

Thanks for helping improve hangnone. This is an independent tool (not affiliated with Anthropic).

## Development setup

```bash
git clone https://github.com/Onur45500/hangnone.git
cd hangnone
npm install
npm test
npm run build
node dist/cli.js scan ./fixtures/01-gha-action-hang
```

Requires Node.js 18+.

## Project layout

- `src/` — CLI, discoverers, rule engine, reporters, fix
- `fixtures/` — mini repos used by classification tests
- `tests/` — vitest suites

The decision table in `src/core/rules.ts` is the source of truth. The README table must stay in sync (enforced by tests).

## Adding a fixture

1. Create `fixtures/<name>/` with a realistic CI or script layout
2. Assert the expected classification in `tests/`
3. Run `npm test`

## Pull requests

- Keep changes focused; prefer small PRs
- Include tests for new classifications or discoverers
- Do not commit `node_modules/` or `dist/`
- Do not commit secrets or `.env` files

## Releases / npm publish

Maintainers publish by tagging a version (e.g. `v2.0.0`). The Release workflow runs tests, builds, and publishes to npm.

The repository needs a secret named `NPM_TOKEN` (npm automation token with publish rights). Set it under **Settings → Secrets and variables → Actions**. Never commit tokens.

## Code of conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
