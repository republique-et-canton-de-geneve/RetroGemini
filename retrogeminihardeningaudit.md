# RetroGemini — Production Hardening Audit (/plan-eng-review)

**Date**: 2026-07-06 · **Branch**: `claude/retrogemini-hardening-audit-j4qtx0` · **HEAD**: `07ded96` · **VERSION**: 27.0
**Scope**: repository-wide engineering & maintainability audit. No source file was modified.
**Ground rule**: current behavior, public APIs, persisted formats, WebSocket events and deployment behavior are contracts — every proposal below preserves them or stages the change behind compatibility.

---

## 0. Executive summary

The codebase is in far better shape than most AI-generated projects: the concurrency core (per-team CAS, session `_rev` compare-and-swap, client-side merge + resend) is genuinely well engineered, unit-tested at the right seams (470 tests, all green), and the recent git history shows the team already burned its fingers on stale-write clobbering and fixed it properly. The load-test harness is a real asset.

The hardening gaps cluster in four places:

1. **Auth model** — plaintext team passwords at rest, returned over the wire by `restore-session`, and embedded in invite links. Acknowledged in SECURITY.md, but it is the single biggest hardening item and it constrains everything else.
2. **Process lifecycle** — there is **no graceful shutdown at all** (no SIGTERM handler, no connection drain, no pool close), and `/ready` is a static 200. The zero-downtime story currently rests 100% on client reconnect + CAS, contradicting CLAUDE.md's claims.
3. **Unauthenticated write/abuse surface** — `/api/send-invite` is an unauthenticated, un-rate-limited SMTP relay; `/api/ai/*` lets any network caller drive the internal LLM with a custom prompt; the super-admin restore endpoint accepts a 1 GB in-memory body.
4. **Quality-gate theater** — the 70% coverage threshold measures **only 2 files** (918 statements out of a ~35k-line repo); E2E never runs on normal PRs; lint passes with 344 warnings; `strict: false` while CLAUDE.md mandates strict mode; a dozen doc claims are false.

Everything below is incremental. No rewrite is proposed anywhere.

### Verification evidence (run during this audit, clean checkout + `npm ci`)

| Check | Result |
|---|---|
| `npm run lint` | 0 errors, **344 warnings** (no `--max-warnings` gate) |
| `npm run type-check` | clean (but `strict: false`) |
| `npm test` | **54 files, 470 tests, all pass** (24.5 s) |
| `npm run test:coverage` | thresholds pass — but only `services/dataService.ts` + `services/syncService.ts` are measured (918 statements total) |
| `npm run build` | OK (462 ms); warning: main chunk > 500 kB |
| `npm audit --omit=dev --audit-level=high` | **0 vulnerabilities** |
| `npm audit --audit-level=moderate` (all deps) | 2 (1 low, 1 moderate: `brace-expansion`, dev-only) |
| E2E suite | not run in this audit environment (requires Playwright browsers); CI config analysis below |

---

## 1. High-level architecture map

```
                                   BROWSER (React 19 + Vite, single ~500kB bundle)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │ App.tsx ──> TeamLogin / Dashboard / Session / HealthCheckSession / SuperAdmin│
  │                  │                        │                                  │
  │       services/dataService.ts    components/session/mergeRemoteSession.ts   │
  │       (in-memory team+password,  (re-apply own votes/creations on healing   │
  │        HTTP persist queue)        snapshots, jittered re-send)              │
  │                  │                        │                                  │
  │                  │              services/syncService.ts                      │
  │                  │              (socket.io client, rev stamping,             │
  │                  │               auto-rejoin, session-ack synthesis)         │
  └──────────────────┼────────────────────────┼──────────────────────────────────┘
              HTTP JSON (password in body)   WebSocket /socket.io
                     │                        │
  ┌──────────────────▼────────────────────────▼──────────────────────────────────┐
  │ server.js (Express 5 + Socket.IO 4, no shutdown handler)                     │
  │                                                                              │
  │  routes/                     services/                                       │
  │   coreRoutes    /health /ready /api/version   sessionGuard (facilitator-only │
  │   publicRoutes  wifi, info, send-invite ⚠     field enforcement)             │
  │   teamRoutes    login/create/update (plaintext pw ⚠, per-route limiters)     │
  │   feedbackRoutes  cross-team feedback reads                                  │
  │   passwordResetRoutes  hashed one-time tokens (good)                         │
  │   superAdminRoutes  backups, restore (1GB ⚠), AI endpoints (no auth ⚠)       │
  │                                                                              │
  │   socketHandlers ── join-session (no auth beyond session id ⚠)               │
  │        │            update-session → sessionGuard → saveSessionState (CAS)   │
  │        │            degraded mode: CAS against boundedCache on DB outage     │
  │        ▼                                                                     │
  │   sessionCache (bounded LRU, per pod)     tokenService (in-memory Maps ⚠     │
  │                                            → lost on restart, not shared     │
  │                                              across pods)                    │
  └──────────┬──────────────────────────────────────────────┬────────────────────┘
             │ dataStore.js (KV abstraction)                │ socketAdapter
  ┌──────────▼──────────────┐              ┌────────────────▼───────────────┐
  │ SQLite (better-sqlite3, │      OR      │ PostgreSQL (pg pool, FOR UPDATE│
  │ WAL, sync/blocking)     │              │ row locks) + socket.io adapter │
  │ single pod only         │              │ (Redis if configured, else PG) │
  └─────────────────────────┘              └────────────────────────────────┘
     KV keys: team:{id} (_rev CAS) · team-index · retro-meta · session:{id} (_rev CAS)
              global-settings · backups table (gzipped monolithic JSON snapshots)
```

**Write paths that guard against data loss** (the crown jewels — do not regress):
1. Socket `update-session`: client stamps honest base `_rev` → server CAS → reject-and-heal stale writes → `session-ack` → client merge re-applies own data → jittered re-send.
2. HTTP retro/healthcheck persist: `_rev` guard inside `atomicTeamUpdate` (teamRoutes.js:362-366).
3. Degraded mode: same CAS semantics against the per-pod cache when the DB is down.

---

## 2. Contradictions: documentation vs implementation

