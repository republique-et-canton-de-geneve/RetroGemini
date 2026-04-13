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
kubectl apply -f k8s/secrets-templates/automation-secret.yaml -n retrogemini  # optional

# 4. Deploy application
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
oc apply -f k8s/secrets-templates/automation-secret.yaml  # optional

# 4. Deploy application
oc apply -k k8s/base
oc apply -k k8s/overlays/openshift
```

The OpenShift overlay uses the Red Hat PostgreSQL image and creates a Route.

### Using a private registry (Nexus, Harbor, etc.)

If you use a private container registry, update the deployment image after applying:

```bash
# OpenShift
oc set image deployment/retrogemini retrogemini=<your-registry>/jpfroud/retrogemini:3.1

# Kubernetes
kubectl set image deployment/retrogemini retrogemini=<your-registry>/jpfroud/retrogemini:3.1 -n retrogemini
```

---

## Project structure

```
k8s/
├── base/                    # Main manifests (safe to apply repeatedly)
├── overlays/openshift/      # OpenShift-specific patches
└── secrets-templates/       # Secret files to apply FIRST
    ├── postgresql-secret.yaml   # Required - has working defaults
    ├── smtp-secret.yaml         # Optional - email features
    ├── wifi-secret.yaml         # Optional - Wi-Fi QR code in invite modal
    └── automation-secret.yaml   # Optional - feedback automation GitHub dispatch
```

### Why are secrets separate?

Secrets are **intentionally excluded** from `kustomization.yaml` to prevent accidental overwrites.

This means:
- You apply secrets **once** at first deployment
- You can run `kubectl apply -k k8s/base` as many times as needed
- Your secrets (and database passwords) remain untouched

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
```

> **CRITICAL**: PostgreSQL initializes credentials **only once** (when the volume is empty).
> Changing the Secret later will **NOT** update the database passwords.
> **Always edit this file with your final values BEFORE applying.**

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

### Feedback automation dispatch (optional)

File: `k8s/secrets-templates/automation-secret.yaml`

Enable this only if you use feedback-to-GitHub automation.

```yaml
stringData:
  FEEDBACK_AUTOMATION_GITHUB_REPO: ""    # e.g. org/repo
  FEEDBACK_AUTOMATION_GITHUB_TOKEN: ""   # token for repository_dispatch
```

The deployment keeps automation disabled by default with:

- `FEEDBACK_AUTOMATION_ENABLED=false`
- `FEEDBACK_AUTOMATION_EVENT_TYPE=feedback_hub_submission`
- `FEEDBACK_AUTOMATION_MIN_TITLE_LENGTH=8`
- `FEEDBACK_AUTOMATION_MIN_DESCRIPTION_LENGTH=40`

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

### Multi-pod support

The deployment uses 2 replicas by default for zero-downtime rolling updates. Since backups are stored in PostgreSQL, all pods can read and write backups without volume conflicts. Startup backups are deduplicated (skipped if one was created within 5 minutes).

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
