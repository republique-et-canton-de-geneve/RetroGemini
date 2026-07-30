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
const PG_GROUP = 'PostgreSQL credentials are documented as a group (see `DATABASE_URL`) and shipped via k8s/secrets-templates/postgresql-secret.yaml';
const OPENSHIFT_ALIAS = 'fallback alias injected by Kubernetes/OpenShift itself — never set by an operator, so it belongs with the Kubernetes guidance only';
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

  // --- PostgreSQL connection: credentials, plus the platform-injected aliases. ---
  POSTGRES_DB: { readme: PG_GROUP, agents: PG_GROUP },
  POSTGRES_HOST: { readme: PG_GROUP, agents: PG_GROUP },
  POSTGRES_PASSWORD: { readme: PG_GROUP, agents: PG_GROUP },
  POSTGRES_USER: { readme: PG_GROUP, agents: PG_GROUP },
  POSTGRES_PORT: {
    readme: PG_GROUP,
    agents: PG_GROUP,
    manifest: 'defaults to 5432; the bundled postgresql Service does not move it',
    k8sSecrets: 'defaults to 5432; not part of the credential set',
  },
  // Required on the two surfaces an operator actually consults for them:
  // the AGENTS.md variable list and the Kubernetes/OpenShift guide.
  POSTGRESQL_DATABASE: { envExample: OPENSHIFT_ALIAS, readme: OPENSHIFT_ALIAS, manifest: OPENSHIFT_ALIAS, k8sSecrets: OPENSHIFT_ALIAS },
  POSTGRESQL_PASSWORD: { envExample: OPENSHIFT_ALIAS, readme: OPENSHIFT_ALIAS, manifest: OPENSHIFT_ALIAS, k8sSecrets: OPENSHIFT_ALIAS },
  POSTGRESQL_SERVICE_HOST: { envExample: OPENSHIFT_ALIAS, readme: OPENSHIFT_ALIAS, manifest: OPENSHIFT_ALIAS, k8sSecrets: OPENSHIFT_ALIAS },
  POSTGRESQL_SERVICE_PORT: { envExample: OPENSHIFT_ALIAS, readme: OPENSHIFT_ALIAS, manifest: OPENSHIFT_ALIAS, k8sSecrets: OPENSHIFT_ALIAS },
  POSTGRESQL_USER: { envExample: OPENSHIFT_ALIAS, readme: OPENSHIFT_ALIAS, manifest: OPENSHIFT_ALIAS, k8sSecrets: OPENSHIFT_ALIAS },

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

describe('base deployment manifest (audit H7.1 / H7.3)', () => {
  const manifest = surfaceText.manifest;

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
    const tag = manifest.match(/image:\s*\S+\/retrogemini:(\S+)/)?.[1];
    expect(tag, 'the base manifest must pin an explicit image tag').toBeDefined();
    expect(tag, 'never pin a deployment to a floating tag').not.toBe('latest');

    const tagMajor = tag!.match(/^(\d+)\.\d+$/)?.[1];
    if (tagMajor === undefined) return; // A deliberate one-off tag; nothing to compare.
    expect(
      tagMajor,
      `k8s/base/deployment.yaml pins ${tag} while VERSION is ${version}: the manifest advertises an image from an earlier major, i.e. a build that predates user-visible releases`,
    ).toBe(version.split('.')[0]);
  });

  it('requests enough CPU for a scrypt password verification', () => {
    const cpuRequest = manifest.match(/requests:\s*\n(?:\s*#.*\n)*\s*cpu:\s*(\S+)/)?.[1];
    expect(cpuRequest).toBeDefined();
    const millicores = cpuRequest!.endsWith('m')
      ? Number(cpuRequest!.slice(0, -1))
      : Number(cpuRequest) * 1000;
    // Login derives scrypt at N=16384 (~16 MB and real CPU per verify). A 1m
    // request means the pod is scheduled with essentially no guaranteed CPU and
    // logins stall under node contention.
    expect(millicores).toBeGreaterThanOrEqual(50);
  });
});

describe('kustomize overlays (audit H16)', () => {
  const base = ['deployment', 'postgresql-deployment', 'postgresql-service', 'pvc', 'service', 'ingress', 'poddisruptionbudget']
    .flatMap((file) => {
      const text = read(`k8s/base/${file}.yaml`);
      const kind = text.match(/^kind:\s*(\S+)/m)?.[1];
      const name = text.match(/^metadata:\n(?:\s+.*\n)*?\s+name:\s*(\S+)/m)?.[1];
      return kind && name ? [{ kind, name }] : [];
    });

  const baseImages = [...read('k8s/base/deployment.yaml').matchAll(/^\s*image:\s*(\S+?)(?::\S+)?$/gm)]
    .map((match) => match[1]);

  for (const overlay of ['dev', 'prod', 'openshift']) {
    const kustomization = read(`k8s/overlays/${overlay}/kustomization.yaml`);

    it(`targets resources that exist in base (${overlay})`, () => {
      // `patches[].target` with no matching resource makes `kustomize build`
      // fail outright, so a stale name silently disables the whole overlay.
      const targets = [...kustomization.matchAll(/target:\s*\n\s*kind:\s*(\S+)\s*\n\s*name:\s*(\S+)/g)];
      const unmatched = targets
        .filter(([, kind, name]) => !base.some((res) => res.kind === kind && res.name === name))
        .map(([, kind, name]) => `${kind}/${name}`);
      expect(unmatched).toEqual([]);
    });

    it(`renames images that exist in base (${overlay})`, () => {
      // Unlike a patch target, an unmatched `images[].name` fails silently:
      // kustomize applies nothing and the overlay ships the base tag.
      const named = [...kustomization.matchAll(/^\s*-\s*name:\s*(\S+)\s*$/gm)].map((match) => match[1]);
      expect(named.filter((name) => !baseImages.includes(name))).toEqual([]);
    });
  }
});
