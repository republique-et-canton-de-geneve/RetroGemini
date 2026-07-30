# AI Agent Instructions for RetroGemini

This document provides guidelines for AI coding assistants (Claude, ChatGPT, Gemini, Copilot, Cursor, etc.) working on this codebase.

> **Single source of truth.** This `AGENTS.md` is the **only** instruction file to
> edit. `CLAUDE.md` is a symlink to it (`CLAUDE.md → AGENTS.md`), so Claude Code and
> every other agent read the exact same content. Never create a separate `CLAUDE.md`
> with its own text — edit `AGENTS.md` and both stay in sync automatically.

## Project Overview

**RetroGemini** is a self-hosted, real-time collaborative retrospectives and team health checks application built with:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS
- **Backend**: Express 5 + Socket.IO + SQLite/PostgreSQL
- **Deployment**: Docker + Railway/Kubernetes/OpenShift

## AI Tooling: gstack

This repo standardizes on [**gstack**](https://github.com/garrytan/gstack), an
open-source Claude Code skill set that adds a virtual engineering team (slash
commands such as `/office-hours`, `/plan-eng-review`, `/review`, `/qa`, `/ship`,
`/browse`). The recommended setup is **global install + team mode for this repo**.

### 1. Global install (once per machine, all your Claude Code projects)

Paste this into Claude Code:

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack \
  && cd ~/.claude/skills/gstack && ./setup
```

This installs gstack under `~/.claude/skills/gstack`, so the skills are available
in **every** repo you open with Claude Code. Re-running `./setup` after a
`git pull` refreshes it. Add `--no-prefix` to the `./setup` call if you prefer
short command names (`/qa` instead of `/gstack-qa`).

### 2. Team mode for this repo (recommended per-repo install)

After the global install, from the **RetroGemini repo root**, enable team mode so
every contributor's Claude Code session auto-uses (and auto-updates) gstack
without vendoring any gstack files into the repo:

```bash
(cd ~/.claude/skills/gstack && ./setup --team) \
  && ~/.claude/skills/gstack/bin/gstack-team-init required
```

`gstack-team-init` writes a `.claude/` bootstrap (a `SessionStart` hook) and a
gstack section into `CLAUDE.md`. Because `CLAUDE.md` is a symlink to this
`AGENTS.md`, that section lands in the single source of truth — exactly what we
want. Commit the result:

```bash
git add .claude/ AGENTS.md CLAUDE.md
git commit -m "chore: require gstack for AI-assisted work"
```

> After running `gstack-team-init`, verify the symlink survived with
> `ls -l CLAUDE.md`. If a tool replaced it with a regular file, move any gstack
> section into `AGENTS.md` and recreate the link: `rm CLAUDE.md && ln -s AGENTS.md CLAUDE.md`.

To remove gstack later: `~/.claude/skills/gstack/bin/gstack-uninstall` (global),
and drop the repo's `.claude/` bootstrap.

## Zero Downtime Requirements

**CRITICAL**: This application is deployed on OpenShift/Kubernetes with rolling updates. Users may be in the middle of a retrospective session when deployments occur.

### Key Principles
- **Never interrupt active sessions** - All features must support seamless reconnection after pod restarts
- **WebSocket reconnection must be automatic** - The `SyncService` automatically rejoins sessions after reconnection (see `services/syncService.ts`)
- **State must be persistent** - Session state is stored in PostgreSQL/SQLite and synchronized across pods via Socket.IO adapters (Redis or PostgreSQL)

### When Developing New Features
1. **Consider reconnection scenarios** - Will the feature work correctly if the WebSocket disconnects and reconnects mid-operation?
2. **Store necessary state for recovery** - If a feature requires user context, ensure it can be restored after reconnection
3. **Test with rolling updates** - Verify that ongoing sessions survive pod restarts
4. **Use the existing sync patterns** - Follow the `pendingJoin`, `queuedSession`, and auto-rejoin patterns in `syncService.ts`

### Architecture for High Availability
- **Multi-pod support**: Use Redis or PostgreSQL Socket.IO adapter for cross-pod communication
- **Session persistence**: All session state is saved to database on every update
- **Graceful shutdown**: Kubernetes probes (`/health`, `/ready`) ensure proper pod lifecycle management

## Offline / Air-Gapped Deployment

**CRITICAL**: This application is deployed on internal networks where devices (especially mobile phones on corporate Wi-Fi) have **no internet access**. All resources must be self-hosted.

### Rules
- **NEVER load resources from external URLs** — no CDNs, no Google Fonts, no external APIs, no remotely hosted images, sounds, or scripts
- **All static assets** (fonts, images, sounds, icons) MUST be placed in the `public/` directory and referenced with absolute local paths (e.g. `/fonts/...`, `/assets/...`)
- **All npm dependencies** used in the frontend are bundled by Vite at build time — this is fine and works offline
- **No external service calls from the frontend** — if a feature needs an external API (e.g. QR code generation), use a client-side library instead

### Current Self-Hosted Assets
| Asset | Location | Purpose |
|-------|----------|---------|
| Material Symbols font | `public/fonts/material-symbols-outlined.woff2` | Icon font for all UI icons |
| Timer alert sound | `public/assets/timer-alert.mp3` | Audio notification when retro timer ends |
| Background texture | `public/assets/cubes.png` | Decorative pattern on login page |

### When Adding New Features
1. **Check for external resource dependencies** — if a new library or feature loads something from the internet, find an offline alternative
2. **If you need a new icon** that isn't rendering, the Material Symbols woff2 file may need to be updated — re-download from Google Fonts and replace `public/fonts/material-symbols-outlined.woff2`
3. **QR codes** are generated client-side using the `qrcode` npm package — no external API needed
4. **Test with network disabled** — verify that the feature works with no internet access

## Language & Code Conventions

### Language
- **Code**: All code, comments, variable names, and function names MUST be in **English**
- **UI text**: All user-facing text in the application MUST be in **English**
- **Documentation**: All documentation (README, CHANGELOG, comments) MUST be in **English**

### File Size Guidance
- LLMs struggle with very large files; prefer clean decomposition into smaller, focused modules instead of long single files.

### Code Style
- Use TypeScript strict mode
- Follow existing code patterns in the codebase
- Use functional React components with hooks
- Use Tailwind CSS for styling (follow existing class patterns)
- No external UI component libraries - use native HTML + Tailwind

### File Organization
```
/
├── components/          # React components
├── services/           # Business logic (dataService, syncService)
├── __tests__/          # Test files
├── loadtest/           # Load-test harness (see loadtest/README.md)
├── .github/workflows/  # CI/CD pipelines
├── k8s/                # Kubernetes manifests
├── server/             # Backend modules (routes, services, config)
├── server.js           # Express backend
├── App.tsx             # Main React app
├── types.ts            # TypeScript interfaces
├── VERSION             # Current version (X.Y format)
└── CHANGELOG.md        # Release notes
```

## Version Management

> ⚠️ **AI assistants get versioning and the changelog wrong most often.** Read
> the golden rule below and follow it exactly — do not improvise version numbers
> or invent extra changelog entries.

### The golden rule (VERSION ⇄ CHANGELOG)

One question decides **both** files: **is the change visible to end users?**

- **Yes — user-visible** (new feature, UX/behaviour improvement, removed
  feature): bump the **major** `X`, reset `Y` to `0`, **and** add exactly
  **one** consolidated CHANGELOG entry.
- **No — internal / not user-facing** (bug fix, **security patch**, refactor,
  tests, docs, CI/CD, Docker/deploy, dependency bump, version bookkeeping): bump
  the **minor** `Y`, keep `X`, and add **no** CHANGELOG entry.

In other words: **a CHANGELOG entry exists if and only if you bumped `X`.** A bug
fix or a security patch bumps `Y` and is *never* written in the changelog — the
user cannot see it, so it does not belong in the user-facing "What's New".

### VERSION file

- Located at the repo root: `VERSION`. Format is `X.Y` (current example: `24.0`).
- **Read the current value first**, then move by exactly one step:
  - User-visible change → `X+1` and `Y=0` (e.g. `23.4` → `24.0`).
  - Internal change → `Y+1`, keep `X` (e.g. `23.4` → `23.5`).
- Never skip or invent numbers, never jump more than one step, never pick a
  number because it "looks nicer".
- One unit of work / pull request = **one** version bump, no matter how many
  files it touches. Bundle several user-visible changes into the same next `X`.
- The Docker deploy action reads `VERSION`, so every deployable change needs a
  bump (user-visible → `X`, internal → `Y`).
- **A major bump also retags the Kubernetes base manifest.**
  `k8s/base/deployment.yaml` pins the image tag, and `docker-deploy.yml` rewrites
  that line on every deployment — so it normally lags `VERSION` by the `Y` bumps
  since the last deploy, which is fine. `__tests__/deploymentManifestParity.test.ts`
  only fails when the *majors* diverge: the tag had been left 17 majors behind,
  advertising an image that predated many user-visible releases. So a `Y` bump
  needs nothing; an `X` bump should retag the manifest too.

## Changelog Management

### CHANGELOG.md Format
The changelog follows [Keep a Changelog](https://keepachangelog.com/) format and is **automatically parsed** by the backend to display announcements to users.

Each released version is **one** `## [X.Y]` block with **one** `###` section and
**one** consolidated bullet:

```markdown
## [X.Y] - YYYY-MM-DD

### Added
- One sentence describing everything new in this version, from the user's point of view
```

The only sections to use for new entries are `### Added`, `### Changed` and
`### Removed`. Do **not** create `### Fixed` or `### Security` entries — bug
fixes and security patches are not user-visible, so they bump `Y` only and stay
out of the changelog (see rules below).

### Changelog Rules — the two that matter most

1. **Exactly ONE entry per version, and ONE bullet.** A release is a single
   `## [X.Y] - YYYY-MM-DD` block with a single `###` section containing **one**
   consolidated bullet that summarises *all* the user-visible changes of that
   version. Never write multiple bullets, and never add multiple `###` sections,
   for the same version — the goal is one readable sentence, not a list of
   technical changes.
2. **Never document bug fixes or security patches.** There is **no `### Fixed`
   or `### Security` entry, ever.** Bug fixes, security patches, refactors,
   tests, docs, CI, deps and deployment config are not user-visible: they only
   bump `Y` and stay out of the changelog entirely.

Plus the usual style rules:

3. **Only user-visible changes** - the changelog is displayed to end users in the app
4. **Write from the user's perspective, in present tense** - "Add dark mode", not "Added/Implemented dark-mode feature"
5. **Keep it concise** - 1-2 sentences, no technical jargon or implementation detail
6. **Most recent version at the top**
7. **Choose the single section that fits the release** - `### Added` for a new feature (most common), `### Changed` for improvements to existing behaviour, `### Removed` for a removed feature. If a version mixes a feature with smaller tweaks, use `### Added` and fold them into the one bullet.

### What belongs in the CHANGELOG

| ✅ Document it (and bump `X`) | ❌ Never document it (bump `Y` only) |
|------------------------------|--------------------------------------|
| New user-facing features | Bug fixes |
| UI/UX improvements | Security patches / fixes |
| Removed user-facing features | Internal refactoring (no user impact) |
| | Tests, docs, code comments |
| | GitHub workflow / CI-CD changes |
| | Docker / deployment configuration |
| | Code style / linting fixes |
| | Version & changelog bookkeeping |
| | Dependency updates |

### Section Mapping (for announcements)
| CHANGELOG Section | Announcement Type | Icon Color |
|-------------------|-------------------|------------|
| Added | New Feature | Green |
| Changed | Improvement | Blue |
| Removed | Removed | Gray |
| Fixed | Bug Fix | Amber |
| Security | Security Update | Red |

> `Fixed` and `Security` are listed only so the parser keeps rendering any
> legacy entries. **Do not create new `Fixed` or `Security` entries** — per the
> rules above, bug fixes and security patches are not user-visible and are never
> documented.

## Development Workflow

### Before Starting Work
1. Read the existing code to understand patterns
2. Check `types.ts` for data structures
3. Review similar existing features for patterns
4. If you change retrospective guidance or timebox suggestions, keep `components/session/retroTips.ts`, the related tests, and the automatic phase timer defaults aligned with the intended session flow

### When Fixing a Bug (TDD Approach)
1. **Write a failing test first**: Reproduce the bug with a unit test or e2e test that fails, confirming the bug exists
2. **Fix the issue**: Follow existing patterns to make the failing test pass
3. **Verify the test passes**: Run the test suite to confirm the fix works
4. **Update VERSION**: Increment `Y` only (e.g. `23.4` → `23.5`); never touch `X`
5. **Do NOT touch CHANGELOG.md**: Bug fixes are never documented in the changelog

### When Adding a New Feature (TDD Approach)
1. **Write a failing test first**: Define the expected behavior with a test that fails because the feature doesn't exist yet
2. **Implement the feature**: Write the minimum code to make the test pass
3. **Refactor if needed**: Clean up the implementation while keeping tests green
4. **Update VERSION**: Increment `X`, reset `Y` to `0` (e.g. `23.4` → `24.0`)
5. **Update CHANGELOG**: Add exactly one `## [X.Y]` block with a single consolidated bullet under `### Added` (see the Version & Changelog golden rule)

### Before Committing
**CRITICAL**: Ensure that all GitHub CI checks will pass before committing. Run the full CI pipeline locally using `npm run ci` (which runs lint + type-check + test + build). The CI workflow (`.github/workflows/ci.yml`) also runs test coverage and a security audit, so verify those as well:
1. **Run linting**: `npm run lint`
2. **Run type check**: `npm run type-check`
3. **Run tests with coverage**: `npm run test:coverage`
4. **Run build**: `npm run build`
5. **Run security audit**: `npm audit --omit=dev --audit-level=high` (production dependencies only)
6. **Run e2e tests**: `npm run test:e2e` (end-to-end tests with Playwright)

Or use the shorthand: `npm run ci` (lint + type-check + test + build) then `npm run test:coverage`, `npm audit --omit=dev --audit-level=high`, and `npm run test:e2e` separately.

**IMPORTANT**: If your changes impact user-facing behavior (UI, interactions, workflows), you MUST also update the e2e tests in the `e2e/` directory to reflect those changes. E2e tests must pass before committing.

### After Opening a Pull Request

Do not consider a PR done the moment it is pushed. You MUST watch it through to a
green state and address automated feedback:

1. **Wait for and read every CI check**, not just the unit-test job. This repo runs
   `Lint, Type-Check & Test` (on multiple Node majors), `Build Production`,
   `Security Audit`, **CodeQL code-scanning**, and a **Docker image vulnerability
   scan**. A red CodeQL or security check blocks the PR just like a failing test —
   investigate the specific alert (file + line + rule id) and fix the root cause.
2. **Read and act on automated bot review comments** — CodeQL /
   `github-advanced-security`, the Codex reviewer (`chatgpt-codex-connector`),
   Dependabot, etc. For each finding: fix it if it is a real issue, or, if it is a
   false positive, say why (in a brief reply and in `HARDENING_STATUS.md`) and get
   it dismissed rather than silently ignored. There is repo precedent for
   dismissing documented CodeQL false positives — but never restructure code *only*
   to silence a scanner without understanding the alert.
   **Always leave a traceability reply on every bot finding** — fixed *or*
   dismissed — directly on its review thread, stating what was done and pointing
   to the fixing commit and the regression test (e.g. "✅ Addressed in
   `<commit>` — <one-line what changed>; test: `<file> › <test name>`"). Do NOT
   rely on GitHub's "outdated" marker as the signal that a comment was handled:
   "outdated" only means a later commit rewrote the exact diff lines the comment
   was anchored to — a finding can be fully fixed yet not show "outdated" (the
   anchored lines survived the fix), or show "outdated" while ignored (the lines
   changed for unrelated reasons). The human reviewer must be able to see at a
   glance, from the reply on each thread, that every bot finding was consciously
   handled.
3. **Re-run the full local suite before pushing a fix**, not just the files you
   touched: a change in one route (e.g. an auth handler) can break another suite's
   mock. `npm run test` runs all 64 files; do not push after re-running only a
   subset.
4. **Keep pushing until CI is green and bot findings are resolved or explicitly
   dismissed with a rationale.** A pushed-but-red PR is not finished.

### Keep This File Current
- After any change to the project, review and update `AGENTS.md` so it stays accurate and up to date.

## Testing Requirements

- **Always run tests** before committing: `npm run test`
- **Add tests** for new functionality in `__tests__/` directory
- **Test naming**: `*.test.ts` or `*.test.tsx`
- **Framework**: Vitest + React Testing Library

### Regression coverage (leave a durable guard, not a throwaway)

Every bug fix, refactor, or feature MUST leave behind at least one **committed**
automated test that fails without the change — this is the safety net that
shrinks future manual regression testing, so never write a test just to verify a
change and then delete it. (A quick, temporary reproduction harness is fine as a
first step, but promote its assertion into a permanent test before finishing;
don't leave the reproduction as the deliverable.)

- **Pick the cheapest level that catches the regression.** Prefer a fast unit
  test (Vitest) that pins the logic/edge case; only reach for e2e (Playwright)
  when the change alters an integrated user-facing flow. Do not add e2e coverage
  for something a unit test can guard.
- **Report, per change, so manual testing stays minimal and non-redundant:**
  1. the **new/updated tests** that prove the change,
  2. the **existing tests** that already cover the touched area (so the human
     does not re-test it by hand),
  3. a short **manual-verification list** — only what automated tests genuinely
     cannot cover (visual/layout, real offline/mobile behaviour, real LLM output
     quality, multi-pod Socket.IO timing).
- **Load / scale validation**: `npm run test:load` (`loadtest/` harness) drives
  many parallel retros with many concurrent users over the real HTTP +
  Socket.IO protocol and audits that no user action is lost. Run it against a
  staging environment before changing the session sync protocol
  (`update-session` / `_rev` CAS) or before a capacity-sensitive rollout —
  see `loadtest/README.md` for the strategy and presets

## Commit Message Convention

Use conventional commits for clarity:

```
feat: Add dark mode toggle to settings
fix: Resolve timer sync issue in retrospectives
improve: Optimize session loading performance
docs: Update README with deployment instructions
refactor: Simplify vote counting logic
test: Add tests for health check session
```

**Prefix meanings** (note: only `feat:` and `improve:` add a changelog entry):
- `feat:` → New feature (bump VERSION `X`, one CHANGELOG `### Added` entry)
- `improve:` → User-visible enhancement (bump VERSION `X`, one CHANGELOG `### Changed` entry)
- `fix:` → Bug fix (bump VERSION `Y`, **no CHANGELOG entry**)
- `security:` → Security patch (bump VERSION `Y`, **no CHANGELOG entry** — not user-visible)
- `refactor:` → Code refactoring (bump VERSION `Y`, no CHANGELOG entry)
- `docs:` → Documentation only (bump VERSION `Y`, no CHANGELOG entry)
- `test:` → Adding/updating tests (bump VERSION `Y`, no CHANGELOG entry)

## Docker & Deployment

### Configuration Parity
When adding, removing, or changing an environment variable, keep all deployment
surfaces aligned in the same change:
- `.env.example` for local/self-hosted configuration examples
- `README.md` and the Environment Variables list in this `AGENTS.md`
- `k8s/base/deployment.yaml` for non-secret/default runtime values
- `k8s/secrets-templates/*.yaml` for secret-backed values
- `k8s/README.md` for Kubernetes/OpenShift operator guidance

Do not update `.env.example` alone. If a variable is not relevant to Kubernetes,
state why in the PR or commit notes instead of silently skipping the k8s files.

**This rule is now machine-checked.** `__tests__/deploymentManifestParity.test.ts`
holds the parity contract as data: every variable the server reads must be listed
there, and mentioned on every surface it is not explicitly excused from — where
an exemption is a written reason, not a flag. Adding a knob therefore fails the
suite until either the surfaces are updated or the absence is argued for. The
same suite checks that the base image tag has not fallen behind `VERSION`'s major
and that every kustomize overlay patches resource names that actually exist in
`k8s/base` (both `dev` and `prod` had been silently broken by a renamed
Deployment).

### Files to Include in Docker
The following files MUST be included in the Docker image (check `.dockerignore`):
- `VERSION` - For version API
- `CHANGELOG.md` - For announcement system
- `server.js` - Backend
- `dist/` - Built frontend

### Environment Variables
See `README.md` for full list. Key ones:
- `PORT` - Server port (default: 3000)
- `DATABASE_URL` - PostgreSQL connection URL (if set, uses PostgreSQL instead of SQLite)
- `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` - the same connection as discrete values, used when `DATABASE_URL` is unset (what `k8s/base/deployment.yaml` supplies from the PostgreSQL Secret). Each falls back to a platform-injected alias — `POSTGRESQL_SERVICE_HOST` / `POSTGRESQL_SERVICE_PORT` (the standard Kubernetes service-discovery variables for the `postgresql` Service) and `POSTGRESQL_USER` / `POSTGRESQL_PASSWORD` / `POSTGRESQL_DATABASE` (the Red Hat PostgreSQL image's own names, used by the OpenShift overlay). Those aliases are never set in a manifest; they exist so a bound database service works with no extra configuration
- `DATA_STORE_PATH` - SQLite database path (used when DATABASE_URL is not set)
- `SUPER_ADMIN_PASSWORD` - Enable super admin panel
- `SESSION_TOKEN_SECRET` - Stable HMAC signing secret for team and super-admin session tokens **and invite-link credentials** (stage 7e); set the same value on every pod so tokens and newly minted invite links survive restarts and non-sticky routing (falls back to a process-local random secret when unset, in which case new invite links die with the process). **Effectively required for zero-downtime deployments**: `join-session` authenticates with the same token, so without a stable secret a rolling update or a non-sticky route makes every live participant's automatic re-join fail and drops them out of an in-progress session
- `SMTP_*` - Email configuration
- `BACKUP_ENABLED` - Enable automatic server-side backups (default: `true`)
- `BACKUP_INTERVAL_HOURS` - Hours between automatic backups (default: `24`); across multiple pods the scheduled `auto` backup is elected via the shared store (each pod skips if another already wrote an `auto` backup within the interval), so `N` pods produce one backup per interval instead of `N`
- `BACKUP_MAX_COUNT` - Max automatic backups to keep (default: `7`)
- `BACKUP_ON_STARTUP` - Create backup on server start (default: `true`)
- `RESTORE_MAX_BODY_MB` - Max compressed/uploaded super-admin restore archive size in MB (default: `128`)
- `RESTORE_MAX_DECOMPRESSED_MB` - Max decompressed restore archive size in MB for uploaded and stored gzip restores (default: `512`)
- `WIFI_SSID` - Wi-Fi network name; when set with `WIFI_PASSWORD`, shows a Wi-Fi QR code in the invite modal
- `WIFI_PASSWORD` - Wi-Fi password; both `WIFI_SSID` and `WIFI_PASSWORD` must be set to enable the feature
- `AUTH_RATE_LIMIT_MAX` - Max team-create / restore-session requests allowed per IP per 15 minutes (default: `5`); raised by the Playwright config so the full e2e suite can run without hitting the production safeguard
- `PG_POOL_MAX` - Max PostgreSQL connections per pod (default: `10`); raise for high concurrency, keep under `max_connections / pod count`
- `SESSION_CACHE_MAX` - Max live sessions held in each pod's bounded in-memory cache (default: `500`); only bounds memory since session state is always recoverable from the database
- `SOCKET_MAX_BUFFER_SIZE` - Max Socket.IO message size in bytes (default: `1000000`); caps a single client session-update payload
- `SOCKET_UPDATE_RATE` - Sustained `update-session` writes/second allowed per socket via a per-socket token bucket (default: `0`, disabled). Enabling it is a capacity-sensitive change to the session-sync path — run `npm run test:load` at the real cadence first. A throttled write is healed with the authoritative state (a round-trip), never silently dropped. Timer sync is ~1/s, so `20` is a generous starting point
- `SOCKET_UPDATE_BURST` - Momentary burst of `update-session` writes allowed above `SOCKET_UPDATE_RATE` (default: `2 × rate`)
- `LAST_CONNECTION_DEBOUNCE_MS` - Minimum interval between refreshes of a team's `lastConnectionDate` on participant join (default: `300000`); prevents a write storm when a whole session reconnects after a rolling update
- `ROSTER_BROADCAST_DEBOUNCE_MS` - Debounce window (ms) for coalescing session-roster rebroadcasts (default: `250`). Each join/leave otherwise triggers a cross-pod `fetchSockets()` + a full-roster broadcast, so a reconnect stampede is O(N²) messages and N cross-pod fetches; coalescing caps it to at most one rebuild + broadcast per room per window while the immediate `member-joined`/`member-left` signals still drive incremental UI. Unlike the update-session throttle it never drops or delays a user action (only a presence broadcast whose content is unchanged), so it is on by default. Set to `0` for the pre-optimization synchronous broadcast
- `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`) - Redis connection for the multi-pod Socket.IO adapter; when unset, the PostgreSQL adapter is used automatically if PostgreSQL is the data store (single-pod deployments need neither)
- `CORS_ORIGIN` - Restrict Socket.IO CORS to specific origin(s) (default: `*`)
- `TRUST_PROXY` - Express `trust proxy` setting for correct client IPs behind a reverse proxy; rate limiting relies on it (default: `1` in production, `false` otherwise)

## Dependabot / Dependency Updates

### Automated Handling
- A GitHub Actions workflow (`.github/workflows/dependabot-auto-merge.yml`) automatically merges Dependabot PRs for **minor and patch** updates when CI passes
- **Major version** updates are flagged with a comment and require manual review due to potential breaking changes

### Manual Review Required For
- **Major version bumps** (e.g., ESLint 9→10, Tailwind 3→4) — check changelogs for breaking changes, update config files as needed
- **PRs with failing CI** — investigate failures, fix locally, and push fixes to the Dependabot branch
- **GitHub Actions major bumps** (e.g., docker/build-push-action v6→v7) — verify workflow compatibility

### Branch Protection Requirement
For auto-merge to work, the repository must have a branch protection rule on `main` that requires status checks to pass. The checks to mark as required are:
- **`CI Success`** — the single stable aggregate gate from `ci.yml` (see below)
- **`E2E Tests (Playwright)`** — from `e2e.yml`

Without branch protection, `--auto` merge will not wait for checks to pass.

> ✅ **Require the `CI Success` gate, not the individual matrix legs.** `ci.yml`
> ends with a `ci-success` job (context name `CI Success`) that `needs:` every
> other CI job — `lint-and-test` (the whole Node matrix), `build`, and
> `security-audit` — and, via `if: always()`, always reports a status that fails
> unless *every* dependency succeeded. Because the required check is this one
> stable name, **the Node matrix and the rest of `ci.yml` can change freely in a
> PR without ever touching repo settings.** This is deliberate: it keeps CI
> maintenance (e.g. bumping the Node matrix) in developer-controllable workflow
> files instead of admin-only branch-protection settings.
>
> ⚠️ **Never re-pin required checks to per-version legs** (`Lint, Type-Check & Test
> (22.x)`, `(26.x)`, …). A version that is required but later removed from the
> matrix never reports, so GitHub pins the PR at *"Expected — Waiting for status
> to be reported"* forever — which is exactly the trap the `CI Success` gate
> exists to avoid. Editing the required-checks list is a repo-settings action
> (Settings → Branches → the `main` rule → "Require status checks to pass") and
> cannot be done from a PR.

## Common Pitfalls to Avoid

1. **Get VERSION/CHANGELOG right** - User-visible change → bump `X` + **one** consolidated CHANGELOG bullet. Bug fix / internal change → bump `Y` + **no** CHANGELOG entry. Never write a `### Fixed` entry, and never split one version into multiple bullets.
2. **Don't use non-English text** - All code and UI must be English
3. **Don't skip tests** - Run `npm run test` before committing
4. **Don't break the build** - Run `npm run build` to verify
5. **Don't ignore TypeScript errors** - Run `npm run type-check`
6. **Don't add files to Docker without checking `.dockerignore`**

## Quick Reference Commands

```bash
# Development
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Start production server

# Quality checks
npm run lint         # Run ESLint
npm run type-check   # TypeScript check
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode

# Full CI check (run before committing)
npm run ci           # lint + type-check + test + build
```

## API Endpoints Reference

All `/api/team/:teamId/*` and `/api/feedbacks/*` endpoints authenticate with the
team password **or** a valid team session token (`sessionToken` in the request
body) minted for that exact team — the token is an alternative credential so
clients can avoid resending the password on every call.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/version` | GET | Returns version info and changelog for announcements |
| `/api/info-message` | GET | Returns the global info banner configured by the super admin |
| `/api/wifi-config` | GET | Returns Wi-Fi SSID and password (404 if not configured) |
| `/api/data` | GET/POST | **Deprecated** (returns `410`) — replaced by the granular `/api/team/*` endpoints |
| `/api/team/create` | POST | Create a team; returns the team and a session token |
| `/api/team/login` | POST | Team login (password or `inviteCredential` from an invite link); returns the team and a session token |
| `/api/team/restore-session` | POST | Restore a team session from a saved session token (never returns a password) |
| `/api/team/list` | GET | Team summaries for the login screen picker |
| `/api/team/exists/:teamName` | GET | Check team-name availability |
| `/api/team/:teamId` | POST | Fetch the authenticated team's current state |
| `/api/team/:teamId/update` | POST | Update team fields (rename keeps the team index in sync) |
| `/api/team/:teamId/retrospective/:retroId` | POST | Persist one retrospective |
| `/api/team/:teamId/healthcheck/:hcId` | POST | Persist one health check |
| `/api/team/:teamId/action` | POST | Persist a global action update |
| `/api/team/:teamId/members` | POST | Update the member roster |
| `/api/team/:teamId/invite-credential` | POST | Derive the team's current invite credential for embedding in invite links (revoked by password rotation) |
| `/api/team/:teamId/password` | POST | Change the team password (password-only; also bumps the invite epoch, revoking outstanding invite links) |
| `/api/team/:teamId/delete` | POST | Delete a team (its feedbacks are preserved as orphaned) |
| `/api/feedbacks/create` / `all` / `comment` / `comment/delete` / `delete` | POST | Team feedback (bug reports / feature requests) CRUD |
| `/api/send-invite` | POST | Send email invitations. Requires `teamId` **and** a team credential (`sessionToken` or `password`) — it mails a caller-supplied link through the deployment's SMTP identity, so it is never anonymous. The team name in the mail comes from the authenticated record, not the request body. **There is deliberately no cap on how many invitations an authenticated team may send** — inviting a whole department in one batch is the normal case. The only meter counts *rejected credentials* per IP (20/15min), scoped to `401`s alone so nothing a real facilitator does (a typo'd address, a deployment without SMTP, a send failure) can trip it; it exists solely to bound the data-store reads an anonymous prober can drive |
| `/api/send-password-reset` | POST | Send password reset email |
| `/api/password-reset/verify` | POST | Verify a password-reset token |
| `/api/password-reset/confirm` | POST | Set a new team password using a reset token |
| `/api/notify-new-feedback` | POST | Notify the admin email about a new feedback |
| `/api/ai-status` | GET | Returns whether AI features are enabled |
| `/api/ai/suggest-group-title` | POST | AI-generated group title suggestion (requires a valid team session token in the body) |
| `/api/ai/suggest-groups` | POST | AI-suggested ticket clusters for facilitator review during the Group phase (requires a valid team session token in the body) |
| `/api/ai/generate-retro-summary` | POST | AI-generated retrospective summary (requires a valid team session token in the body) |
| `/api/ai/generate-release-analysis` | POST | AI-generated synthesis across multiple retrospectives (release-level analysis; requires a valid team session token in the body) |
| `/api/super-admin/*` | POST | Super admin operations |
| `/api/super-admin/backups/list` | POST | List server-side backups and config |
| `/api/super-admin/backups/create` | POST | Create a manual checkpoint |
| `/api/super-admin/backups/download` | POST | Download a specific backup |
| `/api/super-admin/backups/restore` | POST | Restore from a backup |
| `/api/super-admin/backups/delete` | POST | Delete a backup |
| `/api/super-admin/backups/update` | POST | Update backup label/protection |
| `/api/super-admin/ai-settings` | POST | Load AI/LLM configuration |
| `/api/super-admin/update-ai-settings` | POST | Save AI/LLM configuration |
| `/api/super-admin/test-ai` | POST | Test AI connection |
| `/health` | GET | Health check |
| `/ready` | GET | Readiness check |

## Data Persistence Structure

The application uses a **per-team KV store** architecture to eliminate write contention. Each team is stored in its own KV record, so concurrent updates to different teams never conflict.

### KV Store Keys

| Key Pattern | Description |
|-------------|-------------|
| `team:{teamId}` | One record per team, contains full Team object + `_rev` for optimistic concurrency |
| `team-index` | Maps lowercase team names to team IDs for fast login lookups |
| `retro-meta` | Stores `resetTokens` and `orphanedFeedbacks` (non-team-specific data) |
| `session:{sessionId}` | Real-time session state (retro or health check) |
| `global-settings` | Admin settings (info message, admin email, notifications, AI config) |

### Team Record Structure (`team:{teamId}`)
```json
{
  "id": "abc123",
  "name": "My Team",
  "passwordHash": "...",
  "_rev": 5,
  "_updatedAt": "2025-01-01T00:00:00.000Z",
  "members": [],
  "retrospectives": [],
  "healthChecks": [],
  "globalActions": [],
  "teamFeedbacks": []
}
```

`passwordHash` holds a scrypt hash (`scrypt$N$r$p$salt$hash`, hashed at rest via
`server/services/passwordHashing.js`). Legacy records created before hashing
shipped still hold the clear-text password; they keep authenticating through a
constant-time plaintext fallback and are upgraded to a hash on their next
successful password authentication (rehash-on-login). `/api/team/restore-session`
never returns a password; restored sessions are token-only. Invite links embed a
signed, team-scoped **invite credential** derived on demand from
`/api/team/:teamId/invite-credential` and bound to the team record's
`inviteEpoch` counter (absent means `0`; every password rotation bumps it,
revoking all outstanding invite links). `inviteEpoch` is stripped from client
responses and protected against writes through `/api/team/:teamId/update`, like
`passwordHash`.

### Team Index Structure (`team-index`)
```json
{
  "teams": {
    "my team": "abc123",
    "other team": "def456"
  }
}
```

### Metadata Structure (`retro-meta`)
```json
{
  "resetTokens": [],
  "orphanedFeedbacks": []
}
```

### Key Design Principles
- **Per-team atomic updates**: `atomicTeamUpdate(teamId, updater)` only locks the specific team record, not all teams
- **Team index**: Used for login (name-to-ID lookup) and team creation (uniqueness check)
- **orphanedFeedbacks**: `TeamFeedback` objects preserved from deleted teams. When a team is deleted, its feedbacks are moved to `retro-meta` so bug reports and feature requests are never lost. All feedback endpoints check both `team.teamFeedbacks` and `orphanedFeedbacks`.
- **Automatic migration**: On startup, the server checks for legacy `retro-data` single-blob format and automatically migrates to per-team storage
- **Backup/restore**: Uses `loadPersistedData()` / `savePersistedData()` which reconstruct/decompose the legacy monolithic format for compatibility. Restore is a **faithful replace**, not a merge: `savePersistedData(data, { mode: 'replace' })` upserts the archive's teams/index/meta and then makes the store match the archive exactly — it deletes `team:{id}` records absent from the archive (so a team deleted since the backup no longer lingers as a "ghost" in prefix scans / the super-admin dashboard) and clears all live `session:*` state (a backup never carries session blobs, and a stale session could let a client re-persist pre-restore state). `mode` defaults to `'merge'` (the historical additive behaviour) so non-restore callers are untouched. Both restore routes (`/api/super-admin/restore` and `/api/super-admin/backups/restore`) take a **protected** pre-restore snapshot first (survives retention purge — it may be the only copy of the pre-restore state; prune old ones manually) and **abort with `503 pre_restore_snapshot_failed` if that snapshot cannot be created** (never run the destructive replace with no recovery point); the uploaded route also **rejects a payload whose `teams` is missing or not an array** (`400 invalid_backup_data`) so a malformed upload cannot be coerced into a wipe-everything empty restore (an explicit `teams: []` still restores to empty). Then, after the replace, they clear this pod's session cache and `io.serverSideEmit('sessions-invalidated')` so **every other pod drops its session cache too** (correct at `replicas:2`; single-pod deployments skip the broadcast). Residual: a client actively connected to a live session at the instant of restore can re-persist its in-memory session once as a fresh row — bounded (a new session, never a ghost team) and expected during a global rollback, so run restores during low activity.
- **Closing an action is team-record-owned**: An action is closed/re-opened (`done` toggled) through the granular action endpoints (`toggleGlobalAction`, i.e. `/api/team/:teamId/action`), which update the team record first — from the Dashboard **and** from inside a session (`OpenActionsPhase` and `ReviewPhase` both toggle through them, for carried-over *and* newly created actions). A full retro-session persist (`dataService.updateSession` → `/retrospective`) therefore runs `reconcileRetroActionState`, which guards the single `done: true → false` transition: a stale full-session blob — an open Session whose React state predates a close, or a lagging client re-persisting a retro while browsing — can no longer silently re-open a closed action. A *legitimate* re-open still works because it goes through the granular endpoint (which sets the stored record open first, so the guard lets it through). `assigneeId`/`text` and proposal state are deliberately **not** reconciled: several session-only flows (accepting/editing a proposal in Discuss, assigning a ROTI follow-up in Close) legitimately set them through the session blob without a granular endpoint. The `/api/team/:teamId/retrospective/:retroId` server handler enforces the **same** closed-only guard (`/action` does not advance the retro `_rev`, so a full-retro persist from a client that never saw the close would otherwise clear the rev guard and re-open it), which also protects the multi-client case where the reverting client's own cache is stale.

## Real-time Events (Socket.IO)

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-session` | Client→Server | Join a retrospective/health check. **Authenticated**: the payload must carry the team `sessionToken` the client already holds after login, and that token must be minted for the team owning the session (checked against the persisted session's `teamId` before the socket enters the room, so a refused join leaks no state and receives no roster). A session that does not exist yet cannot be team-checked here; the first `update-session` is instead bound to the credential's team, so one team's token can never seed a session claiming another team's id. `syncService` reads the token at emit time, so the automatic re-join after a reconnect (rolling update) presents the current credential |
| `join-denied` | Server→Client | The join was refused (`unauthenticated` — no/invalid/expired token; `forbidden` — valid token for another team). Retrying cannot help, so `syncService` surfaces it and the session components pause editing instead of leaving the UI looking live while nothing syncs |
| `leave-session` | Client→Server | Leave current session |
| `update-session` | Bidirectional | Sync session state. The server runs an optimistic compare-and-swap on the session `_rev`: a write built on a stale revision is **rejected** (not persisted, not broadcast) so an out-of-date client blob cannot clobber newer state; the rejected sender is sent the authoritative state instead. `syncService` stamps outgoing writes with the revision of the state they were built on (an artificially raised stamp would let stale content overwrite newer state), and on `session-ack` it synthesizes the acked blob back to the app so the local revision stays current. When a healing snapshot lacks the user's own recent data, the session components' merge (`components/session/mergeRemoteSession.ts`) re-applies it (own votes, happiness/ROTI, proposal votes, ratings, unconfirmed ticket/proposal creations, and the add-only collections the healed state lost: open/history action snapshot entries and `invitedUsers` — those are only ever *added* to during a session, so a missing entry always means a lost write race, not a removal; without the `invitedUsers` merge a losing invite write silently erased the "waiting to join" list) and schedules a jittered re-send, so a lost optimistic-concurrency race costs a round-trip instead of losing the user's action. The server also enforces **role-based authorization** (`server/services/sessionGuard.js`): a write from a non-facilitator (role resolved server-side from the team roster) that changes facilitator-only fields — `phase`, `status`, `name`, `date`, `columns`, `icebreakerQuestion`, `discussionFocusId`, `reviewSummary`, template structure, and the reveal/vote/timer-allocation settings — is rejected the same way; timer runtime fields (`timerRunning`, `timerSeconds`, `timerStartedAt`, `timerAcknowledged`) and `participantsPanelCollapsed` stay writable by every client because all clients legitimately sync timer expiry, alarm acknowledgement and the panel toggle. `teamId` is immutable for everyone. If persistence fails, the same compare-and-swap runs against the in-memory cache (degraded mode) so live collaboration continues through a database outage without ever letting a stale blob be broadcast. Before any of this, a cheap top-level shape check (`validateSessionUpdateShape` in `socketHandlers.js`) drops blobs that are not plain objects, claim a different session id, or carry a non-finite `_rev` (which would otherwise poison the revision counter through `Number()` coercion). An optional per-socket token-bucket throttle (`SOCKET_UPDATE_RATE`/`SOCKET_UPDATE_BURST`, disabled by default) caps how many writes one client can drive through the DB + broadcast path; a throttled write is healed from cache, never dropped. |
| `session-ack` | Server→Client | Acknowledges an accepted `update-session` with its new authoritative `_rev`, so the sender (which does not receive its own broadcast echo) learns the revision advanced |
| `member-joined` | Server→Client | User joined notification |
| `member-left` | Server→Client | User left notification |
| `member-roster` | Server→Client | Current participants list. Rebuilt (via a cross-pod `fetchSockets()`) and rebroadcast to the room on every join/leave, but **coalesced** behind a debounce window (`ROSTER_BROADCAST_DEBOUNCE_MS`, default 250ms) so a reconnect stampede after a rolling update cannot drive one rebuild+broadcast per client (audit R28). The roster is rebuilt at fire time, so the coalesced broadcast always reflects current membership; `member-joined`/`member-left` stay immediate for incremental UI. Set the window to `0` to broadcast synchronously |
| `participant-activity` | Bidirectional | Ephemeral "is typing" cue (Brainstorm ticket / Discuss proposal); broadcast to other clients only, never persisted, auto-expires on the receiver |
