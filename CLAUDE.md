# CLAUDE.md

Guidance for Claude Code (and compatible agents) working in this repository.
See [`AGENTS.md`](AGENTS.md) for the full project/engineering conventions.

## gstack

This repository vendors [gstack](https://github.com/garrytan/gstack) — a suite of
AI-assisted engineering workflows — directly under `.claude/skills/gstack/`.

It is **committed to the repo on purpose** so the skills are available in every
session (including Claude Code on the web) with **no install step**. Do not run
gstack's `./setup` or `git clone` here: the normal global install does not work
behind this environment's egress proxy, which is why gstack is vendored instead.

### Using it

- Run `/gstack` to route any request to the right skill (planning, review, QA,
  shipping, debugging, docs, security, design).
- Or invoke a skill directly. Available skills include: `/office-hours`,
  `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`,
  `/plan-devex-review`, `/design-consultation`, `/design-shotgun`,
  `/design-html`, `/design-review`, `/review`, `/devex-review`, `/ship`,
  `/land-and-deploy`, `/canary`, `/benchmark`, `/qa`, `/qa-only`, `/investigate`,
  `/retro`, `/document-release`, `/document-generate`, `/autoplan`, `/careful`,
  `/freeze`, `/guard`, `/unfreeze`, `/learn`, `/cso`, `/codex`, `/browse`.

### Known limitations in this environment

- **Browser-dependent skills** (`/browse`, browser-driven `/qa`) need a local
  Chromium matching gstack's pinned Playwright build. The sandboxed web
  environment cannot download it, so these skills will not run here. They work
  on a local machine after a normal gstack install.
- Some gstack helper scripts (`bin/gstack-*`) log telemetry / read config from
  `~/.claude/skills/gstack` and degrade gracefully (silently no-op) when that
  global path is absent. Core skill behavior is unaffected.

### Updating

Because gstack is vendored, it does not auto-update. To upgrade, re-vendor the
desired version from upstream into `.claude/skills/gstack/` (excluding the
`test/` and `browse/test/` directories, which are dropped here to keep the repo
small).
