# Docker & Deployment

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


### Configuration Parity
When adding, removing, or changing an environment variable, keep all deployment
surfaces aligned in the same change:
- `.env.example` for local/self-hosted configuration examples
- `README.md` and the Environment Variables list of this file (`docs/agents/deployment.md`)
- `k8s/base/deployment.yaml` for non-secret/default runtime values
- `k8s/secrets-templates/*.yaml` for secret-backed values
- `k8s/README.md` for Kubernetes/OpenShift operator guidance

A change that opens a **port** or a **network path** has one more surface:
`k8s/base/networkpolicy.yaml`, since the namespace denies ingress by default.

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
Deployment) — and, since H40/H46, the platform posture described below.

### Platform manifests (audit H40, H46)

Three rules that look like details and are not. Each one, got wrong, produces a
**silent** failure: a database that starts empty, a pod the platform refuses, or
an application off the network with nothing in the logs that names the cause.

- **The database's `runAsUser` belongs to its image, not to taste.**
  `postgres:15-alpine` creates its account with UID/GID **70**; the Debian
  variants use **999**. `initdb` calls `getpwuid()` and refuses a UID with no
  passwd entry, so changing the image without the UID stops the database from
  starting. The parity suite checks the pair. The UID is also what lets the
  container drop **all** capabilities: `docker-entrypoint.sh` re-execs through
  `gosu` when it starts as root, and `gosu` needs `CAP_SETUID`/`CAP_SETGID` —
  so `drop: [ALL]` and a root start cannot both be true.
- **`PGDATA` is a subdirectory of the mount, never the mount root.** An ext4
  PersistentVolume arrives with a `lost+found` at its root and `initdb` refuses
  a non-empty directory; `fsGroup` makes the root group-writable and `initdb`
  refuses that too. ⚠️ Changing this back — or forward, on a volume that already
  holds a cluster — makes PostgreSQL initialise an **empty** cluster beside the
  data. `k8s/README.md` → *Moving PGDATA on an existing volume* is the operator
  procedure; link it from any PR that touches the value.
- **The NetworkPolicies are opt-in and `apply -k` must not install them**
  (decision D21) — `k8s/base/kustomization.yaml` deliberately omits the file and
  a test asserts that absence. **A NetworkPolicy cannot deny anything:** the
  model is a union of allows, so a "default deny" works only by being the sole
  policy selecting a pod. The Geneva project carries two platform-applied
  allow-all policies, which made ours inert — proven with a probe, not assumed.
  Installing them there would be worse than installing nothing, because an
  auditor reads three policies and concludes the database is isolated. Before
  adding a policy anywhere, ask **"what NetworkPolicies already exist in this
  namespace, and what do they select?"** — a co-tenant workload is harmless, a
  co-tenant *policy* silently voids yours. They also restrict ingress only: a
  default-deny covering egress takes DNS out first, then SMTP, Redis and the LLM
  endpoint fail quietly one by one because each is optional.

- **TLS on an Ingress is two things, not one.** A `tls:` block offers HTTPS; on
  most controllers the same host keeps answering plain HTTP, so a password still
  crosses the network in clear text. `k8s/base/ingress.yaml` therefore also
  carries `nginx.ingress.kubernetes.io/ssl-redirect`, which is **ingress-nginx's
  and silently ignored by every other controller** — `k8s/README.md` → *TLS*
  lists the equivalents. Both halves are asserted.

**Verify manifest changes offline before landing them.** `kustomize` and
`kubeconform` are single binaries; `k8s/README.md` → *Validating the manifests
without a cluster* has the three commands. They catch a stale patch target and a
malformed policy. They cannot tell you whether the SCC admits the pod or whether
the CNI enforces a policy — those need a non-production project, and that
rollout is the standing item in `HARDENING_STATUS.md` §6 (lot L19b).

### Files to Include in Docker
The following files MUST be included in the Docker image (check `.dockerignore`):
- `VERSION` - For version API
- `CHANGELOG.md` - For announcement system
- `CHANGELOG.fr.md` - The French "What's New" (without it French readers silently get English)
- `server.js` - Backend
- `dist/` - Built frontend, with the `.gz` beside each compressible bundle file
  and `dist/.vite/manifest.json`, both written by `npm run build` (see
  *Compression and caching*). A missing manifest means nothing is served as
  immutable, which is safe; the runtime stage's `COPY --from=builder /app/dist`
  carries the dot-directory

`.dockerignore` leaves out `.claude/` and `.gstack/` (the lint, the unit run
and the coverage sweep skip `.claude/worktrees/` and `.gstack/`, *Before
Committing*, item 1), because the builder copies the whole context
(`COPY . .`):

