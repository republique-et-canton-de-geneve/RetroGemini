import { describe, expect, it } from 'vitest';
import type { ActionItem } from '../types';
import { jiraIssuePreview, withLiveSession } from '../components/jira/jiraIssuePreview';

/**
 * The batch dialog's preview of each issue (`components/jira/jiraIssuePreview.ts`).
 * It must say what the server will send to Jira: the server builds the issue
 * from its team record and the request, through `issueSource`, and so does the
 * preview, from the client's copy of the record with the live session on
 * screen in it. `jiraIssues.test.ts` → *the preview and the server agree*
 * checks the two against each other through the real route.
 */

const action = (id: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text: `Action ${id}`,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

const cachedRetro = { id: 'r1', name: 'Sprint 12', date: '2026-10-06', templateLanguage: 'en', actions: [action('a1')], tickets: [], groups: [] };
const team = {
  retrospectives: [cachedRetro, { id: 'r0', name: 'Sprint 11', date: '2026-09-22', templateLanguage: 'en', actions: [action('a1')] }],
  healthChecks: [{ id: 'h1', name: 'Q3', date: '2026-09-01', templateId: 'team_health_en', actions: [action('h-a')] }],
  globalActions: [action('b1', { text: 'Backlog work' })]
};

describe('withLiveSession', () => {
  it('puts the live session in place of the cached copy of it, and changes nothing else', () => {
    const live = { ...cachedRetro, name: 'Sprint 12 (renamed)', actions: [action('a1'), action('a-new')] };
    const read = withLiveSession(team, live, 'retro')!;
    expect(read.retrospectives[0]).toBe(live);
    expect(read.retrospectives[1]).toBe(team.retrospectives[1]);
    expect(read.healthChecks).toBe(team.healthChecks);
    expect(team.retrospectives[0]).toBe(cachedRetro);
  });

  it('puts a live session the cache does not hold yet first, where a new session goes on the record', () => {
    const live = { id: 'h2', name: 'Q4', actions: [action('h-new')] };
    expect(withLiveSession(team, live, 'healthcheck')!.healthChecks.map((entry) => entry.id)).toEqual(['h2', 'h1']);
  });

  it('leaves the team as it is for a backlog action or without a session', () => {
    expect(withLiveSession(team, cachedRetro, 'backlog')).toBe(team);
    expect(withLiveSession(team, null, 'retro')).toBe(team);
    expect(withLiveSession(null, cachedRetro, 'retro')).toBeNull();
  });
});

describe('jiraIssuePreview', () => {
  it('describes a new action of the live session from that session, with its latest name', () => {
    const live = { ...cachedRetro, name: 'Sprint 12 (renamed)', actions: [action('a1'), action('a-new', { text: 'Write the runbook' })] };
    const preview = jiraIssuePreview({ action: live.actions[1], team, session: live, kind: 'retro', sessionId: 'r1', requestedBy: 'Ann', language: 'en' });
    expect(preview.summary).toBe('Write the runbook');
    expect(preview.description).toBe('Action from the retrospective Sprint 12 (renamed) (2026\\-10\\-06). Requested in RetroGemini as Ann.');
  });

  // Written out rather than rebuilt with issueSource + issueFields: an oracle
  // made of the calls the preview makes cannot see the preview drift. The copy
  // on screen says something else in every case, so a preview built from it
  // fails; every session here is English, so the reader's 'fr' must lose to
  // the session's language, as it does on the server.
  it.each([
    {
      label: 'a retro action, from the session the request names',
      actionId: 'a1', sessionId: 'r0', kind: 'retro',
      summary: 'Action a1',
      description: 'Action from the retrospective Sprint 11 (2026\\-09\\-22). Requested in RetroGemini as Ann.'
    },
    {
      label: 'a backlog action, from the first session that holds it: the request names none',
      actionId: 'a1', sessionId: undefined, kind: 'backlog',
      summary: 'Action a1',
      description: 'Action from the retrospective Sprint 12 (2026\\-10\\-06). Requested in RetroGemini as Ann.'
    },
    {
      // The screen's session is not sent for a backlog action, so the server
      // reads the first retrospective holding it, not the one on screen.
      label: 'a backlog action listed on another session’s screen, still from the first session that holds it',
      actionId: 'a1', sessionId: 'r0', kind: 'backlog',
      summary: 'Action a1',
      description: 'Action from the retrospective Sprint 12 (2026\\-10\\-06). Requested in RetroGemini as Ann.'
    },
    {
      label: 'an action the named session does not hold, from the session that does',
      actionId: 'h-a', sessionId: 'r1', kind: 'retro',
      summary: 'Action h-a',
      description: 'Action from the health check Q3 (2026\\-09\\-01). Requested in RetroGemini as Ann.'
    },
    {
      label: 'an action only the backlog holds',
      actionId: 'b1', sessionId: undefined, kind: 'backlog',
      summary: 'Backlog work',
      description: 'Action from the team backlog. Requested in RetroGemini as Ann.'
    }
  ] as const)('describes $label, from the record’s copy', ({ actionId, sessionId, kind, summary, description }) => {
    const shown = action(actionId, { text: 'The copy on screen' });
    expect(jiraIssuePreview({ action: shown, team, kind, sessionId, requestedBy: 'Ann', language: 'fr' }))
      .toEqual({ summary, description, language: 'en' });
  });

  it('describes an action the team holds no copy of from the copy on screen, as a backlog action', () => {
    const shown = action('nowhere', { text: 'Only on screen' });
    expect(jiraIssuePreview({ action: shown, team, kind: 'retro', sessionId: 'r1', requestedBy: '', language: 'en' }))
      .toEqual({ summary: 'Only on screen', description: 'Action from the team backlog. Created from RetroGemini.', language: 'en' });
  });
});
