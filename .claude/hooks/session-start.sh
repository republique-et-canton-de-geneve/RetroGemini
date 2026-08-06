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
# Three deliberate choices here, each one paid for by a bug:
#
#   - `npm ci`, never `npm install`. `npm install` REWRITES package-lock.json:
#     the container's npm (10.x) is older than the one that generated this
#     lockfile and silently strips the `libc` fields from optional platform
#     packages, leaving a 30-line diff in `git status` at every session start,
#     waiting to be committed by accident. `npm ci` never writes the lockfile.
#
#   - `--ignore-scripts`. This runs unattended, before the first prompt, on
#     whatever branch the session opened — including a branch under review. A
#     lifecycle script (root `prepare`, or any dependency's `postinstall`) would
#     therefore execute automatically in a session that holds a repo-scoped
#     GitHub token, with no human having looked at the diff yet. Ignoring
#     scripts does not make the branch safe (the agent runs its code later
#     anyway) but it removes the *automatic, pre-inspection* window, which is
#     the part nobody can review. Verified safe for this repo: better-sqlite3,
#     the only native dependency, ships a prebuilt binary and loads fine without
#     its install script, and the full 1252-test suite passes. If a future
#     dependency really needs a lifecycle script, rebuild it explicitly by name
#     rather than dropping this flag.
#
#   - A lockfile stamp, not a bare `node_modules` check. An existing directory
#     is not evidence of a matching install: switching to a dependency-update
#     branch, or an interrupted `npm ci` leaving a partial tree, would otherwise
#     make every later session skip the install and validate different packages
#     than the commit declares. The stamp is written only after `npm ci`
#     succeeds, so a partial install re-runs instead of being trusted.
if [ -f "$REPO_ROOT/package.json" ]; then
  NPM_STAMP="$REPO_ROOT/node_modules/.session-start-lockfile"
  LOCK_HASH=$(sha256sum "$REPO_ROOT/package-lock.json" 2>/dev/null | cut -d' ' -f1)
  if [ -n "$LOCK_HASH" ] && [ "$(cat "$NPM_STAMP" 2>/dev/null)" = "$LOCK_HASH" ]; then
    echo "[session-start] dependencies match package-lock.json, skipping install."
  else
    echo "[session-start] installing npm dependencies (npm ci --ignore-scripts)..."
    if ( cd "$REPO_ROOT" && npm ci --ignore-scripts --no-audit --no-fund ); then
      [ -n "$LOCK_HASH" ] && printf '%s\n' "$LOCK_HASH" > "$NPM_STAMP"
    else
      echo "[session-start] WARNING: npm ci failed — run it by hand before trusting any check."
    fi
  fi
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
      # Remove the clone when setup fails. `bin/` is part of the repository, so
      # it exists the moment the clone lands — before setup has linked a single
      # skill. Leaving it behind would make `check-gstack.sh` allow Skill calls
      # against a half-installed gstack, and make the next session skip the
      # install as "already installed": one transient failure would silently
      # disable the enforcement for the whole cached container. Deleting it
      # keeps the guard honest and makes the next session retry.
      rm -rf "$GSTACK_DIR"
      echo "[session-start] WARNING: gstack setup failed — clone removed so the next session retries; skills stay blocked meanwhile."
    fi
  else
    echo "[session-start] WARNING: could not clone gstack (no network?) — skills will be blocked."
  fi
fi

exit 0
