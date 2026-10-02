#!/usr/bin/env bash
# Runs inside the new window opened by next-phase.sh: starts Claude Code on the
# relay prompt. The prompt is moved aside first, so a crash never relaunches it.
set -euo pipefail

cd "$(dirname "$0")/../.."
relay="plans/relay"
stamp="$(date +%Y%m%d-%H%M%S)"
mv "$relay/next-prompt.md" "$relay/sent-$stamp.md"
echo "$(date -Iseconds) started: sent-$stamp.md" >> "$relay/relay.log"

prompt="$(cat "$relay/sent-$stamp.md")"

# Start Claude in C:/Users/Steve/Dev, not the repo (Steve, 2026-10-02): that folder is trusted, and a
# repo Claude Code hadn't opened before left two relay windows without a session. Prompts use
# absolute paths, so the working folder doesn't matter to them.
cd /c/Users/Steve/Dev
claude "$prompt"
