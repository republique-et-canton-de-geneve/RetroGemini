import { describe, expect, it } from 'vitest';
import { effectiveSessionStatus, isSessionInProgress, statusForPhase } from '../utils/sessionStatus';

describe('statusForPhase — one rule for retrospectives and health checks', () => {
  it('closes the session at its Close phase and nowhere else', () => {
    expect(statusForPhase('CLOSE')).toBe('CLOSED');
    for (const phase of ['ICEBREAKER', 'WELCOME', 'BRAINSTORM', 'GROUP', 'VOTE', 'DISCUSS', 'REVIEW', 'SURVEY']) {
      expect(statusForPhase(phase)).toBe('IN_PROGRESS');
    }
  });
});

describe('effectiveSessionStatus', () => {
  it('reads a session stuck in progress at its Close phase as closed', () => {
    // The shape of the health checks in the field report.
    expect(effectiveSessionStatus({ status: 'IN_PROGRESS', phase: 'CLOSE' })).toBe('CLOSED');
    expect(isSessionInProgress({ status: 'IN_PROGRESS', phase: 'CLOSE' })).toBe(false);
  });

  it('keeps a stored CLOSED, whatever the phase', () => {
    // Health checks closed mid-survey by the previous exit rule keep the status
    // they were shown with until someone reopens them.
    expect(effectiveSessionStatus({ status: 'CLOSED', phase: 'SURVEY' })).toBe('CLOSED');
  });

  it('reports a session that is genuinely running as in progress', () => {
    expect(effectiveSessionStatus({ status: 'IN_PROGRESS', phase: 'DISCUSS' })).toBe('IN_PROGRESS');
    expect(isSessionInProgress({ status: 'IN_PROGRESS', phase: 'SURVEY' })).toBe(true);
  });
});
