#!/bin/bash
# UserPromptSubmit hook — route every prompt through gstack by default.
#
# AGENTS.md says this repo standardizes on gstack, but a document is passive: an
# agent reads it once and then answers the prompt however it likes. This hook is
# the active half. It fires on *every* prompt so the maintainer never has to
# write "use gstack" again — choosing the right command becomes the default
# first step, not something requested.
#
# Deliberately short: this text is prepended to every prompt, so it pays a token
# cost on each turn. Keep it a routing table, not a tutorial — the full
# reasoning lives in AGENTS.md.

set -uo pipefail

if [ ! -d "$HOME/.claude/skills/gstack/bin" ]; then
  echo "gstack is NOT installed — say so plainly rather than silently working without it (AGENTS.md requires it)."
  exit 0
fi

cat <<'ROUTING'
Before acting, pick the gstack command that fits this prompt and use it. Route:
- reported bug / "why does X happen" -> /investigate
- change is written, about to land -> /review (then /ship to bump VERSION, commit, push, open the PR)
- security question or audit -> /cso
- "what is the state of the code" / quality baseline -> /health
- test the running app, find and fix bugs -> /qa (/qa-only to report without fixing)
- vague intent that needs pinning down -> /spec ; plan needing a second opinion -> /plan-eng-review
- any web browsing -> /browse (never raw curl/WebFetch for pages)
- writing or refreshing docs after a change -> /document-release
State the command you chose in one line before running it. If genuinely none
fits (a pure question, a one-line edit), say "no gstack command fits: <reason>"
and proceed — but do not skip this choice silently.
ROUTING
exit 0
