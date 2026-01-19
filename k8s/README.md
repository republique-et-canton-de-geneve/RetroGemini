# OpenShift/Kubernetes deployment guide

This repository provides baseline Kubernetes manifests under `k8s/base/` plus an
OpenShift overlay under `k8s/overlays/openshift`. Apply them with Kustomize so the
Secret, PostgreSQL, and the app are created together.

## Kubernetes

```bash
kubectl create namespace retrogemini
kubectl apply -k k8s/base -n retrogemini
```

### Update the image (example for a private Nexus registry)

```bash
kubectl -n retrogemini set image deployment/retrogemini \
  container=<nexus_repository>/jpfroud/retrogemini:1.12
```

### Troubleshooting: PostgreSQL pod stuck in Pending

If the PostgreSQL pod stays in **Pending**, it usually means the
`PersistentVolumeClaim` could not be bound (no default storage class or no
available storage). Check your storage classes and PVC status:

```bash
kubectl -n retrogemini get storageclass
kubectl -n retrogemini describe pvc retrogemini-postgresql-data
```

### Troubleshooting: app deployment stuck in Progressing

If the `retrogemini` Deployment shows **Progressing** with 0 ready pods, inspect
the pod events and logs:

```bash
kubectl -n retrogemini describe pod -l app=retrogemini
kubectl -n retrogemini logs -l app=retrogemini --all-containers
```

The base manifests set the app replicas to 2. If your cluster still shows 3
replicas from a previous apply, scale it back down:

```bash
kubectl -n retrogemini scale deployment/retrogemini --replicas=2
```

## OpenShift

```bash
oc new-project retrogemini
oc apply -k k8s/base
oc apply -k k8s/overlays/openshift
```

The OpenShift overlay switches PostgreSQL to the Red Hat image and adjusts the
expected environment variables and data directory.

## Configure secrets with real values

The manifests include a Secret template at `k8s/base/postgresql-secret.yaml` with placeholder values.
Replace the values in your cluster with real credentials before running in production:

```bash
oc -n <namespace> create secret generic retrogemini-super-admin \
  --from-literal=POSTGRES_DB=retrogemini \
  --from-literal=POSTGRES_HOST=postgresql \
  --from-literal=POSTGRES_USER=retrogemini \
  --from-literal=POSTGRES_PASSWORD='<your-password>' \
  --from-literal=SUPER_ADMIN_PASSWORD='<your-admin-password>' \
  --dry-run=client -o yaml | oc apply -f -
```

If you are using Windows CMD, use `^` for line continuation:

```bat
oc -n <namespace> create secret generic retrogemini-super-admin ^
  --from-literal=POSTGRES_DB=retrogemini ^
  --from-literal=POSTGRES_HOST=postgresql ^
  --from-literal=POSTGRES_USER=retrogemini ^
  --from-literal=POSTGRES_PASSWORD="<your-password>" ^
  --from-literal=SUPER_ADMIN_PASSWORD="<your-admin-password>" ^
  --dry-run=client -o yaml | oc apply -f -
```

## Cleanup

```bash
kubectl -n retrogemini delete -k k8s/base
oc -n retrogemini delete -k k8s/overlays/openshift
```
