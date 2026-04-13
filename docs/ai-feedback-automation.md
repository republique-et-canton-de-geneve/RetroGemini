# AI Feedback Automation

This document explains what is now implemented to automate feedback processing and how to test it end-to-end.

## What is implemented

1. **Feedback submission triggers automation dispatch**
   - When `/api/feedbacks/create` stores a feedback, the backend optionally triggers a GitHub `repository_dispatch` event.
   - Event payload includes a ready-to-use prompt for Claude Code and a suggested branch name.

2. **Automatic clarification for vague feedback**
   - If the feedback title/description is too short, automation does not start.
   - The backend writes an automatic comment in the feedback thread asking for clearer details.

3. **GitHub workflow for AI handoff**
   - Workflow: `.github/workflows/feedback-ai-autopilot.yml`
   - It stores payload + prompt as artifacts.
   - If `CLAUDE_CODE_WEBHOOK_URL` is configured, payload is forwarded to your external Claude Code orchestrator.
   - If not configured, it creates a tracking GitHub issue with the exact prompt and context.

4. **Release safety**
   - Manual Docker deploy checks tag uniqueness before push.
   - Main-branch auto release publishes `VERSION` and immutable `sha-<commit>` tags.

## Required environment variables (server)

```bash
FEEDBACK_AUTOMATION_ENABLED=true
FEEDBACK_AUTOMATION_GITHUB_REPO=owner/repo
FEEDBACK_AUTOMATION_GITHUB_TOKEN=ghp_xxx
FEEDBACK_AUTOMATION_EVENT_TYPE=feedback_hub_submission
FEEDBACK_AUTOMATION_MIN_TITLE_LENGTH=8
FEEDBACK_AUTOMATION_MIN_DESCRIPTION_LENGTH=40
```

## Required GitHub secrets

- `CLAUDE_CODE_WEBHOOK_URL` (optional but recommended): URL of your Claude Code orchestrator endpoint
- `CLAUDE_CODE_WEBHOOK_TOKEN` (optional): bearer token used when forwarding payload

If `CLAUDE_CODE_WEBHOOK_URL` is not set, automation remains testable and visible via created GitHub issues.

If you use only a monthly Claude subscription (without API token automation), leave these webhook secrets empty and use the fallback issue workflow.

## Testing checklist

1. Configure server env vars above.
2. Submit a **clear** feedback from Feedback Hub.
3. Verify in feedback thread:
   - status is set to `in_progress`
   - an automation bot comment is added
4. Verify GitHub Actions:
   - `Feedback AI Autopilot` workflow runs
   - prompt artifact is available
5. Verify fallback path:
   - if no webhook secret, a tracking issue is created automatically
6. Submit a **vague** feedback (short title/description):
   - confirm automation is not started
   - confirm clarification comment is added

## Versioning when multiple feedback PRs run in parallel

Recommended strategy:

1. Keep `VERSION` unchanged in feedback branches (`feedback/...`).
2. Each automation PR includes a release impact marker:
   - `feature` (major bump)
   - `fix` (minor bump)
3. After you choose which PRs to merge, bump version once on `main` based on the highest impact merged in that batch.

Example from `17.3`:

- 3 bug-fix PRs + 2 feature PRs open in parallel.
- You merge only the 3 bug-fix PRs first → bump to `17.4`.
- Later you merge 2 feature PRs together → bump to `18.0`.
- If after that you merge another bug-fix PR → bump to `18.1`.

This avoids version conflicts between concurrent AI branches and keeps release numbering under your control.

## Docker Hub tags: what is published and when

Two tag families are now used:

1. **Preview tags (one per feedback branch push)**
   - Workflow: `Docker Preview (Feedback Branches)`
   - Pattern: `preview-<branch-slug>-<short-sha>`
   - Purpose: test each feedback branch independently

2. **Stable tags (after merge on main)**
   - Workflow: `Auto Docker Release`
   - Patterns:
     - `<VERSION>` (e.g. `17.4`, `18.0`)
     - `sha-<commit>`
   - Purpose: candidate versions for Dev/Prod deployment

With your example (`17.3`, 3 bugs + 2 features), you get:
- 5 preview images (one per branch/commit)
- then stable tags only for what you merge on `main` (e.g. `17.4`, then `18.0`, then `18.1`)

## Claude Code orchestrator payload contract

The forwarded webhook payload includes:

- `feedbackId`
- `teamId`
- `teamName`
- `feedbackType`
- `title`
- `description`
- `submittedAt`
- `branchName`
- `prompt`

Your external orchestrator can use this payload to:
- run Claude Code against the configured repository,
- push a feature branch,
- open a PR,
- report back status into your own ticketing flow.