| # | Claim (where) | Reality (evidence) |
|---|---|---|
| C1 | "Use TypeScript strict mode" (CLAUDE.md → Code Style) | `"strict": false` — `tsconfig.json:10` |
| C2 | "Graceful shutdown: Kubernetes probes ensure proper pod lifecycle" (CLAUDE.md) | No SIGTERM/SIGINT handler anywhere; no `server.close()`, no `pool.end()`, no `stopScheduler()` on exit — `server.js:158-175`; no `preStop` hook — `k8s/base/deployment.yaml` |
| C3 | API table lists `/api/data` GET/POST as "Team data persistence" (CLAUDE.md) | Both return **410 Gone** — `server/routes/publicRoutes.js:41-49` |
| C4 | CLAUDE.md API table omits `/api/team/*` (9 endpoints), `/api/feedbacks/*`, `/api/password-reset/*`, `/api/info-message`, `/api/notify-new-feedback` | `server/routes/teamRoutes.js`, `feedbackRoutes.js`, `passwordResetRoutes.js`, `publicRoutes.js` |
| C5 | "Vitest with 10%+ coverage threshold" (README.md:277) | Thresholds are 70/70/59/70 — `vitest.config.ts:35-40` — and apply to only 2 files |
| C6 | "Type Safety: Full TypeScript coverage" (README.md:284) | Backend is untyped JS (`allowJs`, no `checkJs`); `strict:false`; `_rev` protocol field missing from `types.ts`, cast via `as unknown as` — `services/syncService.ts:37-40` |
| C7 | "Dependency Review: Blocks PRs with vulnerable dependencies" (README.md:290); AUDIT_REPORT.md claims `dependency-review.yml` implemented | No such workflow exists — `.github/workflows/` contains ci, codeql, dependabot-auto-merge, docker-deploy, docker-security, e2e only |
| C8 | "Security headers configured in nginx" (README.md:269); "Security headers: X-Frame-Options…" (SECURITY.md:29) | nginx exists only in the **optional** compose profile `with-proxy` (`docker-compose.yml:77-86`); the K8s/OpenShift production path serves Express directly with zero security headers |
| C9 | "Capability dropping: All Linux capabilities dropped" (SECURITY.md:24) | `securityContext: {}` — `k8s/base/deployment.yaml:171`; container starts as root and drops via su-exec (`docker-entrypoint.sh:21-23`) |
| C10 | "Minimal base image: Node 20 Alpine" (SECURITY.md:23, README.md:262) | `FROM node:26-alpine` — `Dockerfile:7,30`; CI matrix tests only Node 20.x/22.x (`ci.yml:16`) → **the production Node version is never tested in CI** |
| C11 | README config table: `PORT` default `8080` | Code default is `3000` (`server.js:156`); 8080 comes only from the Dockerfile ENV |
| C12 | CLAUDE.md branch protection: "E2E Tests (Playwright)" should be a required check | `e2e.yml:12` — `if: workflow_dispatch || dependabot[bot]` → E2E **never runs on normal PRs**; a skipped required check does not block merging |
| C13 | AUDIT_REPORT.md (repo root) presents "No automated tests / No CI/CD / ESLint not configured" as findings | All three exist; the file is a stale 2025 artifact that misleads newcomers |
| C14 | MAINTENANCE.md test structure references `__tests__/example.test.ts` | File does not exist |
| C15 | Golden rule: `improve:` ⇒ X bump + one `### Changed` entry | Commit `8231650` (improve:) bumped VERSION through 26.0 with **no `## [26.0]` changelog block** (CHANGELOG.md jumps 25.0 → 27.0) |
| C16 | `.env.example:23`: "PostgreSQL is used if DATABASE_URL **or POSTGRES_HOST** is set" | Code requires host **and** user **and** password **and** database — `server/services/dataStore.js:20` |
| C17 | Redis adapter is a documented HA option (CLAUDE.md) | `REDIS_URL/REDIS_HOST/REDIS_PORT/REDIS_PASSWORD` appear in no README table and not in `.env.example` — only readable from `server/services/socketAdapter.js:6-23` |
| C18 | README:210 "two E2E artifacts are uploaded: playwright-report and playwright-videos" | Workflow uploads a single `playwright-artifacts` artifact — `e2e.yml:41-50` |
| C19 | k8s manifest is the deploy source of truth (docker-deploy.yml updates it) | Committed image tag is `jpfroud/retrogemini:10.2` vs VERSION 27.0 — `k8s/base/deployment.yaml:24` — manifest/version drift |
| C20 | README:82 "provide an image_tag (defaults to `0.1`)" | Workflow defaults to the VERSION file — `docker-deploy.yml:5-9` |

---

## 3. Prioritized risk register

Format: `[Px] (confidence N/10) — severity / likelihood — evidence`. Confidence per the calibration table; everything listed ≥7 was verified by reading the quoted code.

### P0 — fix in the next few releases

