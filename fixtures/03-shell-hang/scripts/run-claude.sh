#!/usr/bin/env bash
# cron-style unattended runner
set -euo pipefail
claude -p "Summarize git status and open a draft PR"
