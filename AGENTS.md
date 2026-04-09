# AI Agent Instructions for RetroGemini

This document provides guidelines for AI coding assistants (Claude, ChatGPT, Gemini, Copilot, Cursor, etc.) working on this codebase.

## Project Overview

**RetroGemini** is a self-hosted, real-time collaborative retrospectives and team health checks application built with:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS
- **Backend**: Express 5 + Socket.IO + SQLite/PostgreSQL
- **Deployment**: Docker + Railway/Kubernetes/OpenShift

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

### Deployment Note
- Update the `VERSION` file whenever you introduce a new feature or fix a bug so the Docker image deploy action uses the correct version without manual edits.

### VERSION File
- Located at root: `VERSION`
- Format: `X.Y` where:
  - **X** (major): Increment for new features
  - **Y** (minor): Increment for bug fixes
- Example: `1.0` → `1.1` (bug fix) → `2.0` (new feature)

### When to Update Version
- **New feature**: Increment X, reset Y to 0 (e.g., `1.3` → `2.0`)
- **Bug fix**: Increment Y (e.g., `1.3` → `1.4`)
- **Multiple changes**: Use the highest priority (feature > fix)

## Changelog Management

### CHANGELOG.md Format
The changelog follows [Keep a Changelog](https://keepachangelog.com/) format and is **automatically parsed** by the backend to display announcements to users.

```markdown
## [X.Y] - YYYY-MM-DD

### Added
- Description of new feature

### Changed
- Description of improvement/change

### Fixed
- Description of bug fix

### Security
- Description of security fix

### Removed
- Description of removed feature
```

### Changelog Rules
1. **Only user-visible changes** - The changelog is displayed to end users in the app
2. **Write from the user's perspective** - what they can do now, not technical details
3. **Keep descriptions concise** - 1-2 sentences max
4. **Use present tense** - "Add dark mode" not "Added dark mode"
5. **Most recent version at the top**
6. **Summarize only the main highlights** - avoid exhaustive, verbose lists
7. **Do not document bug fixes** - keep the changelog focused on features and improvements
8. **Use a single, consolidated entry when changes are all part of one feature** - do not split into multiple bullet points for the same release note

### What TO Include in CHANGELOG
- New features users can use
- UI/UX improvements
- Security fixes
- Removed features

### What NOT to Include in CHANGELOG
- GitHub workflow changes
- CI/CD pipeline updates
- Internal refactoring (no user impact)
- Documentation updates
- Test additions/changes
- Version tracking infrastructure
- Docker/deployment configuration changes
- Code style/linting fixes
- Bug fixes
- Dependency updates (unless security-related)

### Section Mapping (for announcements)
| CHANGELOG Section | Announcement Type | Icon Color |
|-------------------|-------------------|------------|
| Added | New Feature | Green |
| Changed | Improvement | Blue |
| Fixed | Bug Fix | Amber |
| Security | Security Update | Red |
| Removed | Removed | Gray |

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
4. **Update VERSION**: Increment Y (minor version)

### When Adding a New Feature (TDD Approach)
1. **Write a failing test first**: Define the expected behavior with a test that fails because the feature doesn't exist yet
2. **Implement the feature**: Write the minimum code to make the test pass
3. **Refactor if needed**: Clean up the implementation while keeping tests green
4. **Update VERSION**: Increment X, reset Y to 0
5. **Update CHANGELOG**: Add entry under `### Added`

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

### Keep This File Current
- After any change to the project, review and update `AGENTS.md` so it stays accurate and up to date.

## Testing Requirements

- **Always run tests** before committing: `npm run test`
- **Add tests** for new functionality in `__tests__/` directory
- **Test naming**: `*.test.ts` or `*.test.tsx`
- **Framework**: Vitest + React Testing Library

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

**Prefix meanings:**
- `feat:` → New feature (update VERSION X, CHANGELOG ### Added)
- `fix:` → Bug fix (update VERSION Y, CHANGELOG ### Fixed)
- `improve:` → Enhancement (CHANGELOG ### Changed)
- `docs:` → Documentation only
- `refactor:` → Code refactoring (no user-visible change)
- `test:` → Adding/updating tests
- `security:` → Security fix (CHANGELOG ### Security)

## Docker & Deployment

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
- `DATA_STORE_PATH` - SQLite database path (used when DATABASE_URL is not set)
- `SUPER_ADMIN_PASSWORD` - Enable super admin panel
- `SMTP_*` - Email configuration
- `BACKUP_ENABLED` - Enable automatic server-side backups (default: `true`)
- `BACKUP_INTERVAL_HOURS` - Hours between automatic backups (default: `24`)
- `BACKUP_MAX_COUNT` - Max automatic backups to keep (default: `7`)
- `BACKUP_ON_STARTUP` - Create backup on server start (default: `true`)

## Dependabot / Dependency Updates

### Automated Handling
- A GitHub Actions workflow (`.github/workflows/dependabot-auto-merge.yml`) automatically merges Dependabot PRs for **minor and patch** updates when CI passes
- **Major version** updates are flagged with a comment and require manual review due to potential breaking changes

### Manual Review Required For
- **Major version bumps** (e.g., ESLint 9→10, Tailwind 3→4) — check changelogs for breaking changes, update config files as needed
- **PRs with failing CI** — investigate failures, fix locally, and push fixes to the Dependabot branch
- **GitHub Actions major bumps** (e.g., docker/build-push-action v6→v7) — verify workflow compatibility

### Branch Protection Requirement
For auto-merge to work, the repository must have a branch protection rule on `main` that requires status checks to pass. The following checks should be marked as required:
- **CI** (`Lint, Type-Check & Test`, `Build Production`, `Security Audit`)
- **E2E Tests** (`E2E Tests (Playwright)`)

Without branch protection, `--auto` merge will not wait for checks to pass.

## Common Pitfalls to Avoid

1. **Don't forget VERSION/CHANGELOG** - Every user-visible change needs both
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

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/version` | GET | Returns version info and changelog for announcements |
| `/api/data` | GET/POST | Team data persistence |
| `/api/send-invite` | POST | Send email invitations |
| `/api/send-password-reset` | POST | Send password reset email |
| `/api/super-admin/*` | POST | Super admin operations |
| `/api/super-admin/backups/list` | POST | List server-side backups and config |
| `/api/super-admin/backups/create` | POST | Create a manual checkpoint |
| `/api/super-admin/backups/download` | POST | Download a specific backup |
| `/api/super-admin/backups/restore` | POST | Restore from a backup |
| `/api/super-admin/backups/delete` | POST | Delete a backup |
| `/api/super-admin/backups/update` | POST | Update backup label/protection |
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
| `global-settings` | Admin settings (info message, admin email, notifications) |

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
- **Backup/restore**: Uses `loadPersistedData()` / `savePersistedData()` which reconstruct/decompose the legacy monolithic format for compatibility

## Real-time Events (Socket.IO)

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-session` | Client→Server | Join a retrospective/health check |
| `leave-session` | Client→Server | Leave current session |
| `update-session` | Bidirectional | Sync session state |
| `member-joined` | Server→Client | User joined notification |
| `member-left` | Server→Client | User left notification |
| `member-roster` | Server→Client | Current participants list |