- `.claude/worktrees/` holds whole checkouts of the repository, often older
  ones, and until 45.3 Tailwind's scan in the builder would have read their
  components: the scan skips what a `.gitignore` names, and the file that
  names them, the root `.gitignore`, is the one `.dockerignore` drops (its
  `.gitignore` pattern is anchored at the root). A directory's own
  `.gitignore` stays in the context, but a worktree's own copy of that file
  does not name its own components. Since 45.3 `index.css` keeps `.claude/`
  and `.gstack/` out of the scan itself, wherever the build runs (*The look*).
- `.gstack/` is gstack's state: its browser's access token (`browse.json`),
  its cookies and storage when session persistence is on
  (`session-state.json`), the logs of the pages and requests it made
  (`browse-*.log`, `browse-audit.jsonl`), and the probes and reports of `/qa`
  and `/review`. `COPY . .` would put all of it in the builder stage's layer.

`__tests__/deploymentManifestParity.test.ts` → *Docker build context
(.dockerignore)* reads the file as Docker does, through
`__tests__/helpers/dockerignore.ts` (a port of `moby/patternmatcher` v0.6.0):
the agents' directories stay out, and every file the Dockerfile copies from
the context stays in — `VERSION`, both changelogs, `server.js`, `server/`,
`utils/`, the entrypoint and `package*.json`. `dist/` comes from the
builder's own build.

