# AI Tooling: gstack

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


This repo standardizes on [**gstack**](https://github.com/garrytan/gstack), an
open-source Claude Code skill set that adds a virtual engineering team. It is
installed in **team mode (`required`)**, and the repo's `.claude/` bootstrap
makes that real rather than aspirational — see *Enforcement* below.

### The routing rule — read this before anything else

> **Applies to Claude Code only.** gstack is a Claude Code skill set: the
> commands below are invoked through Claude's `Skill` surface, and only
> `.claude/settings.json` installs or reaches them. ChatGPT, Gemini, Copilot,
> Cursor and the other assistants this file addresses **cannot run them** — for
> those, the table stays useful as a description of *what a thorough answer
> covers* (investigate before fixing, review before landing, audit security
> explicitly), and the binding rules for them are the rest of this document:
> TDD, the VERSION/CHANGELOG golden rule, and the before-committing sequence.
> Do not stop work because gstack is unavailable on a non-Claude assistant.

**On Claude Code, every prompt starts by choosing a gstack command.** Nobody
should ever have to write "use gstack" in a request: picking the right command
*is* the first step of answering. The `.claude/hooks/gstack-route.sh` hook
prepends this routing table to every prompt so the choice cannot be skipped
silently:

| The prompt is about… | Command |
|---|---|
| a reported bug, "why does X happen" | `/investigate` |
| a change that is written and about to land | `/review`, then `/ship` |
| security — an audit, a finding, a threat question | `/cso` |
| "what state is the code in", a quality baseline | `/health` |
| exercising the running app and fixing what breaks | `/qa` (`/qa-only` to report only) |
| vague intent that needs pinning down first | `/spec` |
| a plan that deserves a second opinion | `/plan-eng-review` |
| any web browsing at all | `/browse` — never raw `curl`/WebFetch for pages |
| docs to refresh after a change | `/document-release` |

State the chosen command in one line before running it. When none genuinely fits
— a pure question, a one-line edit — say `no gstack command fits: <reason>` and
proceed. What is **not** acceptable is answering as if gstack did not exist.

`/health` and `/cso` are the two the hardening work leans on
(`HARDENING_STATUS.md` §0 asks for them by name), and `/review` before landing.

### Enforcement — how this survives a fresh container

Three hooks in `.claude/settings.json`, all committed:

| Hook | Event | Job |
|---|---|---|
| `session-start.sh` | `SessionStart` | Installs npm deps **and** gstack in a Claude Code on the web container, and records the maintainer's answers to gstack's one-time questions (below). Idempotent; skipped on local machines (`CLAUDE_CODE_REMOTE`). |
| `gstack-route.sh` | `UserPromptSubmit` | Injects the routing table above into every prompt. |
| `check-gstack.sh` | `PreToolUse` on `Skill` | gstack's own team-mode guard: denies skill use when gstack is missing. |

The order matters. `check-gstack.sh` is a *blocker*, not an installer — on its own
it would deny every skill call in a web session, because those containers are
ephemeral and start with no `~/.claude/skills/gstack`. `session-start.sh` is what
makes the guard a safety net instead of a wall; the container state is cached
after it completes, so the install cost is paid per container refresh, not per
session. **Never commit `check-gstack.sh` without `session-start.sh`.**

**gstack's one-time questions are already answered — never ask them.** A web
container does not keep what a session writes in gstack's state directory, so
its one-time questions came back in every session. The maintainer answered them
once (2026-10-20) and `session-start.sh` applies the answers before the first
prompt: **telemetry off**, and **cross-project learnings off** (a container
holds this one project). If a skill's preamble still emits the telemetry
question, run `gstack-config set telemetry off` and continue without asking.

**Multi-agent workflows are pre-approved.** `settings.json` also carries
`"permissions": { "allow": ["Workflow"] }`, at the maintainer's request
(2026-11-23): without it, every workflow launch, and every resume of one after a
container restart, asked for a confirmation. It applies to every Claude Code
session on this repository, a teammate's included, which then no longer shows
the warning that a workflow can use a large share of the usage limit. Remove the
entry to bring that confirmation back.

> ⚠️ Re-running `gstack-team-init required` **overwrites** `check-gstack.sh` and
> rewrites `.claude/settings.json`. It knows neither the two hooks above nor the
> `Workflow` allow rule, so re-add them to `settings.json` afterwards — otherwise
> a web session silently loses the auto-install, the routing table and the
> pre-approved workflows.

### Manual install (local machine, once)

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack \
  && cd ~/.claude/skills/gstack && ./setup --team
```

Skills install under short names (`/qa`, `/review`, `/ship`) — as of gstack
1.60.x no `--no-prefix` flag is needed for that. Re-running `./setup` after a
`git pull` refreshes the install; `--team` also makes gstack self-update at each
session start. Use `~/.claude/skills/gstack/...` for gstack file paths.

> `gstack-team-init` appends its own section to `CLAUDE.md`, which is a symlink to
> `AGENTS.md`, so the text lands in the single source of truth. Verify the
> symlink survived with `ls -l CLAUDE.md`; if a tool replaced it with a regular
> file, move the section into `AGENTS.md` and recreate the link:
> `rm CLAUDE.md && ln -s AGENTS.md CLAUDE.md`.

To remove gstack later: `~/.claude/skills/gstack/bin/gstack-uninstall` (global),
and drop the repo's `.claude/` bootstrap.
