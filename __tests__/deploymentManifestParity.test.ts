import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Audit H7 / H16 — the deployment surfaces must agree with each other and with
 * the code.
 *
 * AGENTS.md requires that adding, removing or changing an environment variable
 * keeps every deployment surface aligned *in the same change*. That rule had
 * silently drifted (`AUTH_RATE_LIMIT_MAX` documented but absent from the
 * manifests, `PG_POOL_MAX` the other way round, five `POSTGRESQL_*` fallbacks
 * read by the code and documented nowhere), the base image tag had fallen 17
 * majors behind `VERSION`, and both the `dev` and `prod` overlays patched a
 * Deployment name that no longer exists — so `kustomize build` on them failed
 * and their patches had never been applied.
 *
 * A reviewer cannot be expected to re-derive that by hand on every change, so
 * the contract lives here as data and is checked.
 *
 * On invariant 10 ("tests assert behaviour, never source text"): that rule
 * exists because grepping *production source* passes while the code is broken.
 * Here the documentation and the manifests **are** the artefacts under test —
 * there is no behaviour behind a README row or a kustomize target to assert
 * instead — so reading them is the only way to check them.
 */

const repoRoot = join(__dirname, '..');
const read = (relativePath: string) => readFileSync(join(repoRoot, relativePath), 'utf8');

/**
 * These manifests are read with line scanners and single-line regexes on
 * purpose. The first version of this file matched YAML blocks with patterns like
 * `/^metadata:\n(?:\s+.*\n)*?\s+name:/` — `\s` includes the newline, so the
 * repetition can match the same text several ways and CodeQL correctly flagged it
 * as exponential backtracking. Nothing below spans a line, so there is no
 * ambiguous repetition to backtrack through; `[^\S\n]` is horizontal whitespace
 * where indentation is meant.
 */
const indentOf = (line: string) => line.length - line.trimStart().length;

type ResourceId = { kind: string; name: string };

/** Top-level `kind:`, plus the `name:` inside the top-level `metadata:` block. */
const resourceIdOf = (relativePath: string): ResourceId | undefined => {
  let kind: string | undefined;
  let name: string | undefined;
  let inMetadata = false;

  for (const line of read(relativePath).split('\n')) {
    if (indentOf(line) === 0 && line.trim() !== '') {
      inMetadata = /^metadata:/.test(line);
      kind = /^kind:[^\S\n]*(\S+)/.exec(line)?.[1] ?? kind;
      continue;
    }
    if (inMetadata && name === undefined) {
      name = /^[^\S\n]+name:[^\S\n]*(\S+)/.exec(line)?.[1];
    }
  }
  return kind && name ? { kind, name } : undefined;
};

/** The `resources:` list of a kustomization, `.yaml` entries only. */
const resourceFilesOf = (relativePath: string) => {
  const files: string[] = [];
  let inResources = false;

  for (const line of read(relativePath).split('\n')) {
    if (indentOf(line) === 0 && line.trim() !== '') {
      inResources = /^resources:/.test(line);
      continue;
    }
    if (!inResources) continue;
    const entry = /^[^\S\n]*-[^\S\n]*(\S+\.yaml)[^\S\n]*$/.exec(line);
    if (entry) files.push(entry[1]);
  }
  return files;
};

/** Every `image:` value in a manifest, split into repository name and tag. */
const imageRefs = (relativePath: string) =>
  read(relativePath).split('\n').flatMap((line) => {
    const value = /^[^\S\n]*image:[^\S\n]*(\S+)[^\S\n]*$/.exec(line)?.[1];
    if (value === undefined) return [];
    const lastColon = value.lastIndexOf(':');
    // A colon before the last slash is a registry port, not a tag.
    return lastColon > value.lastIndexOf('/')
      ? [{ name: value.slice(0, lastColon), tag: value.slice(lastColon + 1) }]
      : [{ name: value, tag: undefined }];
  });

/** `patches[].target` entries written inline in a kustomization. */
const inlinePatchTargets = (kustomization: string): ResourceId[] => {
  const targets: ResourceId[] = [];
  let pending: Partial<ResourceId> | undefined;

  for (const line of kustomization.split('\n')) {
    if (/^[^\S\n]*target:[^\S\n]*$/.test(line)) {
      pending = {};
      continue;
    }
    if (pending === undefined) continue;
    pending.kind = /^[^\S\n]*kind:[^\S\n]*(\S+)/.exec(line)?.[1] ?? pending.kind;
    pending.name = /^[^\S\n]*name:[^\S\n]*(\S+)/.exec(line)?.[1] ?? pending.name;
    if (pending.kind && pending.name) {
      targets.push({ kind: pending.kind, name: pending.name });
      pending = undefined;
    }
  }
  return targets;
};

/** `patches[].path` entries — strategic-merge patches held in their own file. */
const patchPaths = (kustomization: string) =>
  kustomization.split('\n').flatMap((line) => {
    const path = /^[^\S\n]*-[^\S\n]*path:[^\S\n]*(\S+)[^\S\n]*$/.exec(line)?.[1];
    return path === undefined ? [] : [path];
  });

/** `images[].name` entries — the image a `newName`/`newTag` override applies to. */
const imageOverrideNames = (kustomization: string) => {
  const names: string[] = [];
  let inImages = false;

  for (const line of kustomization.split('\n')) {
    if (indentOf(line) === 0 && line.trim() !== '') {
      inImages = /^images:/.test(line);
      continue;
    }
    if (!inImages) continue;
    const entry = /^[^\S\n]*-[^\S\n]*name:[^\S\n]*(\S+)[^\S\n]*$/.exec(line);
    if (entry) names.push(entry[1]);
  }
  return names;
};