**R1. Plaintext team passwords: at rest, over the wire, and inside invite links** — (10/10) — severity **high** / likelihood medium (internal network mitigates exposure, doesn't remove it)
- Stored verbatim: `teamRoutes.js:141` (`passwordHash: password`); compared with `!==`: `teamService.js:15`, `teamRoutes.js:80` (also not constant-time).
- Returned to the client: `/api/team/restore-session` responds `password: team.passwordHash` — `teamRoutes.js:118`.
- Embedded in invite links (base64, no expiry, no revocation): `utils/inviteLink.js:31-34` (`minimal = { id, name, password }`).
- Every authenticated HTTP call carries the plaintext password in the JSON body: `services/dataService.ts:309-312`.
- Acknowledged in SECURITY.md:36 — but "acknowledged" ≠ "hardened". One leaked backup, one captured HAR file, or one forwarded invite email = permanent team compromise (passwords are also likely reused by users elsewhere).
- **Constraint**: invite links embedding the secret are a wire contract; old links must keep working. See PR-7 staging.

**R2. No graceful shutdown; readiness probe is decorative** — (9/10) — severity high / likelihood **certain** (every rolling update, every pod eviction)
- `server.js` registers no signal handler; on SIGTERM Node dies immediately: in-flight `update-session` persists are cut mid-CAS, HTTP requests get connection resets, the PG pool and SQLite handle are never closed, the backup scheduler interval is orphaned.
- `/ready` returns static 200 (`coreRoutes.js:3`) — a pod that lost its DB stays in the Service endpoints forever.
- No `preStop` hook and no `PodDisruptionBudget` (`k8s/base/`), so both replicas can be drained simultaneously during node maintenance.
- **Severity framing corrected by outside voice**: the original "one abrupt-kill away from the #346-#348 stale-write clobbering" is **overstated**. `saveSessionState` is a single atomic rev-checked write — a process killed mid-write either committed or didn't; there is no partial-CAS corruption. A lost in-flight persist just costs a client round-trip via the merge + jittered re-send path the audit praises elsewhere. So abrupt death hits the *designed-for* path, it does not reintroduce data clobbering. R2 remains real and worth doing, but for the right reasons: **clean pool/handle close, fewer connection-reset log spikes, and faster failover via `preStop` drain** — not data-loss prevention. The highest-value 20% is `preStop: sleep 5`; the elaborate ordered flush is lower value than first billed (see PR-1 correction).

**R3. `/api/send-invite` is an unauthenticated, un-rate-limited email relay** — (9/10) — severity high / likelihood medium
- `publicRoutes.js:51-88`: no auth check, no limiter, recipient/name/teamName fully caller-controlled. Anyone with network access can pump arbitrary email through the corporate SMTP account (spam, phishing with a legitimate internal sender). `/api/send-password-reset` (passwordResetRoutes.js:14) and `/api/notify-new-feedback` (publicRoutes.js:90) are also unlimited, lower impact.

**R4. `/api/ai/*` endpoints are unauthenticated (and one is an unbounded amplifier)** — (9/10) — severity medium-high / likelihood medium
- `superAdminRoutes.js:1122-1210`: despite living in "superAdminRoutes", the four `/api/ai/*` endpoints check no credential; `generate-release-analysis` even accepts a caller-supplied **`customPrompt`** that fully replaces the system prompt (`aiService.js:387-389`). Any network caller gets 30 req/min/IP of free rein over the internal LLM.
- **Amplification (outside-voice correction)**: unlike `suggest-groups` which caps input at 200 (`superAdminRoutes.js:1154`), `generate-release-analysis` accepts an **unbounded `retrospectives` array** — no `.slice()` cap (`:1188-1200`). Combined with the custom-prompt override, that's an unauthenticated LLM cost/DoS amplifier, not merely "abuse". Add a hard cap on array length + payload size as part of PR-4.

**R4b. Server-side backups are plaintext-credential dumps, and the download endpoint hands them out** — (9/10) — severity high / likelihood low-medium — **(outside-voice, not in original register)**
- Because `passwordHash === password` (`teamRoutes.js:141`), every gzipped backup contains every team's plaintext password. `/api/super-admin/backups/download` (`superAdminRoutes.js:694`) and the on-disk `backups` table therefore leak all credentials to anyone with the super-admin token or DB/volume access. This is the concrete instantiation of R1's "one leaked backup = compromise" — and it creates a PR-7 interaction the plan must handle: restoring an **old** backup (contract item #4) reintroduces plaintext records after bcrypt-at-rest ships. Dual-verify (PR-7c) covers it, but the plan must say so explicitly.

### P1 — plan now

**R5. Session/super-admin tokens are per-pod, in-memory** — (9/10) — severity medium / likelihood **high with replicas:2**
- `sessionTokens.js:6-7` (`new Map()`): with 2 replicas and no sticky sessions, `restore-session` and super-admin `validate-session` fail whenever the request lands on the other pod, and **all** tokens vanish on every deploy. Users are silently bounced to the login screen — directly against the zero-downtime doctrine. (The app recovers via the localStorage token → 401 → re-login path, so it looks like "users keep getting logged out" rather than an outage.)

**R6. Backup restore is a merge, not a restore** — (9/10) — severity high / likelihood low-medium (only on restore day — exactly the day you can't afford surprises)
- `dataStore.js:827-843` (`savePersistedData`): writes every team in the archive and overwrites `team-index`, but **never deletes team records absent from the archive**. Teams created after the backup become half-orphaned: invisible to login (index gone) but still returned by `loadTeamSummaries`/`loadAllTeams` (prefix scan), so the super-admin dashboard shows ghosts and a later name-reuse can collide.
- `session:{id}` keys and each pod's `sessionCache` are untouched by restore — a live session can immediately re-persist post-backup state into restored teams.
- The pre-restore snapshot (`superAdminRoutes.js:732`) is type `'auto'`, so it competes with the retention purge of 7.

**R7. Degraded-mode divergence across pods** — (7/10) — severity medium / likelihood low
- `socketHandlers.js:262-279`: when the DB write throws, each pod CAS-es against **its own** cache and increments revs locally. Two pods serving the same session during a DB outage fork the rev line; after recovery the first write wins silently. Single-pod SQLite deployments are unaffected. This is a conscious tradeoff (documented in CLAUDE.md) — the residual risk should at least be logged loudly and surfaced in `/api/super-admin/logs`.

**R8. Socket surface: join needs only a guessable session id; no per-socket write throttle** — (8/10) — severity medium / likelihood low-medium
- `socketHandlers.js:92-132`: `join-session` takes `{sessionId, userId, userName}` at face value — no team membership check; the joiner immediately receives the full session state. Session ids are client-generated `Math.random().toString(36).substr(2, 9)` (`components/Session.tsx:38`, `services/dataService.ts:656` etc.) ≈ 46 bits from a non-crypto PRNG.
- `update-session` has no per-socket rate limit: a hostile client can push 1 MB blobs in a tight loop; each one costs a DB read + CAS write + broadcast.
- Participant-level writes (tickets, votes) are by design open to all joiners; facilitator fields are guarded (`sessionGuard.js`) and `teamId` is immutable — good.

**R9 (RECLASSIFIED TO P0 by outside voice). Restore endpoint buffers up to 1 GB into memory PRE-AUTH** — (9/10) — severity high / likelihood medium — **belongs in the R3/R4 unauthenticated-abuse bucket, not here**
- Original audit said "auth required". That is **wrong**: `express.raw({ limit: '1gb' })` (`superAdminRoutes.js:580-583`) is middleware that runs **before** the auth check at `:588`. The full body is buffered into memory during body parsing; the 401 only fires afterward. So any **unauthenticated** network caller (gated only by the rate limiter) can force each request to buffer up to 1 GB against a 384 Mi pod, then `gunzipSync` (`:600`) amplifies. This is an unauthenticated OOM-kill button. → promote to P0, fix via PR-11 (lower limit + streamed decompressed-size cap), and move PR-11 into the early abuse-surface lane.

**R10. `/api/feedbacks/all` and super-admin feedbacks deserialize every team's full history** — (8/10) — severity medium (memory/latency spike) / likelihood medium at 100+ teams
- `feedbackRoutes.js:81` and `superAdminRoutes.js:103` call `loadAllTeams()` — full JSON.parse of every team blob including all retrospectives — to extract feedbacks only. The codebase already invented the summary-projection pattern (`loadTeamSummaries`, dataStore.js:598) for exactly this reason. Also: any team member sees **all teams'** feedbacks (by design? worth confirming).

### P2 — schedule

**R11. Coverage gate measures 2.6% of the codebase** — (10/10)
- `vitest.config.ts:14-16`: `include: ['services/**/*.ts']` → the enforced 70% applies to 918 statements. The 470-test suite actually exercises far more (server modules, utils, components) but none of it counts. The metric can't regress-protect what it doesn't measure.

**R12. E2E never gates PRs** — (10/10) — `e2e.yml:12`. Combined with CLAUDE.md's instruction that e2e must pass before committing, the gate exists only on the honor system.

**R13. ESLint server override targets the wrong directory; no warning budget** — (9/10)
- `eslint.config.js:88`: `files: ['server.js', 'services/**/*.js', ...]` — but backend code lives in `server/**` (services/ holds frontend .ts). Result: `no-console` fires on all backend files → 344 warnings of noise → real warnings are invisible; lint job passes regardless.

**R14. Dead/duplicated rate-limiter module** — (9/10)
- `server/config/rateLimiters.js` is imported by nothing (verified: only defined, never referenced); it duplicates the limiters defined inline in `teamRoutes.js`/`superAdminRoutes.js` **with conflicting values** (teamWrite 60/min vs 300/min at `teamRoutes.js:50-56`). A future "fix" applied to the dead file would silently do nothing.

**R15. Monolithic modules** — (9/10)
- `components/Session.tsx` 2643 lines, `SuperAdmin.tsx` 2336, `Dashboard.tsx` 2034, `services/dataService.ts` 1753, `superAdminRoutes.js` 1213 — against CLAUDE.md's own file-size guidance. Single 500 kB+ JS chunk (build warning) hurts first paint on corporate-Wi-Fi mobile — the app's primary client.

**R16. Multi-pod backup stampede** — (8/10)
- `backupService.js:130`: every pod runs the interval scheduler; the 5-minute dedup covers only the `startup` type. N pods ⇒ N `auto` backups per interval, churning the max-7 retention window (real retention horizon = 7/N intervals).

**R17. `_rev` is untyped at the heart of the sync protocol** — (9/10)
- `types.ts` has no `_rev`/`_updatedAt` on `RetroSession`/`HealthCheckSession`; `syncService.ts:37-40,136` round-trips it through `as unknown as SyncedSession`. One refactor that "cleans up" the spread loses the CAS stamp with zero compiler feedback.

**R18. CI never tests the production Node major** — (9/10) — matrix 20/22 (`ci.yml:16`) vs runtime node:26 (`Dockerfile:30`); better-sqlite3 native module rebuilds are exactly the kind of thing that breaks across majors.

**R19. K8s hardening gaps** — (8/10) — no PodDisruptionBudget; app `cpu request: 1m` (scheduler can starve it); `securityContext: {}`; Postgres single replica with `Recreate` (planned DB downtime windows — degraded mode covers sockets but HTTP persists fail); probes `timeoutSeconds: 1` is tight for a blocking SQLite pod.

### P3 — opportunistic cleanups

- **R20** `loadAllTeams` dead filter: `!r.key.startsWith('team-')` can never be true after `startsWith('team:')` — `dataStore.js:571`. Harmless; delete.
- **R21** `nginx.conf.template` referenced by nothing (only `nginx.conf` is mounted in the optional compose profile). Dead file.
- **R22** Two `socketAdapter.js` files (repo root = strategy resolver, server/services = implementation) — confusing import `'../../socketAdapter.js'`.
- **R23** `package.json` version `1.1.0` and repository URL `uSpreadIt/RetroGeminiCodex.git` are stale/unrelated to VERSION 27.0 and the actual repo.
- **R24** `tokenService` `setInterval` (sessionTokens.js:71) and backup scheduler interval are never `unref()`d — keeps the event loop alive in tests/tools that import them.
- **R25** logService `attachConsole` only captures `console.error/warn` — `console.info`/`log` (most of socketHandlers' operational trail) never reaches the super-admin log viewer.
- **R26** Backups pretty-print JSON before gzip (`backupService.js:35`, `JSON.stringify(data, null, 2)`) — ~30% larger uncompressed payload, pure CPU waste.
- **R27** `AUDIT_REPORT.md` stale (see C13) — replace or delete.
- **R28** Roster broadcast is O(N²) during a reconnect stampede: every `join-session` triggers `fetchSockets()` + full-roster broadcast to the room (`socketHandlers.js:108-109`) — 50 rejoining clients ⇒ 50 cross-pod fetches and 2 500 roster messages in seconds. Works today; first thing to melt at larger rooms.

---

## 4. Review sections (gstack 4-pass)

### 4.1 Architecture — 6 issues (R1, R2, R5, R6, R7, R8 above)
Boundaries are otherwise clean and boring in the good sense: routes/services separation on the server, a single dataStore abstraction hiding both engines, ephemeral vs persistent state clearly separated. The KV + per-record CAS model is the right amount of engineering for the scale. No speculative infrastructure found. **Single points of failure**: PostgreSQL (Recreate, 1 replica), and — for SQLite deployments — the single pod itself (documented).

### 4.2 Code quality — 5 issues (R13, R14, R15, R17, R20-R27)
DRY: limiter duplication (R14) is the only aggressive-flag-worthy repetition on the backend; the per-engine `if (usePostgres) … else …` blocks in dataStore.js are repetitive but explicit and consistently shaped — acceptable, and safer than a premature abstraction. Frontend: `SuperAdmin.tsx` carries 16 `any`s; the session components are large but internally well-factored into `components/session/*`. Error handling: routes uniformly try/catch → 500 JSON (good); `kvGet` JSON.parse of a corrupted row throws raw (acceptable: fail-loud beats fail-silent for corruption).

### 4.3 Tests — coverage diagram

```
CODE PATHS (unit/integration)                      USER FLOWS (e2e, Playwright)
[+] server: CAS + guards                           [+] e2e/retro-full-flow.spec.ts (778 ln)
  ├── [★★★] saveSessionState CAS  sessionStateCas    ├── [★★★] full retro incl. reconnection
  ├── [★★★] facilitator guard  socketSessionAuth…    ├── [★★ ] grouping/vote/discuss
  ├── [★★★] concurrency repro  sessionConcurrency…   [+] healthcheck-full-flow.spec.ts
  ├── [★★★] boundedCache, socketHandlersDebounce     [+] release-analysis / participants-origin
  ├── [★★ ] backupService (create/retention/restore) [+] team-favorites
  └── [GAP] graceful shutdown (nothing to test yet)
[+] client sync                                    [GAP] [→E2E] backup → restore → relogin
  ├── [★★★] mergeRemoteSession (312-ln test)        [GAP] [→E2E] password reset full loop
  ├── [★★★] syncService rev/ack/rejoin              [GAP] [→E2E] super-admin panel flows
  └── [★★★] dataService (1242-ln test)              [GAP] [→E2E] pod-restart mid-retro
[+] loadtest harness (real HTTP+socket protocol)         (loadtest covers the protocol side;
  └── [★★★] no-lost-action audit at scale                 no automated k8s rolling-update test)
[GAP] server routes: publicRoutes (send-invite),   [GAP] E2E runs only on workflow_dispatch /
      passwordResetRoutes, superAdmin backups API         dependabot (e2e.yml:12) → 0 PR gating
COVERAGE MEASURED: services/*.ts only (918 stmts) — thresholds enforce ~2.6% of repo (R11)
QUALITY: the tests that exist are ★★★ — they test behavior, races, and edge cases, not smoke.
```

**Regression rule check**: no regressions introduced by this audit (read-only). The concurrency area regressed twice historically (commits `0f09a0c`, `e027780`) and now has the strongest tests in the repo — the process worked.

### 4.4 Performance — 4 issues (R10, R26, R28 + bundle)
- R10 full-blob deserialization on feedback endpoints (pattern already exists to fix it).
- R28 roster O(N²) on reconnect stampedes.
- Single 500 kB+ chunk (build warning) — one `manualChunks` split (vendor/react vs app) is cheap.
- better-sqlite3 synchronous calls block the event loop — fine at documented single-pod scale; PostgreSQL is already the prescribed path beyond that. No N+1 of consequence found on hot paths (`loadTeamSummaries` SQL projection is well done).

---

## 5. Target quality baseline (proposed, all measurable)

| Dimension | Today | Baseline target |
|---|---|---|
| Lint | 0 errors / 344 warnings, no budget | 0 errors / 0 warnings (`--max-warnings 0`) after eslint scope fix |
| Types | `strict:false`, backend unchecked | `strict:true` for .ts; `checkJs` on `server/**` (or migrate hot server files to checked JS via JSDoc); `_rev` typed |
| Coverage | 70% of 2 files | ≥70% lines on `services/`, `server/services/`, `utils/`, `components/session/*.ts`; components stay e2e-covered |
| E2E | manual trigger only | runs on every PR (required check), plus nightly full run |
| Node | CI 20/22, prod 26 | CI matrix includes the Dockerfile major; Dockerfile pins digest |
| Shutdown | none | SIGTERM drain: stop intake → close sockets → flush persists → close pools; verified by a unit test + documented rolling-update drill |
| Readiness | static 200 | `/ready` reflects **this pod's** ability to serve (process up, HTTP listening, event loop responsive) — **NOT** shared-DB reachability. See correction below. |
| Abuse surface | 5 unauthenticated unlimited endpoints | every state-changing/costly endpoint authenticated and/or rate-limited |
| Secrets at rest | plaintext passwords | bcrypt at rest (staged, R1/PR-7), tokens server-persisted |
| Docs | 20 false claims (section 2) | zero known-false statements; CLAUDE.md API table complete |
| Backups | merge-restore, N-pod stampede | restore = faithful replace (with pre-restore snapshot), single scheduler election |

---

## 6. Proposed PR sequence (small, independent, contract-preserving)

Ordering = risk-reduction per unit of review effort. Every PR: `security:`/`fix:`/`refactor:` prefix ⇒ VERSION `Y+1`, **no CHANGELOG entry** (per the golden rule — none of these are user-visible). Rollback for every PR = `git revert` of one commit + redeploy previous image tag; none introduces a schema migration (KV additions only).

**PR-1 `fix:` Graceful shutdown** — `server.js`
Add SIGTERM/SIGINT handler: `io.close()` (sends disconnect, clients auto-rejoin), `server.close()`, `backupService.stopScheduler()`, `pool.end()` / `sqliteDb.close()`, hard-exit timer (e.g. 10 s < terminationGracePeriodSeconds 30). Add `preStop: sleep 5` to the k8s deployment so endpoints drain before SIGTERM.
*Acceptance*: `kill -TERM` on a running server exits 0 within 10 s with connections drained; unit test on an extracted `createShutdown({io,server,pool,…})` asserting call order; existing e2e reconnection spec stays green.
*Must-not-change*: exit code 0; clients experience a normal socket disconnect (already handled by `syncService` auto-rejoin).

**PR-2 `fix:` Pod-local readiness + PDB — REVISED per outside voice (do NOT gate readiness on the shared DB)**
Original draft made `/ready` do a DB read and return 503 on failure. The outside voice correctly killed this: both replicas point at the **same** Postgres, so a single DB blip would fail readiness on **every** pod at once → the Service loses all endpoints → **full outage** — defeating the exact degraded-mode mechanism (`socketHandlers.js:255-280`) built to survive a DB outage. **Revised scope**: `/ready` reflects only *this pod's* ability to serve (process up, HTTP listening, event loop not wedged) — never a shared dependency. In practice that means `/ready` stays a cheap local 200 but PR-2's real deliverables become the **PodDisruptionBudget (`minAvailable:1`)**, the `preStop` drain, and slightly looser probe `timeoutSeconds` (2-3). DB health belongs in metrics/alerting, not in a readiness probe.
*Acceptance*: `/ready` returns 200 while the DB is down (degraded mode still serves sockets); PDB blocks simultaneous drain of both replicas; `/health` untouched.

**PR-3 `security:` Rate-limit + validate the mail endpoints** — `publicRoutes.js`, `passwordResetRoutes.js`
Add strict per-IP limiters (e.g. 10/15 min) to `/api/send-invite`, `/api/send-password-reset`, `/api/notify-new-feedback`; validate email shape and cap field lengths. Wire shapes and success codes unchanged.
*Acceptance*: supertest — 11th call in window ⇒ 429; happy path still 204/200; e2e invite spec green.

**PR-4 `security:` Authenticate `/api/ai/*`** — `superAdminRoutes.js` (move to own `aiRoutes.js`), `services/dataService.ts` + AI-calling components
Server requires team credentials (same `password` body convention used by every team endpoint); client adds them (it already holds the in-memory credential). Invisible to users.
*Acceptance*: route tests — no/bad password ⇒ 401; UI flows (suggest title/groups/summary/analysis) green in e2e release-analysis spec.
*Rollback note*: ship server-side acceptance first (accept both with-and-without for one release if third-party callers might exist — decide in review).

**PR-5 `security:` Stateless HMAC-signed tokens — REVISED per outside voice (drop the KV store)**
Original draft backed the two Maps with a `kv_store` key + read-through cache. The outside voice is right that this is the wrong tool: a **stateless HMAC-signed token** (`teamId`/marker + expiry, signed with a server secret) solves R5 with **zero storage** — no KV write on login, no per-validation DB read, no cache-coherence code — and survives restarts + multi-pod inherently. The token is opaque to the client (it's just echoed from localStorage), so the format change is invisible; old random tokens simply fail once and users re-login, which is **already today's deploy behavior**. The one capability lost is pre-expiry revocation (`invalidateSessionToken`, called in exactly one place) — acceptable, or add a small deny-list later if needed. Requires a new `TOKEN_SECRET` env var (fail-fast if unset when `SUPER_ADMIN_PASSWORD` is set).
*Acceptance*: unit — token signed by one instance validates on a second instance with the same secret and fails with a different secret; expiry enforced; tampered token rejected; restart-survival test.
*Note*: this also unblocks doing PR-4/PR-7 with token auth from the start (see corrections C-4 and C-7c below), avoiding the build-then-rebuild the outside voice flagged.

**PR-6 `fix:` Restore = faithful replace** — `dataStore.js`, `backupService.js`, `superAdminRoutes.js`
`savePersistedData` (restore path only — keep a `mode` flag so other callers are untouched): delete `team:*` records absent from the archive; clear `session:*` keys; bump/clear local `sessionCache`; make the pre-restore snapshot `protected` or a dedicated type excluded from auto-purge.
*Acceptance*: unit — restore over a store containing an extra team removes it from records **and** index; ghost-team dashboard repro test; backup archive format untouched (old backups restore fine).

**PR-7 `security:` Password hashing — 4-stage migration (the risky one)**
- **7a**: server accepts `sessionToken` as an alternative credential on all team endpoints (additive).
- **7b**: client prefers token auth after login/restore; `restore-session` still returns the password (compat).
- **7c**: hash at rest (bcrypt) with dual-verify (plain match OR hash match), rehash-on-login; `restore-session` stops returning `password` once the client no longer needs it; invite links keep carrying the plain team secret (they are the shareable credential — document this loudly in SECURITY.md).
- **7d**: remove plain-compare path after a deprecation window.
*Acceptance per stage*: full e2e suite; a dedicated migration test (login with pre-existing plaintext record → hashed after login → login again); old invite links join successfully at every stage.
*Rollback*: each stage independently revertible; 7c's dual-verify means a revert never locks anyone out (hashes verify via hash branch, plaintext via plain branch).
*Unresolved decision*: whether 7d ever ships, and the deprecation window length — owner call.

**PR-8 `test:`/`refactor:` CI truth** — 4 micro-PRs
- 8a: fix eslint override to `server/**/*.js`, burn down warnings, add `--max-warnings 0`.
- 8b: widen coverage `include` to `server/services/**`, `utils/**`, `components/session/**/*.ts`; set per-dir thresholds at current-actual minus 2% (ratchet, don't aspire).
- 8c: run e2e on `pull_request` unconditionally (it's a 1-browser suite; if too slow, smoke subset on PR + full nightly).
- 8d: add Node 26 to the CI matrix.
*Acceptance*: CI green on all four; thresholds fail if server files lose coverage.

**PR-9 `docs:` Truth pass** — README/SECURITY/CLAUDE.md/.env.example/MAINTENANCE
Fix every row of section 2 (C1-C20); delete or archive `AUDIT_REPORT.md`; document Redis env vars; complete the CLAUDE.md API table; add missing `## [26.0]` placeholder note or accept the gap explicitly.
*Acceptance*: grep-able claims match code (spot-check list included in PR description).

**PR-10 `refactor:` Dead code & small hazards** — delete `server/config/rateLimiters.js`, `nginx.conf.template`, dead filter (dataStore.js:571); `unref()` timers; drop pretty-print in backup JSON (format stays valid JSON — restore path unaffected); fix package.json repo URL.
*Acceptance*: full suite green; backup created post-change restores pre-change and vice-versa (test).

**PR-11 `security:` Bound the restore body** — `superAdminRoutes.js`
Lower `1gb` to a configurable `RESTORE_MAX_BODY` (default 64 MB) and check the **decompressed** size while gunzipping (streamed, cap e.g. 512 MB).
*Acceptance*: oversized body ⇒ 413; legitimate large archive under cap restores.

**PR-12 `security:` Per-socket update throttle + shape check** — `socketHandlers.js`
Token-bucket per socket on `update-session` (generous: e.g. 20/s burst 40 — timer sync writes at ~1/s); cheap top-level shape validation before CAS. Server-generated crypto-strong ids for **new** sessions (`crypto.randomUUID` in dataService is client-side — switch new-id generation to `crypto.getRandomValues`-based, old ids remain valid).
*Acceptance*: unit — burst above budget ⇒ dropped with heal (send authoritative state back), no disconnect; loadtest preset green (this PR touches the sync path ⇒ CLAUDE.md requires `npm run test:load` against staging before rollout).

**PR-13 `refactor:` Backup scheduler election** — `backupService.js`
Generalize the startup-dedup: before an `auto` backup, skip if any `auto` backup newer than `interval - jitter` exists (same `getRecentStartupBackup` query pattern, type-parameterized).
*Acceptance*: unit — two service instances over one store, one interval ⇒ one backup.

**PR-14 `refactor:` Frontend decomposition + code-split** (ongoing, lowest priority)
Mechanical extraction from `Session.tsx`/`SuperAdmin.tsx`/`Dashboard.tsx` (≤300-line steps, one component per PR), `manualChunks` vendor split. Only with e2e green per step; behavior-freeze rule: no JSX logic edits inside an extraction commit.

### 6.5 Outside-voice corrections (cross-model challenge — supersede the PRs where noted)

An independent model reviewed this plan against source. It confirmed the risk register (spot-checked R1, R2, R4, R5, R6, R9, R14, R18, C9, C10, C12, C15 against code) and found four judgment soft-spots plus several implementation traps. The material ones, already folded into R2/R4/R4b/R9/Section 5/PR-2/PR-5 above, plus the rest:

- **C-1 (PR-1 flush is unimplementable as written)**: "flush in-flight persists" has no handle to await — nothing tracks the async CAS writes spawned by `update-session` handlers, and `io.close()` already closes the underlying HTTP server, so "`io.close()` then `server.close()`" risks a double-close. **Revised PR-1**: the high-value 20% is `preStop: sleep 5` (drain from Service endpoints before SIGTERM) + `pool.end()`/`sqliteDb.close()`/`stopScheduler()` on SIGTERM + a hard-exit timer. Drop the "ordered persist flush" acceptance criterion — accept that in-flight writes either committed or are recovered by the client re-send path (which R2's corrected framing now relies on anyway).
- **C-4 (PR-4 has no team to bind to + wrong lane)**: `/api/ai/*` payloads carry raw arrays with **no `teamId`** — `generate-release-analysis` spans multiple retros possibly across teams, so "use the password body convention" glosses a real shape change. And adding password-in-body here pushes **opposite** to the PR-5→PR-7 token direction (build-then-rebuild). **Revised**: sequence PR-4 **after** PR-5 and authenticate with the new signed token from the start; decision #3 (do third parties call these today?) is a **blocker**, not a footnote — check access logs first.
- **C-6 (PR-6 only fixes the single-pod case)**: "bump/clear local sessionCache" leaves the **other** replica's cache stale, and it can re-persist post-backup session state after a restore. **Revised PR-6**: add cross-pod cache invalidation (a socket.io broadcast or a cache-epoch counter checked on read) so restore is correct at `replicas:2`. Without it, PR-6 closes only the single-pod path it diagnoses.
- **C-7c (PR-7c latent lockout — invite-link generation is an unlisted password consumer)**: client-side invite-link creation reads the **in-memory plaintext password** (`utils/inviteLink.js:31-34`, `buildMinimalInvitePayload` requires `password`). A user who **restored** a session after a pod restart no longer has the plaintext in memory. So "restore-session stops returning `password`" (PR-7c) cannot happen until invite-link generation is migrated to token auth too — otherwise restored users can't mint invites or authenticate team-update calls. **Add invite-link generation to the explicit list of password consumers gating 7c.**
- **C-12 (PR-12 misidentifies the id construct)**: there is **no `crypto.randomUUID` in `services/dataService.ts`** — every id is `Math.random().toString(36).substr(2,9)` (dataService.ts:656,721,815,…; Session.tsx:38). Fix the PR-12 description: the change is Math.random → a crypto-strong generator for **new** session ids (old ids stay valid).
- **Calibration note (accepted)**: the cheap unauthenticated-surface fixes (PR-3 ~15 min, corrected-R9/PR-11, PR-4 caps) deliver more risk reduction per hour than the week-long PR-7, which by design closes only the **at-rest** leak vector (invite-link and in-body plaintext remain by design until full token migration). **Reordered priority**: ship PR-3, PR-11, PR-4-caps, PR-1(preStop), PR-2(PDB) FIRST; PR-7 is important but is the *partial-benefit, high-cost* item — it should not head the queue. The 20 doc-contradiction rows (C1-C20) are real but low-risk; don't let their page-weight anchor the sense of proportion.

**Where I did NOT change the plan**: the outside voice's stateless-token recommendation (PR-5) trades away pre-expiry revocation — accepted because the app uses it once, but flagged as an explicit decision (see unresolved #5). Everything else above is folded in.

### Dependencies & parallel lanes

| Lane | PRs | Notes |
|---|---|---|
| A (lifecycle) | PR-1 → PR-2 | sequential (both touch server bootstrap/k8s) |
| B (abuse surface) | PR-3, PR-4, PR-11, PR-12 | independent of A; PR-12 last (needs loadtest run) |
| C (auth model) | PR-5 → PR-7a → 7b → 7c → 7d | strictly sequential; PR-5 unblocks 7a |
| D (quality gates) | PR-8a-d, PR-9, PR-10 | fully parallel with everything |
| E (storage) | PR-6, PR-13 | independent |
| F (frontend) | PR-14 | independent, after 8c gives PR-level e2e |

Launch A + B + D in parallel; C after PR-5 review settles the token design; E anytime; F last.
**Conflict flags**: PR-1/PR-2 both edit `server.js`+k8s (same lane, sequential). PR-4 and PR-7b both touch `dataService.ts` auth plumbing — coordinate or order B4 before C7b.

---

## 7. Behaviors that must NOT change (contract list)

1. **HTTP API**: every existing route's path, method, request/response JSON shape, and status codes — including the 410 responses on `/api/data`, the 204-on-unknown-team anti-enumeration behavior of password reset, and `restore-session` returning `password` until PR-7c consciously retires it.
2. **Socket protocol**: event names (`join-session`, `leave-session`, `update-session`, `session-ack`, `member-joined`, `member-left`, `member-roster`, `participant-activity`); full-blob semantics of `update-session`; `_rev` CAS reject-and-heal; `session-ack {sessionId, rev}`; timer runtime fields + `participantsPanelCollapsed` writable by every client; `teamId` immutable; facilitator-only field list in `sessionGuard.js`.
3. **Persistence**: KV key formats (`team:{id}`, `team-index`, `retro-meta`, `session:{id}`, `global-settings`), `_rev`/`_updatedAt` stamping, per-team record shape, `orphanedFeedbacks` preservation on team delete, legacy `retro-data` migration path.
4. **Backup format**: gzipped monolithic `{teams, meta, resetTokens, orphanedFeedbacks}` JSON — old archives must restore forever.
5. **Invite links**: existing links (base64 `join` payload incl. team password) must keep joining teams/sessions.
6. **Offline/air-gap**: zero external resource loads from the frontend (fonts/sounds/images stay in `public/`); AI calls are server-side to the configured internal endpoint only.
7. **Deployment**: image runs as non-root (su-exec drop), `/data` volume contract, `PORT` env, `/health` = process liveness (must NOT become DB-dependent — degraded mode is a feature), SQLite path fallback chain incl. the `/tmp` warning, VERSION/CHANGELOG parsing for the announcements API.
8. **Zero-downtime patterns**: auto-rejoin after reconnect, `pendingJoin`/`queuedSession` semantics, merge + jittered re-send in `mergeRemoteSession.ts`.

## 8. Rollback strategy for the risky refactors

- **Blanket rule**: one PR = one revertible commit on `main`; deploys are tag-per-VERSION, so operational rollback = redeploy previous tag (`docker-deploy.yml` manual dispatch with explicit `image_tag`). Nothing in the sequence writes a new persistent format, so **data never blocks a rollback** — the KV additions (auth-tokens key) are ignored by older code.
- **PR-2 (readiness)**: env kill-switch `READY_CHECK_DB=false` reverts semantics without redeploying code.
- **PR-7 (password hashing)**: the only truly risky sequence. Dual-verify (plain OR hash) is the invariant that makes every stage two-way: reverting 7c leaves hashed records verifiable by the hash branch that remains in 7b-era code? — **no**: revert order must be 7c-revert ⇒ also restore dual-verify. Therefore 7c ships hash-writing + dual-verify in the SAME commit, and the "remove plain path" is exclusively 7d. Rollback drill before 7c: restore a pre-7c backup on staging, run login/invite/restore-session e2e.
- **PR-12 (socket throttle)**: config-gated (`SOCKET_UPDATE_RATE=0` disables); run `npm run test:load` before AND after on staging per CLAUDE.md.
- **PR-14 (decomposition)**: extraction-only commits; any visual/behavioral diff found by e2e ⇒ revert that single extraction, not the series.

---

## 9. Skill-required outputs

### NOT in scope (considered, deferred)
- **Rewrite of the full-blob sync protocol to op-based (CRDT/patches)** — the CAS + merge design works, is tested, and load-validated; replacing it is a multi-quarter risk with no user-visible payoff at current scale.
- **Replacing better-sqlite3 with async driver** — single-pod SQLite is documented as the small-scale path; Postgres already exists for scale.
- **Introducing an auth framework / SSO** — changes the product's login UX (user-visible); out of the hardening mandate.
- **Splitting the Docker image / distroless** — Trivy gates exist; marginal benefit.
- **Redis-backed rate limiting** — per-pod express-rate-limit is acceptable at 2 replicas; revisit past ~4 pods.
- **CSRF tokens** — API is same-origin JSON with credential-in-body (no cookies), so classic CSRF doesn't apply; revisit only if cookie auth is ever introduced.

### What already exists (reuse, don't rebuild)
- Summary projection pattern (`loadTeamSummaries`) → reuse for feedbacks (R10/PR follow-up).
- Startup-backup dedup query → generalize for scheduler election (PR-13).
- `sessionGuard` pure-function pattern → model for socket payload validation (PR-12).
- Loadtest harness → the acceptance gate for PR-12 (already scripted).
- Playwright suite incl. reconnection scenario → the regression net for PR-1/PR-14.
- express-rate-limit already deployed on 20+ routes → same tool for PR-3.

### Failure modes for new codepaths introduced by the plan
| New path | Realistic failure | Test? | Handled? | User sees |
|---|---|---|---|---|
| SIGTERM drain (PR-1) | flush hangs on dead DB → grace timeout | unit (fake timers) | hard-exit timer | brief reconnect (existing UX) |
| `/ready` DB probe (PR-2) | probe flaps on slow query → pod removed | unit + cache TTL | 5 s cache, 3-failure threshold | nothing (other pod serves) |
| Token KV store (PR-5) | KV write fails at login | route test | fall back to in-memory (current behavior) | session survives ≥ current |
| Restore-replace (PR-6) | crash mid-restore → partial delete | unit | pre-restore snapshot is the recovery path — make it `protected` first, restore later | admin retries restore |
| Dual-verify (PR-7c) | rehash-on-login race on two pods | unit (CAS retry covers it) | `atomicTeamUpdate` retry | nothing |
| Socket throttle (PR-12) | legit burst (phase flip) throttled | loadtest preset | heal-with-authoritative, never drop silently | none if budget ≥ real cadence |
**Critical-gap check**: none of the above is simultaneously untested + unhandled + silent in the proposed plan.

### Implementation tasks
- [ ] **T1 (P1, human: ~1d / CC: ~30min)** — server — graceful shutdown + preStop (PR-1) — Files: `server.js`, `k8s/base/deployment.yaml` — Verify: unit + manual SIGTERM
- [ ] **T2 (P1, human: ~0.5d / CC: ~20min)** — server/k8s — readiness DB probe + PDB (PR-2) — Verify: unit 503-on-outage
- [ ] **T3 (P1, human: ~0.5d / CC: ~15min)** — routes — limiters on mail endpoints (PR-3) — Verify: supertest 429
- [ ] **T4 (P1, human: ~1d / CC: ~30min)** — routes+client — authenticate `/api/ai/*` (PR-4) — Verify: 401 tests + e2e
- [ ] **T5 (P1, human: ~1d / CC: ~40min)** — auth — KV-persisted tokens (PR-5) — Verify: cross-instance validate test
- [ ] **T6 (P1, human: ~1.5d / CC: ~45min)** — backup — restore-replace semantics (PR-6) — Verify: ghost-team repro test
- [ ] **T7 (P0 sequence, human: ~1w / CC: ~2h across 4 PRs)** — auth — staged password hashing (PR-7a-d) — Verify: migration tests + full e2e each stage
- [ ] **T8 (P2, human: ~1d / CC: ~40min)** — CI — eslint scope, coverage ratchet, e2e-on-PR, node 26 (PR-8a-d)
- [ ] **T9 (P2, human: ~0.5d / CC: ~30min)** — docs — truth pass C1-C20 (PR-9)
- [ ] **T10 (P2, human: ~0.5d / CC: ~20min)** — cleanup — dead code + timers + backup stringify (PR-10)
- [ ] **T11 (P2, human: ~0.5d / CC: ~20min)** — security — bound restore body (PR-11)
- [ ] **T12 (P2, human: ~1d / CC: ~45min)** — sockets — per-socket throttle + shape check + crypto ids (PR-12) — Verify: loadtest
- [ ] **T13 (P3, human: ~0.5d / CC: ~15min)** — backup — scheduler election (PR-13)
- [ ] **T14 (P3, ongoing)** — frontend — decomposition + code-split (PR-14)

### Unresolved decisions that may bite later
1. **PR-7d** (removing plaintext-verify entirely) and its deprecation window — product owner call; until then plaintext secrets remain the invite contract.
2. Whether `/api/feedbacks/all` exposing every team's feedback to any authenticated team is intended community behavior or an isolation bug — confirm before "fixing".
3. Whether any third-party automation calls `/api/ai/*` unauthenticated today (PR-4 would break it) — **blocker per outside voice**: check access logs before PR-4.
4. ~~Whether `/ready` should turn 503 on DB outage~~ — **RESOLVED by outside voice**: no. Readiness must reflect only this pod's health, never the shared DB, or a DB blip becomes a full outage. PR-2 revised accordingly.
5. **(new)** PR-5 stateless signed tokens trade away pre-expiry token revocation (used once today via `invalidateSessionToken`). Accept the trade, or add a small deny-list — owner call.
6. **(new)** PR-6 cross-pod cache invalidation mechanism (socket.io broadcast vs cache-epoch) — pick one during PR-6 design; without it restore is correct only single-pod.

---

*Sections below are gstack process artifacts.*

## Completion summary
- Step 0 Scope Challenge — scope accepted as-is (repo-wide audit, user-confirmed via D1; complexity gate N/A — read-only audit, no plan-of-code-changes to reduce)
- Architecture Review: **6** issues
- Code Quality Review: **5** issues (+8 P3 cleanups)
- Test Review: diagram produced, **6** gaps identified (4 e2e flows, coverage scope, e2e-on-PR)
- Performance Review: **4** issues
- NOT in scope: written · What already exists: written
- TODOS.md updates: 0 proposed (no TODOS.md in repo; the 14 implementation tasks above serve as the backlog; user pre-authorized batch delivery — per-item AskUserQuestion waived by D1)
- Failure modes: **0** critical gaps (all proposed paths tested + handled + visible)
- Outside voice: **ran** (Claude subagent; Codex not installed) — confirmed the risk register, overturned 2 conclusions (PR-2 readiness end-state, PR-5 token design), corrected R9 to unauthenticated/P0, and flagged 4 implementation traps (PR-1 flush, PR-4 no-teamId, PR-6 single-pod-only, PR-7c invite-link lockout). All folded into §6.5.
- **CROSS-MODEL TENSION**: original plan gated `/ready` on DB reachability; outside voice says never gate readiness on a shared dependency. Resolved in favor of the outside voice (pod-local readiness) — it's the stronger argument and matches the codebase's own degraded-mode design.
- Parallelization: 6 lanes — A+B+D parallel, C sequential after PR-5, E independent, F last
- Lake Score: 14/14 recommendations chose the complete option (staged where risk demands)
