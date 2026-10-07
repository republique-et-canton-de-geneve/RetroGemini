import { describe, expect, it } from 'vitest';
import { effectiveSessionStatus, isSessionInProgress } from '../utils/sessionStatus';

describe('effectiveSessionStatus — one rule for retrospectives and health checks', () => {
  it('closes a session at its Close phase and nowhere else', () => {
    expect(effectiveSessionStatus({ status: 'IN_PROGRESS', phase: 'CLOSE' })).toBe('CLOSED');
    for (const phase of ['ICEBREAKER', 'WELCOME', 'OPEN_ACTIONS', 'BRAINSTORM', 'GROUP', 'VOTE', 'DISCUSS', 'REVIEW', 'SURVEY']) {
      expect(effectiveSessionStatus({ status: 'IN_PROGRESS', phase })).toBe('IN_PROGRESS');
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
    // A finished session read back through its phases, and the health checks
    // the previous exit rule closed mid-survey: neither is in progress.
    expect(effectiveSessionStatus({ status: 'CLOSED', phase: 'SURVEY' })).toBe('CLOSED');
    expect(effectiveSessionStatus({ status: 'CLOSED', phase: 'REVIEW' })).toBe('CLOSED');
  });

  it('reports a session that is genuinely running as in progress', () => {
    expect(effectiveSessionStatus({ status: 'IN_PROGRESS', phase: 'DISCUSS' })).toBe('IN_PROGRESS');
    expect(isSessionInProgress({ status: 'IN_PROGRESS', phase: 'SURVEY' })).toBe(true);
  });
});
