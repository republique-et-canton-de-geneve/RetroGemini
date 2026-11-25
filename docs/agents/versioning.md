# Version Management

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


> ⚠️ **AI assistants get versioning and the changelog wrong most often.** Read
> the golden rule below and follow it exactly — do not improvise version numbers
> or invent extra changelog entries.

### The golden rule (VERSION ⇄ CHANGELOG)

One question decides **both** files: **is the change visible to end users?**

- **Yes — user-visible** (new feature, UX/behaviour improvement, removed
  feature): bump the **major** `X`, reset `Y` to `0`, **and** add exactly
  **one** consolidated CHANGELOG entry — plus its French counterpart in
  `CHANGELOG.fr.md`, in the same change.
- **No — internal / not user-facing** (bug fix, **security patch**, refactor,
  tests, docs, CI/CD, Docker/deploy, dependency bump, version bookkeeping): bump
  the **minor** `Y`, keep `X`, and add **no** CHANGELOG entry.

In other words: **a CHANGELOG entry exists if and only if you bumped `X`.** A bug
fix or a security patch bumps `Y` and is *never* written in the changelog — the
user cannot see it, so it does not belong in the user-facing "What's New".

### VERSION file

- Located at the repo root: `VERSION`. Format is `X.Y` (current example: `24.0`).
- **Read the current value first**, then move by exactly one step:
  - User-visible change → `X+1` and `Y=0` (e.g. `23.4` → `24.0`).
  - Internal change → `Y+1`, keep `X` (e.g. `23.4` → `23.5`).
- Never skip or invent numbers, never jump more than one step, never pick a
  number because it "looks nicer".
- One unit of work / pull request = **one** version bump, no matter how many
  files it touches. Bundle several user-visible changes into the same next `X`.
- Keep `publiccode.yml`'s `softwareVersion` equal to `VERSION` in the same change.
  The release workflow publishes that version when `VERSION` changes on `main`,
  including internal and documentation changes (unless a release of that
  version already holds other content, which stops the run: see the next
  bullet), so catalogue metadata must describe the version the merge will
  publish.
