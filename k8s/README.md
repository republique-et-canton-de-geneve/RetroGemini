# Kubernetes / OpenShift Deployment Guide

## Table of contents

1. [Deployment workflow](#deployment-workflow)
2. [Quick start](#quick-start)
   - [Kubernetes](#kubernetes)
   - [OpenShift](#openshift)
   - [Using a private registry](#using-a-private-registry-nexus-harbor-etc)
3. [Project structure](#project-structure)
4. [Secrets reference](#secrets-reference)
5. [PostgreSQL management](#postgresql-management)
6. [Troubleshooting](#troubleshooting)
7. [Cleanup](#cleanup)

---

## Deployment workflow

The deployment follows a **specific order** to ensure secrets are created before the application needs them:

```
1. Create namespace
2. Edit secret files with your FINAL values
3. Apply secrets (FIRST TIME ONLY)
4. Deploy base + overlays (can be repeated safely)
```

> **CRITICAL**: PostgreSQL initializes passwords **once** when the volume is created.
> You **cannot change passwords later** by simply updating the Secret.
> Always set your **final production values** before applying secrets.

> **Key point**: Secrets are **separated** from the main kustomization.
> Running `kubectl apply -k k8s/base` multiple times will **never overwrite your secrets**.

---

## Quick start

### Kubernetes

```bash
# 1. Create namespace
kubectl create namespace retrogemini

# 2. Edit secrets with your FINAL values (passwords cannot be changed later!)
nano k8s/secrets-templates/postgresql-secret.yaml

# 3. Apply secrets (only needed once - values are permanent)
kubectl apply -f k8s/secrets-templates/postgresql-secret.yaml -n retrogemini
kubectl apply -f k8s/secrets-templates/smtp-secret.yaml -n retrogemini  # optional
kubectl apply -f k8s/secrets-templates/wifi-secret.yaml -n retrogemini  # optional

# 4. Public URL (only once; needed for password-reset email - see below)
kubectl create configmap retrogemini-config -n retrogemini \
  --from-literal=PUBLIC_BASE_URL="https://retro.example.org/"

# 5. Deploy application
kubectl apply -k k8s/base -n retrogemini
```

Access at http://localhost:30080 (NodePort).

### OpenShift

```bash
# 1. Create project
oc new-project retrogemini

# 2. Edit secrets with your FINAL values (passwords cannot be changed later!)
nano k8s/secrets-templates/postgresql-secret.yaml

# 3. Apply secrets (only needed once - values are permanent)
oc apply -f k8s/secrets-templates/postgresql-secret.yaml
oc apply -f k8s/secrets-templates/smtp-secret.yaml  # optional
oc apply -f k8s/secrets-templates/wifi-secret.yaml  # optional

# 4. Deploy application
oc apply -k k8s/base
oc apply -k k8s/overlays/openshift

# 5. Public URL (only once, AFTER the Route exists - it reads the hostname
#    from the Route itself, so there is nothing to look up or type)
oc create configmap retrogemini-config \
  --from-literal=PUBLIC_BASE_URL="https://$(oc get route retrogemini-route -o jsonpath='{.spec.host}')/"
```

The OpenShift overlay uses the Red Hat PostgreSQL image and creates a Route.

### Using a private registry (Nexus, Harbor, etc.)

If you use a private container registry, update the deployment image after applying.

> **The container is named `container`, not `retrogemini`.** `set image` takes
> `<container>=<image>`, not `<deployment>=<image>`, and the container in
> `k8s/base/deployment.yaml` carries the OpenShift console's default name. Using
> the Deployment's name fails with
> `error: unable to find container named "retrogemini"`.

```bash
# OpenShift
oc set image deployment/retrogemini container=<your-registry>/jpfroud/retrogemini:27.32

# Kubernetes
kubectl set image deployment/retrogemini container=<your-registry>/jpfroud/retrogemini:27.32 -n retrogemini
```

To check the name rather than trust this document:

```bash
oc get deployment/retrogemini -o jsonpath='{.spec.template.spec.containers[*].name}'
```

`postgresql-retrogemini` uses the same container name, so retagging the database
image follows the same shape.

**This is an imperative change and it does not stick.** The image lives in
`k8s/base/deployment.yaml`, so the next `apply -k k8s/base` puts the manifest's
value back. `set image` is the right tool for a one-off retag; if your registry
is permanent, prefer a kustomize override so a re-apply cannot undo it:

```yaml
# in your own overlay's kustomization.yaml
images:
  - name: jpfroud/retrogemini
    newName: <your-registry>/jpfroud/retrogemini
```

---

## Project structure

```
k8s/
├── base/                    # Main manifests (safe to apply repeatedly)
├── overlays/openshift/      # OpenShift-specific patches (Route, RHEL PostgreSQL image)
├── config-templates/        # Non-secret per-environment values, applied ONCE
│   └── retrogemini-config.yaml  # PUBLIC_BASE_URL - your Route/Ingress URL
└── secrets-templates/       # Secret files to apply FIRST
    ├── postgresql-secret.yaml   # Required - has working defaults
    ├── smtp-secret.yaml         # Optional - email features
    └── wifi-secret.yaml         # Optional - Wi-Fi QR code in invite modal
```

### Why are secrets separate?

Secrets are **intentionally excluded** from `kustomization.yaml` to prevent accidental overwrites.

This means:
- You apply secrets **once** at first deployment
- You can run `kubectl apply -k k8s/base` as many times as needed
- Your secrets (and database passwords) remain untouched

`config-templates/` follows the same rule for values that are **per environment
but not secret** — today just `PUBLIC_BASE_URL`, whose value is your Route
hostname and therefore differs between dev and prod. (A **ConfigMap** is simply a
named bag of key/value settings stored in the cluster; the Deployment points at a
key and the platform injects it as an environment variable at container start. It
is the same idea as a Secret, minus the encryption-at-rest and the RBAC caution —
which is exactly right for a public URL.) The base manifest references
it with `optional: true`, so an environment that never creates the ConfigMap
still starts normally; it simply cannot send password-reset email.

---

## Secrets reference

### PostgreSQL credentials (required)

File: `k8s/secrets-templates/postgresql-secret.yaml`

```yaml
stringData:
  POSTGRES_DB: retrogemini
  POSTGRES_HOST: postgresql
  POSTGRES_USER: retrogemini
  POSTGRES_PASSWORD: change-me        # Update for production!
  SUPER_ADMIN_PASSWORD: change-me     # Update for production!
  SESSION_TOKEN_SECRET: change-me-to-a-long-random-secret  # Same value on every pod
```

`POSTGRES_PORT` is not in the Secret: it defaults to `5432` and the bundled
`postgresql` Service does not move it. Set it only if you point the application
at an external PostgreSQL on a non-standard port.

The application also accepts a set of **fallback aliases**, each consulted only
when its `POSTGRES_*` equivalent is unset. They differ in how much they can
actually do for you, so do not treat them as a way to skip the Secret:

- `POSTGRESQL_SERVICE_HOST` and `POSTGRESQL_SERVICE_PORT` **are** available to the
  application pod: Kubernetes injects `<SERVICE>_SERVICE_HOST` / `_SERVICE_PORT`
  for every Service in the namespace, and the bundled Service is named
  `postgresql`. Host and port therefore resolve on their own.
- `POSTGRESQL_USER`, `POSTGRESQL_PASSWORD` and `POSTGRESQL_DATABASE` are the Red
  Hat PostgreSQL image's own variable names, which
  `k8s/overlays/openshift/postgresql-image.patch.yaml` sets on the **database
  container**. They are *not* propagated to the application container, so they do
  nothing for the application in this topology — they exist for a deployment that
  sets them on the app pod itself.

**The credentials still have to come from the Secret.** Leaving `POSTGRES_USER` /
`POSTGRES_PASSWORD` / `POSTGRES_DB` unset and expecting OpenShift to supply them
gives you a connection failure, not a configuration-free binding.

> **CRITICAL**: PostgreSQL initializes credentials **only once** (when the volume is empty).
> Changing the Secret later will **NOT** update the database passwords.
> **Always edit this file with your final values BEFORE applying.**

`SESSION_TOKEN_SECRET` signs team and super-admin session tokens and the invite
credentials embedded in invite links. Keep the same value across all pods so
browser sessions and newly minted invite links survive rolling updates and
non-sticky routing. Existing deployments without this key still start because
the application falls back to a process-local random secret, but tokens and new
invite links will not survive restarts or non-sticky routing until a dedicated
secret is configured.

> **Treat this as required, not optional, for rolling updates.** The Socket.IO
> `join-session` handshake authenticates with the same token. Without a stable
> shared secret, a participant whose socket lands on a restarted or different
> pod has their automatic re-join refused and drops out of an in-progress
> retrospective — exactly the interruption rolling updates are meant to avoid.

If you need to change passwords after deployment, see [Changing secrets after deployment](#changing-secrets-after-deployment).

### SMTP (optional)

File: `k8s/secrets-templates/smtp-secret.yaml`

Email enables invite links and password reset. Skip this if you don't need email features.

```yaml
stringData:
  SMTP_HOST: ""              # Empty = email disabled
  SMTP_PORT: "587"
  SMTP_SECURE: "false"
  SMTP_USER: ""
  SMTP_PASS: ""
  FROM_EMAIL: ""
```

See the main [README.md](../README.md#configuration) for SMTP variable details.

### Wi-Fi QR code (optional)

File: `k8s/secrets-templates/wifi-secret.yaml`

For air-gapped or internal deployments where participants must join a specific Wi-Fi network to access the application. When configured, a "WI-FI" tab appears in the invite modal with a scannable QR code.

```yaml
stringData:
  WIFI_SSID: ""                # Network name (empty = feature disabled)
  WIFI_PASSWORD: ""            # Network password
```

---

## PostgreSQL management

### Backups

**Manual backup:**
```bash
kubectl exec deployment/postgresql-retrogemini -- \
  pg_dump -U retrogemini retrogemini > backup_$(date +%Y%m%d).sql
```

**Restore:**
```bash
kubectl exec -i deployment/postgresql-retrogemini -- \
  psql -U retrogemini retrogemini < backup_YYYYMMDD.sql
```

### Changing secrets after deployment

If PostgreSQL has already initialized (data exists in the volume), changing the Kubernetes Secret alone won't update the database password.

**Option A: Fresh start (loses data)**
```bash
kubectl -n retrogemini delete pvc retrogemini-postgresql-data
# Update secret, then restart
kubectl rollout restart deployment/postgresql-retrogemini
```

**Option B: Keep data**
```bash
# 1. Change password in database
kubectl exec -it deployment/postgresql-retrogemini -- \
  psql -U retrogemini -c "ALTER USER retrogemini WITH PASSWORD 'new-password';"

# 2. Update the Secret to match

# 3. Restart application
kubectl rollout restart deployment/retrogemini
```

---

## Automated backups

RetroGemini includes an automatic server-side backup system that creates compressed snapshots of all data. Backups are stored in the PostgreSQL database (in a dedicated `backups` table), so they work seamlessly with multi-pod deployments — no extra PVC required.

### How it works

- **Startup backup**: A snapshot is created each time the server starts (before a new version runs)
- **Scheduled backups**: Automatic backups run at a configurable interval (default: every 24 hours)
- **Manual checkpoints**: Named snapshots can be created from the super admin panel
- **Retention**: Old automatic backups are pruned when the limit is reached; protected backups are kept
- **Restore**: Any backup can be restored from the super admin panel (a pre-restore snapshot is created automatically)

### Configuration

These environment variables are set directly in `deployment.yaml` (not in secrets — safe to re-apply):

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_ENABLED` | `true` | Enable automatic backups |
| `BACKUP_INTERVAL_HOURS` | `24` | Hours between automatic backups |
| `BACKUP_MAX_COUNT` | `7` | Max automatic backups to keep |
| `BACKUP_ON_STARTUP` | `true` | Create backup when server starts |
| `RESTORE_MAX_BODY_MB` | `128` | Max compressed/uploaded restore archive size in MB |
| `RESTORE_MAX_DECOMPRESSED_MB` | `512` | Max decompressed restore archive size in MB |

### Multi-pod support

The deployment uses 2 replicas by default for zero-downtime rolling updates. Since backups are stored in PostgreSQL, all pods can read and write backups without volume conflicts. Startup backups are deduplicated (skipped if one was created within 5 minutes).

Cross-pod Socket.IO traffic needs no extra component here: when PostgreSQL is the
data store, the PostgreSQL Socket.IO adapter is selected automatically. That is
why the manifests deploy no Redis and set no `REDIS_URL` / `REDIS_HOST` /
`REDIS_PORT` / `REDIS_PASSWORD` — configure those only if you prefer to run the
Redis adapter instead.

---

## Scaling & performance tuning

These environment variables tune performance for larger deployments. They are set directly in `deployment.yaml` with the **built-in code defaults**, so you can deploy as-is and adjust per environment (dev / prod / openshift) as you grow. All are optional — the app runs fine without setting any of them.

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_RATE_LIMIT_MAX` | `5` | **Rejected** team-create / restore-session credentials per IP per 15 minutes, counted **per pod** (see below). Only `401` responses count, so no amount of ordinary use can consume the budget |
| `PG_POOL_MAX` | `10` | Max PostgreSQL connections **per pod** |
| `SESSION_CACHE_MAX` | `500` | Max live sessions cached in memory per pod (bounds memory only; session state is always recoverable from the database) |
| `SOCKET_MAX_BUFFER_SIZE` | `1000000` | Max Socket.IO message size in bytes (caps a single session update) |
| `SOCKET_UPDATE_RATE` | `0` (disabled) | Sustained `update-session` writes/second allowed per socket (token bucket). Enabling it is capacity-sensitive — load-test at your real cadence first. Throttled writes are healed, not dropped |
| `SOCKET_UPDATE_BURST` | `2 × rate` | Momentary burst of `update-session` writes allowed above `SOCKET_UPDATE_RATE` |
| `LAST_CONNECTION_DEBOUNCE_MS` | `300000` | Min interval (ms) between `lastConnectionDate` refreshes on participant join (avoids a write storm when a whole session reconnects) |
| `ROSTER_BROADCAST_DEBOUNCE_MS` | `250` | Debounce window (ms) for coalescing session-roster rebroadcasts. Caps a reconnect stampede to one rebuild + broadcast per room per window instead of one cross-pod `fetchSockets()` + broadcast per join. Never drops a user action; set to `0` for synchronous broadcasts |

### Behind an Ingress or Route

Two settings are left at their defaults in `deployment.yaml` because the correct
value depends on your cluster's edge:

- `TRUST_PROXY` defaults to `1` in production, which is what an Ingress or an
  OpenShift Route needs — the per-IP rate limiters read the client address
  through it, so a wrong value meters either everybody as one client or nobody.
  Raise it only if you add another proxy hop in front.
- `CORS_ORIGIN` defaults to `*`, i.e. Socket.IO accepts any origin. Set it to
  your Ingress/Route origin (for example `https://retro.example.org`) once the
  hostname is fixed.
- `PUBLIC_BASE_URL` comes from the `retrogemini-config` ConfigMap, which you
  create **once per environment** (step 5 of the Quick start). **Password-reset
  email does not work until you do.** `/api/send-password-reset` is anonymous and
  its mail carries a *live reset token* to a facilitator who did not ask for it;
  with no configured origin the only candidate left is the request's `Host`
  header, which that same anonymous caller controls. An edge that forwards an
  arbitrary `Host` — a default virtual host, or anyone able to reach the pod
  directly inside the cluster — could otherwise have the deployment mail a
  working token to a host they own. So the route answers
  `501 public_base_url_not_configured` instead, and the UI tells the user to
  contact their administrator.

  The command reads the hostname from the Route, so there is nothing to look up:

  ```bash
  oc create configmap retrogemini-config \
    --from-literal=PUBLIC_BASE_URL="https://$(oc get route retrogemini-route -o jsonpath='{.spec.host}')/"
  ```

  **Leaving it unset is a legitimate choice for a dev project** that does not send
  reset email: the base manifest marks the reference `optional: true`, so the pods
  start normally without it and every other feature — invitations, login, live
  sessions — is unaffected.

  **To change it later**, replace the ConfigMap and restart the Deployment. A
  ConfigMap consumed as an environment variable is read at container start, so an
  edit alone changes nothing until the pods roll:

  ```bash
  oc delete configmap retrogemini-config
  oc create configmap retrogemini-config \
    --from-literal=PUBLIC_BASE_URL="https://$(oc get route retrogemini-route -o jsonpath='{.spec.host}')/"
  oc rollout restart deployment/retrogemini
  ```

  Invitations keep working without it: that endpoint requires a team credential
  and the link it mails carries one the caller already holds, so it falls back to
  the origin the request arrived on. Setting `PUBLIC_BASE_URL` pins it too.

### What `AUTH_RATE_LIMIT_MAX` actually counts

**It cannot lock out a legitimate user.** The meter only counts `401` responses —
a session token or team credential that was *rejected*. Everything a real person
does returns something else and is ignored: a restored session (`200`), a page
load with no stored token (`400`), a team deleted since (`404`), a facilitator
colliding on an existing team name (`409`). So reloading the application a hundred
times in a row costs nothing against the budget.

This matters more than it looks: `/api/team/restore-session` runs on **every page
load** for anyone with a saved session. When the limiter counted every request,
five reloads from a single office egress address were enough to lock people out of
a retrospective already in progress, for fifteen minutes.

What stays metered is the anonymous prober guessing tokens, where each guess costs
a data-store read. That is the property the limiter exists for.

Two consequences worth knowing:

- **It is per pod.** `express-rate-limit` has no shared store, so `N` replicas
  admit up to `N × AUTH_RATE_LIMIT_MAX` *failures* per window — 10 rather than 5 at
  the default 2 replicas. For a hard cluster-wide ceiling, enforce it at the
  Ingress/Route or WAF, or give the limiter a Redis store; the application ships
  neither today.
- **The super-admin panel is separate.** `/api/super-admin/verify` has its own
  limiter, fixed at 5 wrong passwords per 15 minutes and not affected by this
  variable. It is scoped to `401` in the same way, so signing in successfully
  several times never locks the panel.

### The connection-budget rule (`PG_POOL_MAX`)

`PG_POOL_MAX` is **per pod**, so total connections to PostgreSQL are `replicas × PG_POOL_MAX`. Keep that comfortably below the database's `max_connections` (the bundled `postgres:15-alpine` defaults to **100**), leaving headroom for admin/monitoring connections.

- Current default: 2 replicas × 10 = **20** connections — plenty of headroom.
- If you scale up to handle more teams, size it together with the replica count, e.g. 6 replicas × 12 = 72 (still under 100). If you need to go higher, raise the database's `max_connections` too.

`SESSION_CACHE_MAX` only bounds per-pod memory; at ~20-30 parallel retrospectives you will never approach 500, so the default is safe with the current pod memory limits.

---

## Troubleshooting

### PostgreSQL pod stuck in Pending

Check storage class and PVC:
```bash
kubectl -n retrogemini get storageclass
kubectl -n retrogemini describe pvc retrogemini-postgresql-data
```

### PostgreSQL crash loop after changing secrets

If you changed the Secret after PostgreSQL was initialized, the passwords don't match.
See [Changing secrets after deployment](#changing-secrets-after-deployment).

### Pod rejected at admission ("unable to validate against any SCC")

`k8s/base/deployment.yaml` runs the pod as UID/GID **1000** with `runAsNonRoot`,
a `RuntimeDefault` seccomp profile, `allowPrivilegeEscalation: false` and all
Linux capabilities dropped. That is what a plain Kubernetes cluster needs, since
it enforces nothing by itself.

**On OpenShift, apply the `openshift` overlay, not `base`.** The restricted SCC
allocates each project its own UID range and refuses a pod that names a UID
outside it, so the overlay deletes `runAsUser`, `runAsGroup` and `fsGroup` and
lets the platform assign them. Everything else in the context stays and already
satisfies `restricted-v2`.

If you apply `base` directly on OpenShift and the pod never starts, this is why:

```bash
oc -n retrogemini get events --field-selector reason=FailedCreate
oc apply -k k8s/overlays/openshift   # the supported path
```

The application image itself needs no root: `docker-entrypoint.sh` only becomes
root to `chown` a mounted `/data` volume, which this Deployment does not have
(it runs on PostgreSQL), and it skips that step when it is already non-root.

### App deployment stuck in Progressing

```bash
kubectl -n retrogemini describe pod -l app=retrogemini
kubectl -n retrogemini logs -l app=retrogemini --all-containers
```

---

## Cleanup

```bash
# Kubernetes
kubectl -n retrogemini delete -k k8s/base

# OpenShift
oc delete -k k8s/overlays/openshift
oc delete -k k8s/base
```
