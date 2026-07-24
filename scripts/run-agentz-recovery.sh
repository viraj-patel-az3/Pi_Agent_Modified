#!/usr/bin/env bash
set -euo pipefail

# //Viraj's Code Start
# Repository-local AgentZ launcher for the agent-recovery work.
# Keeps chat session storage (JSONL history + agentz-local-state.sqlite)
# inside this repository instead of the user-level ~/.pi directory.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SESSION_DIR="$REPO_ROOT/results/agent-recovery/agentz-sessions"

mkdir -p "$SESSION_DIR"
echo "AgentZ session directory: $SESSION_DIR"

"$REPO_ROOT/node_modules/.bin/tsx" \
  --tsconfig "$REPO_ROOT/tsconfig.json" \
  "$REPO_ROOT/packages/coding-agent/src/cli.ts" \
  --session-dir "$SESSION_DIR" \
  "$@"
exit $?
# //Viraj's Code End
