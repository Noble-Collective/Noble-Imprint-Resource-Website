#!/usr/bin/env bash
# Phase relay (Collective-Shared plans/2026-10-02-shared-scripture-parser.md, §3a): opens a fresh
# Claude Code session in a new Git Bash window with the prompt in
# plans/relay/next-prompt.md. Pass --exit to also end THIS session afterwards.
#
#   bash tools/relay/next-phase.sh          # launch only
#   bash tools/relay/next-phase.sh --exit   # launch, then close this session
set -euo pipefail

repo="$(cd "$(dirname "$0")/../.." && pwd)"
relay="$repo/plans/relay"
prompt="$relay/next-prompt.md"
log="$relay/relay.log"

if [ -e "$relay/STOP" ]; then
  echo "$(date -Iseconds) STOP file present — not launching" | tee -a "$log"
  exit 1
fi
if [ ! -s "$prompt" ]; then
  echo "no prompt at $prompt" >&2
  exit 1
fi

echo "$(date -Iseconds) launch: $(head -n 1 "$prompt")" >> "$log"
# launch.ps1 opens the window with Start-Process (detached, so it outlives this
# session). cmd's `start` mangled the arguments when called from Git Bash.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$(cygpath -w "$repo/tools/relay/launch.ps1")"

if [ "${1:-}" = "--exit" ]; then
  sleep 5 # let the new window start before this one goes
  bash "$repo/tools/relay/self-exit.sh"
fi
