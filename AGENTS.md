# AI Agent Instructions for RetroGemini

Rules for AI coding assistants (Claude, ChatGPT, Gemini, Copilot, Cursor…) working on this codebase. This file holds only what every change must follow. The detail of each area (its decisions, its stated residuals and the tests that guard it) is in [`docs/agents/`](docs/agents/): **read the file of an area before changing it**. The index is at the end.

> **Single source of truth.** `AGENTS.md` is the only instruction file. `CLAUDE.md` is a symlink to it (`CLAUDE.md → AGENTS.md`): never give `CLAUDE.md` text of its own. **Keep this file short**: every assistant loads it whole, in every session and every subagent. A rule that only one area needs goes in that area's file of `docs/agents/`.

## Project overview

**RetroGemini** is a self-hosted, real-time collaborative retrospectives and team health checks application:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS 4
- **Backend**: Express 5 + Socket.IO + SQLite/PostgreSQL
- **Deployment**: Docker + Railway/Kubernetes/OpenShift, with rolling updates

## AI tooling: gstack (Claude Code only)

- Every prompt starts by choosing a gstack command: the `.claude/hooks/gstack-route.sh` hook adds the routing table to each prompt. State the command in one line, or `no gstack command fits: <reason>`. Other assistants cannot run gstack: for them the table only describes what a thorough answer covers.
- gstack's one-time questions are already answered (telemetry off, cross-project learnings off): never ask them. `session-start.sh` installs the dependencies and gstack in a web container; never commit `check-gstack.sh` without it.
- **Cost.** The diffs here are large. Use the lightest depth that answers the question. Start a multi-agent fan-out (a workflow, a full `/review` army, a red team) only when the owner asks for one, and say what it will cost first.
- Hooks, settings and the manual install: [`docs/agents/gstack.md`](docs/agents/gstack.md).

## Rules for every change

### Product constraints

- **Zero downtime.** The app is deployed with rolling updates while people are in a session. Every feature must survive a WebSocket reconnection and a pod restart. State is persisted (PostgreSQL or SQLite) and shared across pods (Redis or PostgreSQL Socket.IO adapter). Follow the `pendingJoin`, `queuedSession` and auto-rejoin patterns of `services/syncService.ts`. A stored or wire field keeps its meaning across releases: add one, never repurpose it. → `zero-downtime.md`, `realtime.md`
- **Offline and air-gapped.** Phones on corporate Wi-Fi have no internet. Never load anything from an external URL (CDN, Google Fonts, external API, remote image). Assets live in `public/`, referenced by absolute local paths. The CSP is enforcing (`default-src 'self'`, `server/services/securityHeaders.js`): never weaken it to make something load. → `offline.md`, `security-headers.md`
- **Two languages.** Every user-facing string goes through `t()`, with its entry in both `i18n/locales/en/` and `i18n/locales/fr/`, in the same change. Never write a literal in JSX. French uses formal *vous* and its typography (` ` before `? ! ;`, ` ` before `:`). Text written onto a session is content, written in the session's template language. → `i18n.md`
- **Accessibility, WCAG 2.1 AA (eCH-0059).**
  - Every overlay goes through `components/common/ModalDialog.tsx`.
  - Anything a pointer can do, the keyboard can do.
  - An icon-only button carries an `aria-label`. A visible label is part of the accessible name.
  - A state is said in words or with `aria-pressed`, `aria-checked` or `aria-current`, never by colour or fading alone.
  - Contrast is measured, never judged by eye.
  - The axe `BASELINE` stays at 0.
  - → `accessibility.md`
