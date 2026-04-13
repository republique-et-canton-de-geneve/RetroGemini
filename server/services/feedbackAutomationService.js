import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const DEFAULT_EVENT_TYPE = 'feedback_hub_submission';
const DEFAULT_MIN_DESCRIPTION_LENGTH = 40;
const DEFAULT_MIN_TITLE_LENGTH = 8;

const slugify = (value) =>
  (value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42) || 'feedback';

const isFeedbackClear = ({ title, description, minTitleLength, minDescriptionLength }) => {
  const cleanedTitle = (title || '').trim();
  const cleanedDescription = (description || '').trim();

  if (cleanedTitle.length < minTitleLength) {
    return false;
  }
  if (cleanedDescription.length < minDescriptionLength) {
    return false;
  }

  const words = cleanedDescription.split(/\s+/).filter(Boolean);
  return words.length >= 8;
};

const buildPrompt = ({ feedback, branchName, releaseImpact }) => `Suis les directives du fichier AGENTS.md

Feedback ID: ${feedback.id}
Team: ${feedback.teamName} (${feedback.teamId})
Type: ${feedback.type}
Release impact: ${releaseImpact}
Title: ${feedback.title}
Description:
${feedback.description}

Assure-toi que:
- le développement suit une approche TDD (test qui échoue puis correction)
- les tests passent: npm run ci, npm run test:coverage, npm audit --omit=dev --audit-level=high, npm run test:e2e
- la PR indique clairement "release impact: feature" ou "release impact: fix"
- ne modifie pas VERSION/CHANGELOG dans la branche feedback (versioning consolidé au moment du merge)
- une PR est créée avec le contexte du feedback

Branche suggérée: ${branchName}`;

const createFeedbackAutomationService = ({
  env = process.env,
  logService,
  fetchImpl = fetch
} = {}) => {
  const enabled = String(env.FEEDBACK_AUTOMATION_ENABLED || 'false').toLowerCase() === 'true';
  const repository = env.FEEDBACK_AUTOMATION_GITHUB_REPO || '';
  const githubToken = env.FEEDBACK_AUTOMATION_GITHUB_TOKEN || '';
  const offlineMode = String(env.FEEDBACK_AUTOMATION_OFFLINE_MODE || 'false').toLowerCase() === 'true';
  const outboxPath = env.FEEDBACK_AUTOMATION_OUTBOX_PATH || '/tmp/feedback-automation-outbox';
  const eventType = env.FEEDBACK_AUTOMATION_EVENT_TYPE || DEFAULT_EVENT_TYPE;
  const minDescriptionLength = Number(env.FEEDBACK_AUTOMATION_MIN_DESCRIPTION_LENGTH || DEFAULT_MIN_DESCRIPTION_LENGTH);
  const minTitleLength = Number(env.FEEDBACK_AUTOMATION_MIN_TITLE_LENGTH || DEFAULT_MIN_TITLE_LENGTH);

  const processNewFeedback = async ({ feedback }) => {
    if (!enabled || !feedback) {
      return { skipped: true };
    }

    const clearEnough = isFeedbackClear({
      title: feedback.title,
      description: feedback.description,
      minTitleLength,
      minDescriptionLength
    });

    if (!clearEnough) {
      return {
        needsClarification: true,
        status: 'pending',
        commentText:
          'Thanks for your feedback. More details are needed before automation can start. Please share expected behavior, current behavior, and clear reproduction steps.'
      };
    }

    const releaseImpact = feedback.type === 'feature' ? 'feature' : 'fix';
    const branchName = `feedback/${feedback.id}-${slugify(feedback.title)}`;
    const prompt = buildPrompt({ feedback, branchName, releaseImpact });
    const payload = {
      source: 'feedback-hub',
      feedbackId: feedback.id,
      teamId: feedback.teamId,
      teamName: feedback.teamName,
      feedbackType: feedback.type,
      releaseImpact,
      title: feedback.title,
      description: feedback.description,
      submittedAt: feedback.submittedAt,
      branchName,
      prompt
    };

    if (offlineMode) {
      const outboxFile = join(outboxPath, `${feedback.id}.json`);
      await mkdir(dirname(outboxFile), { recursive: true });
      await writeFile(outboxFile, JSON.stringify(payload, null, 2), 'utf8');

      logService?.addServerLog('info', 'automation', `Feedback automation stored locally for ${feedback.id}: ${outboxFile}`);
      return {
        queuedOffline: true,
        status: 'pending',
        branchName,
        commentText: `Automation payload prepared locally (offline mode). Retrieve outbox file for ${feedback.id} and process with your Claude subscription.`
      };
    }

    if (!repository || !githubToken) {
      return {
        skipped: true,
        status: 'pending',
        commentText:
          'Automation is enabled but not fully configured by the administrator (missing GitHub repository or token).'
      };
    }

    const apiUrl = `https://api.github.com/repos/${repository}/dispatches`;

    const response = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${githubToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        event_type: eventType,
        client_payload: payload
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Failed to trigger automation dispatch (${response.status}): ${errorBody}`);
    }

    logService?.addServerLog('info', 'automation', `Feedback automation triggered for ${feedback.id}`);

    return {
      dispatched: true,
      status: 'in_progress',
      branchName,
      commentText: `Automation started. Proposed branch: ${branchName}. A GitHub workflow run was triggered.`
    };
  };

  return {
    enabled,
    processNewFeedback
  };
};

export { createFeedbackAutomationService, isFeedbackClear, buildPrompt };
