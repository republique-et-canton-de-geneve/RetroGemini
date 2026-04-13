# Automation Test Checklist (Feedback → PR → Docker)

Use this checklist to test the full automation pipeline quickly.

## How the trigger works from internal OpenShift

1. A user submits feedback in RetroGemini (running in OpenShift).
2. Backend route `/api/feedbacks/create` stores the feedback.
3. An email notification is sent to admin with a Claude-ready prompt and "Open Claude" link.
4. If `FEEDBACK_AUTOMATION_ENABLED=true`, backend behavior depends on mode:
   - `FEEDBACK_AUTOMATION_OFFLINE_MODE=false`: call GitHub `repository_dispatch`.
   - `FEEDBACK_AUTOMATION_OFFLINE_MODE=true`: write payload JSON locally to outbox path.
5. GitHub starts `Feedback AI Autopilot`.
6. If `CLAUDE_CODE_WEBHOOK_URL` is configured, payload is forwarded to your orchestrator.
7. If not configured, a fallback GitHub issue is created (this is the recommended path for monthly subscription usage).

So:
- Online mode: no Claude token needed, but GitHub token is required.
- Offline mode: no Claude token and no GitHub token; payloads are queued locally.

## 1) Server environment variables

Set these on the RetroGemini server (Dev environment):

```bash
FEEDBACK_AUTOMATION_ENABLED=true
FEEDBACK_AUTOMATION_GITHUB_REPO=<owner>/<repo>
FEEDBACK_AUTOMATION_GITHUB_TOKEN=<github_token_with_repo_access>
FEEDBACK_AUTOMATION_EVENT_TYPE=feedback_hub_submission
FEEDBACK_AUTOMATION_OFFLINE_MODE=false
FEEDBACK_AUTOMATION_OUTBOX_PATH=/tmp/feedback-automation-outbox
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

> Important: there is no built-in "Claude subscription webhook URL" provided by Anthropic for Pro/Max subscriptions.
> `CLAUDE_CODE_WEBHOOK_URL` is only needed if **you** operate your own orchestrator endpoint.
> If you want to use only your monthly Claude subscription, keep these webhook secrets empty and use the fallback issue flow.

## 2.1) Network requirement from OpenShift

In online mode, your RetroGemini pod must be able to reach:
- `api.github.com` (to trigger `repository_dispatch`)

If your internal cluster cannot access GitHub, set `FEEDBACK_AUTOMATION_OFFLINE_MODE=true`.

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
3. Verify one of:
   - online mode: `Feedback AI Autopilot` workflow runs
   - offline mode: payload file exists in outbox path
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