- **The look.**
  - Colours, radii, shadows and fonts are theme tokens in the `@theme` block of `index.css`; components keep their Tailwind class names.
  - No literal colour (hex, `rgb()`, `hsl()`) outside `@theme`. A radius the steps do not name is written from them.
  - Screens reuse the shared recipes (`components/dashboard/dashboardLook.ts`, `ModalDialog`'s frame).
  - Motion is decoration. It is declared under `prefers-reduced-motion: no-preference`, checks `motionAllowed()` first, follows a change of state (never an element being drawn), and never moves a box a click aims at.
  - → `look.md`, `motion.md`
- **One behaviour for both session types.** What a retrospective and a health check share is written once (`components/session/`) and changes in both. → `session-shared.md`, `board-moves.md`, `open-board.md`

### Data and server

- One KV record per team (`team:{teamId}`), changed through `atomicTeamUpdate`. A route never replaces a list another route owns. Facilitator-only session fields are enforced by the server (`server/services/sessionGuard.js`). The rules the server and the screens share live in `utils/` (`passwordPolicy.js`, `emailAddress.js`, `avatars.js`, `jira.js`). → `data-persistence.md`, `api.md`, `email.md`
- A handler must not throw, nor do anything that can throw, after it has answered. Large JSON answers are compressed after the handler returns. → `compression-caching.md`
- A privileged action writes a row to `security_events` (`server/services/securityEvents.js`); a new privileged route adds its action to `SECURITY_ACTIONS`. → `audit-trail.md`
- A new environment variable or port updates every deployment surface in the same change (`.env.example`, `README.md`, `docs/agents/deployment.md`, `k8s/`). `__tests__/deploymentManifestParity.test.ts` checks it. → `deployment.md`

### Code

- Code, comments, identifiers and documentation are in **English**. The two exceptions are `CHANGELOG.fr.md` and the French catalogue text of `publiccode.yml`.
- TypeScript strict, functional React components with hooks, Tailwind in the existing patterns, no UI component library. Prefer small focused modules to long files. → `conventions.md`
- Read JSX with the TypeScript parser, never with a regular expression.

## Version and changelog: the golden rule

Assistants get this wrong most often. One question decides both files: **is the change visible to end users?**

- **Yes** (a new feature, a UX change, a removed feature):
  - Bump the major: `X+1`, `Y=0`.
  - Add **exactly one** `## [X.Y] - YYYY-MM-DD` block to `CHANGELOG.md`, with **one** `###` section (`Added`, `Changed` or `Removed`) and **one** consolidated bullet. Write it from the user's side, in the present tense.
  - Add its French twin to `CHANGELOG.fr.md`: same version, date, section and bullet count, ordinary spaces before `? ! : ;`.
- **No** (a bug fix, a security patch, a refactor, tests, docs, CI, deployment, a dependency): bump the minor (`Y+1`) and add **no** changelog entry. Never write `### Fixed` or `### Security`.
- Read `VERSION` first and move by one step. One pull request is one bump, **until the branch has been deployed**. After that, every push meant to be deployed bumps `Y` again, without being asked.
- Keep `publiccode.yml`'s `softwareVersion` equal to `VERSION`. A major bump also retags the image in `k8s/base/deployment.yaml`.
- Details, the release workflow and the tests that check all this: `versioning.md`, `changelog.md`.

## Working method

- **TDD.** A bug fix starts with a test that fails; a feature starts with a test of the expected behaviour. Every change leaves a committed test that fails without it, at the cheapest level that catches it (a unit test before an e2e test). → `testing.md`
- A change to user-facing behaviour updates the e2e tests in `e2e/`.
- **Before committing**, everything CI checks must pass:
  ```bash
  npm run lint            # a two-way warning budget (scripts/lint.mjs): lower BUDGET when warnings go away
  npm run type-check
  npm run test:coverage
  npm run build
  npm audit --omit=dev --audit-level=high
  npm run test:e2e        # Playwright
  npm run test:e2e:prod   # when the CSP, static delivery, compression or a runtime asset changes
  ```
  Never raise the lint budget or the axe `BASELINE` to make a change pass.
- **After opening a pull request**, watch every check until it is green (CodeQL and the image scans included). Leave a traceability reply on every bot finding, fixed or dismissed. → `workflow.md`, `dependencies.md`
- Commit messages follow conventional commits:
  - `feat:` and `improve:` bump `X` and add one changelog entry;
  - `fix:`, `security:`, `refactor:`, `docs:` and `test:` bump `Y` and add none.
- Keep the guide true. A change updates the file of `docs/agents/` that covers its area, and adds to the index below a file it creates.

## Where the details live

Each file of `docs/agents/` keeps its area's rules, decisions, stated residuals and guarding tests. A section named in italics in the code or the docs (*Avatars*, *The look*, *Jira*…) is one of these files.

| Read it before you touch… | File |
|---|---|
| the AI tooling, `.claude/` hooks and settings | `gstack.md` |
| reconnection, sync, several pods | `zero-downtime.md` |
| Socket.IO events, `update-session`, the own-change ledger (`mergeRemoteSession.ts`) | `realtime.md` |
| response headers, the CSP | `security-headers.md` |
| JSON compression, static delivery and caching, `npm run build` | `compression-caching.md` |
| theme tokens, colours, radii, recipes, a card's colour | `look.md` |
| any animation, transition, smooth scroll or vote flight | `motion.md` |
| dialogs, keyboard and touch paths, icon buttons, contrast, the double-gesture guard | `accessibility.md` |
| moving cards in Brainstorm or Group, column order, wide boards | `board-moves.md` |
| the open board (`OPEN_BOARD`), its votes, sort and search | `open-board.md` |
| what both session types share: status, participants panel, timer, banners | `session-shared.md` |
| fonts, icons, assets, anything loaded at runtime | `offline.md` |
| user-facing text, languages, dates and numbers, "What's New" | `i18n.md` |
| language and style rules, the file tree | `conventions.md` |
| `VERSION`, releases, the image tag, the release workflow | `versioning.md` |
| `CHANGELOG.md` and its French mirror | `changelog.md` |
| the commit checklist, pull requests, commit messages, pitfalls, commands | `workflow.md` |
| test rules (fake clocks, regression coverage, load tests) | `testing.md` |
| Docker, the Kubernetes and OpenShift manifests, environment variables | `deployment.md` |
| Dependabot, lockfiles, packages that move as a set | `dependencies.md` |
| any HTTP route | `api.md` |
| the KV store, team records, passwords, session epochs, backups, caches | `data-persistence.md` |
| an email address the product stores or mails | `email.md` |
| merging and deleting teams in the console | `team-merge.md` |
| restoring one team, importing a backup file | `team-restore.md` |
| avatars, the picker, the one-time hint | `avatars.md` |
| the Jira integration | `jira.md` |
| privileged actions and `security_events` | `audit-trail.md` |

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).