### Environment Variables
See `README.md` for full list. Key ones:
- `PORT` - Server port (default: 3000)
- `DATABASE_URL` - PostgreSQL connection URL (if set, uses PostgreSQL instead of SQLite)
- `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` - the same connection as discrete values, used when `DATABASE_URL` is unset (what `k8s/base/deployment.yaml` supplies from the PostgreSQL Secret). Each has a fallback alias, consulted only when the `POSTGRES_*` value is unset, and they are **not** equally useful: `POSTGRESQL_SERVICE_HOST` / `POSTGRESQL_SERVICE_PORT` really do resolve on their own (Kubernetes injects `<SERVICE>_SERVICE_HOST`/`_SERVICE_PORT` for every Service in the namespace, and the bundled Service is named `postgresql`), whereas `POSTGRESQL_USER` / `POSTGRESQL_PASSWORD` / `POSTGRESQL_DATABASE` — the Red Hat PostgreSQL image's own names — are set by the OpenShift overlay on the **database container only** and never reach the application container. Credentials must still come from the Secret; do not document these as a way to skip it
- `DATA_STORE_PATH` - SQLite database path (used when DATABASE_URL is not set)
- `SUPER_ADMIN_PASSWORD` - Enable super admin panel
- `SESSION_TOKEN_SECRET` - Stable HMAC signing secret for team and super-admin session tokens **and invite-link credentials** (stage 7e); set the same value on every pod so tokens and newly minted invite links survive restarts and non-sticky routing (falls back to a process-local random secret when unset, in which case new invite links die with the process). **Effectively required for zero-downtime deployments**: `join-session` authenticates with the same token, so without a stable secret a rolling update or a non-sticky route makes every live participant's automatic re-join fail and drops them out of an in-progress session. **Required to store a team's Jira token**: the token is sealed with a key derived from this secret (`deriveKey('jira-token/v1')`), so without one — or with the templates' example value, `change-me-to-a-long-random-secret` or `change-me`, whose key is public (`canSealSecrets`; the pod logs a warning at startup) — the token route answers `503 jira_secret_unavailable`, and rotating it makes every team enter its token again (see *Jira*). Keep it in a secret store, never beside the database dumps: the two together open every team's token
- `SMTP_*` - Email configuration
- `NODE_EXTRA_CA_CERTS` - PEM file of additional trusted CAs, read by Node at process startup. Internal SMTP uses STARTTLS even when `SMTP_SECURE=false` (that flag selects implicit TLS); its corporate CA must be trusted too. OpenShift operators can opt into the cluster trust bundle with `k8s/config-templates/trusted-ca.yaml` and `trusted-ca.patch.yaml`, after verifying the required CA is in the injected bundle. Keep certificate verification enabled; restart the application pods after a bundle update. These templates stay outside the generic kustomizations because cluster trust injection is platform-specific. See `k8s/README.md` → *Internal SMTP certificates on OpenShift*.
- `BACKUP_ENABLED` - Enable automatic server-side backups (default: `true`)
- `BACKUP_INTERVAL_HOURS` - Hours between automatic backups (default: `24`); across multiple pods the scheduled `auto` backup is elected via the shared store (each pod skips if another already wrote an `auto` backup within the interval), so `N` pods produce one backup per interval instead of `N`
- `BACKUP_MAX_COUNT` - Max automatic backups to keep (default: `7`)
- `BACKUP_ON_STARTUP` - Create backup on server start (default: `true`)
- `RESTORE_MAX_BODY_MB` - Max compressed/uploaded super-admin restore or import archive size in MB (default: `128`); bounds both the uploaded whole-store restore and the Backups tab's file import, and the console checks a file against it before sending (`/backups/list` → `limits`)
- `RESTORE_MAX_DECOMPRESSED_MB` - Max decompressed restore or import archive size in MB, for uploaded and stored gzip restores and for imported files (default: `512`)
- `WIFI_SSID` - Wi-Fi network name; when set with `WIFI_PASSWORD`, shows a Wi-Fi QR code in the invite modal
- `WIFI_PASSWORD` - Wi-Fi password; both `WIFI_SSID` and `WIFI_PASSWORD` must be set to enable the feature. Served only to an authenticated team (audit H31) — `/api/wifi-config` is a POST requiring a team credential, so setting these does not publish the password to anyone who can reach the deployment
- `AUTH_RATE_LIMIT_MAX` - Max **rejected** `/api/team/create` and `/api/team/restore-session` credentials per IP per 15 minutes (default: `5`). The meter is scoped to `401` responses alone, so nothing a legitimate user does can consume it — a restored session, a page load with no stored token, a team deleted since, a facilitator colliding on an existing team name, a token a password change revoked (`401 session_revoked`, decision D3b: signature-valid, so no guess). This matters because `restore-session` runs on **every page load** for a returning user, so a request-counting limiter locked whole offices out of running retrospectives. It does **not** cover `/api/super-admin/verify`, which has its own separate limiter fixed at 5 wrong passwords per 15 minutes. Counted **per pod**: `express-rate-limit` runs without a shared store, so `N` replicas admit up to `N × AUTH_RATE_LIMIT_MAX` failures per window; a hard cluster-wide ceiling needs the Ingress/WAF or a Redis store
- `PG_POOL_MAX` - Max PostgreSQL connections per pod (default: `10`); raise for high concurrency, keep under `max_connections / pod count`
- `SESSION_CACHE_MAX` - Max live sessions held in each pod's bounded in-memory cache (default: `500`); only bounds memory since session state is always recoverable from the database
- `SESSION_CACHE_MAX_MB` - Max total size, in MB of session JSON (MiB of characters), of the same cache, beside the count (default: `32`; unset, blank, non-numeric or ≤ 0 reads as the default — there is no "off"). Least-recently-used sessions are evicted past it, never the one just written (it would read the database on every write, and a throttled write could not be healed). The sizes come from the store, which remembers the text length of every session object it parsed or wrote (`dataStore.sessionTextLength`), so the join and write paths pay no second serialization; only a copied or synthesized state (degraded mode) is measured with `JSON.stringify`. An evicted session is read from the database again, and during an outage falls into the documented no-baseline case
- `SOCKET_MAX_BUFFER_SIZE` - Max Socket.IO message size in bytes (default: `1000000`); caps a single client session-update payload
- `SOCKET_UPDATE_RATE` - Sustained `update-session` writes/second allowed per socket via a per-socket token bucket. **Off by default and deliberately off in `k8s/base/deployment.yaml`** (decision D17): this deployment is internal and not internet-facing, so the hostile client the throttle guards against does not exist here, while its cost — a heal round-trip on a legitimate burst — would be paid by real facilitators. Do not turn it on "to be safe". **Enable it when** the app becomes reachable beyond the internal network, or when a runaway client is actually observed saturating the DB write path: set `20` (timer sync is ~1/s per client, so that keeps an order of magnitude of headroom), roll to staging first, watch for heal round-trips. A throttled write is healed with the authoritative state and re-sent, never dropped, so too tight costs a round-trip rather than a user action
- `SOCKET_UPDATE_BURST` - Momentary burst of `update-session` writes allowed above `SOCKET_UPDATE_RATE` (default: `2 × rate`)
- `LAST_CONNECTION_DEBOUNCE_MS` - Minimum interval between refreshes of a team's `lastConnectionDate` on participant join (default: `300000`); prevents a write storm when a whole session reconnects after a rolling update. The refresh is decided again inside the team update, and shared by every join of one team on a pod (`createLastConnectionRefresher` in `socketHandlers.js`), so a burst of joins costs one team write across the cluster; a join reads the roster from the team summary (`loadTeamSummary`), and the full record only after a summary read has thrown (a row PostgreSQL's jsonb refuses, see *Team summaries* below)
- `ROSTER_BROADCAST_DEBOUNCE_MS` - Debounce window (ms) for coalescing session-roster rebroadcasts (default: `250`). Each join/leave otherwise triggers a cross-pod `fetchSockets()` + a full-roster broadcast, so a reconnect stampede is O(N²) messages and N cross-pod fetches; coalescing caps it to at most one rebuild + broadcast per room per window while the immediate `member-joined`/`member-left` signals still drive incremental UI. Unlike the update-session throttle it never drops or delays a user action (only a presence broadcast whose content is unchanged), so it is on by default. Set to `0` for the pre-optimization synchronous broadcast
- `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`) - Redis connection for the multi-pod Socket.IO adapter; when unset, the PostgreSQL adapter is used automatically if PostgreSQL is the data store (single-pod deployments need neither)
- `PUBLIC_BASE_URL` - Canonical public URL of the deployment, used to build the links the server mails. **The origin of a mailed link is always the server's own, never the caller's** (audit H4). **Required to send password-reset email:** that route is anonymous and its mail carries a *live token*, so with no configured origin the only candidate left is the request `Host` — which the same anonymous caller sets. Rather than trust it, `/api/send-password-reset` answers `501 public_base_url_not_configured` and mails nothing. `/api/send-invite` deliberately keeps the `Host` fallback: it is authenticated and the payload it mails is a credential the caller already holds, so a forged `Host` gains an attacker nothing, while failing closed would break invitations everywhere. When set, the configured value wins over the request for both routes (the caller keeps only the query) and a configured sub-path is preserved. On Kubernetes/OpenShift it is supplied per environment by the `retrogemini-config` ConfigMap (`k8s/config-templates/`, applied once like the Secrets so `apply -k` never overwrites it); `k8s/base/deployment.yaml` references it with `optional: true`, which must stay — without it an environment that has not created the ConfigMap could not start its pods at all, turning "no reset mail" into "no application"
- `PROXY_BASE_URL` - Optional second HTTPS public mount behind a reverse proxy. Only its exact configured request Host selects the public prefix, and the proxy strips that prefix once. Assets, API calls, Socket.IO paths, navigation and mailed links follow the server-rendered public base, while root access keeps working (`zero-downtime.md`)
- `LOG_FORMAT` - `json` or `text` (default: `json` when `NODE_ENV=production`, `text` otherwise). `json` emits **one line of JSON per log record** — timestamp, level, source, message and `correlationId` — which is what a cluster log aggregator can query; `text` keeps the human-readable console output. The id comes from `server/services/logContext.js`, an `AsyncLocalStorage` context mounted before every route and wrapped around every socket event, so a handler never mentions it and a message logged three awaits deep still names its request. An inbound `X-Request-Id` is adopted **only** when it matches `[A-Za-z0-9._-]{1,64}` — the header is caller-controlled, and while JSON encoding neutralises log injection, nothing else bounds a megabyte of junk being written by the platform's aggregator on every request. Secrets are blanked at that single choke point, before both stdout **and** the in-memory ring the super admin can export: by *value* for the ones the process holds (`SESSION_TOKEN_SECRET`, `SUPER_ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `SMTP_PASS`, `REDIS_PASSWORD`, `WIFI_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, and only values of 8+ characters, so a variable holding `true` cannot blank that word out of every line), and by *key pattern* for the ones it does not — the operator's LLM key lives in the database, so only the shape of the line gives it away. **`console.debug` reaches stdout only, never the ring**: one JSON line with `level: "debug"` in `json` mode (redacted like every other), the raw line in `text` mode. The per-write socket lines (`Session update from …`, `Broadcasting to …`) and the redundant reconnect lines (`Client connected`, `… now has N connected clients`, `Sending persisted/cached session state`) are debug: one accepted write wrote two info lines and one join four, so ten live retrospectives turned the 1000-entry ring over in about 25 seconds and a rolling update's reconnect wave filled it alone — right when the super admin opens the Logs tab to read that rollout's errors. One line per join, leave and disconnect stays at info. There is no `LOG_LEVEL`: the debug lines, with their correlation and session ids, are the per-write trail an investigation reads, and an aggregator configured to drop `level: debug` drops that trail
- `CORS_ORIGIN` - Restrict Socket.IO CORS to specific origin(s) (default: `*`)
- `TRUST_PROXY` - Express `trust proxy` setting for correct client IPs behind a reverse proxy; rate limiting relies on it (default: `1` in production, `false` otherwise)
