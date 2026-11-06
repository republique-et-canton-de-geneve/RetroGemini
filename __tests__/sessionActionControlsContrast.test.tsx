import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import OpenActionsPhase from '../components/session/OpenActionsPhase';
import ReviewPhase from '../components/session/ReviewPhase';
import { dataService } from '../services/dataService';
import type { ActionItem, RetroSession, Team, User } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * Review finding (pass 16 of 42.1): the action rows' icon controls — the
 * circle that marks an action as done, the trash that deletes one — were
 * slate-300 on the rows' white, 1.49:1, always shown, on a phone and on a
 * computer alike. The glyph is the only thing that shows the control, and its
 * unchecked state, so it is non-text that needs 3:1 (WCAG 1.4.11). axe-core
 * skips icon ligatures, so the Open Actions screen it audits never reported
 * them: they are measured here, what each control paints, with axe-core's own
 * colour engine (helpers/tailwindTheme).
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getSessionToken: vi.fn(() => null),
    getAuthenticatedPassword: vi.fn(() => null),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn(),
    deleteAction: vi.fn()
  }
}));

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' };

const action = (id: string, text: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id, text, assigneeId: null, done: false, type: 'new', proposalVotes: {}, ...overrides
});

const previous = action('prev-1', 'Automate the changelog');
// Closed during the Open Actions step, which still shows it: its check is
// the only sign of its state, and needs the same 3:1.
const closedBefore = action('prev-2', 'Rotate the facilitator', { done: true });

const team: Team = {
  id: 'team-1',
  name: 'Team',
  passwordHash: 'hash',
  members: [facilitator],
  customTemplates: [],
  retrospectives: [],
  globalActions: [previous, closedBefore]
};

const session = (phase: RetroSession['phase']): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: '2026-11-06',
  status: 'IN_PROGRESS',
  phase,
  participants: [facilitator],
  discussionFocusId: null,
  discussionNextTopicVotes: {},
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: true,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [{ id: 'tkt-1', colId: 'col-1', text: 'Releases keep slipping', authorId: 'fac-1', groupId: null, votes: [] }],
  groups: [],
  actions: [
    action('act-1', 'Write the release checklist', { linkedTicketId: 'tkt-1' }),
    action('act-2', 'Pair on the release', { linkedTicketId: 'tkt-1', done: true })
  ],
  openActionsSnapshot: [previous, closedBefore],
  happiness: {},
  roti: {},
  finishedUsers: []
});

beforeEach(() => {
  vi.mocked(dataService.getTeam).mockReturnValue(team);
});

describe('the action rows’ icon controls', () => {
  it('draws the done circle and the trash of the Review step at a contrast that can be seen', () => {
    render(
      <ReviewPhase
        session={session('REVIEW')}
        team={team}
        currentUser={facilitator}
        isFacilitator
        historyActionIds={['prev-1']}
        setPhase={vi.fn()}
        updateSession={vi.fn()}
        applyActionUpdate={vi.fn()}
        buildActionContext={vi.fn(() => '')}
        assignableMembers={team.members}
        setRefreshTick={vi.fn()}
      />
    );

    const controls = [
      ...screen.getAllByRole('button', { name: 'Mark action as done' }),
      ...screen.getAllByRole('button', { name: 'Mark action as not done' }),
      ...screen.getAllByRole('button', { name: 'Delete action' })
    ];
    expect(controls.length).toBeGreaterThanOrEqual(4);
    for (const control of controls) expect(effectivePair(control).ratio).toBeGreaterThanOrEqual(3);
  });

  it('draws the done circle of the Open Actions step at a contrast that can be seen', () => {
    render(
      <OpenActionsPhase
        team={team}
        session={session('OPEN_ACTIONS')}
        currentUser={facilitator}
        participants={team.members}
        isFacilitator
        reviewActionIds={['prev-1', 'prev-2']}
        setPhase={vi.fn()}
        applyActionUpdate={vi.fn()}
        assignableMembers={team.members}
        buildActionContext={vi.fn(() => '')}
        setRefreshTick={vi.fn()}
        ratingEnabled={false}
        showRatingNotice={false}
        onRateAction={vi.fn()}
        onToggleDeferRating={vi.fn()}
        onRateNow={vi.fn()}
        onToggleImpactReveal={vi.fn()}
        onDismissRatingNotice={vi.fn()}
      />
    );

    const toggles = [
      screen.getByRole('button', { name: 'Mark action as done' }),
      screen.getByRole('button', { name: 'Mark action as not done' })
    ];
    for (const toggle of toggles) expect(effectivePair(toggle).ratio).toBeGreaterThanOrEqual(3);
  });
});
