import { describe, expect, it, vi } from 'vitest';
import { buildPrompt, createFeedbackAutomationService, isFeedbackClear } from '../server/services/feedbackAutomationService.js';

const sampleFeedback = {
  id: 'feedback_abc123',
  teamId: 'team_1',
  teamName: 'Platform Team',
  type: 'bug',
  title: 'Timer reset while session reconnects',
  description: 'During a reconnect the running timer goes back to default and participants lose sync. Steps: start timer, force websocket reconnect, observe reset.',
  submittedAt: '2026-04-13T10:00:00.000Z'
};

describe('feedbackAutomationService', () => {
  it('detects unclear feedback content', () => {
    const clear = isFeedbackClear({
      title: sampleFeedback.title,
      description: sampleFeedback.description,
      minTitleLength: 8,
      minDescriptionLength: 40
    });
    const unclear = isFeedbackClear({
      title: 'Bug',
      description: 'broken',
      minTitleLength: 8,
      minDescriptionLength: 40
    });

    expect(clear).toBe(true);
    expect(unclear).toBe(false);
  });

  it('returns clarification request when feedback is too vague', async () => {
    const service = createFeedbackAutomationService({
      env: {
        FEEDBACK_AUTOMATION_ENABLED: 'true'
      }
    });

    const result = await service.processNewFeedback({
      feedback: {
        ...sampleFeedback,
        title: 'Bug',
        description: 'bad'
      }
    });

    expect(result.needsClarification).toBe(true);
    expect(result.status).toBe('pending');
    expect(result.commentText).toContain('More details are needed');
  });

  it('dispatches feedback payload to GitHub when configured', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true
    });
    const logService = { addServerLog: vi.fn() };
    const service = createFeedbackAutomationService({
      env: {
        FEEDBACK_AUTOMATION_ENABLED: 'true',
        FEEDBACK_AUTOMATION_GITHUB_REPO: 'owner/repo',
        FEEDBACK_AUTOMATION_GITHUB_TOKEN: 'token'
      },
      logService,
      fetchImpl: fetchMock
    } as any);

    const result = await service.processNewFeedback({ feedback: sampleFeedback });

    expect(result.dispatched).toBe(true);
    expect(result.status).toBe('in_progress');
    expect(result.branchName).toContain('feedback/feedback_abc123');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(logService.addServerLog).toHaveBeenCalled();
  });

  it('builds a prompt containing guard rails and commands', () => {
    const prompt = buildPrompt({
      feedback: sampleFeedback,
      branchName: 'feedback/feedback_abc123-timer-reset',
      releaseImpact: 'fix'
    });

    expect(prompt).toContain('Suis les directives du fichier AGENTS.md');
    expect(prompt).toContain('npm run ci');
    expect(prompt).toContain('release impact');
    expect(prompt).toContain('ne modifie pas VERSION/CHANGELOG');
    expect(prompt).toContain('Branche suggérée');
  });
});
