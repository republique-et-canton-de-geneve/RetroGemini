import { existsSync, readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { dockerContextExcludes } from './helpers/dockerignore';

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

/**
 * A YAML file split into its documents on `---`.
 *
 * One file used to mean one resource, so the readers below stopped at the first
 * `kind:`/`metadata.name` pair. That silently under-read the moment a file
 * carried several documents — three NetworkPolicies in one file (H46), or the
 * OpenShift overlay patching two Deployments from one patch file (H40): the
 * extra documents were simply not examined, so a stale `metadata.name` in the
 * second one would pass the overlay check.
 */
const documentsIn = (source: string) => {
  const documents: string[][] = [[]];
  for (const line of source.split('\n')) {
    if (/^---[^\S\n]*$/.test(line)) documents.push([]);
    else documents[documents.length - 1].push(line);
  }
  return documents.map((lines) => lines.join('\n')).filter((doc) => doc.trim() !== '');
};

/** Top-level `kind:`, plus the `name:` inside the top-level `metadata:` block. */
const idOfDocument = (document: string): ResourceId | undefined => {
  let kind: string | undefined;
  let name: string | undefined;
  let inMetadata = false;

  for (const line of document.split('\n')) {
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

/** Every resource a manifest file declares, in document order. */
const resourceIdsOf = (relativePath: string): ResourceId[] =>
  documentsIn(read(relativePath)).flatMap((document) => {
    const id = idOfDocument(document);
    return id ? [id] : [];
  });

/**
 * Blocks introduced by a `securityContext:` key, each with its indentation.
 *
 * The shallowest is the pod-level one; anything deeper belongs to a container.
 * Shared by the application and the database Deployments (H7.2 and H40), which
 * are held to the same four guarantees.
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

/**
 * The four pod-level guarantees and the two container-level ones, asserted for
 * whichever Deployment is named. H7.2/D4 wrote them for the application pod;
 * H40 found the database pod — the one with all the data on it — still at
 * `securityContext: {}`, which enforces nothing at all on plain Kubernetes.
 */
const expectHardenedPodSpec = (relativePath: string) => {
  const blocks = securityContextBlocks(relativePath);
  expect(blocks, `${relativePath} must declare a securityContext`).not.toEqual([]);
  expect(
    read(relativePath),
    'an empty securityContext enforces nothing on plain Kubernetes',
  ).not.toMatch(/securityContext:[^\S\n]*\{\}/);

  const shallowest = Math.min(...blocks.map((block) => block.indent));
  const podLevel = blocks.find((block) => block.indent === shallowest)!;
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

  const containerLevel = blocks.filter((block) => block.indent > shallowest);
  expect(containerLevel, `${relativePath} needs a container securityContext too`).not.toEqual([]);
  const merged = containerLevel.map((block) => block.body).join('\n');
  expect(merged).toMatch(/allowPrivilegeEscalation:[^\S\n]*false/);
  expect(merged).toMatch(/capabilities:/);
  expect(merged).toMatch(/drop:/);
  expect(merged).toMatch(/-[^\S\n]*(ALL|"ALL")/);
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

type DispatchCall = { caller: string; target: string; inputs: string[]; ref: string | undefined; line: string };

/**
 * A workflow's lines with shell continuations joined, so that a command written
 * across several lines reads as one. Comment lines are dropped before joining:
 * a command that is commented out, or merely described in prose, as the
 * dispatch caller below describes itself, is not a command.
 */
const logicalLinesIn = (source: string): string[] => {
  const logicalLines: string[] = [];
  let pending = '';

  for (const line of source.split('\n')) {
    if (/^[^\S\n]*#/.test(line)) continue;
    const continues = /\\[^\S\n]*$/.test(line);
    pending += (pending === '' ? '' : ' ') + line.replace(/\\[^\S\n]*$/, '').trim();
    if (continues) continue;
    logicalLines.push(pending);
    pending = '';
  }
  if (pending !== '') logicalLines.push(pending);
  return logicalLines;
};

const logicalLinesOf = (relativePath: string): string[] => logicalLinesIn(read(relativePath));

/**
 * Every `gh workflow run <target>` in a workflow's `run:` blocks, with the input
 * names it passes and its `--ref`. Continuation lines are joined first, because
 * the call this exists to check is written across six of them.
 */
const dispatchCallsIn = (relativePath: string): DispatchCall[] => {
  return logicalLinesOf(relativePath).flatMap((line) => {
    const target = /gh workflow run[^\S\n]+(\S+)/.exec(line)?.[1];
    if (target === undefined) return [];
    const inputs = [...line.matchAll(/(?:--raw-field|--field|-f|-F)(?:=|[^\S\n]+)([A-Za-z_][\w-]*)=/g)]
      .map((match) => match[1]);
    const ref = /--ref(?:=|[^\S\n]+)("[^"]*"|\S+)/.exec(line)?.[1];
    return [{ caller: relativePath, target, inputs, ref, line }];
  });
};

type WorkflowStep = {
  name: string | undefined;
  id: string | undefined;
  uses: string | undefined;
  env: Map<string, string>;
  with: Map<string, string>;
  /** The `run:` script, dedented, comments included. */
  run: string;
};

/** A `key: value` line: the key, and everything after its colon. */
const keyLineOf = (line: string) => /^[^\S\n]*([\w-]+):(.*)$/.exec(line);

const workflowStepOf = (item: string[]): WorkflowStep => {
  // The first line carries the list's `-`: read it as the key it introduces.
  const lines = [item[0].replace(/^([^\S\n]*)-/, '$1 '), ...item.slice(1)];
  const keyIndent = indentOf(lines[0]);
  const keyAt = (key: string) =>
    lines.findIndex((line) => indentOf(line) === keyIndent && keyLineOf(line)?.[1] === key);
  const scalar = (key: string) => {
    const at = keyAt(key);
    return at === -1 ? undefined : keyLineOf(lines[at])?.[2].trim();
  };
  const block = (key: string) => {
    const at = keyAt(key);
    const body: string[] = [];
    if (at === -1) return body;
    for (const line of lines.slice(at + 1)) {
      if (line.trim() !== '' && indentOf(line) <= keyIndent) break;
      body.push(line);
    }
    while (body.length > 0 && body[body.length - 1].trim() === '') body.pop();
    return body;
  };
  const mapOf = (key: string) => new Map(block(key).flatMap((line): [string, string][] => {
    const entry = keyLineOf(line);
    return entry ? [[entry[1], entry[2].trim()]] : [];
  }));
  const runLines = block('run');
  const runIndent = Math.min(...runLines.filter((line) => line.trim() !== '').map(indentOf));

  return {
    name: scalar('name'),
    id: scalar('id'),
    uses: scalar('uses'),
    env: mapOf('env'),
    with: mapOf('with'),
    run: runLines.map((line) => line.slice(runIndent)).join('\n'),
  };
};

/**
 * The steps of a workflow's first `steps:` list, in order, which for the
 * single-job release workflow is all of them.
 *
 * Read line by line like everything above. A step starts at a `-` at the list's
 * indentation, and a comment line never starts or ends anything. A key of a step
 * is a line at the step's own indentation, and a block under a key (`run: |`,
 * `env:`, `with:`) is every line indented deeper than the key, blank lines
 * included: a line back at the key's indentation ends it, which is also where
 * YAML ends a block scalar.
 */
const workflowStepsOf = (relativePath: string): WorkflowStep[] => {
  const items: string[][] = [];
  let stepsIndent: number | undefined;
  let itemIndent: number | undefined;

  for (const line of read(relativePath).split('\n')) {
    if (stepsIndent === undefined) {
      if (/^[^\S\n]*steps:[^\S\n]*$/.test(line)) stepsIndent = indentOf(line);
      continue;
    }
    const structural = line.trim() !== '' && !/^[^\S\n]*#/.test(line);
    if (structural && indentOf(line) <= stepsIndent) break;
    const startsItem = structural
      && /^[^\S\n]*-[^\S\n]/.test(line)
      && (itemIndent === undefined || indentOf(line) === itemIndent);
    if (startsItem) {
      itemIndent = indentOf(line);
      items.push([line]);
    } else if (items.length > 0) {
      items[items.length - 1].push(line);
    }
  }
  return items.map(workflowStepOf);
};

/** A step's shell commands: continuations joined, comments and blank lines dropped. */
const commandsOf = (step: WorkflowStep | undefined): string[] =>
  logicalLinesIn(step?.run ?? '').filter((line) => line !== '');

/** Whether a shell line expands the variable `name`, as `$name` or `${name}`. */
const expands = (line: string, name: string) => line.includes(`$${name}`) || line.includes(`\${${name}}`);

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
  LOG_FORMAT: { k8sSecrets: NOT_A_SECRET },
  PG_POOL_MAX: { k8sSecrets: NOT_A_SECRET },
  RESTORE_MAX_BODY_MB: { k8sSecrets: NOT_A_SECRET },
  RESTORE_MAX_DECOMPRESSED_MB: { k8sSecrets: NOT_A_SECRET },
  ROSTER_BROADCAST_DEBOUNCE_MS: { k8sSecrets: NOT_A_SECRET },
  SESSION_CACHE_MAX: { k8sSecrets: NOT_A_SECRET },
  SESSION_CACHE_MAX_MB: { k8sSecrets: NOT_A_SECRET },
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
  PROXY_BASE_URL: { k8sSecrets: NOT_A_SECRET },
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
   * The image line is retagged by hand, and only in the pull request that bumps
   * `VERSION`'s major (decision D7 deleted the deploy workflow's `sed` and
   * auto-commit; the workflow no longer touches the manifests), so the tag lags
   * `VERSION` by the `Y` bumps since the last retag.
   *
   * Demanding exact equality would therefore be wrong: every `Y` bump would have
   * to retag the manifest, which D7 leaves to the major bump alone. What the audit actually
   * caught was a tag **17 majors** behind — an image predating many user-visible
   * releases. A major bump is by definition a user-visible change, so requiring
   * the majors to agree catches that while leaving the normal lag (same major,
   * older `Y`) alone.
   *
   * The retag names the version that pull request's merge publishes, which is
   * `VERSION` as it is merged: `X.Y`, not `X.0`, when the branch was deployed
   * and bumped `Y` before its merge. Main never publishes the branch's earlier
   * numbers, so a tag left at `X.0` sends the next `apply -k` to an image that
   * was never built (`45.0`, left behind while the branch went to 45.3) or to
   * a test build of the branch. This test cannot see that: a tag left behind
   * on the branch and the lag of later `Y` bumps on main are both the current
   * major with an older `Y`, and only main's history tells them apart.
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
  it('pins a pod security context instead of leaving it empty', () => {
    expectHardenedPodSpec(SURFACES.manifest);
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

/**
 * What `docker build .` sends, read from `.dockerignore` the way Docker reads
 * it (`helpers/dockerignore.ts`): every pattern is anchored at the root and the
 * last one that matches decides, so the file's text alone misleads.
 *
 * The builder stage copies the whole context (`COPY . .`) and builds the
 * bundle there, and Tailwind's source scan reads every file of it that no
 * `.gitignore` names. The root `.gitignore`, the one that names
 * `.claude/worktrees/`, is not in the context (`.dockerignore` drops it, at
 * the root only), and a worktree's own copy of it does not name the
 * worktree's components. An agent's checkout there (a whole copy of the
 * repository, often an older one) therefore put its components' classes into
 * the bundle's CSS, and every checkout made the context larger (113 MB in the
 * checkout where it was found). CI builds from a clean checkout and never saw
 * it.
 *
 * `.gstack/` is left out for what it holds: gstack's state, with its
 * browser's access token (`browse.json`), its cookies and storage when it
 * keeps them (`session-state.json`), the logs of the pages and requests it
 * made, and the probes and reports of `/qa` and `/review`. `COPY . .` put all
 * of it in the builder stage's layer. Tailwind's scan skips the directory
 * when it holds gstack's own `.gitignore` (`*`), which only the browser
 * writes: the review tools keep `.gstack/tmp/` out of git through
 * `.git/info/exclude`, which the context does not carry, so where only they
 * ran, the classes their probes name reached the bundle's CSS too.
 */
describe('Docker build context (.dockerignore)', () => {
  const leftOut = dockerContextExcludes(read('.dockerignore'));
  const dockerfile = read('Dockerfile');

  /**
   * The paths the Dockerfile's `COPY`s read from the context: every operand but
   * the last (the destination) of every `COPY` without `--from`, which reads a
   * stage instead. `.` is the builder's whole context.
   */
  const contextSources = dockerfile
    .split('\n')
    .filter((line) => /^COPY\s/.test(line))
    .map((line) => line.trim().split(/\s+/).slice(1))
    .filter((args) => !args.some((arg) => arg.startsWith('--from=')))
    .flatMap((args) => args.filter((arg) => !arg.startsWith('--')).slice(0, -1));

  /** A source's files: a glob at the root expanded, a directory walked, none when it is missing. */
  const filesOf = (source: string): string[] => {
    if (/[*?]/.test(source)) {
      expect(source, 'a COPY glob below the root, which this reader does not expand').not.toContain('/');
      const pattern = source
        .replace(/[.+^$(){}|\\]/g, (char) => `\\${char}`)
        .replace(/\*/g, '[^/]*')
        .replace(/\?/g, '[^/]');
      const glob = new RegExp(`^${pattern}$`);
      return readdirSync(repoRoot).filter((entry) => glob.test(entry));
    }
    const absolute = join(repoRoot, source);
    if (!existsSync(absolute)) return [];
    if (!statSync(absolute).isDirectory()) return [source];
    return (readdirSync(absolute, { recursive: true }) as string[])
      .map((entry) => `${source}/${entry}`)
      .filter((path) => statSync(join(repoRoot, path)).isFile());
  };

  // Each answer was checked against Docker's own matcher
  // (github.com/moby/patternmatcher v0.6.0) when this table was written: it
  // holds the helper to the rules the assertions below rely on.
  it.each([
    ['*.md\n!CHANGELOG.md', 'CHANGELOG.md', false],
    ['*.md\n!CHANGELOG.md', 'AGENTS.md', true],
    ['!CHANGELOG.md\n*.md', 'CHANGELOG.md', true], // the last pattern that matches decides
    ['*.md', 'docs/guide.md', false], // anchored at the root
    ['node_modules', 'server/node_modules/x.js', false],
    ['.claude/', '.claude/worktrees/agent/components/Session.tsx', true], // a directory takes what it holds
    ['.claude/\n!.claude/settings.json', '.claude/settings.json', false],
    ['.gitignore', '.gstack/.gitignore', false], // the root's alone: a directory's own copy stays
    ['**/*.test.*', '__tests__/x.test.ts', true],
    ['/dist/', 'dist/index.html', true],
  ])('reads %j as Docker does for %s (left out: %s)', (dockerignore, path, expected) => {
    expect(dockerContextExcludes(dockerignore)(path)).toBe(expected);
  });

  it("leaves the agents' working directories out of it", () => {
    // Claude Code's settings and agents' checkouts of the repository, often
    // older ones, whose components Tailwind's scan reads.
    const claudeFiles = [
      '.claude/worktrees/agent-a1b2c3/components/Session.tsx',
      '.claude/worktrees/agent-a1b2c3/index.css',
      '.claude/settings.json',
    ];
    // gstack's state, every file of it and not only its probes: its browser's
    // access token, cookies and storage, the logs of the pages and requests it
    // made, and the probes and reports of /qa and /review.
    const gstackFiles = [
      '.gstack/browse.json',
      '.gstack/session-state.json',
      '.gstack/browse-network.log',
      '.gstack/browse-audit.jsonl',
      '.gstack/qa-reports/qa-report-localhost-2026-11-23.md',
      '.gstack/tmp/qa-reports/run-20261123T000000Z/probe.mjs',
    ];
    expect(
      claudeFiles.filter((path) => !leftOut(path)),
      "these reach the builder's COPY . ., where Tailwind's scan reads a stale checkout's components and puts their classes into the bundle",
    ).toEqual([]);
    expect(
      gstackFiles.filter((path) => !leftOut(path)),
      "these reach the builder's COPY . ., which keeps gstack's browser credentials, its logs and its probes in that stage's layer",
    ).toEqual([]);
  });

  it('keeps every file the image copies from it', () => {
    const sources = contextSources.filter((source) => source !== '.');
    // AGENTS.md → *Files to Include in Docker*: the version API, both "What's
    // New" files and the server, beside everything else the stages copy.
    expect(sources).toEqual(expect.arrayContaining(['VERSION', 'CHANGELOG.md', 'CHANGELOG.fr.md', 'server.js']));
    const files = sources.flatMap((source) => {
      const found = filesOf(source);
      expect(found, `COPY ${source} finds nothing in the repository, and fails the build`).not.toEqual([]);
      return found;
    });
    expect(files.filter(leftOut), 'files the image copies but .dockerignore leaves out of the context').toEqual([]);
    // dist/ never comes from the context: the builder builds it, with its
    // precompressed files and its manifest, and the runtime stage takes it there.
    expect(dockerfile).toMatch(/^RUN npm run build$/m);
    expect(dockerfile).toMatch(/^COPY --from=builder \/app\/dist \.\/dist$/m);
  });
});

describe('opt-in OpenShift trusted CA configuration', () => {
  const patchPath = 'k8s/config-templates/trusted-ca.patch.yaml';
  const configMapPath = 'k8s/config-templates/trusted-ca.yaml';

  // These are deployment artefacts, like the base manifests above. Follow the
  // references between their blocks: merely finding a CA path somewhere in the
  // patch would pass even when Node reads a different file from the one mounted.
  const childrenOf = (source: string, key: string) => {
    const lines = source.split('\n');
    const index = lines.findIndex((line) => line.trim() === `${key}:`);
    expect(index, `missing YAML block ${key}`).toBeGreaterThan(-1);
    const indent = indentOf(lines[index]);
    const children: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
      if (indentOf(line) <= indent) break;
      children.push(line);
    }
    return children.join('\n');
  };

  const namedEntry = (source: string, name: string) => {
    const lines = source.split('\n');
    const index = lines.findIndex((line) => line.trim() === `- name: ${name}`);
    expect(index, `missing named YAML entry ${name}`).toBeGreaterThan(-1);
    const indent = indentOf(lines[index]);
    const body: string[] = [];
    for (let next = index + 1; next < lines.length; next += 1) {
      const line = lines[next];
      if (line.trim() === '' || line.trimStart().startsWith('#')) continue;
      if (indentOf(line) <= indent) break;
      body.push(line);
    }
    return body.join('\n');
  };

  const scalarOf = (source: string, key: string) => source.split('\n')
    .find((line) => line.trimStart().startsWith(`${key}:`))
    ?.trim().slice(key.length + 1).trim().replace(/^["']|["']$/g, '');

  it('requests the cluster trust bundle in a dedicated ConfigMap', () => {
    expect(resourceIdsOf(configMapPath)).toEqual([{ kind: 'ConfigMap', name: 'retrogemini-trusted-ca' }]);
    const source = read(configMapPath);
    expect(scalarOf(source, 'apiVersion')).toBe('v1');
    expect(scalarOf(childrenOf(source, 'labels'), 'config.openshift.io/inject-trusted-cabundle')).toBe('true');
    expect(source).toMatch(/^data:[^\S\n]*\{\}[^\S\n]*$/m);
    expect(source).not.toMatch(/^[^\S\n]*service\.beta\.openshift\.io\/inject-cabundle:/m);
  });

  it('points Node at the bundle actually mounted read-only on the application', () => {
    expect(resourceIdsOf(patchPath)).toEqual([{ kind: 'Deployment', name: 'retrogemini' }]);
    const source = read(patchPath);
    expect(scalarOf(source, 'apiVersion')).toBe('apps/v1');
    const pod = childrenOf(childrenOf(childrenOf(source, 'spec'), 'template'), 'spec');
    const container = namedEntry(childrenOf(pod, 'containers'), 'container');
    const env = namedEntry(childrenOf(container, 'env'), 'NODE_EXTRA_CA_CERTS');
    const mount = namedEntry(childrenOf(container, 'volumeMounts'), 'trusted-ca');
    const volume = namedEntry(childrenOf(pod, 'volumes'), 'trusted-ca');
    const configMap = childrenOf(volume, 'configMap');

    expect(scalarOf(configMap, 'name')).toBe(idOfDocument(read(configMapPath))?.name);
    expect(scalarOf(configMap, 'optional')).not.toBe('true');
    const items = childrenOf(configMap, 'items');
    expect(items).toMatch(/-[^\S\n]*key:[^\S\n]*ca-bundle\.crt/);
    expect(scalarOf(items, 'path')).toBe('ca-bundle.crt');
    expect(scalarOf(env, 'value')).toBe(`${scalarOf(mount, 'mountPath')}/${scalarOf(items, 'path')}`);
    expect(scalarOf(env, 'value')).toBe('/etc/retrogemini/trusted-ca/ca-bundle.crt');
    expect(scalarOf(mount, 'readOnly')).toBe('true');
    expect(imageRefs(patchPath), 'a trust fix must preserve the deployed application image').toEqual([]);
    const settings = source.split('\n').filter((line) => !line.trimStart().startsWith('#')).join('\n');
    expect(settings).not.toMatch(/NODE_TLS_REJECT_UNAUTHORIZED|ignoreTLS|rejectUnauthorized:[^\S\n]*false/);
  });

  it('leaves cluster-specific trust opt-in on generic shipped deployment paths', () => {
    // Environment overlays may opt into the CA templates, as the operator
    // guide recommends; only the generic deployment paths must stay neutral.
    const paths = [
      'k8s/base/kustomization.yaml',
      'k8s/overlays/openshift/kustomization.yaml',
      'k8s/overlays/nodeport/kustomization.yaml',
    ];
    for (const path of paths) {
      const references = [...resourceFilesOf(path), ...patchPaths(read(path))];
      expect(
        references.filter((entry) => /(?:^|\/)trusted-ca(?:\.patch)?\.yaml$/.test(entry)),
        `${path} must not require an OpenShift-specific trust bundle`,
      ).toEqual([]);
    }
  });
});

describe('database pod security context (audit H40)', () => {
  /**
   * H7.2/D4 hardened the application pod and stopped there. The PostgreSQL
   * Deployment beside it in the same kustomization kept `securityContext: {}`
   * — on the pod that holds every team record, every retrospective and every
   * backup, while the application pod is the one with no persistent data.
   *
   * State the exposure at the level it actually sits at: container root is not
   * node root here. These manifests set no `privileged`, no `hostPID`, no
   * `hostNetwork` and mount no host path, so reaching the node still needs a
   * separate escape — which is exactly what a dropped capability set and a
   * seccomp profile make harder.
   */
  const manifest = 'k8s/base/postgresql-deployment.yaml';

  it('holds the database pod to the same guarantees as the application pod', () => {
    expectHardenedPodSpec(manifest);
  });

  /**
   * `drop: [ALL]` and `runAsUser` are one decision, not two.
   *
   * `docker-entrypoint.sh` starts as root and re-execs itself through `gosu`
   * (`if [ "$(id -u)" = '0' ]; then exec gosu postgres …`), and gosu needs
   * CAP_SETUID/CAP_SETGID to do it. Dropping every capability from a pod that
   * still starts as root therefore stops the database from starting at all.
   * Naming a UID skips that branch: the entrypoint runs as postgres from the
   * first instruction and never needs the capability.
   */
  it('names the UID, because dropping ALL capabilities from a root start breaks gosu', () => {
    const blocks = securityContextBlocks(manifest);
    const shallowest = Math.min(...blocks.map((block) => block.indent));
    const podLevel = blocks.find((block) => block.indent === shallowest)!;

    expect(
      podLevel.body,
      'a pod that drops CAP_SETUID must not rely on the entrypoint dropping privileges itself',
    ).toMatch(/runAsUser:[^\S\n]*\d+/);
  });

  /**
   * The UID is a property of the image, not a preference.
   *
   * `postgres:15-alpine` creates its `postgres` account with `addgroup -g 70 -S`
   * / `adduser -u 70 -S`, while the Debian variants use `--uid=999`. initdb
   * calls getpwuid() and refuses to run as a UID with no passwd entry, so the
   * pair (image, runAsUser) has exactly one correct value and swapping the image
   * without the UID stops the database from starting.
   */
  it('pins a UID that exists in the image it pins', () => {
    const uid = /runAsUser:[^\S\n]*(\d+)/.exec(read(manifest))?.[1];
    const image = imageRefs(manifest).find((ref) => ref.name.endsWith('postgres'));

    expect(image?.tag, 'the database image must be pinned').toBeDefined();
    const expected = /alpine/.test(image!.tag!) ? '70' : '999';
    expect(
      uid,
      `${image!.name}:${image!.tag} creates its postgres account with UID ${expected}; initdb refuses a UID with no passwd entry`,
    ).toBe(expected);
  });

  /**
   * PGDATA must be a subdirectory of the mount, never the mount root.
   *
   * A PersistentVolume formatted ext4 arrives with a `lost+found` directory at
   * its root, and initdb refuses a non-empty directory with exactly that
   * complaint ("It contains a lost+found directory … Create a subdirectory
   * under the mount point"). `fsGroup` compounds it: it makes the mount root
   * group-writable, and initdb also refuses a data directory with group access.
   * The entrypoint creates PGDATA itself with `mkdir -p "$PGDATA"; chmod 00700`,
   * so a subdirectory gets the mode initdb wants.
   */
  it('points PGDATA at a subdirectory of the volume, not at the mount root', () => {
    const source = read(manifest);
    const mountPath = /mountPath:[^\S\n]*(\S+)/.exec(source)?.[1];
    const pgdata = /name:[^\S\n]*PGDATA[^\S\n]*\n[^\S\n]*value:[^\S\n]*(\S+)/.exec(source)?.[1];

    expect(mountPath, 'the database container must mount its volume').toBeDefined();
    expect(pgdata, 'PGDATA must be set explicitly; the image default is the mount root itself').toBeDefined();
    expect(
      pgdata!.startsWith(`${mountPath}/`),
      `PGDATA ${pgdata} must live under the mount ${mountPath}`,
    ).toBe(true);
    expect(pgdata, 'the mount root carries lost+found and the fsGroup bits; initdb refuses both').not.toBe(mountPath);
  });
});

describe('network posture (audit H46)', () => {
  /**
   * Four items of one shape: the platform left at its permissive default.
   * `SECURITY.md` has recommended network policies for as long as it has
   * existed, and the manifests shipped none.
   */
  const policyFile = 'k8s/base/networkpolicy.yaml';

  const policies = () => {
    const byName = new Map<string, string>();
    for (const document of documentsIn(read(policyFile))) {
      const id = idOfDocument(document);
      if (id?.kind === 'NetworkPolicy') byName.set(id.name, document);
    }
    return byName;
  };

  it('ships the policies', () => {
    expect([...policies().keys()].length).toBeGreaterThanOrEqual(3);
  });

  /**
   * Decision D21, 2026-08-26 — the policies are opt-in, and this asserts the
   * *absence* that makes them so.
   *
   * A NetworkPolicy cannot deny anything: the model is a union of allows, and a
   * "default deny" works only by being the sole policy selecting a pod. One
   * namespace-wide allow-all applied by someone else makes every policy in that
   * file inert — which is exactly what the Geneva OpenShift project turned out
   * to have (`expose-all-pod-from-outside`, `discuss-within-same-namespace`,
   * both `podSelector: {}`, both applied by the platform to every project).
   *
   * Installing them there anyway would be worse than installing nothing: an
   * auditor reads three NetworkPolicies and concludes the database is isolated.
   * So `apply -k` must not install them, and the file carries the check that
   * tells an operator whether applying it would achieve anything.
   */
  it('does not install them automatically, because an allow-all elsewhere makes them inert', () => {
    expect(
      resourceFilesOf('k8s/base/kustomization.yaml'),
      'apply -k must not install policies that may be decorative — see D21',
    ).not.toContain('networkpolicy.yaml');

    const source = read(policyFile);
    expect(source, 'the file must say it is opt-in').toMatch(/OPT-IN/);
    expect(
      source,
      'an operator needs the command that tells them whether applying it achieves anything',
    ).toMatch(/get networkpolicy/);
  });

  it('denies ingress by default', () => {
    const deny = [...policies().values()].find((doc) => /podSelector:[^\S\n]*\{\}/.test(doc));

    expect(deny, 'a policy selecting every pod with no ingress rule is what makes the others a floor').toBeDefined();
    expect(deny).toMatch(/policyTypes:/);
    expect(deny).toMatch(/-[^\S\n]*Ingress/);
    expect(deny, 'a default-deny with an `ingress:` rule is not a default-deny').not.toMatch(/^[^\S\n]+ingress:/m);
  });

  /**
   * This is the finding: any pod in the cluster that can resolve
   * `postgresql:5432` may attempt to connect to it.
   */
  it('lets only the application reach the database', () => {
    const policy = [...policies().values()].find((doc) => /app:[^\S\n]*postgresql-retrogemini/.test(doc));

    expect(policy, 'the database pod needs a policy naming who may reach it').toBeDefined();
    expect(policy, 'the allowed peer is the application pod').toMatch(/podSelector:[\s\S]*?app:[^\S\n]*retrogemini\b/);
    expect(policy).toMatch(/port:[^\S\n]*5432/);
  });

  /**
   * Ingress only, deliberately (Codex, PR #418). A default-deny that covers
   * egress and allows only the two known flows breaks the application in ways
   * that do not look like a network problem: DNS goes first, so the pod cannot
   * even resolve `postgresql`, and then SMTP, Redis and the LLM endpoint each
   * fail quietly because each of them is optional. Restricting egress means
   * enumerating kube-dns plus every endpoint an operator may configure later,
   * which is a separate piece of work.
   */
  it('never restricts egress, which would break DNS before anything else', () => {
    for (const [name, document] of policies()) {
      expect(document, `${name} must not declare Egress`).not.toMatch(/-[^\S\n]*Egress/);
      expect(document, `${name} must not declare an egress rule`).not.toMatch(/^[^\S\n]+egress:/m);
    }
  });

  /**
   * CIS Kubernetes 5.1.5/5.1.6 — the pods never call the Kubernetes API, so the
   * default ServiceAccount token is a cluster credential handed to a process
   * that has no use for it.
   */
  it('mounts no ServiceAccount token into pods that never call the API', () => {
    for (const manifest of ['k8s/base/deployment.yaml', 'k8s/base/postgresql-deployment.yaml']) {
      expect(
        read(manifest),
        `${manifest} hands its pod a cluster credential it never uses`,
      ).toMatch(/automountServiceAccountToken:[^\S\n]*false/);
    }
  });

  /**
   * The OpenShift overlay already patched this to ClusterIP, so production was
   * fine and the base — the documented plain-Kubernetes path, and the one a
   * reviewer reads — was not: a NodePort is reachable on every node and
   * bypasses the Route and its TLS termination entirely.
   */
  it('does not expose the application on a NodePort by default', () => {
    expect(
      read('k8s/base/service.yaml'),
      'the NodePort belongs in an opt-in overlay for local testing, not in base',
    ).not.toMatch(/type:[^\S\n]*NodePort/);
    expect(read('k8s/base/service.yaml')).not.toMatch(/nodePort:/);
  });

  it('keeps a NodePort available as an overlay, since local clusters need one', () => {
    const overlay = 'k8s/overlays/nodeport/service.patch.yaml';
    expect(read(overlay)).toMatch(/type:[^\S\n]*NodePort/);
    expect(resourceIdsOf(overlay)).toEqual([{ kind: 'Service', name: 'retrogemini-service' }]);
  });

  /**
   * Combined with the NodePort, a deployment following the base manifests served
   * team passwords and session tokens over plain HTTP.
   */
  it('asks the base Ingress for TLS', () => {
    const ingress = read('k8s/base/ingress.yaml');
    expect(ingress, 'the base Ingress must declare TLS for its host').toMatch(/^[^\S\n]+tls:/m);
    expect(ingress).toMatch(/secretName:/);
  });

  /**
   * A `tls:` block only *offers* HTTPS; on most controllers the same host keeps
   * answering plain HTTP, so a typed or pasted `http://` link still carries a
   * team password in clear text (Codex, PR #436). Declaring TLS and stopping
   * there is the failure mode this asserts against.
   *
   * The annotation checked is ingress-nginx's, which is the reference
   * controller for the plain-Kubernetes path these base manifests document.
   * There is no portable spelling — the manifest lists the equivalents for
   * Traefik, HAProxy, Contour and Istio, and OpenShift's Route carries
   * `insecureEdgeTerminationPolicy: Redirect` instead.
   */
  it('redirects HTTP to HTTPS rather than merely offering TLS', () => {
    expect(
      read('k8s/base/ingress.yaml'),
      'without a redirect the TLS block leaves plain HTTP answering on the same host',
    ).toMatch(/ssl-redirect:[^\S\n]*"true"/);
  });

  it('keeps the OpenShift Route redirecting too, since it bypasses the Ingress', () => {
    expect(read('k8s/overlays/openshift/route.yaml')).toMatch(/insecureEdgeTerminationPolicy:[^\S\n]*Redirect/);
  });
});

describe('kustomize overlays (audit H16)', () => {
  // Derived from the base kustomization rather than hard-coded, so a resource
  // added to base is covered without editing this test.
  const baseResources = resourceFilesOf('k8s/base/kustomization.yaml')
    .flatMap((file) => resourceIdsOf(`k8s/base/${file}`));

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
      // Every document in the patch file, not just the first: the OpenShift
      // overlay patches the application and the database Deployments from one
      // file (H40), and only reading the first would leave the second's target
      // unchecked.
      const fromFiles = patchPaths(kustomization).flatMap((file) => resourceIdsOf(`${dir}/${file}`));

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

describe('the release builds its image from its own tag', () => {
  /**
   * `gh release create "$VERSION" --target "$GITHUB_SHA"` puts the release's
   * tag on the commit the run started from. The image step dispatched
   * `docker-deploy.yml` with `--ref main`, which builds whatever main holds
   * when the build starts. Run by hand from a branch, to release that branch,
   * the workflow created the branch's release and published main's code under
   * the branch's version and as `latest`; and a second merge within the
   * build's minute was published under the first one's version. Building the
   * tag the release created is what ties the image to the release.
   *
   * A tag is only as good as what it points at, and three reviews of that
   * change found it pointing elsewhere, or nowhere, with nothing saying so:
   *
   * - a release created before the merge (a branch released by hand, then
   *   fixed without a bump, or main taking a Dependabot fix meanwhile): the
   *   merge rebuilt the old tag and moved the version and `latest` to it, and
   *   its only log line was "already exists; nothing to create";
   * - a tag left behind by a deleted release: `--target` is ignored for a tag
   *   that exists, so the new release was attached to the stale commit, and
   *   that commit was published, green;
   * - a draft named VERSION: `gh release view` finds it, a draft has no tag,
   *   and the dispatch failed with a bare "No ref found", so no image at all.
   *
   * And `latest` was pushed on every run, so re-running an older release's run
   * republished that older version as `latest`, which render.yaml and the
   * README pull.
   */
  const caller = '.github/workflows/github-release.yml';
  const workflow = read(caller);
  const publishes = dispatchCallsIn(caller).filter((call) => call.target === 'docker-deploy.yml');
  const releaseCreates = logicalLinesOf(caller).filter((line) => /gh release create/.test(line));

  const steps = workflowStepsOf(caller);
  const stepRunning = (pattern: RegExp) =>
    steps.findIndex((step) => commandsOf(step).some((line) => pattern.test(line)));
  const createAt = stepRunning(/gh release create/);
  const dispatchAt = stepRunning(/gh workflow run[^\S\n]+docker-deploy\.yml/);
  const checkAt = stepRunning(/\^\{tree\}/);
  const tagCheckoutAt = steps.findIndex((step) =>
    /^actions\/checkout@/.test(step.uses ?? '') && /^refs\/tags\//.test(step.with.get('ref') ?? ''));

  it("reads the workflow's steps", () => {
    // Pins the step reader the order checks below stand on: one that lost a
    // step, or a key of one, would make them pass or fail for the wrong reason.
    const readVersion = steps.find((step) => step.name === 'Read version');
    expect(readVersion?.id).toBe('version');
    expect(readVersion?.run).toContain('echo "value=$VERSION" >> "$GITHUB_OUTPUT"');
    expect(steps.filter((step) => /^actions\/checkout@/.test(step.uses ?? ''))).toHaveLength(2);
    expect(steps[dispatchAt]?.env.get('VERSION')).toBe('${{ steps.version.outputs.value }}');
    expect(createAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeGreaterThan(-1);
    expect(tagCheckoutAt).toBeGreaterThan(-1);
  });

  it('creates the release under the version it publishes, on the commit the run started from', () => {
    // Without `--target`, gh puts a new tag on the default branch's head, and
    // building that tag builds main again: the defect this suite is about.
    expect(releaseCreates).toHaveLength(1);
    expect(releaseCreates[0]).toMatch(/gh release create "\$VERSION"/);
    expect(releaseCreates[0]).toMatch(/--target "\$GITHUB_SHA"/);
  });

  it('dispatches the image build once', () => {
    expect(publishes).toHaveLength(1);
  });

  it('builds the image from the release tag, never from a branch', () => {
    expect(
      publishes[0]?.ref,
      `${caller} dispatches docker-deploy.yml on ${publishes[0]?.ref ?? 'no --ref'}: `
        + 'the image must be built from the tag the release created, "$VERSION"',
    ).toBe('"$VERSION"');
  });

  it('tags the image with the same version', () => {
    expect(publishes[0]?.line).toMatch(/-f image_tag="\$VERSION"/);
  });

  it('generates the SBOM from the release tag too', () => {
    // The image and its SBOM must describe one commit, the tag's. The tag can
    // be another commit than the run's own (a released branch, squash-merged):
    // the content check below makes their trees equal, and reading the tag
    // still ties the document to the image if that check ever changes.
    const tagCheckout = workflow.search(
      /uses: actions\/checkout@[^\n]*\n[^\S\n]*with:\n[^\S\n]*ref: refs\/tags\/\$\{\{ steps\.version\.outputs\.value \}\}/,
    );
    const lastCheckout = workflow.lastIndexOf('uses: actions/checkout@');
    const sbom = workflow.indexOf('npm sbom');
    expect(tagCheckout, `${caller} never checks out refs/tags/<version>`).toBeGreaterThan(-1);
    expect(lastCheckout, 'another checkout comes after the release tag one').toBe(tagCheckout);
    expect(sbom, 'the SBOM is generated before the release tag is checked out').toBeGreaterThan(tagCheckout);
  });

  it('creates the release before it dispatches the image or checks out the tag for the SBOM', () => {
    // A missing tag is created with the release. Read before that step, the
    // tag is either not there or not yet the one the release is attached to.
    expect(createAt, `${caller} never creates the release`).toBeGreaterThan(-1);
    expect(dispatchAt, 'the image is dispatched before the release step').toBeGreaterThan(createAt);
    expect(tagCheckoutAt, 'the tag is checked out for the SBOM before the release step').toBeGreaterThan(createAt);
  });

  it("checks that the tag holds this run's content before anything is published", () => {
    expect(checkAt, `${caller} never compares the tag's tree with this run's`).toBeGreaterThan(-1);
    expect(checkAt, 'the content check runs before the release step creates a missing tag').toBeGreaterThan(createAt);
    expect(checkAt, 'the content check runs after the image is dispatched').toBeLessThan(dispatchAt);

    const commands = commandsOf(steps[checkAt]);
    // The checkout fetches the run's commit alone, without its tags.
    expect(
      commands.some((line) => /\bgit fetch\b[^\n]*refs\/tags\/\$\{?VERSION\}?/.test(line)),
      'the tag is never fetched',
    ).toBe(true);

    // An annotated tag names a tag object: `^{commit}` follows it to the commit.
    const tagCommit = commands
      .map((line) => /(\w+)=\$\(git rev-parse\b[^\n]*"refs\/tags\/\$\{?VERSION\}?\^\{commit\}"/.exec(line)?.[1])
      .find((name) => name !== undefined);
    expect(tagCommit, 'the tag is never followed to its commit').toBeDefined();

    // Trees, not commits: a branch released by hand and then squash-merged
    // holds the same content under another commit, and that is not a refusal.
    const trees = commands.flatMap((line) => {
      const assigned = /(\w+)=\$\(git rev-parse\b[^\n]*"([^"\s]+)\^\{tree\}"\)/.exec(line);
      return assigned ? [{ name: assigned[1], revision: assigned[2] }] : [];
    });
    const tagTree = trees.find(({ revision }) => /^refs\/tags\/\$\{?VERSION\}?$/.test(revision));
    const runTree = trees.find(({ revision }) => /^(?:\$\{?GITHUB_SHA\}?|HEAD)$/.test(revision));
    expect(tagTree, "the tag's tree is never read").toBeDefined();
    expect(runTree, 'the tree of the commit the run started from is never read').toBeDefined();
    expect(
      commands.some((line) => /!=/.test(line) && expands(line, tagTree!.name) && expands(line, runTree!.name)),
      'the two trees are never compared',
    ).toBe(true);

    // When they differ the run stops, naming both commits and the way out.
    const refusal = commands.findIndex((line) =>
      /::error::/.test(line) && expands(line, tagCommit!) && expands(line, 'GITHUB_SHA'));
    expect(refusal, "no error names the tag's commit and this run's").toBeGreaterThan(-1);
    expect(commands[refusal]).toMatch(/Bump VERSION/);
    expect(commands[refusal]).toMatch(/\bdelete\b/);
    expect(commands[refusal + 1], 'the error is not followed by an exit').toMatch(/^exit[^\S\n]+1$/);
  });

  it('refuses a draft release named VERSION with its own message', () => {
    // `gh release view` finds a draft too, and a draft has no tag yet: the
    // dispatch failed on it with a bare "No ref found", and no image was built.
    const draftAt = stepRunning(/gh release view\b[^\n]*--json[^\S\n]+isDraft\b/);
    expect(draftAt, `${caller} never asks whether release VERSION is a draft`).toBeGreaterThan(-1);
    expect(draftAt, 'the draft is looked for after the release step').toBeLessThanOrEqual(createAt);

    const commands = commandsOf(steps[draftAt]);
    const refusal = commands.findIndex((line) => /::error::[^\n]*\bdraft\b/i.test(line));
    expect(refusal, 'no error says that a draft named VERSION is in the way').toBeGreaterThan(-1);
    expect(commands[refusal]).toMatch(/\bpublish\b/i);
    expect(commands[refusal]).toMatch(/\bdelete\b/i);
    expect(commands[refusal + 1], 'the error is not followed by an exit').toMatch(/^exit[^\S\n]+1$/);
  });

  it('moves latest only to the newest release', () => {
    // render.yaml and the README pull `latest`: a re-run of an older release's
    // run republished that older version under it.
    const dispatch = publishes[0]?.line ?? '';
    expect(dispatch, 'the image is pushed as latest whatever the release').not.toMatch(/push_latest=["']?true\b/);
    const variable = /(?:-f|--raw-field)[^\S\n]+push_latest="\$\{?(\w+)\}?"/.exec(dispatch)?.[1];
    expect(variable, `push_latest is not passed from a variable: ${dispatch}`).toBeDefined();

    const source = steps[dispatchAt]?.env.get(variable!) ?? '';
    const decidedBy = /^\$\{\{[^\S\n]*steps\.([\w-]+)\.outputs\.push_latest[^\S\n]*\}\}$/.exec(source)?.[1];
    expect(decidedBy, `push_latest is ${source || 'unset'}, not the output of a step`).toBeDefined();
    const decideAt = steps.findIndex((step) => step.id === decidedBy);
    expect(decideAt, "the releases are listed before this run's release exists").toBeGreaterThan(createAt);
    expect(decideAt, 'the newest release is decided after the image is dispatched').toBeLessThan(dispatchAt);

    const decision = commandsOf(steps[decideAt]);
    expect(
      decision.some((line) => /\bgh release list\b[^\n]*--exclude-drafts\b/.test(line)),
      'the releases are not listed without their drafts',
    ).toBe(true);
    expect(decision.some((line) => /\bsort[^\S\n]+-V\b/.test(line)), 'the versions are not sorted as versions').toBe(true);
    expect(decision.some((line) => /push_latest=true/.test(line))).toBe(true);
    expect(decision.some((line) => /push_latest=false/.test(line))).toBe(true);
    expect(decision.some((line) => /::notice::/.test(line)), 'nothing says why latest is not moved').toBe(true);
  });

  it('stops at the first failure in every step from the release to the dispatch', () => {
    // A `run:` block with no `shell:` runs under `bash -e`, with neither
    // pipefail nor nounset: a command that fails inside a pipeline goes
    // unnoticed, and an unset variable reads as an empty word.
    expect(createAt).toBeGreaterThan(-1);
    expect(dispatchAt).toBeGreaterThan(createAt);
    const loose = steps.slice(createAt, dispatchAt + 1)
      .filter((step) => step.run !== '')
      .filter((step) => commandsOf(step)[0] !== 'set -euo pipefail')
      .map((step) => step.name);
    expect(loose).toEqual([]);
  });
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

describe('codeql-action revision parity', () => {
  /**
   * `init`, `autobuild`, `analyze` and `upload-sarif` are four `uses:` lines
   * drawn from one repository, and they are **not independent**: `init` writes a
   * config file that the others read, and a reader refuses a config written by
   * another major — *"Loaded a configuration file for version 'A', but running
   * version 'B'"*. So the family is only ever correct at one revision.
   *
   * Dependabot has no way to know that. It opens one pull request per
   * sub-action, each of which is individually mergeable and collectively
   * breaks the workflow, and the repository reached exactly that state: with
   * `analyze` and `upload-sarif` on v4.38.0 while `init` and `autobuild` sat on
   * v3.37.8, CodeQL uploaded a *failed execution* on every push to `main` and
   * produced no alerts at all.
   *
   * **The reason this needs a test and not just a rule is that the workflow
   * does not go red.** `analyze` carries `continue-on-error: true` — deliberately,
   * so a repository without Advanced Security is not blocked — which turns the
   * mismatch into a one-second step inside a green job. Nothing a reviewer looks
   * at says code scanning stopped working. The `codeql-action` Dependabot group
   * added alongside this test makes the four arrive together; this assertion is
   * what catches the case the group cannot cover — a hand-edit, a partial
   * revert, or a merge that takes one side of a conflict.
   *
   * Same note on invariant 10 as the blocks above: the ref resolution happens on
   * GitHub's runners, so the workflow YAML is the artefact under test.
   */
  const workflowDir = '.github/workflows';
  const codeqlRefs = readdirSync(join(repoRoot, workflowDir))
    .filter((file) => file.endsWith('.yml') || file.endsWith('.yaml'))
    .flatMap((file) =>
      read(`${workflowDir}/${file}`)
        .split('\n')
        .map((line, index) => ({ file, line: line.trim(), lineNumber: index + 1 }))
        .filter(({ line }) => /uses:\s*github\/codeql-action\//.test(line)),
    )
    .map(({ file, line, lineNumber }) => {
      const [, subAction, sha] =
        /uses:\s*github\/codeql-action\/(\S+?)@([0-9a-f]{40})\b/.exec(line) ?? [];
      // The trailing `# vX.Y.Z` is what Dependabot reads to know which version a
      // SHA stands for, and it is the only human-readable statement of the
      // version in the file. A SHA that agrees while the comments disagree is a
      // file that lies to its next reader, so both halves are compared.
      const [, version] = /#\s*(v\S+)\s*$/.exec(line) ?? [];
      return { where: `${file}:${lineNumber}`, subAction, sha, version };
    });

  it('finds the codeql-action references to check', () => {
    // Vacuity guard: a scanner that silently matches nothing would make every
    // assertion below pass on an empty set. The workflows carry four such
    // references today; the floor is deliberately "more than one", since one
    // reference cannot disagree with itself and zero means the reader broke.
    expect(codeqlRefs.length).toBeGreaterThan(1);
  });

  it('reads a SHA and a version comment from every reference', () => {
    const unparsed = codeqlRefs
      .filter(({ sha, version }) => !sha || !version)
      .map(({ where }) => where);
    expect(unparsed).toEqual([]);
  });

  it('uses one revision for every codeql-action sub-action', () => {
    const revisions = codeqlRefs.map(({ where, subAction, sha, version }) => ({
      subAction,
      where,
      revision: `${sha} (${version})`,
    }));
    // Named per sub-action rather than counted: the thing a maintainer has to
    // act on is *which* reference is behind and what the rest are on, and a bare
    // "expected 1 revision, found 2" says neither. The vacuity guard above is
    // what covers the empty-set case this comparison would pass.
    const expected = revisions[0]?.revision;
    const divergent = revisions
      .filter(({ revision }) => revision !== expected)
      .map(
        ({ subAction, where, revision }) =>
          `${subAction} @ ${where} is on ${revision}, but the rest are on ${expected}`,
      );
    expect(divergent).toEqual([]);
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
