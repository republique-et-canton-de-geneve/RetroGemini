#!/bin/bash
# SessionStart hook — prepare a Claude Code on the web container for this repo.
#
# Two jobs, both idempotent so re-running costs nothing:
#   1. npm dependencies, so `npm run ci` works from the first prompt. A fresh
#      web container clones the repo without node_modules, and every check then
#      fails with `vitest: not found` — which has cost past sessions a baseline.
#   2. gstack (AGENTS.md requires it). The repo is in gstack *team mode*:
#      `.claude/hooks/check-gstack.sh` DENIES every Skill call when gstack is
#      missing, and a web container starts without it every single time. Without
#      this install the enforcement hook would block all AI-assisted work here
#      instead of enabling it.
#
# Deliberately synchronous: the container state is cached after the hook
# completes, so the cost is paid once per container refresh rather than per
# session, and nothing races a half-installed gstack.
#
# Local machines are skipped — a developer's ~/.claude is their own, and
# AGENTS.md documents the one-time manual install for them.

set -uo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO_ROOT="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)}"
GSTACK_DIR="$HOME/.claude/skills/gstack"

# ── 1. npm dependencies ────────────────────────────────────────
# `npm ci`, and only when node_modules is absent. Two reasons not to use
# `npm install` here, both learned the hard way:
#   - `npm install` REWRITES package-lock.json. The container's npm (10.x) is
#     older than the one that generated this lockfile, so it silently strips the
#     `libc` fields from optional platform packages — a 30-line diff appearing in
#     `git status` at the start of every session, waiting to be committed by
#     accident. `npm ci` never writes the lockfile.
#   - skipping when node_modules already exists preserves the cached container
#     state just as well as `npm install` would, without the mutation.
if [ -f "$REPO_ROOT/package.json" ] && [ ! -d "$REPO_ROOT/node_modules" ]; then
  echo "[session-start] installing npm dependencies (npm ci)..."
  ( cd "$REPO_ROOT" && npm ci --no-audit --no-fund ) \
    || echo "[session-start] WARNING: npm ci failed — run it by hand before trusting any check."
elif [ -d "$REPO_ROOT/node_modules" ]; then
  echo "[session-start] node_modules present, skipping install."
fi

# ── 2. Playwright browser for the repo's own e2e suite ─────────
# playwright.config.ts honours PW_CHROMIUM_PATH so a sandboxed container can use
# the pre-installed Chromium instead of downloading the pinned build. Exporting
# it here means `npm run test:e2e` just works instead of being written off as
# "unverifiable in this environment".
if [ -n "${CLAUDE_ENV_FILE:-}" ] && [ -z "${PW_CHROMIUM_PATH:-}" ]; then
  PW_CHROMIUM_PATH=$(find /opt/pw-browsers -name chrome -type f 2>/dev/null | head -1)
  if [ -n "$PW_CHROMIUM_PATH" ]; then
    echo "export PW_CHROMIUM_PATH=\"$PW_CHROMIUM_PATH\"" >> "$CLAUDE_ENV_FILE"
    echo "[session-start] PW_CHROMIUM_PATH -> $PW_CHROMIUM_PATH"
  fi
fi

# ── 3. gstack ──────────────────────────────────────────────────
if [ -d "$GSTACK_DIR/bin" ]; then
  echo "[session-start] gstack already installed."
else
  echo "[session-start] installing gstack (required by AGENTS.md)..."
  mkdir -p "$HOME/.claude/skills"
  rm -rf "$GSTACK_DIR"
  if git clone --single-branch --depth 1 \
       https://github.com/garrytan/gstack.git "$GSTACK_DIR" >/dev/null 2>&1; then
    # --team: gstack re-checks itself for updates at each session start.
    # --plan-tune-hooks=no: keeps the install non-interactive.
    if ( cd "$GSTACK_DIR" && ./setup --team --plan-tune-hooks=no --quiet >/dev/null 2>&1 ); then
      echo "[session-start] gstack ready."
    else
      echo "[session-start] WARNING: gstack setup failed — skills will be blocked by check-gstack.sh."
    fi
  else
    echo "[session-start] WARNING: could not clone gstack (no network?) — skills will be blocked."
  fi
fi

exit 0