/**
 * The `workflow_dispatch` inputs a workflow declares, by name, with whether each
 * one is `required: true`.
 *
 * Indentation-driven rather than YAML-parsed, for the same reason as everything
 * above: no parser dependency, and nothing here spans a line.
 */
const dispatchInputsOf = (relativePath: string): Map<string, boolean> => {
  const declared = new Map<string, boolean>();
  let onIndent: number | undefined;
  let dispatchIndent: number | undefined;
  let inputsIndent: number | undefined;
  let nameIndent: number | undefined;
  let currentInput: string | undefined;

  for (const line of read(relativePath).split('\n')) {
    if (line.trim() === '' || /^[^\S\n]*#/.test(line)) continue;
    const indent = indentOf(line);

    if (indent === 0) {
      // A new top-level key ends the `on:` block.
      onIndent = /^(?:on|'on'|"on"):/.test(line) ? 0 : undefined;
      dispatchIndent = inputsIndent = nameIndent = currentInput = undefined;
      continue;
    }
    if (onIndent === undefined) continue;

    if (dispatchIndent === undefined) {
      if (/^[^\S\n]*workflow_dispatch:/.test(line)) dispatchIndent = indent;
      continue;
    }
    if (indent <= dispatchIndent) {
      // Back out to a sibling trigger (`push:`, `pull_request:`, …).
      dispatchIndent = inputsIndent = nameIndent = currentInput = undefined;
      continue;
    }

    if (inputsIndent === undefined) {
      if (/^[^\S\n]*inputs:/.test(line)) inputsIndent = indent;
      continue;
    }
    if (indent <= inputsIndent) {
      inputsIndent = nameIndent = currentInput = undefined;
      continue;
    }

    if (nameIndent === undefined) nameIndent = indent;
    if (indent === nameIndent) {
      currentInput = /^[^\S\n]*([A-Za-z_][\w-]*):/.exec(line)?.[1];
      if (currentInput) declared.set(currentInput, false);
      continue;
    }
    // An attribute of the input currently open.
    if (currentInput && /^[^\S\n]*required:[^\S\n]*true[^\S\n]*$/.test(line)) {
      declared.set(currentInput, true);
    }
  }
  return declared;
};

type DispatchCall = { caller: string; target: string; inputs: string[] };

/**
 * Every `gh workflow run <target>` in a workflow's `run:` blocks, with the input
 * names it passes. Continuation lines are joined first, because the call this
 * exists to check is written across six of them.
 */
const dispatchCallsIn = (relativePath: string): DispatchCall[] => {
  const logicalLines: string[] = [];
  let pending = '';

  for (const line of read(relativePath).split('\n')) {
    // Comment lines are dropped before joining: a dispatch that is commented
    // out — or merely described in prose, as the caller below describes itself —
    // is not a call.
    if (/^[^\S\n]*#/.test(line)) continue;
    const continues = /\\[^\S\n]*$/.test(line);
    pending += (pending === '' ? '' : ' ') + line.replace(/\\[^\S\n]*$/, '').trim();
    if (continues) continue;
    logicalLines.push(pending);
    pending = '';
  }
  if (pending !== '') logicalLines.push(pending);

  return logicalLines.flatMap((line) => {
    const target = /gh workflow run[^\S\n]+(\S+)/.exec(line)?.[1];
    if (target === undefined) return [];
    const inputs = [...line.matchAll(/(?:--raw-field|--field|-f|-F)(?:=|[^\S\n]+)([A-Za-z_][\w-]*)=/g)]
      .map((match) => match[1]);
    return [{ caller: relativePath, target, inputs }];
  });
};

const SURFACES = {
  envExample: '.env.example',
  readme: 'README.md',
  agents: 'AGENTS.md',
  manifest: 'k8s/base/deployment.yaml',
  k8sReadme: 'k8s/README.md',
  k8sSecrets: 'k8s/secrets-templates',
} as const;

type Surface = keyof typeof SURFACES;

const surfaceText: Record<Surface, string> = {
  envExample: read(SURFACES.envExample),
  readme: read(SURFACES.readme),
  agents: read(SURFACES.agents),
  manifest: read(SURFACES.manifest),
  k8sReadme: read(SURFACES.k8sReadme),
  k8sSecrets: readdirSync(join(repoRoot, SURFACES.k8sSecrets))
    .map((file) => read(join(SURFACES.k8sSecrets, file)))
    .join('\n'),
};

/**
 * The parity contract. Every environment variable the server reads must appear
 * here, and must be mentioned on every surface it is not explicitly excused
 * from. An exemption is a *sentence*, not a flag: if a variable does not belong
 * on a surface, the reason is the documentation of that decision.
 *
 * Adding a knob to the server therefore fails this suite until its surfaces are
 * updated or its absence is argued for — which is the whole point.
 */
const NOT_A_SECRET = 'non-secret default — secrets templates hold credentials only';
const PLATFORM_SET = 'set by the platform (Dockerfile / Railway / kustomize), not an operator knob';
const SQLITE_ONLY = 'SQLite-only; the Kubernetes deployment always runs on PostgreSQL';
const SMTP_GROUP = 'documented as the `SMTP_*` group in the AGENTS.md environment list';
const PG_ALIAS = 'fallback alias for a POSTGRES_* value, never set by an operator — documented where it matters, with the Kubernetes/OpenShift guidance';
const NO_REDIS_IN_BASE = 'the manifests deploy no Redis: with PostgreSQL as the store the PostgreSQL Socket.IO adapter is selected automatically (documented in k8s/README.md)';

const PARITY_CONTRACT: Record<string, Partial<Record<Surface, string>>> = {
  // --- Operator-tunable knobs: required on every surface. ---
  AUTH_RATE_LIMIT_MAX: { k8sSecrets: NOT_A_SECRET },
  BACKUP_ENABLED: { k8sSecrets: NOT_A_SECRET },
  BACKUP_INTERVAL_HOURS: { k8sSecrets: NOT_A_SECRET },
  BACKUP_MAX_COUNT: { k8sSecrets: NOT_A_SECRET },
  BACKUP_ON_STARTUP: { k8sSecrets: NOT_A_SECRET },
  CORS_ORIGIN: {
    k8sSecrets: NOT_A_SECRET,
    manifest: 'left unset so the permissive `*` default is not enshrined in a manifest operators copy; k8s/README.md tells them to pin their Ingress/Route origin',
  },
  LAST_CONNECTION_DEBOUNCE_MS: { k8sSecrets: NOT_A_SECRET },
  PG_POOL_MAX: { k8sSecrets: NOT_A_SECRET },
  RESTORE_MAX_BODY_MB: { k8sSecrets: NOT_A_SECRET },
  RESTORE_MAX_DECOMPRESSED_MB: { k8sSecrets: NOT_A_SECRET },
  ROSTER_BROADCAST_DEBOUNCE_MS: { k8sSecrets: NOT_A_SECRET },
  SESSION_CACHE_MAX: { k8sSecrets: NOT_A_SECRET },
  SOCKET_MAX_BUFFER_SIZE: { k8sSecrets: NOT_A_SECRET },
  SOCKET_UPDATE_BURST: { k8sSecrets: NOT_A_SECRET },
  SOCKET_UPDATE_RATE: { k8sSecrets: NOT_A_SECRET },

  // --- Secret-backed values: shipped through the secrets templates. ---
  SESSION_TOKEN_SECRET: {},
  SUPER_ADMIN_PASSWORD: {},
  WIFI_PASSWORD: {},
  WIFI_SSID: {},

  // --- SMTP: one family, documented as a group in the AGENTS.md list. ---
  FROM_EMAIL: { agents: SMTP_GROUP },
  SMTP_HOST: { agents: SMTP_GROUP },
  SMTP_PASS: { agents: SMTP_GROUP },
  SMTP_PORT: { agents: SMTP_GROUP },
  SMTP_SECURE: { agents: SMTP_GROUP },
  SMTP_USER: { agents: SMTP_GROUP },

  // --- PostgreSQL connection: credentials, plus the fallback aliases. ---
  // Not exempted from README.md: the discrete values are a supported connection
  // method in their own right, and "documented as a group under DATABASE_URL" was
  // not true — DATABASE_URL is a *different* mechanism, not a heading for these.
  POSTGRES_DB: {},
  POSTGRES_HOST: {},
  POSTGRES_PASSWORD: {},
  POSTGRES_USER: {},
  PUBLIC_BASE_URL: { k8sSecrets: NOT_A_SECRET },
  POSTGRES_PORT: {
    manifest: 'defaults to 5432; the bundled postgresql Service does not move it',
    k8sSecrets: 'defaults to 5432; not part of the credential set',
  },
  // Required on the two surfaces an operator actually consults for them:
  // the AGENTS.md variable list and the Kubernetes/OpenShift guide.
  POSTGRESQL_DATABASE: { envExample: PG_ALIAS, readme: PG_ALIAS, manifest: PG_ALIAS, k8sSecrets: PG_ALIAS },
  POSTGRESQL_PASSWORD: { envExample: PG_ALIAS, readme: PG_ALIAS, manifest: PG_ALIAS, k8sSecrets: PG_ALIAS },
  POSTGRESQL_SERVICE_HOST: { envExample: PG_ALIAS, readme: PG_ALIAS, manifest: PG_ALIAS, k8sSecrets: PG_ALIAS },
  POSTGRESQL_SERVICE_PORT: { envExample: PG_ALIAS, readme: PG_ALIAS, manifest: PG_ALIAS, k8sSecrets: PG_ALIAS },
  POSTGRESQL_USER: { envExample: PG_ALIAS, readme: PG_ALIAS, manifest: PG_ALIAS, k8sSecrets: PG_ALIAS },

  // --- Store / transport selection: not set in the Kubernetes manifests. ---
  DATABASE_URL: {
    manifest: 'the manifest supplies the discrete POSTGRES_* values instead of a single URL',
    k8sSecrets: 'the manifest supplies the discrete POSTGRES_* values instead of a single URL',
    k8sReadme: 'the manifest supplies the discrete POSTGRES_* values instead of a single URL',
  },
  DATA_STORE_PATH: { manifest: SQLITE_ONLY, k8sSecrets: SQLITE_ONLY, k8sReadme: SQLITE_ONLY },
  REDIS_HOST: { manifest: NO_REDIS_IN_BASE, k8sSecrets: NO_REDIS_IN_BASE },
  REDIS_PASSWORD: { manifest: NO_REDIS_IN_BASE, k8sSecrets: NO_REDIS_IN_BASE },
  REDIS_PORT: { manifest: NO_REDIS_IN_BASE, k8sSecrets: NO_REDIS_IN_BASE },
  REDIS_URL: { manifest: NO_REDIS_IN_BASE, k8sSecrets: NO_REDIS_IN_BASE },

  // --- Set by the runtime, not by an operator. ---
  NODE_ENV: { readme: PLATFORM_SET, agents: PLATFORM_SET, k8sReadme: PLATFORM_SET, k8sSecrets: PLATFORM_SET },
  PORT: {
    manifest: 'fixed to 8080 by the Dockerfile; the manifest pins the matching containerPort',
    k8sReadme: 'fixed to 8080 by the Dockerfile; the manifest pins the matching containerPort',
    k8sSecrets: PLATFORM_SET,
  },
  TRUST_PROXY: {
    manifest: 'defaults to 1 in production, which is already correct behind an Ingress/Route (explained in k8s/README.md)',
    k8sSecrets: NOT_A_SECRET,
  },
};

const envVarsReadByServer = (): string[] => {
  const sources = ['server.js', ...listJsFiles('server'), ...listJsFiles('utils')];
  const names = new Set<string>();
  for (const file of sources) {
    // Both access shapes are in use: `process.env.X` directly, and `env.X` where
    // the environment is injected as a parameter (socketHandlers.js).
    for (const match of read(file).matchAll(/\benv\.([A-Z][A-Z0-9_]{2,})\b/g)) {
      names.add(match[1]);
    }
  }
  return [...names].sort();
};

function listJsFiles(dir: string): string[] {
  return readdirSync(join(repoRoot, dir), { withFileTypes: true }).flatMap((entry) => {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return listJsFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });
}

const mentions = (surface: Surface, name: string) =>
  new RegExp(`\\b${name}\\b`).test(surfaceText[surface]);

describe('deployment configuration parity (audit H7.4)', () => {
  it('accounts for every environment variable the server reads', () => {
    const undocumented = envVarsReadByServer().filter((name) => !(name in PARITY_CONTRACT));
    expect(
      undocumented,
      'A new environment variable must be added to PARITY_CONTRACT (and to the surfaces it belongs on) in the same change',
    ).toEqual([]);
  });

  it('mentions every variable on every surface it is not excused from', () => {
    const missing: string[] = [];
    for (const [name, exemptions] of Object.entries(PARITY_CONTRACT)) {
      for (const surface of Object.keys(SURFACES) as Surface[]) {
        if (surface in exemptions) continue;
        if (!mentions(surface, name)) missing.push(`${name} is missing from ${SURFACES[surface]}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('does not carry a contract entry for a variable the server no longer reads', () => {
    const stillRead = new Set(envVarsReadByServer());
    expect(
      Object.keys(PARITY_CONTRACT).filter((name) => !stillRead.has(name)),
      'A removed environment variable must be dropped from PARITY_CONTRACT too, so the contract cannot rot into a list of variables nothing reads',
    ).toEqual([]);
  });
});

describe('base deployment manifest (audit H7.1)', () => {
  /**
   * The image line is machine-owned: `docker-deploy.yml` rewrites it with
   * `sed` and commits it on every deployment, so the tag is whatever was last
   * *pushed to the registry* — not necessarily the current `VERSION`, since
   * deploys are dispatched manually while `VERSION` moves with every `Y` bump.
   *
   * Demanding exact equality would therefore be wrong twice over: it would make
   * ordinary pull requests claim an image tag that was never built, and it would
   * break a deployment dispatched with a custom `image_tag`. What the audit
   * actually caught was a tag **17 majors** behind — an image predating many
   * user-visible releases. A major bump is by definition a user-visible change,
   * so requiring the majors to agree catches that while leaving the normal lag
   * (same major, older `Y`) alone.
   */
  it('is pinned to an image from the current major', () => {
    const version = read('VERSION').trim();
    const tag = imageRefs(SURFACES.manifest)
      .find((ref) => ref.name.endsWith('/retrogemini'))?.tag;
    expect(tag, 'the base manifest must pin an explicit image tag').toBeDefined();
    expect(tag, 'never pin a deployment to a floating tag').not.toBe('latest');

    const tagMajor = tag!.match(/^(\d+)\.\d+$/)?.[1];
    if (tagMajor === undefined) return; // A deliberate one-off tag; nothing to compare.
    expect(
      tagMajor,
      `k8s/base/deployment.yaml pins ${tag} while VERSION is ${version}: the manifest advertises an image from an earlier major, i.e. a build that predates user-visible releases`,
    ).toBe(version.split('.')[0]);
  });

  /**
   * Audit H7.2 / decision D4 — the pod security context.
   *
   * `securityContext: {}` meant plain Kubernetes enforced *nothing*: the pod
   * could have run as root with every capability. It stayed empty because
   * `docker-entrypoint.sh` starts as root to chown a mounted volume, which
   * looks incompatible with `runAsNonRoot: true`.
   *
   * The decision: keep the entrypoint, and pin the context anyway. This
   * Deployment mounts **no volume** (it runs on PostgreSQL), so the chown has
   * nothing to do here, and the entrypoint already handles being started as a
   * non-root UID — it skips the chown and execs the command directly.
   *
   * `readOnlyRootFilesystem` is deliberately absent: it is the one field with a
   * real failure mode behind it (a SQLite deployment writing to /data, anything
   * needing /tmp) and no matching gain here, so it is left to a change that can
   * be tested against a live cluster.
   */
  const securityContextBlocks = (relativePath: string) => {
    const lines = read(relativePath).split('\n');
    const blocks: { indent: number; body: string }[] = [];

    lines.forEach((line, index) => {
      if (!/^[^\S\n]*securityContext:/.test(line)) return;
      const indent = indentOf(line);
      const body: string[] = [line];
      for (let next = index + 1; next < lines.length; next += 1) {
        const candidate = lines[next];
        if (candidate.trim() === '') continue;
        if (indentOf(candidate) <= indent) break;
        body.push(candidate);
      }
      blocks.push({ indent, body: body.join('\n') });
    });

    return blocks;
  };

  it('pins a pod security context instead of leaving it empty', () => {
    const blocks = securityContextBlocks(SURFACES.manifest);
    expect(blocks, 'the Deployment must declare a securityContext').not.toEqual([]);
    expect(
      read(SURFACES.manifest),
      'an empty securityContext enforces nothing on plain Kubernetes',
    ).not.toMatch(/securityContext:[^\S\n]*\{\}/);

    // The pod-level block is the shallowest one; container blocks nest deeper.
    const podLevel = blocks.reduce((a, b) => (a.indent <= b.indent ? a : b));
    for (const field of [
      /runAsNonRoot:[^\S\n]*true/,
      /runAsUser:[^\S\n]*([1-9]\d*)/, // any non-root UID; never 0
      /fsGroup:[^\S\n]*\d+/,
      /seccompProfile:/,
      /type:[^\S\n]*RuntimeDefault/,
    ]) {
      expect(podLevel.body, `pod securityContext is missing ${field}`).toMatch(field);
    }
    expect(podLevel.body, 'runAsUser: 0 is root').not.toMatch(/runAsUser:[^\S\n]*0\b/);
  });

  /**
   * Audit H4 — `PUBLIC_BASE_URL` is per environment (dev and prod have different
   * Route hostnames, generated by OpenShift), so the base manifest cannot carry a
   * value. It carries the *wiring* instead, and each environment supplies the
   * value once through a ConfigMap that `apply -k` never overwrites — the same
   * apply-once lifecycle the Secrets already use.
   *
   * `optional: true` is the part that must not be lost. Without it, every
   * deployment that has not created the ConfigMap — which is the correct state
   * for a dev environment that does not send reset email — would fail to start
   * its pods at all. A missing origin must degrade to "no reset mail", never to
   * "no application".
   */
  it('wires PUBLIC_BASE_URL to an optional ConfigMap rather than a hard-coded value', () => {
    const lines = read(SURFACES.manifest).split('\n');
    const index = lines.findIndex((line) => /^[^\S\n]*-[^\S\n]*name:[^\S\n]*PUBLIC_BASE_URL[^\S\n]*$/.test(line));

    expect(index, 'the base manifest must declare the PUBLIC_BASE_URL env entry').toBeGreaterThan(-1);

    // The valueFrom block belongs to this entry: everything up to the next
    // sibling `- name:` at the same indentation.
    const indent = indentOf(lines[index]);
    const block: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      if (/^[^\S\n]*-[^\S\n]*name:/.test(lines[next]) && indentOf(lines[next]) <= indent) break;
      block.push(lines[next]);
    }
    const body = block.join('\n');

    expect(body, 'PUBLIC_BASE_URL is per environment; the base manifest must not pin a value').not.toMatch(/^[^\S\n]*value:/m);
    expect(body).toMatch(/configMapKeyRef:/);
    expect(
      body,
      'without optional: true, an environment with no ConfigMap cannot start its pods at all',
    ).toMatch(/optional:[^\S\n]*true/);
  });

  it('drops privileges on the container too', () => {
    const blocks = securityContextBlocks(SURFACES.manifest);
    const containerLevel = blocks.filter((block) => block.indent > Math.min(...blocks.map((b) => b.indent)));

    expect(containerLevel, 'the application container needs its own securityContext').not.toEqual([]);
    const merged = containerLevel.map((block) => block.body).join('\n');
    expect(merged).toMatch(/allowPrivilegeEscalation:[^\S\n]*false/);
    expect(merged).toMatch(/capabilities:/);
    expect(merged).toMatch(/drop:/);
    expect(merged).toMatch(/-[^\S\n]*(ALL|"ALL")/);
  });

  // There is deliberately no assertion on the CPU request. An earlier version of
  // this file required at least 50m, reasoning that the scrypt login path needs a
  // real guaranteed share. The cluster's OpenShift administrators specify 1m and
  // report that it works, so the manifest keeps 1m and the theory loses — a test
  // must not encode an opinion the people running the cluster have overruled.
});

describe('kustomize overlays (audit H16)', () => {
  // Derived from the base kustomization rather than hard-coded, so a resource
  // added to base is covered without editing this test.
  const baseResources = resourceFilesOf('k8s/base/kustomization.yaml')
    .flatMap((file) => {
      const id = resourceIdOf(`k8s/base/${file}`);
      return id ? [id] : [];
    });

  const baseImages = imageRefs('k8s/base/deployment.yaml').map((ref) => ref.name);

  const describeId = ({ kind, name }: ResourceId) => `${kind}/${name}`;

  // Read the directory rather than listing overlays here: `dev` and `prod` were
  // deleted (unreferenced by any documentation, and their patches had been
  // broken long enough that nobody noticed), and a hard-coded list would have
  // turned that clean-up into a test failure.
  const overlays = readdirSync(join(repoRoot, 'k8s/overlays'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  it('has at least one overlay to check', () => {
    expect(overlays).not.toEqual([]);
  });

  for (const overlay of overlays) {
    const dir = `k8s/overlays/${overlay}`;
    const kustomization = read(`${dir}/kustomization.yaml`);

    it(`targets resources that exist in base (${overlay})`, () => {
      // Two patch spellings, both of which must resolve to a real base resource:
      //
      //  - `patches[].target` (inline JSON6902). An unmatched target makes
      //    `kustomize build` fail outright, so a stale name disables the overlay.
      //  - `patches[].path` (strategic merge). The patch file's own kind/name is
      //    the selector. Checking only the inline form let the openshift overlay
      //    pass vacuously: it uses `path:` exclusively, so zero targets were
      //    examined and a stale `metadata.name` in either patch file would have
      //    gone unnoticed.
      const inline = inlinePatchTargets(kustomization);
      const fromFiles = patchPaths(kustomization).flatMap((file) => {
        const id = resourceIdOf(`${dir}/${file}`);
        return id ? [id] : [];
      });

      // An overlay that declares patches must resolve at least one target,
      // otherwise the assertion below means nothing. (`prod` declares none by
      // design — see the comment in its kustomization.)
      if (/^patches:/m.test(kustomization)) {
        expect(
          [...inline, ...fromFiles].length,
          `the ${overlay} overlay declares patches but none resolved — the check below would pass vacuously`,
        ).toBeGreaterThan(0);
      }

      const unmatched = [...inline, ...fromFiles]
        .filter((target) => !baseResources.some(
          (res) => res.kind === target.kind && res.name === target.name,
        ))
        .map(describeId);
      expect(unmatched).toEqual([]);
    });

    it(`does not pin a UID the platform assigns itself (${overlay})`, () => {
      // Audit H7.2 / D4. OpenShift's restricted SCC allocates each project a UID
      // range and injects a value from it; a pod that names its own UID outside
      // that range is *rejected at admission* — the deployment simply does not
      // start. So an overlay for such a platform must neutralise the base's
      // runAsUser/runAsGroup/fsGroup rather than inherit them. Setting a key to
      // null in a strategic-merge patch is how kustomize deletes it.
      const patchBodies = patchPaths(kustomization).map((file) => read(`${dir}/${file}`));
      const inheritsUidPinning = !patchBodies.some((body) => /runAsUser:[^\S\n]*null/.test(body));

      // Only the OpenShift overlay is known to need this; other overlays may
      // legitimately inherit the base context.
      if (overlay !== 'openshift') return;

      expect(
        inheritsUidPinning,
        'the openshift overlay must clear runAsUser/runAsGroup/fsGroup so the SCC can assign them',
      ).toBe(false);
      const merged = patchBodies.join('\n');
      expect(merged).toMatch(/runAsGroup:[^\S\n]*null/);
      expect(merged).toMatch(/fsGroup:[^\S\n]*null/);
      // runAsNonRoot must survive: the SCC assigns a non-root UID anyway, and
      // keeping it means the manifest still states the intent.
      expect(merged).not.toMatch(/runAsNonRoot:[^\S\n]*null/);
    });

    it(`renames images that exist in base (${overlay})`, () => {
      // Unlike a patch target, an unmatched `images[].name` fails silently:
      // kustomize applies nothing and the overlay ships the base tag.
      const renamed = imageOverrideNames(kustomization);
      expect(renamed.filter((name) => !baseImages.includes(name))).toEqual([]);
    });
  }
});

describe('cross-workflow dispatch inputs', () => {
  /**
   * `gh workflow run` sends its `-f` arguments to the dispatch API, which
   * validates them against the target workflow's declared `workflow_dispatch`
   * inputs and rejects the *whole* call on a mismatch:
   *
   *   HTTP 422: Unexpected inputs provided: ["update_k8s_manifests"]
   *
   * There is no partial success and no warning — the dispatched workflow simply
   * never starts. That is what decision D7 caused when it deleted
   * `update_k8s_manifests` from `docker-deploy.yml` and left
   * `github-release.yml` passing it: from 2026-08-03 every merge to `main` that
   * bumped `VERSION` published its GitHub release and then failed on the very
   * next step, because nobody re-read the caller. It stayed unnoticed for three
   * merges partly because images kept appearing anyway — they were being
   * dispatched by hand from the feature branches.
   *
   * The two sides live in different files, so nothing but a check like this one
   * connects them. On invariant 10, see the note at the top of this file: the
   * workflow YAML *is* the artefact under test here — the contract it breaks is
   * enforced by GitHub at dispatch time, not by any code this repo can exercise.
   */
  const workflowDir = '.github/workflows';
  const workflowFiles = readdirSync(join(repoRoot, workflowDir))
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));

  const calls = workflowFiles.flatMap((file) => dispatchCallsIn(`${workflowDir}/${file}`));

  it('finds the cross-workflow dispatches to check', () => {
    // Without this the assertions below pass vacuously if the scanner ever stops
    // recognising a call — which is the failure mode that would hide the very
    // regression this suite exists for.
    expect(calls.length).toBeGreaterThan(0);
  });

  it('parses the declared inputs of a dispatched workflow', () => {
    // Pins the other half of the scanner: an `dispatchInputsOf` that silently
    // returned nothing would make "passes only declared inputs" fail loudly
    // rather than pass, but the failure would point at the caller instead of at
    // this parser.
    const declared = dispatchInputsOf(`${workflowDir}/docker-deploy.yml`);
    expect([...declared.keys()]).toContain('image_tag');
  });

  for (const call of calls) {
    it(`dispatches a workflow that accepts a dispatch (${call.caller} → ${call.target})`, () => {
      expect(
        workflowFiles,
        `${call.caller} dispatches ${call.target}, which is not a workflow in ${workflowDir}`,
      ).toContain(call.target);
      expect(
        read(`${workflowDir}/${call.target}`),
        `${call.target} has no workflow_dispatch trigger, so ${call.caller} cannot dispatch it`,
      ).toMatch(/^[^\S\n]*workflow_dispatch:/m);
    });

    it(`passes only inputs ${call.target} declares (${call.caller})`, () => {
      const declared = dispatchInputsOf(`${workflowDir}/${call.target}`);
      const unexpected = call.inputs.filter((input) => !declared.has(input));
      expect(
        unexpected,
        `${call.caller} passes ${unexpected.join(', ')} to ${call.target}, which does not declare it — `
          + 'the dispatch API answers 422 and the workflow never runs',
      ).toEqual([]);
    });

    it(`passes every input ${call.target} requires (${call.caller})`, () => {
      // The same 422, from the other direction: adding a `required: true` input
      // to a workflow breaks every caller that does not pass it.
      const required = [...dispatchInputsOf(`${workflowDir}/${call.target}`)]
        .filter(([, isRequired]) => isRequired)
        .map(([name]) => name);
      expect(required.filter((input) => !call.inputs.includes(input))).toEqual([]);
    });
  }
});

describe('third-party action pinning (audit H37)', () => {
  /**
   * `uses: <action>@master` resolves at job-start time, so the code that runs is
   * whatever that repository's default branch holds right then. An upstream
   * account or supply-chain compromise therefore executes in this repo's runner
   * on the next push, with the job's `GITHUB_TOKEN` and the built image in hand,
   * and *nothing in this repository changes* — no merge, no review, no
   * Dependabot PR. A pinned ref has the opposite property: it can only move
   * through a commit here, which is also why pinning costs nothing (Dependabot
   * bumps a pinned action for you).
   *
   * `aquasecurity/trivy-action@master` was the single mutable ref across all
   * eight workflows. This test is the standing rule rather than the one-time
   * fix — the same lesson as the cross-workflow dispatch contract above: the
   * other side of this contract lives in someone else's repository.
   *
   * On invariant 10 (tests assert behaviour, never source text): as with the
   * rest of this file, the workflow YAML *is* the artefact under test. There is
   * no behaviour to assert instead — the resolution happens on GitHub's runners.
   */
  const workflowDir = '.github/workflows';
  const workflowFiles = readdirSync(join(repoRoot, workflowDir))
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));

  const usesLines = workflowFiles.flatMap((file) =>
    read(`${workflowDir}/${file}`)
      .split('\n')
      .map((line, index) => ({ file, line: line.trim(), lineNumber: index + 1 }))
      .filter(({ line }) => /^-?\s*uses:\s*\S+/.test(line)),
  );

  it('finds the `uses:` lines to check', () => {
    // Vacuity guard: if the scanner ever stops recognising a `uses:` line, the
    // assertion below would pass while checking nothing at all.
    expect(usesLines.length).toBeGreaterThan(0);
  });

  it('pins every action to an immutable ref, never a branch', () => {
    const mutable = usesLines
      .filter(({ line }) => /@(master|main|HEAD)\s*$/.test(line))
      .map(({ file, line, lineNumber }) => `${file}:${lineNumber} ${line}`);
    expect(mutable).toEqual([]);
  });

  /**
   * Every action gets the stronger form: a full commit SHA.
   *
   * This assertion exists because the first version of this fix pinned
   * `aquasecurity/trivy-action@0.33.1` — a plausible-looking version that is not
   * a ref this action publishes (its tags carry a `v` prefix), so the job died
   * with "unable to resolve action". The mutable-ref check above passed happily:
   * it knew `@master` was wrong but had no opinion on whether the replacement
   * resolved. A 40-character SHA cannot have that failure mode, cannot be moved
   * upstream at all, and Dependabot still bumps it when the trailing
   * `# vX.Y.Z` comment names the version.
   *
   * **It used to exempt `actions/*`, `github/*`, `docker/*` and `dependabot/*`**
   * — GitHub's and Docker's own — on the grounds that rewriting them would be
   * churn with a much weaker argument (audit H37). H47 withdrew the exemption,
   * and the reasoning is the part worth keeping: `@v7` is mutable *by whoever
   * owns the repository it names*, so the exemption never said "this ref is
   * safe", it said "we trust this owner to never lose control of it". That is a
   * trust assumption rather than a property of the ref, and it is the exact
   * assumption a supply-chain review asks us to stop making — H47's failure
   * scenario is a compromised release of a *popular* action, which describes
   * `actions/checkout` far better than it describes any third party here.
   * The ongoing cost is one Dependabot PR per release, which is what the
   * already-pinned `trivy-action` costs today.
   */
  it('pins every action to a full commit SHA', () => {
    const loose = usesLines
      // A local action (`uses: ./.github/actions/…`) is this repository's own
      // code, fixed by the commit under review, and a `docker://` reference
      // carries its own tag or digest. Neither has an upstream git ref to pin.
      .filter(({ line }) => !/uses:\s*(\.\/|docker:\/\/)/.test(line))
      .filter(({ line }) => !/@[0-9a-f]{40}\b/.test(line))
      .map(({ file, line, lineNumber }) => `${file}:${lineNumber} ${line}`);
    expect(loose).toEqual([]);
  });
});

describe('workflow token permissions (audit H47)', () => {
  /**
   * A pinned SHA says what code runs; it says nothing about what that code is
   * *allowed to do*. `ci.yml` and `e2e.yml` declared no `permissions:` at all,
   * so both inherited whatever the repository default `GITHUB_TOKEN` grants —
   * on the two workflows that run `npm ci`, i.e. the two that execute
   * dependency lifecycle scripts, in a repository that deploys to production
   * from its own workflows.
   *
   * Both placements are accepted, because both are correct. A top-level block
   * covers every job at once; a per-job block is the stricter form and is what
   * `codeql.yml` needs (one job wants `security-events: write`, and nothing
   * else should have it). What is refused is neither: silence resolves to a
   * repository setting that no pull request ever shows a reviewer.
   *
   * Same note on invariant 10 as the block above — the workflow YAML is the
   * artefact under test, and the resolution happens on GitHub's runners.
   */
  const workflowDir = '.github/workflows';
  const workflowFiles = readdirSync(join(repoRoot, workflowDir))
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'));

  /**
   * Indentation-driven, like every other reader in this file: no parser
   * dependency, and nothing being looked for spans a line. A job's own
   * `permissions:` sits exactly one level below its key, which is what
   * `jobIndent + 2` encodes — deliberately narrow, so the word appearing
   * inside a `run:` script cannot be mistaken for a declaration.
   */
  const permissionsCoverageOf = (file: string) => {
    const lines = read(`${workflowDir}/${file}`)
      .split('\n')
      .filter((line) => line.trim() !== '' && !/^[^\S\n]*#/.test(line));

    const hasTopLevel = lines.some((line) => /^permissions:/.test(line));
    const jobsWithout: string[] = [];

    let inJobs = false;
    let jobIndent: number | undefined;
    let currentJob: string | undefined;
    let currentJobDeclares = false;

    const closeJob = () => {
      if (currentJob !== undefined && !currentJobDeclares) jobsWithout.push(currentJob);
      currentJob = undefined;
      currentJobDeclares = false;
    };

    for (const line of lines) {
      const indent = indentOf(line);

      if (indent === 0) {
        closeJob();
        inJobs = /^jobs:/.test(line);
        jobIndent = undefined;
        continue;
      }
      if (!inJobs) continue;
      if (jobIndent === undefined) jobIndent = indent;

      if (indent === jobIndent) {
        closeJob();
        currentJob = /^[^\S\n]*([A-Za-z_][\w-]*):/.exec(line)?.[1];
        continue;
      }
      if (currentJob !== undefined && indent === jobIndent + 2 && /^[^\S\n]*permissions:/.test(line)) {
        currentJobDeclares = true;
      }
    }
    closeJob();

    return { hasTopLevel, jobsWithout };
  };

  it('finds the workflows to check', () => {
    // Vacuity guard, twinned with the one below: an empty directory listing
    // would make every assertion here pass while checking nothing.
    expect(workflowFiles.length).toBeGreaterThan(0);
  });

  it('reads both placements — top-level and per-job', () => {
    // Vacuity guard on the reader itself. If it stopped recognising either
    // shape, the assertion below would report a false failure on a compliant
    // workflow (loud), or — worse, once someone "fixed" it by loosening the
    // regex — pass on a workflow that declares nothing.
    expect(permissionsCoverageOf('dependabot-auto-merge.yml').hasTopLevel).toBe(true);

    const codeql = permissionsCoverageOf('codeql.yml');
    expect(codeql.hasTopLevel).toBe(false);
    expect(codeql.jobsWithout).toEqual([]);
  });

  it.each(
    readdirSync(join(repoRoot, '.github/workflows'))
      .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml')),
  )('declares least-privilege token permissions (%s)', (file) => {
    const { hasTopLevel, jobsWithout } = permissionsCoverageOf(file);
    expect(
      hasTopLevel || jobsWithout.length === 0,
      `${file} declares no top-level \`permissions:\` and these jobs declare none either: `
        + `${jobsWithout.join(', ')} — so they inherit the repository default GITHUB_TOKEN`,
    ).toBe(true);
  });
});

describe('release SBOM (audit H47)', () => {
  /**
   * The image is installed inside an air-gapped network, so the only moment an
   * operator can learn what is in it is the moment they fetch the release. That
   * makes the SBOM a *release asset*, not a CI artefact that expires.
   *
   * What this asserts is the one thing that fails silently. A release workflow
   * that generates `retrogemini-29.2-sbom.cdx.json` and uploads
   * `sbom.cdx.json` does not fail — `gh release upload` errors on a missing
   * file, but the two names drift apart the moment either is edited alone, and
   * the failure surfaces as a release that quietly carries no SBOM. Tying the
   * produced name to the uploaded one is therefore the assertion worth having;
   * "the step exists" is not.
   */
  const workflow = read('.github/workflows/github-release.yml');

  it('generates a CycloneDX SBOM of what actually ships', () => {
    const generate = /npm sbom([^\n]*)>\s*"([^"]+)"/.exec(workflow);
    expect(generate, 'no `npm sbom … > "<file>"` step in github-release.yml').not.toBeNull();

    const flags = generate![1];
    expect(flags).toContain('--sbom-format cyclonedx');
    // `--omit dev` is not cosmetic: the production image stage runs
    // `npm ci --omit=dev`, so a full-tree document would describe a tree that
    // is never installed anywhere.
    expect(flags).toContain('--omit dev');
  });

  it('stamps the release version onto the document it uploads', () => {
    // `npm sbom` takes the root component's version from package.json (1.1.0
    // since the repo began), not from VERSION, so an unstamped document
    // describes every release identically — the filename says 29.2 and the
    // identity inside says 1.1.0 (Codex, PR #434). The stamping step is what
    // makes the asset usable by an inventory scanner, and it is one deleted
    // line away from silently not happening.
    expect(workflow).toMatch(/node scripts\/stampSbom\.mjs/);

    const generated = /npm sbom[^\n]*>\s*"([^"]+)"/.exec(workflow)?.[1];
    const stamped = /node scripts\/stampSbom\.mjs\s+"([^"]+)"/.exec(workflow)?.[1];
    expect(stamped).toBe(generated);
  });

  it('uploads the file it just produced', () => {
    const produced = /npm sbom[^\n]*>\s*"([^"]+)"/.exec(workflow)?.[1];
    const uploaded = /gh release upload[^\n]*\n?[^\n]*"([^"]*sbom[^"]*)"/.exec(workflow)?.[1];

    expect(produced).toBeDefined();
    expect(uploaded).toBeDefined();
    expect(uploaded).toBe(produced);
  });
});
