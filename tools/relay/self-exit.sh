#!/usr/bin/env bash
# Ends the Claude Code session that runs this script — and ONLY that one.
# Claude Code tells each of its shells its own process id in $CLAUDE_PID; we
# stop exactly that id, after checking it really is a claude.exe. Never by
# name: other Claude sessions (e.g. an app window) and node servers keep
# running. If anything doesn't check out, nothing is stopped.
#
#   bash tools/relay/self-exit.sh --dry-run   # say what would be stopped
#   bash tools/relay/self-exit.sh             # stop this session
set -euo pipefail

relay="$(cd "$(dirname "$0")/../.." && pwd)/plans/relay"
mkdir -p "$relay"
log="$relay/relay.log"

fail() { echo "$(date -Iseconds) self-exit: $1 — nothing stopped" | tee -a "$log"; exit 1; }

pid="${CLAUDE_PID:-}"
[[ "$pid" =~ ^[0-9]+$ ]] || fail "CLAUDE_PID not set (not run from a Claude Code shell?)"

name="$(powershell.exe -NoProfile -Command "(Get-Process -Id $pid -ErrorAction SilentlyContinue).ProcessName" | tr -d '\r')"
[ "$name" = "claude" ] || fail "pid $pid is '${name:-gone}', not claude.exe"

if [ "${1:-}" = "--dry-run" ]; then
  echo "would stop claude.exe pid $pid (session ${CLAUDE_CODE_SESSION_ID:-?})"
  exit 0
fi
echo "$(date -Iseconds) self-exit: stopping claude.exe pid $pid (session ${CLAUDE_CODE_SESSION_ID:-?})" >> "$log"
taskkill //PID "$pid" //F > /dev/null