- **A release builds its image, and its SBOM, from its own tag, and only from
  a tag that holds the run's content.** `github-release.yml` creates the
  GitHub release, its tag on the commit the run started from (when a tag named
  `VERSION` exists already, as deleting a release leaves it, GitHub ignores
  `--target` and attaches the release to that tag), then checks the tag: it
  fetches it, follows an annotated tag to its commit and compares the tag's
  tree with the tree of the commit the run started from. Trees, not commits:
  a branch released by hand and then squash-merged or rebased (another commit,
  the same tree) passes, and its image is built from the tag. Only then does
  it dispatch `docker-deploy.yml` on that tag, named in full (`--ref
  refs/tags/<version>`, as the check fetches it: a short name is a branch's
  as much as a tag's, and a branch named like the version, whose tree the
  check never compared, could be built in the tag's place), with the
  version, and it generates the SBOM from a checkout of the same tag. That
  the dispatch API takes a qualified ref, as the dispatches that pass
  `github.ref` rely on, could not be checked offline: were it refused, the
  step would fail with an HTTP 422 and stop the run before any image is
  built or any SBOM attached, the release already created; the next release
  run settles it. Run by hand from a
  branch (Actions → *Publish GitHub Release* → the branch), it therefore
  releases that branch whole; with `--ref main`, as it was until 45.2, it
  published main's code under the branch's version. When the trees differ the
  run stops before any image is published, on a push to `main` and on a
  manual dispatch alike (a release this run attached to a stale tag stays,
  and its error says so): it lists the files that differ, and its error names
  the tag's commit and the run's, then the way out: bump `VERSION` so this
  content gets its own release, or, when the tag is stale and nothing was
  published from it, delete the release with its tag
  (`gh release delete <version> --cleanup-tag --yes`) and run the workflow
  again. A draft release named `VERSION` is refused before anything is
  created, with its own error: a draft has no tag, so there is nothing to
  build; publish it or delete it, then run the workflow again. **So a branch
  released by hand, then fixed
  without a bump or merged into a `main` that took other commits since (a
  Dependabot fix), fails its merge's run until `VERSION` is bumped**: the
  rule below that a deployed branch bumps `Y` again, enforced at release time.
  A branch whose merge should republish it is released from the tree it will
  be merged with (rebased onto the latest `main`). A merge whose release
  already exists, and whose tag holds its tree, is rebuilt from that tag as a
  new build (the base image and its Alpine packages may be newer), and the
  version tag moves to it: deploy a tested image by its digest. `latest`,
  which `render.yaml` and the README pull, moves only to the release that is
  the newest when its image is dispatched: a step lists the releases that are
  not drafts, counts `VERSION` in, keeps the `X.Y` names, sorts them with
  `sort -V` (45.10 above 45.9) and passes `push_latest=false`, with a notice,
  when a higher one exists. A re-run of an older release's run, or a release
  of an older line, therefore leaves `latest` alone when the run's commit
  carries that step. A re-run replays the workflow of its own commit, and
  before the step that workflow passed `push_latest=true` on every run: a
  re-run of a run from before it still moves `latest`, and so does a release
  of an older line dispatched from a branch whose workflow predates it. Two
  `VERSION` bumps merged within one build's few minutes can also leave
  `latest` on the lower one: when the lower run decides before the higher
  release exists, both pass `push_latest=true`, and the build that finishes
  last holds the tag (neither workflow has a `concurrency` group, and one
  would not cure it: GitHub keeps a single pending run per group and cancels
  the others, so a release's build could be dropped). The steps
  from the release to the dispatch run under `set -euo pipefail`.
  `docker-deploy.yml` dispatched by hand still defaults `push_latest` to
  `true`. `__tests__/deploymentManifestParity.test.ts` → *the release builds
  its image from its own tag*, which runs the newest-release step's own script
  under bash with a stand-in `gh` rather than only reading its lines: the
  newest release, a higher one, 45.10 against 45.9, the first release, a
  draft, names that are not `X.Y`, and `gh` failing.
- The Docker deploy action reads `VERSION`, so every deployable change needs a
  bump (user-visible → `X`, internal → `Y`).
- ⚠️ **Those two rules meet as soon as a version has been deployed, and the
  second one wins.** "One pull request = one bump" describes a branch nobody has
  released yet. The moment a version is built and deployed — which is how the
  maintainer tests a branch before merging it — that number is spent: pushing
  more commits without a further bump makes the deploy action produce the *same
  image tag*, so the new work is untestable and the previous image is silently
  overwritten. So **once a branch has been deployed, every subsequent push that
  is meant to be deployed bumps `Y` again** (`31.1` → `31.2` → …), still with no
  CHANGELOG entry while `X` is unchanged. Do this without being asked: the
  maintainer should never have to request a bump so they can redeploy.
- **A major bump also retags the Kubernetes base manifest.**
  `k8s/base/deployment.yaml` pins the image tag, and **you** rewrite that line —
  decision D7 deleted the auto-commit step that used to do it (it had never once
  executed, and it would have pushed to whatever branch the deploy was dispatched
  from). So the tag lags `VERSION` by the `Y` bumps since the last retag, which is
  fine: `__tests__/deploymentManifestParity.test.ts` only fails when the *majors*
  diverge — the tag had been left 17 majors behind, advertising an image that
  predated many user-visible releases. An `X` bump should retag the manifest
  in the same pull request, to the version that pull request's merge
  publishes: `VERSION` as it is merged, since main publishes only that. That
  is `X.Y`, not `X.0`, when the branch was deployed and bumped `Y` before its
  merge, so each further `Y` bump of a deployed major branch retags the line
  again before the merge; any other `Y` bump needs nothing. The parity test
  checks the major only and cannot see a tag left at `X.0`: on the branch,
  that tag and main's normal lag after a later `Y` bump both read as the
  current major with an older `Y`. That limit is the residual, and the slip
  happened at least five times: the manifest named 35.0, 36.0, 41.0 and 42.0
  when main first published 35.5, 36.2, 41.4 and 42.2 (none of those four has
  a GitHub release; Docker Hub holds no 35.0, 36.0 or 41.0, and its 42.0 is a
  branch's test build), and it named 45.0 on 45.x's branch, retagged to 45.3
  before its merge.
