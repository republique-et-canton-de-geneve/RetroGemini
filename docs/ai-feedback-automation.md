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
