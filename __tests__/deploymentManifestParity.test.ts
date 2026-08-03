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
