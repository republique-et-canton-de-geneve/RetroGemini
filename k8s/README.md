# Kubernetes / OpenShift Deployment Guide

## Table of contents

1. [Quick start](#quick-start)
2. [Project structure](#project-structure)
3. [Secrets configuration](#secrets-configuration)
4. [PostgreSQL management](#postgresql-management)
5. [Troubleshooting](#troubleshooting)
6. [Cleanup](#cleanup)

---

## Quick start

### Kubernetes

```bash
# 1. Create namespace
kubectl create namespace retrogemini

# 2. Create secrets FIRST (see "Secrets configuration" below)
kubectl -n retrogemini create secret generic retrogemini-super-admin \
  --from-literal=POSTGRES_DB=retrogemini \
  --from-literal=POSTGRES_HOST=postgresql \
  --from-literal=POSTGRES_USER=retrogemini \
  --from-literal=POSTGRES_PASSWORD='<your-password>' \
  --from-literal=SUPER_ADMIN_PASSWORD='<your-admin-password>'

# 3. Deploy application
kubectl apply -k k8s/base -n retrogemini
```

Access at http://localhost:30080 (NodePort).

### OpenShift

```bash
# 1. Create project
oc new-project retrogemini

# 2. Create secrets FIRST (see "Secrets configuration" below)
oc create secret generic retrogemini-super-admin \
  --from-literal=POSTGRES_DB=retrogemini \
  --from-literal=POSTGRES_HOST=postgresql \
  --from-literal=POSTGRES_USER=retrogemini \
  --from-literal=POSTGRES_PASSWORD='<your-password>' \
  --from-literal=SUPER_ADMIN_PASSWORD='<your-admin-password>'

# 3. Deploy application
oc apply -k k8s/base
oc apply -k k8s/overlays/openshift
```

The OpenShift overlay uses the Red Hat PostgreSQL image and creates a Route.

---

## Project structure

```
k8s/
├── base/                    # Main manifests (safe to apply repeatedly)
├── overlays/openshift/      # OpenShift-specific patches
└── secrets-templates/       # Example files - NOT applied automatically
    ├── postgresql-secret.yaml.example
    └── smtp-secret.yaml.example
```

> **Important**: Secrets are excluded from `kustomization.yaml`.
> You can run `kubectl apply -k k8s/base` as many times as needed without overwriting your secrets.

---

## Secrets configuration

### PostgreSQL credentials

> **CRITICAL: Create secrets BEFORE first deployment!**
>
> PostgreSQL initializes credentials only once (when the volume is empty).
> Changing the Secret later will NOT update the database passwords.

**Linux/macOS:**
```bash
kubectl -n <namespace> create secret generic retrogemini-super-admin \
  --from-literal=POSTGRES_DB=retrogemini \
  --from-literal=POSTGRES_HOST=postgresql \
  --from-literal=POSTGRES_USER=retrogemini \
  --from-literal=POSTGRES_PASSWORD='<your-password>' \
  --from-literal=SUPER_ADMIN_PASSWORD='<your-admin-password>' \
  --dry-run=client -o yaml | kubectl apply -f -
```

**Windows CMD:**
```bat
kubectl -n <namespace> create secret generic retrogemini-super-admin ^
  --from-literal=POSTGRES_DB=retrogemini ^
  --from-literal=POSTGRES_HOST=postgresql ^
  --from-literal=POSTGRES_USER=retrogemini ^
  --from-literal=POSTGRES_PASSWORD="<your-password>" ^
  --from-literal=SUPER_ADMIN_PASSWORD="<your-admin-password>" ^
  --dry-run=client -o yaml | kubectl apply -f -
```

### SMTP (optional)

Email enables invite links and password reset. Skip this if you don't need email.

```bash
kubectl -n <namespace> create secret generic retrogemini-smtp \
  --from-literal=SMTP_HOST='smtp.example.com' \
  --from-literal=SMTP_PORT='587' \
  --from-literal=SMTP_SECURE='false' \
  --from-literal=SMTP_USER='your-username' \
  --from-literal=SMTP_PASS='your-password' \
  --from-literal=FROM_EMAIL='noreply@example.com'
```

See the main [README.md](../README.md#configuration) for SMTP variable details.

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

**Automated backups:** See `k8s/secrets-templates/` for a CronJob example (coming soon).

### Changing passwords after deployment

**Option A: Fresh start (loses data)**
```bash
kubectl -n <namespace> delete pvc retrogemini-postgresql-data
# Update secret, then restart
kubectl rollout restart deployment/postgresql-retrogemini
```

**Option B: Keep data**
```bash
# 1. Change password in database
kubectl exec -it deployment/postgresql-retrogemini -- \
  psql -U retrogemini -c "ALTER USER retrogemini WITH PASSWORD '<new-password>';"

# 2. Update the Secret to match (see command above)

# 3. Restart application
kubectl rollout restart deployment/retrogemini
```

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
See [Changing passwords after deployment](#changing-passwords-after-deployment).

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
