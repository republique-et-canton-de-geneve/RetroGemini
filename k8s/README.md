# Kubernetes / OpenShift Deployment Guide

## Table of contents

1. [Deployment workflow](#deployment-workflow)
2. [Quick start](#quick-start)
   - [Kubernetes](#kubernetes)
   - [OpenShift](#openshift)
   - [Using a private registry](#using-a-private-registry-nexus-harbor-etc)
3. [Project structure](#project-structure)
4. [Secrets reference](#secrets-reference)
5. [Network policies](#network-policies)
6. [TLS](#tls)
   - [Upload size and timeouts](#upload-size-and-timeouts)
7. [PostgreSQL management](#postgresql-management)
   - [Reading the audit trail](#reading-the-audit-trail-who-did-that)
8. [Jira](#jira)
9. [Troubleshooting](#troubleshooting)
10. [Cleanup](#cleanup)

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

# 5. TLS certificate for the Ingress host (see "TLS" below)
kubectl create secret tls retrogemini-tls -n retrogemini \
  --cert=tls.crt --key=tls.key

# 6. Deploy application
kubectl apply -k k8s/base -n retrogemini
```

Access at `https://retrogemini.local/` — substitute your own hostname in
`k8s/base/ingress.yaml` first. A local cluster with no ingress controller can
use `kubectl apply -k k8s/overlays/nodeport` instead and reach
http://localhost:30080, but that path is plain HTTP and bypasses TLS: see
[TLS](#tls).

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

# 4. Deploy application (the OVERLAY, never `base` — see Troubleshooting)
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
├── overlays/nodeport/       # Opt-in NodePort for a local cluster with no ingress
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

It is also the root of the key that encrypts each team's **Jira token**: without
a stable value, or with the template's example value above, a team cannot save
one (`503 jira_secret_unavailable`; the example value is published, so its key
is too, and the pod logs a warning at startup), and changing the value makes
every stored Jira token unreadable — each team then enters its token again
([Jira](#jira)). Generate a long random value (for example
`openssl rand -base64 48`), and keep it in your secret store, never next to the
database dumps: a dump together with the secret opens every team's Jira token.

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

## Network policies

`k8s/base/networkpolicy.yaml` holds three `NetworkPolicy` objects (audit H46): a
namespace-wide default-deny on ingress, an allow to the application on 8080, and
PostgreSQL reachable on 5432 **from the application pods alone**.

> ⚠️ **They are opt-in and `apply -k` does not install them.** Read this whole
> section before applying the file by hand — on many clusters it will achieve
> nothing, and installing it there is worse than leaving it out.

### Why opt-in: a NetworkPolicy cannot deny anything

The model is a **union of allows**. Traffic is permitted as soon as *at least
one* policy permits it, and there is no construct that overrides an allow. A
"default deny" works only by being the **sole** policy selecting a pod — it
denies by adding no permission, not by subtracting one.

So one namespace-wide allow-all, applied by somebody else, makes every policy in
that file inert.

**That is what happened here (2026-08-26, decision D21).** The Geneva OpenShift
project this application runs in carries two such policies, applied by the
platform to every project:

```
expose-all-pod-from-outside      podSelector: {}   [Ingress]
discuss-within-same-namespace    podSelector: {}   [Ingress]
```

With all three of our policies installed and the CNI enforcing correctly, a
throwaway pod still reached PostgreSQL on 5432. Nothing was broken — and nothing
was protected. Removing those platform policies is the platform team's decision,
not the application's.

### Step 1 — can a policy do anything here at all?

```bash
kubectl -n retrogemini get networkpolicy \
  -o custom-columns=NAME:.metadata.name,SELECTOR:.spec.podSelector,TYPES:.spec.policyTypes
```

A `map[]` / `{}` selector on a policy you did not write means it selects **every
pod in the namespace**. Read its ingress rules. If it allows traffic broadly,
stop here: applying our file changes nothing, and three unnecessary
NetworkPolicies in the listing will mislead the next person who audits it.

### Step 2 — apply, then prove it

```bash
kubectl -n retrogemini apply -f k8s/base/networkpolicy.yaml
```

Then measure, rather than assume:

```bash
kubectl -n retrogemini run np-probe --restart=Never --image=busybox --command -- \
  sh -c 'nc -w 3 postgresql 5432 </dev/null && echo DB_REACHABLE || echo DB_BLOCKED;
         nc -w 3 retrogemini-service 8080 </dev/null && echo APP_REACHABLE || echo APP_BLOCKED'
kubectl -n retrogemini logs np-probe
kubectl -n retrogemini delete pod np-probe
```

| Result | Meaning |
|---|---|
| `DB_BLOCKED` + `APP_REACHABLE` | ✅ Working. The second line is the control: it proves DNS and pod networking are fine, so the first line is the policy and not a broken probe |
| `DB_REACHABLE` + `APP_REACHABLE` | The policies are inert — an allow-all exists (step 1), or the CNI does not enforce NetworkPolicy. **Delete them again** rather than leave decoration behind |
| `DB_BLOCKED` + `APP_BLOCKED` | Inconclusive: DNS or pod networking, not the policy |

`nc -z` does not exist in older BusyBox builds — it prints usage and never
connects, which reads as a pass if you are not careful. The form above works
everywhere.

To remove them again:

```bash
kubectl -n retrogemini delete -f k8s/base/networkpolicy.yaml
```

### Ingress only, on purpose

No policy here restricts egress, and adding one is separate work rather than a
one-line extension. A default-deny covering egress breaks the application in
ways that do not look like a network problem: DNS goes first, so the pod cannot
even resolve `postgresql`, and then SMTP (invitations, password resets), Redis
(the multi-pod Socket.IO adapter), the LLM endpoint and Jira each fail quietly,
because each of them is optional. An egress policy written later must allow the
Jira host (see [Jira](#jira)).

### Does your CNI enforce NetworkPolicy at all?

Calico, Cilium, OVN-Kubernetes and OpenShift SDN in policy mode do. Plain
flannel, and the older `openshift-ovs-subnet` / `openshift-ovs-multitenant`
plugins, accept the objects and ignore them. Step 2 answers this empirically
without needing cluster-scoped read access, which is the point of running it.

### Neither pod mounts a ServiceAccount token

Both Deployments set `automountServiceAccountToken: false` (CIS Kubernetes
5.1.5/5.1.6). Neither the application nor PostgreSQL calls the Kubernetes API,
so the token was a cluster credential sitting in the filesystem of a process
that had no use for it.

---

## TLS

**The base manifests do not terminate TLS for you.** `k8s/base/ingress.yaml`
declares a `tls:` block for `retrogemini.local` backed by a Secret named
`retrogemini-tls`, and both names are placeholders. Substitute your hostname and
create the Secret **before** applying — it is deliberately outside the
kustomization, for the same reason the credentials are:

```bash
kubectl -n retrogemini create secret tls retrogemini-tls \
  --cert=tls.crt --key=tls.key
```

⚠️ **A `tls:` block does not turn HTTP off.** It offers HTTPS; on most
controllers the same host keeps answering plain `http://`, so a link someone
types or is sent would still carry a team password in clear text. The Ingress
therefore also carries `nginx.ingress.kubernetes.io/ssl-redirect: "true"`.

**That annotation is ingress-nginx's and is silently ignored by other
controllers** — there is no portable spelling. If you run something else, set
its equivalent, or the redirect is simply absent:

| Controller | How to force the redirect |
|---|---|
| ingress-nginx | `nginx.ingress.kubernetes.io/ssl-redirect: "true"` (already set; it is also the default when the host has TLS) |
| Traefik | a `redirectScheme` Middleware, referenced from the Ingress |
| HAProxy | `haproxy.org/ssl-redirect: "true"` |
| Contour | an `HTTPProxy`, or `permitInsecure: false` |
| Istio | a `Gateway` with `tls.httpsRedirect: true` |

Check it, don't assume it:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://retrogemini.local/
# expect 308 (or 301) and an https:// location, never 200
```

**OpenShift needs none of this** — its Route sets
`insecureEdgeTerminationPolicy: Redirect`, which is the same guarantee, and the
Ingress above is unused there.

The base `Service` is a `ClusterIP`. It used to be a `NodePort` on 30080, which
is reachable on every node and bypasses the Ingress and its TLS termination
entirely — so a deployment that followed this guide served team passwords and
session tokens in clear text. A local cluster with no ingress controller
(minikube, kind, a bare k3s node) can still have the NodePort back, opt-in:

```bash
kubectl apply -k k8s/overlays/nodeport
```

**OpenShift does not use the Ingress.** `k8s/overlays/openshift/route.yaml`
creates a Route with edge termination and an HTTP→HTTPS redirect, which is
already the right answer there.

### Upload size and timeouts

Two super-admin routes take a whole backup file as their body:
`/api/super-admin/restore` (the console's *Restore Data* card) and
`/api/super-admin/backups/import` (the Backups tab's *Import a backup file*).
The application bounds them itself with `RESTORE_MAX_BODY_MB` (default 128) and
answers its own refusals as JSON. What sits in front of it has limits of its
own, and they are the operator's:

- **ingress-nginx refuses any body over 1 MiB** by default
  (`client_max_body_size`), and `k8s/base/ingress.yaml` sets no
  `proxy-body-size`. On the base manifest every real archive is refused with
  nginx's own HTML 413 before it reaches the application; the console says so
  ("The network in front of the server refused a file this large…") rather
  than blame the file.
- **The OpenShift Route has no body limit, but a 30 s timeout** by default. An
  internal-network upload of a few tens of MB fits easily. Raise it on the
  Route with `haproxy.router.openshift.io/timeout` (for example `120s`) if you
  import larger files. When the Route gives up first it answers 504 while the
  pod is still parsing and inserting: the console reads that as *uncertain*,
  reads the backups list again at once and 20 s later, and asks the admin to
  check the list before importing again. A retry that reaches the same pod
  while the first import still runs is refused (`409 import_in_progress`).

Do **not** raise the nginx limit host-wide. With request buffering on (its
default) ingress-nginx spools a whole body before proxying it, so a 128 MB
limit on `/` would let any anonymous caller make the controller spool 128 MB per
request to routes whose application limit is 1 MB. Raise it only on the two
paths, with a second Ingress for the same host — ingress-nginx merges the
Ingresses of one host, and an `Exact` path wins over the base Ingress's `/`
prefix. Ready to apply (substitute the same hostname and TLS Secret as the base
Ingress, and keep `proxy-body-size` equal to `RESTORE_MAX_BODY_MB`):

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: retrogemini-backup-upload
  labels:
    app: retrogemini
  annotations:
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    # Equal to RESTORE_MAX_BODY_MB; the application enforces its own limit.
    nginx.ingress.kubernetes.io/proxy-body-size: "128m"
spec:
  tls:
    - hosts:
        - retrogemini.local
      secretName: retrogemini-tls
  rules:
    - host: retrogemini.local
      http:
        paths:
          - path: /api/super-admin/restore
            pathType: Exact
            backend:
              service:
                name: retrogemini-service
                port:
                  number: 8080
          - path: /api/super-admin/backups/import
            pathType: Exact
            backend:
              service:
                name: retrogemini-service
                port:
                  number: 8080
```

It is deliberately not part of `k8s/base`: whether it is needed depends on the
controller, and OpenShift does not use an Ingress at all. Apply it next to the
base one (`kubectl -n retrogemini apply -f backup-upload-ingress.yaml`), then
check that a file larger than 1 MiB now gets the application's answer (a JSON
`401` without a credential) instead of nginx's HTML 413:

```bash
head -c 2000000 /dev/urandom > /tmp/big.bin
curl -sS -o /dev/null -w '%{http_code} %{content_type}\n' \
  -H 'Content-Type: application/octet-stream' --data-binary @/tmp/big.bin \
  https://retrogemini.local/api/super-admin/backups/import
# expect: 401 application/json; charset=utf-8   (not 413 text/html)
```

---

## PostgreSQL management

### Reading the audit trail (who did that?)

Every privileged action leaves a row in `security_events` (audit H45) — the
super-admin logins including the **failed** ones, team deletions, renames and
merges, a change of a team's recovery email, password changes, every backup
create / download / restore / delete and the restore of one team, AI
reconfiguration, the console's Jira connection (`jira-settings.update`), a
team's Jira token being saved, replaced or removed (`team.jira-token-change`,
never the token), and clearing the log viewer — the one action whose purpose can
be to remove evidence, which is why the row goes to the database the clear does
not touch. It survives the pod, which the super admin's in-memory log
viewer does not.

There is deliberately **no endpoint and no panel** for it: a viewer would be a
user-visible feature, and this is the operator's answer instead.

The user and database names below are the ones the rest of this file uses
(`retrogemini`); adjust them if your Secret sets different ones. They are
written **literally on purpose** — `kubectl exec ... -- psql -U "$POSTGRES_USER"`
expands the variable in *your* shell, not in the pod, so it silently becomes
`-U ""` and the command fails for a reason that looks like a database problem.

```bash
# The last 50 privileged actions, newest first.
kubectl exec deployment/postgresql-retrogemini -- \
  psql -U retrogemini -d retrogemini -c \
  "SELECT created_at, action, actor, outcome, target, source_ip, correlation_id
     FROM security_events ORDER BY id DESC LIMIT 50;"

# "A team's retrospectives disappeared some time on the 4th" — was it a
# deletion, a merge, a restore (of the whole store, or of that one team), or a bug?
kubectl exec deployment/postgresql-retrogemini -- \
  psql -U retrogemini -d retrogemini -c \
  "SELECT * FROM security_events
     WHERE action IN ('team.delete','team.merge','backup.import','backup.restore','team.restore')
       AND created_at >= '2026-09-04' ORDER BY id;"
# A restore from an imported file reads as two rows: the backup.import, whose
# target is the new backup's id (its detail carries the file's sha256), then a
# team.restore whose detail.backupId — or a backup.restore whose target — is
# that same id.

# "Nobody received the password-reset mail" — who changed the recovery address?
kubectl exec deployment/postgresql-retrogemini -- \
  psql -U retrogemini -d retrogemini -c \
  "SELECT created_at, actor, target, detail FROM security_events
     WHERE action = 'team.recovery-email-change' ORDER BY id DESC LIMIT 20;"

# "Who changed our Jira token?" — or the address every token is sent to.
kubectl exec deployment/postgresql-retrogemini -- \
  psql -U retrogemini -d retrogemini -c \
  "SELECT created_at, action, actor, target, detail FROM security_events
     WHERE action IN ('team.jira-token-change','jira-settings.update')
     ORDER BY id DESC LIMIT 20;"

# Someone trying the super-admin password.
kubectl exec deployment/postgresql-retrogemini -- \
  psql -U retrogemini -d retrogemini -c \
  "SELECT created_at, source_ip FROM security_events
     WHERE action = 'super-admin.login' AND outcome = 'failure'
     ORDER BY id DESC LIMIT 50;"
```

`correlation_id` is the join to the pod logs: the same id is on every log line
the request produced, so the platform's aggregator query is
`correlationId: "<value>"`.

Three things to know before an investigation rests on it:

- **The trail names an action, not a person.** One shared super-admin password
  means `actor = 'super-admin'` is as specific as it gets. See `SECURITY.md`.
- **Append-only is an application guarantee, not a database one.** Nothing in
  the codebase updates or deletes these rows; anyone with `psql` can.
- **There is no retention rule and no purge.** The table grows, bounded by the
  rate limiters in front of the routes rather than by policy. It also stores
  **source IP addresses**. Both are the same position the rest of the product
  takes for an internal deployment, and both are things to revisit if it ever
  becomes reachable from outside.

### Recovery objectives, and what they are worth

| | Value | What it rests on |
|---|---|---|
| **RPO** (data you can lose) | **24 hours** | `BACKUP_INTERVAL_HOURS` defaults to 24, and the automatic backup is the only scheduled copy. Lower the interval to lower the RPO. |
| **RTO** (time to be serving again) | **under an hour**, once someone is at a keyboard with an archive | Rehearsed end to end (below). The clock is dominated by provisioning a database and finding the archive, not by the restore itself. |

State them even though they are modest: *"24 hours / best effort"* written down
beats a better number nobody has checked.

**Both figures assume the archive still exists.** Automatic backups are rows in
the same PostgreSQL instance as the live data, so a lost volume takes them with
it. The `pg_dump` below is the copy that survives that — it is not optional
housekeeping, it is the only independent one, and nothing schedules it for you.

### Backups

**Manual backup — the independent copy:**
```bash
kubectl exec deployment/postgresql-retrogemini -- \
  pg_dump -U retrogemini retrogemini > backup_$(date +%Y%m%d).sql
```

**Restore:**
```bash
kubectl exec -i deployment/postgresql-retrogemini -- \
  psql -U retrogemini retrogemini < backup_YYYYMMDD.sql
```

> A `pg_dump` restores the **whole** `kv_store`, deployment configuration
> included. The application's own `.json.gz` archive does not — see the
> rehearsal below.
>
> **Teams' Jira tokens come back with a `pg_dump` only when the restored pods
> run with the same `SESSION_TOKEN_SECRET`.** The rows are there either way,
> but each token is encrypted with a key derived from that secret: under
> another secret every team's Jira settings say the token can no longer be read
> and ask for it again. Keep `SESSION_TOKEN_SECRET` in your secret store,
> separate from the dumps, and write in the recovery notes where it is kept,
> never the value itself: a dump together with the secret opens every team's
> Jira token.
>
> **A dump of an older state brings back older Jira links.** An action sent to
> Jira after the dump was taken comes back as not in Jira, and with the same
> `SESSION_TOKEN_SECRET` the team's token works at once: ask the teams to check
> their Jira project before pressing "Create in Jira (N)", or the action is
> created a second time.

### The restore, rehearsed (2026-08-25)

Run against PostgreSQL 16 with the application's own archive, by **destroying
the database** (`dropdb` + `createdb`, zero tables) and restoring into the empty
one. Not a thought experiment; the commands and their output are in the pull
request that added this section.

**What came back, verified item by item:** the team and its facilitator email,
both members, the retrospective with its status and phase, the ticket *with its
two votes*, the action with its assignee and done-state, the ROTI, and the
feedback with its author. The original team password still authenticated, so the
scrypt hashes survive the round trip. A protected *pre-restore snapshot* was
written before the replace, as invariant 4 requires.

**What did not come back, and this is the one to plan for:** the deployment's
**configuration**. Before the wipe the AI settings read
`enabled: true, apiUrl: "https://llm.internal.example/v1"`; after the restore
they read `enabled: false, apiUrl: ""`, and `global-settings` was absent from
the store. The archive carries teams, reset tokens and orphaned feedbacks — not
the AI configuration, the admin email or the info banner.

That omission is deliberate rather than accidental: the archive is downloadable
by the super admin, and the AI settings hold a live API key. It is pinned by
`__tests__/archiveContract.test.ts`, which fails if anyone adds it without
thinking about the credential.

**So the runbook after an application-archive restore is:** restore, then open
the super-admin panel and re-enter the AI configuration, the admin email, the
info banner **and the Jira settings** (the Jira card: on, the base URL, the
certificate option). Keep them written down somewhere that is not the database.
**Into a new database, every team then enters its Jira token again** in
*Settings → Jira*: tokens are never in an archive (`team-secret:*`, pinned by
the same test), so none exist there. Restoring an archive *over* the live
database keeps the tokens of the teams it holds that still exist, and their
issue keys. A `pg_dump` restore needs none of this, provided the pods keep the
same `SESSION_TOKEN_SECRET` (above).

**After any restore to an older state, the teams check Jira before creating
actions again.** An action sent to Jira after the backup comes back as not in
Jira whenever no current record held its link — an archive restored into a new
database, a team deleted since the backup — or when the restore removed it and
a client still holding it saves it again. Its next "Create in Jira" makes a
second issue. A team deleted from the console has a protected *Pre-delete
snapshot*, which holds every link: restore that one when it is the newest.

### Moving PGDATA on an existing volume

**Read this before applying the current manifests to an installation that
already has data, on plain Kubernetes.**

`k8s/base/postgresql-deployment.yaml` now sets `PGDATA` to
`/var/lib/postgresql/data/pgdata` — a **subdirectory** of the mount, where it
used to be the mount root. That is not cosmetic:

- A PersistentVolume formatted ext4 arrives with a `lost+found` directory at its
  root, and `initdb` refuses a non-empty data directory with exactly that
  complaint (*"It contains a lost+found directory … Create a subdirectory under
  the mount point"*).
- `fsGroup: 70` makes the mount root group-writable, and `initdb` refuses a data
  directory with group access as well.

The subdirectory solves both: `docker-entrypoint.sh` creates it itself with
`mkdir -p "$PGDATA"; chmod 00700 "$PGDATA"`.

⚠️ **On a volume that already holds a cluster at the mount root, PostgreSQL will
not find it and will initialise a new, empty one beside it.** Nothing is
deleted, but the application comes up with no teams and starts writing to the
new directory. Either keep the old value in your own overlay:

```yaml
# overlays/<yours>/pgdata.patch.yaml — keep an existing cluster where it is
apiVersion: apps/v1
kind: Deployment
metadata:
  name: postgresql-retrogemini
spec:
  template:
    spec:
      containers:
        - name: container
          env:
            - name: PGDATA
              value: /var/lib/postgresql/data
```

…or move the data once, with the Deployment scaled to zero.

**Run the migration pod as UID 70, exactly like the Deployment.** A default
throwaway pod runs as root, so `mkdir` would create `pgdata` owned by
`root:root` and the `chmod 0700` would then lock PostgreSQL out of its own data
directory — the database would come up unable to traverse it. Matching the
Deployment's context avoids that *and* proves the result is readable by the pod
that has to read it:

```bash
kubectl -n retrogemini scale deployment/postgresql-retrogemini --replicas=0

kubectl -n retrogemini apply -f - <<'EOF'
apiVersion: v1
kind: Pod
metadata:
  name: pgdata-move
spec:
  restartPolicy: Never
  # The same identity the hardened Deployment uses. fsGroup is what makes the
  # mount root writable by 70, so nothing here needs root or a chown.
  securityContext:
    runAsUser: 70
    runAsGroup: 70
    fsGroup: 70
  volumes:
    - name: data
      persistentVolumeClaim:
        claimName: retrogemini-postgresql-data
  containers:
    - name: shell
      image: postgres:15-alpine
      command: ["sleep", "1800"]
      volumeMounts:
        - name: data
          mountPath: /var/lib/postgresql/data
EOF

kubectl -n retrogemini wait --for=condition=Ready pod/pgdata-move
kubectl -n retrogemini exec pgdata-move -- sh -c '
  set -eu
  cd /var/lib/postgresql/data
  # Refuse to touch a volume that does not hold a cluster at its root.
  test -f PG_VERSION || { echo "no cluster at the mount root - nothing to move"; exit 1; }
  mkdir -p pgdata
  for entry in * .*; do
    case "$entry" in pgdata|lost+found|.|..) continue ;; esac
    mv "$entry" pgdata/
  done
  chmod 0700 pgdata
  ls -ld pgdata
  test -f pgdata/PG_VERSION && echo "moved: $(cat pgdata/PG_VERSION)"
'

kubectl -n retrogemini delete pod pgdata-move
kubectl -n retrogemini scale deployment/postgresql-retrogemini --replicas=1
```

The `ls -ld pgdata` line is the check that matters: it must print owner and
group **70**, and mode `drwx------`. If it prints `root`, the pod did not honour
`runAsUser` (a Pod Security admission policy may have overridden it) — fix that
before scaling back up, or `chown -R 70:70 pgdata` from a root pod.

The loop replaces a `!(pgdata|lost+found)` glob written here earlier: that is a
bash extended glob, and the shell in this image is `sh`, where it does not
expand.

**Take a backup first either way** — see [Backups](#backups).

**This does not apply to OpenShift.** The overlay swaps in the Red Hat image,
which mounts at `/var/lib/pgsql/data` and manages its own data subdirectory, so
the overlay deletes the `PGDATA` variable entirely.

### The database pod runs as UID 70, and that number belongs to the image

`postgres:15-alpine` creates its `postgres` account with `addgroup -g 70 -S` /
`adduser -u 70 -S`. The **Debian** variants (`postgres:15`,
`postgres:15-bookworm`) use `999` instead, and `initdb` calls `getpwuid()` and
refuses to run as a UID with no passwd entry — so changing the image without
changing `runAsUser` stops the database from starting.
`__tests__/deploymentManifestParity.test.ts` checks that the pair agrees.

The UID is also why the container can drop **all** Linux capabilities:
`docker-entrypoint.sh` re-execs itself through `gosu` when it starts as root,
and `gosu` needs `CAP_SETUID`/`CAP_SETGID` to do it. Naming the UID skips that
branch — the entrypoint runs as `postgres` from the first instruction.

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

**Changing `SESSION_TOKEN_SECRET`** needs no database step, and costs more than
it looks: every session is signed out, every invite link sent so far stops
working, and every team's stored Jira token becomes unreadable — each team's
*Settings → Jira* then asks for it again. When the change follows a suspected
leak of the secret or of a database dump, each team revokes its token in Jira
and saves a newly issued one: the old token, entered again, stays readable from
every earlier dump.

---

## Automated backups

RetroGemini includes an automatic server-side backup system that creates compressed snapshots of all data. Backups are stored in the PostgreSQL database (in a dedicated `backups` table), so they work seamlessly with multi-pod deployments — no extra PVC required.

### How it works

- **Startup backup**: A snapshot is created each time the server starts (before a new version runs)
- **Scheduled backups**: Automatic backups run at a configurable interval (default: every 24 hours)
- **Manual checkpoints**: Named snapshots can be created from the super admin panel
- **Retention**: Old automatic backups are pruned when the limit is reached; protected backups are kept
- **Restore**: Any backup can be restored from the super admin panel (a pre-restore snapshot is created automatically)
- **Team deletion from the console**: deleting a team from the super admin panel — typically the two original teams after a merge — first takes a protected *Pre-delete snapshot* of the whole store. Protected backups are never pruned, so each deleted team leaves one full archive behind: delete the ones you no longer need from the Backups tab, as for pre-restore snapshots
- **Imported files**: a backup file uploaded in the Backups tab (*Import a backup file*) becomes a row of type `imported`, from which one or more teams — or the whole store — can be restored. Imported rows are **never pruned**, each can be up to `RESTORE_MAX_BODY_MB`, and they survive every restore: delete them by hand when done. So are the protected *Pre-restore snapshot* rows each restore leaves — restoring five teams from one import leaves five whole-store snapshots to delete as well. A team from **another** deployment also comes back with its Jira target and the parent issue of each of its sessions: in the mode that gives each session a parent issue, its next sends go as sub-tasks under those keys in this deployment's Jira, which is right only when both deployments use the same Jira. Check the parent issues the batch dialog lists before sending, or re-point them (name a parent and replace, or change the target in *Settings → Jira*)
- **Memory**: a backup, a snapshot or a download holds one team at a time plus the compressed archive (it is built team by team through gzip), and on PostgreSQL one pooled connection for its duration (the teams are read in one consistent snapshot). An import holds the uploaded body, its unpacked bytes and the parsed archive at once, one import at a time per pod. *Restoring* from a row costs more than importing it: the parsed archive is held for the restore, so the single-team restore's peak is the parsed archive plus the team its snapshot is reading, and on PostgreSQL the row's `bytea` arrives as hex text, twice its stored size, before it becomes a buffer. The practical ceiling is therefore the restore's, not the import's — against the 384 Mi pod limit, tens of MB unpacked; an import that passes does not prove a restore from it fits. Raise the pod's memory limit before restoring larger archives
- **A backup that cannot read a team fails**: a team row the database cannot parse (or an empty one), a team row that parses but is not an object (`null`, an array), or a `retro-meta` row that is not one valid object or whose lists are not lists, fails every backup instead of storing an archive that silently misses teams. Every snapshot fails with it, so until the row is repaired, **no restore can run** — whole-store, single-team or console deletion answer `503` — and the manual checkpoint answers *create failed*. A failed automatic backup purges nothing, so the last good backups stay. The pod log and the console's **Logs** tab name the key, never its content: `[Backup] Failed to create backup: Team record "team:<id>" cannot be archived (unparsable)` (or `empty`, `not_an_object`), and for the metadata row `Record "retro-meta" cannot be archived (…)` with `unparsable`, `not_an_object` or `list_malformed`. Take a `pg_dump` first, then inspect the row — `SELECT key, octet_length(value), left(value, 80) FROM kv_store WHERE key = '<key>';` — and act by key:
  - **`team:<id>`**: repair the row in place if you can. If it is beyond repair, delete it — and what goes with the deletion depends on whether a backup holds the team:
    - *A backup holds it*: delete the row (`DELETE FROM kv_store WHERE key = 'team:<id>';`) and restore the team straight away with *Restore a team*. The name index still maps its name to the same id, so the restore takes the name back. The team returns as that backup holds it, without its feedbacks, which a deletion by hand does not set aside as the console's does.
    - *No backup holds it* (it was created after the last good one), or it will not be restored: drop its names from the index **in the same transaction**, otherwise its name answers "team name exists" on creation and "team not found" on login for good, and nothing in the console can free it (filtering by id also removes any alias an interrupted rename left behind):
      ```sql
      BEGIN;
      DELETE FROM kv_store WHERE key = 'team:<id>';
      UPDATE kv_store
         SET value = jsonb_set(value::jsonb, '{teams}', COALESCE((
               SELECT jsonb_object_agg(k, v) FROM jsonb_each(value::jsonb->'teams') e(k, v)
                WHERE v <> to_jsonb('<id>'::text)), '{}'))::text
       WHERE key = 'team-index';
      COMMIT;
      ```
    The team's Jira token row (`team-secret:<id>`), if any, is removed by the next pod start's sweep.
  - **`retro-meta`**: **never delete it** — it holds the feedbacks of every deleted team and the pending password-reset links. Repair it in place: a malformed `resetTokens` can be set to an empty list (`UPDATE kv_store SET value = jsonb_set(value::jsonb, '{resetTokens}', '[]')::text WHERE key = 'retro-meta';`, the links then have to be requested again); take a malformed or unparsable `orphanedFeedbacks` back from the `pg_dump` taken first rather than emptying it.

  Backups and restores work again once the row reads. What else the row breaks, which tells you where to look: an **unparsable or empty team row** makes the summary projection throw, so the login screen's team list and the console's **Teams** tab are down too. A **team row that parses but is not an object** gives a summary with no name: the login screen's team list fails (its sort, or its render), while the **Teams** tab loads with a nameless row that fails only when sorted by name or merged. A **malformed `retro-meta`** shows nothing else at all — its readers see empty lists — so that log line and the absence of new automatic backups in the **Backups** tab are the only signs
- **A team record PostgreSQL's jsonb refuses**: the row is valid JSON to Node but holds a lone half of an emoji, written as the escape `\ud83d` (a ticket excerpt cut through an emoji by a client from 41.0 or earlier, or a feedback or AI group title cut the same way by a server from then), or a NUL written `\u0000`. Node reads it, so backups, invitation links, live sessions and the legacy password pass keep working; every projection that casts the record to `jsonb` fails, for **every** team at once: the login screen's team list, the console's **Teams** tab and feedback views, the feedback board, the boot-time email heal and the console's merge and deletion checks — with `invalid input syntax for type json` (`22P02`, "Unicode low surrogate must follow a high surrogate") or `unsupported Unicode escape sequence` (`22P05`) in the pod log. Find the rows, take a `pg_dump`, and remove those escapes in place — the expression leaves an escaped backslash (a user who typed `\ud83d` literally) alone:
  ```sql
  SELECT key FROM kv_store
   WHERE (key LIKE 'team:%' OR key LIKE 'session:%')
     AND value ~ '(?<!\\)(?:\\\\)*\\u(?:[dD][89a-fA-F][0-9a-fA-F]{2}|0000)';

  UPDATE kv_store
     SET value = regexp_replace(value, '(?<!\\)((?:\\\\)*)\\u(?:[dD][89a-fA-F][0-9a-fA-F]{2}|0000)', '\1', 'g')
   WHERE (key LIKE 'team:%' OR key LIKE 'session:%')
     AND value ~ '(?<!\\)(?:\\\\)*\\u(?:[dD][89a-fA-F][0-9a-fA-F]{2}|0000)';
  ```
  The statement repairs the `session:*` rows too, and is best run while none of the team's sessions is open: an unrepaired session row, or a browser still in the session, puts the text back into the team record with its next save. Node writes a well-formed emoji as itself, never as an escape, so every match is one of these broken halves or a NUL

### Configuration

These environment variables are set directly in `deployment.yaml` (not in secrets — safe to re-apply):

| Variable | Default | Description |
|----------|---------|-------------|
| `BACKUP_ENABLED` | `true` | Enable automatic backups |
| `BACKUP_INTERVAL_HOURS` | `24` | Hours between automatic backups |
| `BACKUP_MAX_COUNT` | `7` | Max automatic backups to keep |
| `BACKUP_ON_STARTUP` | `true` | Create backup when server starts |
| `RESTORE_MAX_BODY_MB` | `128` | Max compressed/uploaded restore or import archive size in MB (the uploaded whole-store restore and the Backups tab's file import; see [Upload size and timeouts](#upload-size-and-timeouts) for the proxy in front) |
| `RESTORE_MAX_DECOMPRESSED_MB` | `512` | Max decompressed restore or import archive size in MB |

### Multi-pod support

The deployment uses 2 replicas by default for zero-downtime rolling updates. Since backups are stored in PostgreSQL, all pods can read and write backups without volume conflicts. Startup backups are deduplicated (skipped if one was created within 5 minutes).

Cross-pod Socket.IO traffic needs no extra component here: when PostgreSQL is the
data store, the PostgreSQL Socket.IO adapter is selected automatically. That is
why the manifests deploy no Redis and set no `REDIS_URL` / `REDIS_HOST` /
`REDIS_PORT` / `REDIS_PASSWORD` — configure those only if you prefer to run the
Redis adapter instead.

#### Checking that the pods really are sharing broadcasts

The adapter is what makes two pods one application, and it can fail *on its own*
— the realistic case is `CREATE TABLE socket_io_attachments` refused by a
restricted database grant; a Redis blip is the other. When it does, the pod keeps
serving with the in-memory adapter and every probe stays green, so two
participants balanced onto different pods each see only their own tickets and
votes. Nothing is down and nothing is red: it is the hardest class of incident to
diagnose, which is why `/health` reports it (audit H50):

```bash
kubectl exec deploy/retrogemini -- wget -qO- localhost:3000/health
# {"status":"ok","socketAdapter":{"strategy":"postgres","expected":true,"active":true,"attempts":1,"gaveUp":false}}
```

- `status: "degraded"` — a cross-pod adapter **was configured and is not
  active**. Alert on this. The pod retries in the background with backoff for
  roughly ten minutes (`gaveUp: true` once it stops); a restart retries from
  scratch. The reason is in the pod log and in the super-admin log viewer, never
  in this response — it names internal hosts and grants, and the endpoint is
  anonymous.
- `expected: false` — no shared adapter is configured. Correct for a single-pod
  deployment, **wrong at `replicas: 2`**: check `DATABASE_URL` / the
  `POSTGRES_*` values actually reached the container.

The status code is always `200`, deliberately. Gating readiness on the adapter
would empty the Service when both pods fail at once — turning degraded
collaboration into a total outage — and readiness cannot express "some pods are
still healthy".

---

## Scaling & performance tuning

These environment variables tune performance for larger deployments. They are set directly in `deployment.yaml` with the **built-in code defaults**, so you can deploy as-is and adjust per environment (dev / prod / openshift) as you grow. All are optional — the app runs fine without setting any of them.

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_RATE_LIMIT_MAX` | `5` | **Rejected** team-create / restore-session credentials per IP per 15 minutes, counted **per pod** (see below). Only `401` responses count, so no amount of ordinary use can consume the budget |
| `PG_POOL_MAX` | `10` | Max PostgreSQL connections **per pod** |
| `SESSION_CACHE_MAX` | `500` | Max live sessions cached in memory per pod (bounds memory only; session state is always recoverable from the database) |
| `SESSION_CACHE_MAX_MB` | `32` | Max total size, in MB of session JSON, of the per-pod session cache, beside the count above (bounds memory only; the session just written is never evicted) |
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
- `LOG_FORMAT` is set to `json` in `deployment.yaml`, which is also the
  production default. Each record is one line — `timestamp`, `level`, `source`,
  `message`, and `correlationId`, the id of the HTTP request or the socket that
  produced it — so the platform's aggregator can group an incident instead of
  offering you a page of prose from two pods. The id is echoed on every response
  as `X-Request-Id` and an inbound one is adopted, so a trace that starts at
  your edge carries through. Set `text` temporarily when reading `kubectl logs`
  by eye. Secrets are blanked in both formats, by value for the ones the pod
  holds and by key pattern for the rest.
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

`SESSION_CACHE_MAX` and `SESSION_CACHE_MAX_MB` only bound per-pod memory. At ~20-30 parallel retrospectives you will never approach 500 sessions, and at 50-500 KB of JSON each they hold 1-15 MB, so the 32 MB cap only trims old sessions and pathological blobs: the cached objects take roughly three times their JSON size in the heap, well inside the 384 Mi limit. An evicted session is read from the database again on its next write; during a database outage that write has no baseline, the documented degraded-mode case.

---

## Jira

Teams can create their actions as Jira issues once the super administrator has
connected the deployment's Jira in the console and the team has saved its token
(the product side is in the repository README → *Jira*). Nothing in the
manifests changes for it, and **no environment variable is introduced**; what
surrounds them does. One existing variable becomes required: each team's token
is encrypted with a key derived from `SESSION_TOKEN_SECRET`, so the Secret must
carry a stable value, the same on every pod and not the template's example
([Secrets](#postgresql-credentials-required)). Without it the console's Test
and its switch still work, but every team's save answers
`503 jira_secret_unavailable`.

**Egress from the application pods to Jira.** The server makes every Jira call
— the browser never does — so the pods must reach Jira's host on its port
(443 normally). The shipped NetworkPolicies restrict ingress only, so nothing
here blocks it; an egress policy or a firewall in front of the cluster must
allow it.

**A proxy and an internal CA.** Node.js reads `HTTPS_PROXY` / `NO_PROXY` only
when `NODE_USE_ENV_PROXY=1` is set too (Node.js's own switch; the image runs
Node 26). List an internal Jira in `NO_PROXY`: a corporate proxy usually cannot
reach it, and the call would fail at the proxy. When Jira's certificate is
issued by an internal CA, mount that CA and point `NODE_EXTRA_CA_CERTS` at it,
rather than turning on the console's "allow self-signed certificates", which
stops checking certificates for every team's token. Set them on the
application container, for example in an overlay:

```yaml
# overlays/<yours>/jira-egress.patch.yaml — strategic merge: env entries merge by name
apiVersion: apps/v1
kind: Deployment
metadata:
  name: retrogemini
spec:
  template:
    spec:
      containers:
        - name: container
          env:
            - name: NODE_USE_ENV_PROXY
              value: "1"
            - name: HTTPS_PROXY
              value: http://proxy.example.org:8080
            - name: NO_PROXY
              value: localhost,127.0.0.1,.svc,.cluster.local,jira.internal.example
```

With `NODE_USE_ENV_PROXY=1` every outbound HTTP(S) call the server makes goes
through the proxy unless `NO_PROXY` names its host — the LLM endpoint too, when
it is internal. PostgreSQL, Redis and SMTP do not speak HTTP and are not
affected.

**Which one is it?** When Jira cannot be reached, the console's **Test** says
what stopped the call — a certificate the pod does not trust (mount the CA), a
connection that failed (the host name, the proxy, `NO_PROXY`), or no answer in
time — with the system's or OpenSSL's code, such as
`UNABLE_TO_GET_ISSUER_CERT_LOCALLY` or `ENOTFOUND`. When a team's call fails the
same way, the team is told only that Jira could not be reached, and the pod logs
the code: `Jira could not be reached (…, team "…"): tls
UNABLE_TO_GET_ISSUER_CERT_LOCALLY`.

**Requests stay short, and a draining pod says so.** One creation request
starts no new issue after 10 seconds and waits at most 15 seconds for each
Jira call, so in project mode it ends within an OpenShift Route's 30-second
default; the browser sends what is left in a new request. With a parent
(sub-task) target, the parent lookup runs first and the first issue is always
started, so a slow Jira can push one request past 30 seconds: the Route then
answers 504 while the server finishes the call in flight and then stops (the
caller is gone), and the browser reads it as an outcome unknown. Raise the
Route's timeout (`haproxy.router.openshift.io/timeout`) if that happens. A pod
that received `SIGTERM` starts no new creation, finishes the one it is in, and
answers `stopped: 'server_restarting'`; the dialog lists the actions it did not
send as not sent, and pressing again sends them to a pod that is not draining.
A draining pod is forced out 20 seconds after `SIGTERM` — one Jira call and the
write of its key — which the shipped `terminationGracePeriodSeconds: 30` minus
its 5-second `preStop` leaves room for; if you shorten the grace period, keep it
above the `preStop` plus about 20 seconds, or a creation in flight is cut off
and reads as "may already be in Jira". An answer lost on the way (a proxy
timeout, a pod killed mid-call) is never sent again automatically: the browser
reads the team once, the actions the server did link show their key, and the
dialog (or the action's own control) lists the rest as "may already be in
Jira", for the facilitator to check — a re-sent batch then also reaches the
actions that were never sent.

**Restores.** The connection (`jira-settings`) and the teams' tokens
(`team-secret:*`) are never in an application archive: see the runbook in
[The restore, rehearsed](#the-restore-rehearsed-2026-08-25), and the
`SESSION_TOKEN_SECRET` note under [Backups](#backups) for a `pg_dump`. After
any restore to an older state, an action sent to Jira after the backup can come
back as not in Jira: the teams check their Jira project before creating actions
again (same runbook).

**During a rolling update from a release before 40.0**, a pod that does not
serve the Jira routes answers them with an HTML `404`; the browser retries for
about seven seconds and the buttons appear once a new pod answers. Do not
restore a backup while such pods remain: they know nothing of Jira links or
tokens.

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

`k8s/base/deployment.yaml` runs the application pod as UID/GID **1000**, and
`k8s/base/postgresql-deployment.yaml` runs the database pod as **70**, both with
`runAsNonRoot`, a `RuntimeDefault` seccomp profile,
`allowPrivilegeEscalation: false` and all Linux capabilities dropped. That is
what a plain Kubernetes cluster needs, since it enforces nothing by itself.

**On OpenShift, apply the `openshift` overlay, not `base`.** The restricted SCC
allocates each project its own UID range and refuses a pod that names a UID
outside it, so the overlay deletes `runAsUser`, `runAsGroup` and `fsGroup` **on
both Deployments** and lets the platform assign them. Everything else in the
context stays and already satisfies `restricted-v2`.

If you apply `base` directly on OpenShift and the pod never starts, this is why:

```bash
oc -n retrogemini get events --field-selector reason=FailedCreate
oc apply -k k8s/overlays/openshift   # the supported path
```

The application image itself needs no root: `docker-entrypoint.sh` only becomes
root to `chown` a mounted `/data` volume, which this Deployment does not have
(it runs on PostgreSQL), and it skips that step when it is already non-root.

### The application cannot reach the database after applying network policies

Confirm the policies are the cause before anything else — scale the check, don't
guess:

```bash
kubectl -n retrogemini get networkpolicy
kubectl -n retrogemini logs -l app=retrogemini --tail=50   # connection refused / timeout?
```

The usual causes, in order of likelihood:

- **Your pods do not carry the `app:` labels the policies select.** The policies
  match `app: retrogemini` and `app: postgresql-retrogemini`; if you renamed the
  Deployments or dropped the labels in an overlay, the allow rules match nothing
  and the default-deny is all that is left.
- **`kustomize` was not used**, so the `app.kubernetes.io/*` labels the policies
  and the pod templates share were never applied consistently. Apply with
  `-k`, not `kubectl apply -f`.
- **The ingress controller cannot reach the app.** `retrogemini-allow-http`
  leaves the source open precisely so this cannot happen; if you tightened it in
  your own overlay, that is the first thing to undo.

To rule the policies out entirely, delete them and retest — then put them back:

```bash
kubectl -n retrogemini delete -f k8s/base/networkpolicy.yaml
# ... retest ...
kubectl -n retrogemini apply -f k8s/base/networkpolicy.yaml
```

### The database starts empty after an upgrade

See [Moving PGDATA on an existing volume](#moving-pgdata-on-an-existing-volume).
The old cluster is still on the volume, at the mount root; the pod is simply
looking one directory deeper.

### Validating the manifests without a cluster

Every manifest here renders and schema-validates offline, which is worth doing
before a rollout:

```bash
kustomize build k8s/base       | kubeconform -strict -ignore-missing-schemas -summary
kustomize build k8s/overlays/openshift | kubeconform -strict -ignore-missing-schemas -summary
kustomize build k8s/overlays/nodeport  | kubeconform -strict -ignore-missing-schemas -summary
```

`-ignore-missing-schemas` is needed for the OpenShift `Route`, which has no
upstream schema. This catches a stale patch target, a typo in a field name and a
malformed policy; it cannot tell you whether your CNI enforces the policies, or
whether your SCC accepts the pod. Those need the cluster.

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
