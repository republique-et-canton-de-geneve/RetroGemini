# Dependabot / Dependency Updates

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


### Automated Handling
- A GitHub Actions workflow (`.github/workflows/dependabot-auto-merge.yml`) automatically merges Dependabot PRs for **minor and patch** updates when CI passes
- **Major version** updates are flagged with a comment and require manual review due to potential breaking changes

### Manual Review Required For
- **Major version bumps** (e.g., ESLint 9→10, Tailwind 3→4) — check changelogs for breaking changes, update config files as needed
- **PRs with failing CI** — investigate failures, fix locally, and push fixes to the Dependabot branch
- **GitHub Actions major bumps** (e.g., docker/build-push-action v6→v7) — verify workflow compatibility

### When every Dependabot PR is red at once, look at `main` first

`Security Audit` and the Docker image scan judge the **whole** production
dependency tree, not the diff. An advisory published against a package `main`
already ships turns `main` red without a commit — and with it every open PR,
each failing on a package its own diff never touched. Fixing the Dependabot branches one by one cannot work;
the fix is one lockfile update on `main` (`npm update <pkg>` inside the existing
range — engine.io 6.6.9 → 6.6.11 on 2026-10-02; body-parser 2.3.0 →
2.4.0 on 2026-10-26). A clean production audit alone is not the finish line:
validate the rebuilt runtime image with Trivy too, since its advisory database
can require a newer fixed version. Two details that bite:

- **Regenerate the lockfile with npm 11** (`npx npm@11 …`), the npm Dependabot
  writes with. npm 10 strips the `"libc"` fields npm 11 wrote on the optional
  per-platform binaries it re-resolved (today the six `@rolldown/binding-linux-*`
  entries) — a gratuitous diff that the next npm 11 update puts back.
- **A Dependabot PR's red unit-test leg is not automatically flakiness.** The
  one that failed beside this audit was a real race in `TeamLogin` that had been
  failing on `main` too (see `HARDENING_STATUS.md` §1, 2026-10-02). Its cousin
  is the vacuous wait: `waitFor` on an element of the *first* render waits for
  nothing — wait on the element that depends on the data you are about to use.

### Some dependencies can only move as a set

Two families in this repo are versioned in lockstep, and a bump that arrives one
package at a time is **not a PR to fix, it is a PR that cannot pass**:

- **vitest.** `@vitest/coverage-v8@X` and `@vitest/ui@X` each declare an *exact*
  `peer vitest@"X"`, so while the three differ `npm ci` fails with `ERESOLVE`
  and every job in every workflow goes red behind the install — lint, tests,
  coverage, audit, build, the Docker scan and the e2e suite alike. The npm
  `vitest` group in `.github/dependabot.yml` covers **majors** for `vitest` and
  `@vitest/*` so they arrive in one PR; it is listed first because a dependency
  joins the first group that matches it.
- **`github/codeql-action/*`.** `init`, `autobuild`, `analyze` and
  `upload-sarif` read one shared config and refuse to run against a config
  written by another major: *"Loaded a configuration file for version 'A', but
  running version 'B'"*. Each sub-action is a separate Dependabot update, so the
  `codeql-action` group in the `github-actions` updater — majors included — is
  what makes them arrive as one PR. **The mismatch is not visible in a job
  conclusion**, because `analyze` carries `continue-on-error: true`: the job
  stays green while CodeQL uploads a *failed execution* and produces no alerts
  at all, and the only symptom is a one-second analysis step. So when you bump
  one, bump all of them in the same change, and read the *step* log rather than
  the job result. `__tests__/deploymentManifestParity.test.ts` →
  *codeql-action revision parity* asserts the four agree, which is the guard for
  what the group cannot cover: a hand-edit, a partial revert, or a conflict
  resolved one side at a time.

### Branch Protection Requirement
For auto-merge to work, the repository must have a branch protection rule on `main` that requires status checks to pass. The checks to mark as required are:
- **`CI Success`** — the single stable aggregate gate from `ci.yml` (see below)
- **`E2E Tests (Playwright)`** — from `e2e.yml`, which runs on every pull
  request (decision D5). It used to be gated to `workflow_dispatch` and
  Dependabot, so requiring it here described a check that never reported; the
  gate was removed rather than the instruction, because the React layer has no
  other automated guard.

Without branch protection, `--auto` merge will not wait for checks to pass.

> ✅ **Require the `CI Success` gate, not the individual matrix legs.** `ci.yml`
> ends with a `ci-success` job (context name `CI Success`) that `needs:` every
> other CI job — `lint-and-test` (the whole Node matrix), `build`, and
> `security-audit` — and, via `if: always()`, always reports a status that fails
> unless *every* dependency succeeded. Because the required check is this one
> stable name, **the Node matrix and the rest of `ci.yml` can change freely in a
> PR without ever touching repo settings.** This is deliberate: it keeps CI
> maintenance (e.g. bumping the Node matrix) in developer-controllable workflow
> files instead of admin-only branch-protection settings.
>
> ⚠️ **Never re-pin required checks to per-version legs** (`Lint, Type-Check & Test
> (22.x)`, `(26.x)`, …). A version that is required but later removed from the
> matrix never reports, so GitHub pins the PR at *"Expected — Waiting for status
> to be reported"* forever — which is exactly the trap the `CI Success` gate
> exists to avoid. Editing the required-checks list is a repo-settings action
> (Settings → Branches → the `main` rule → "Require status checks to pass") and
> cannot be done from a PR.
