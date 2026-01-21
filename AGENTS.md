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

## Language & Code Conventions

### Language
- **Code**: All code, comments, variable names, and function names MUST be in **English**
- **UI text**: All user-facing text in the application MUST be in **English**
- **Documentation**: All documentation (README, CHANGELOG, comments) MUST be in **English**

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

### When Adding a New Feature
1. **Update types**: Add new interfaces to `types.ts` if needed
2. **Implement feature**: Follow existing patterns
3. **Write tests**: Add tests in `__tests__/` directory
4. **Update VERSION**: Increment X (major version)
5. **Update CHANGELOG**: Add entry under `### Added`

### When Fixing a Bug
1. **Fix the issue**: Follow existing patterns
2. **Write test**: Add test to prevent regression
3. **Update VERSION**: Increment Y (minor version)

### Before Committing
1. **Run linting**: `npm run lint`
2. **Run type check**: `npm run type-check`
3. **Run tests**: `npm run test`
4. **Run build**: `npm run build`

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
| `/health` | GET | Health check |
| `/ready` | GET | Readiness check |

## Real-time Events (Socket.IO)

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-session` | Client→Server | Join a retrospective/health check |
| `leave-session` | Client→Server | Leave current session |
| `update-session` | Bidirectional | Sync session state |
| `member-joined` | Server→Client | User joined notification |
| `member-left` | Server→Client | User left notification |
| `member-roster` | Server→Client | Current participants list |
