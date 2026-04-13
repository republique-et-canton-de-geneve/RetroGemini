# Automation Test Checklist (Feedback → PR → Docker)

Use this checklist to test the full automation pipeline quickly.

## 1) Server environment variables

Set these on the RetroGemini server (Dev environment):

```bash
FEEDBACK_AUTOMATION_ENABLED=true
FEEDBACK_AUTOMATION_GITHUB_REPO=<owner>/<repo>
FEEDBACK_AUTOMATION_GITHUB_TOKEN=<github_token_with_repo_access>
FEEDBACK_AUTOMATION_EVENT_TYPE=feedback_hub_submission
FEEDBACK_AUTOMATION_MIN_TITLE_LENGTH=8
FEEDBACK_AUTOMATION_MIN_DESCRIPTION_LENGTH=40
```

## 2) GitHub repository secrets (Actions)

Required for Docker workflows:

- `DOCKERHUB_USERNAME`
- `DOCKERHUB_TOKEN`
- `DOCKERHUB_REPOSITORY` (example: `jpfroud/retrogemini`)

Optional for Claude handoff:

- `CLAUDE_CODE_WEBHOOK_URL`
- `CLAUDE_CODE_WEBHOOK_TOKEN`

If Claude webhook secrets are missing, fallback behavior creates a tracking issue automatically.

## 3) Workflows that should run

- `Feedback AI Autopilot` (on repository_dispatch)
- `Docker Preview (Feedback Branches)` (on push to `feedback/**`)
- `CI` (PR / push)
- `Auto Docker Release` (after successful CI on `main`)
- `Deploy Docker Image` (manual workflow_dispatch)

## 4) Quick validation scenario

1. Submit one clear feedback from Feedback Hub.
2. Verify the feedback receives:
   - status `in_progress`
   - Automation Bot comment
3. Verify `Feedback AI Autopilot` workflow runs.
4. Push on the generated `feedback/**` branch and verify preview Docker tag:
   - `preview-<branch>-<short-sha>`
5. Merge selected PR(s) to `main`.
6. Verify stable Docker tags from `Auto Docker Release`:
   - `<VERSION>`
   - `sha-<commit>`

## 5) Version behavior reminder

- Preview branches do **not** publish stable version tags.
- Stable version tags are published only from `main`.
- For multiple feedback PRs, choose merged scope first, then bump one consolidated stable version.
