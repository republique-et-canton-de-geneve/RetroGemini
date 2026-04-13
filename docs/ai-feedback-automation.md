# AI Feedback Automation Blueprint

This document defines a practical automation flow so each new Feedback Hub submission can be processed with minimal manual work.

## Goals

- Transform a user feedback into an AI development request automatically.
- Keep AGENTS.md conventions enforced (tests, TDD, versioning, changelog, CI quality gates).
- Produce a branch + pull request for each qualified feedback.
- Publish a unique Docker image when changes are merged and checks pass.
- Route unclear feedback to a clarification loop instead of generating low-quality code changes.

## Recommended End-to-End Flow

1. **Feedback submitted in Feedback Hub**
   - Backend emits an automation event (webhook or queue message) with:
     - `feedbackId`
     - `type` (`bug` or `feature`)
     - `title`
     - `description`
     - `teamId`
     - `reporter` (optional)

2. **Triage service validates payload quality**
   - If the feedback is too vague, mark status `needs-clarification` and post a request for extra details in the ticket thread.
   - If clear enough, continue automatically.

3. **AI coding job starts**
   - Build a standardized prompt that always includes:
     - `Suis les directives du fichier AGENTS.md`
     - exact feedback content
     - TDD requirement (write failing test first)
     - full validation requirement (`npm run ci`, `npm run test:coverage`, `npm audit --omit=dev --audit-level=high`, `npm run test:e2e`)
   - Run the AI coding agent on a dedicated branch:
     - `feedback/<feedbackId>-<short-slug>`

4. **Automated PR creation**
   - Push branch to GitHub.
   - Open PR with:
     - link back to feedback ID
     - summary of implemented behavior
     - test evidence
     - version bump rationale (`feature => major`, `bug => minor`)

5. **CI and quality gates**
   - PR must pass CI + e2e checks before merge.
   - Branch protection enforces no direct merge on failing checks.

6. **Post-merge image publishing**
   - After successful push on `main`, publish Docker image automatically.
   - Enforce uniqueness of `VERSION` tag to avoid accidental overwrite.
   - Also publish immutable `sha-<commit>` tag for traceability.

## Clarification Policy (Important)

When a feedback is unclear:

- Do **not** start coding automatically.
- Add a concise clarification comment in the ticket:
  - expected behavior
  - current behavior
  - steps to reproduce
  - screenshots/logs if available
- Re-run automation only when required information is provided.

## Repository Automation Added

- `.github/workflows/docker-deploy.yml`
  - Now fails fast if the target Docker tag already exists.
- `.github/workflows/auto-docker-release.yml`
  - Automatically publishes Docker images on successful `main` checks (CI/E2E workflow completion).
  - Pushes both `VERSION` and immutable `sha-<commit>` tags.

## Suggested Next Step (External Orchestration)

To fully automate from Feedback Hub to AI branch/PR creation, add a small orchestrator (GitLab CI job, GitHub App, or internal worker) that:

1. Listens for new feedback events.
2. Performs clarity classification.
3. Invokes Claude Code with the standardized prompt.
4. Pushes resulting branch and creates PR.
5. Updates feedback status (`queued`, `in-progress`, `needs-clarification`, `pr-open`, `merged`).

This keeps your current human validation model (deploy to Dev, then Prod) while removing repetitive manual preparation.
