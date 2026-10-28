import { describe, expect, it } from 'vitest';
import type { RetroSession } from '../types';
import {
  GUIDED_RETRO_PHASES,
  OPEN_BOARD_PHASE,
  allowsRegrouping,
  canSwitchBoardType,
  cardsVisibleToEveryone,
  guidedResumePhase,
  isOpenBoard,
  recordBoardTypeChange
} from '../utils/openBoard';

/**
 * The open board is a retrospective with every card activity on one screen and
 * no phases to go through: it stays open, and the facilitator can turn it into
 * a guided retrospective and back without losing a card (Lean Coffee request,
 * 2026-10-28). These pin the rules the session screen and the server share;
 * `sessionOpenBoard.test.tsx` pins the screen.
 */

const session = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 's1',
  teamId: 't1',
  name: 'Lean Coffee',
  date: '2026-10-28',
  status: 'IN_PROGRESS',
  phase: OPEN_BOARD_PHASE,
  icebreakerQuestion: '',
  columns: [],
  settings: {
    isAnonymous: true,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: false,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

describe('isOpenBoard', () => {
  it('is the open board phase and nothing else', () => {
    expect(isOpenBoard(session())).toBe(true);
    for (const phase of GUIDED_RETRO_PHASES) {
      expect(isOpenBoard(session({ phase })), phase).toBe(false);
    }
    expect(isOpenBoard(undefined)).toBe(false);
    expect(isOpenBoard(null)).toBe(false);
  });

  it('is not one of the guided phases, so no guided phase rule ever fires on a board', () => {
    expect(GUIDED_RETRO_PHASES).not.toContain(OPEN_BOARD_PHASE);
    expect(GUIDED_RETRO_PHASES).toEqual([
      'ICEBREAKER', 'WELCOME', 'OPEN_ACTIONS', 'BRAINSTORM', 'GROUP', 'VOTE', 'DISCUSS', 'REVIEW', 'CLOSE'
    ]);
  });
});

describe('recordBoardTypeChange', () => {
  it('remembers the guided phase a retro leaves for the open board', () => {
    const retro = session({ phase: 'GROUP' });
    recordBoardTypeChange(retro, OPEN_BOARD_PHASE);
    expect(retro.guidedPhase).toBe('GROUP');
  });

  it('forgets it once the board is a guided retro again', () => {
    const board = session({ guidedPhase: 'VOTE' });
    recordBoardTypeChange(board, 'VOTE');
    expect(board).not.toHaveProperty('guidedPhase');
  });

  it('changes nothing between two guided phases', () => {
    const retro = session({ phase: 'BRAINSTORM' });
    recordBoardTypeChange(retro, 'GROUP');
    expect(retro).not.toHaveProperty('guidedPhase');
  });

  it('never overwrites the remembered phase with the board itself', () => {
    const board = session({ guidedPhase: 'DISCUSS' });
    recordBoardTypeChange(board, OPEN_BOARD_PHASE);
    expect(board.guidedPhase).toBe('DISCUSS');
  });
});

describe('guidedResumePhase', () => {
  it('resumes the guided retro where it was turned into a board', () => {
    expect(guidedResumePhase(session({ guidedPhase: 'VOTE' }))).toBe('VOTE');
    expect(guidedResumePhase(session({ guidedPhase: 'BRAINSTORM' }))).toBe('BRAINSTORM');
  });

  it('starts at the beginning for a board created open', () => {
    expect(guidedResumePhase(session())).toBe('ICEBREAKER');
  });

  it('never resumes at Close: turning a board back must not end the session', () => {
    // A stored CLOSED is final (utils/sessionStatus.ts), so landing on Close
    // would close the board as a side effect of switching its type.
    expect(guidedResumePhase(session({ guidedPhase: 'CLOSE' }))).toBe('ICEBREAKER');
  });

  it('ignores a value that is not a guided phase', () => {
    for (const stored of [OPEN_BOARD_PHASE, 'SURVEY', '', 'brainstorm', 42, null] as unknown[]) {
      expect(guidedResumePhase(session({ guidedPhase: stored as string })), String(stored)).toBe('ICEBREAKER');
    }
  });
});

describe('canSwitchBoardType', () => {
  it('lets the facilitator switch a session that is still going', () => {
    expect(canSwitchBoardType(session())).toBe(true);
    expect(canSwitchBoardType(session({ phase: 'BRAINSTORM' }))).toBe(true);
  });

  it('leaves a finished retrospective as it is', () => {
    expect(canSwitchBoardType(session({ phase: 'CLOSE' }))).toBe(false);
    expect(canSwitchBoardType(session({ phase: 'GROUP', status: 'CLOSED' }))).toBe(false);
  });
});

describe('cardsVisibleToEveryone', () => {
  it('shows every card on an open board, revealed or not', () => {
    expect(cardsVisibleToEveryone(session())).toBe(true);
  });

  it('follows the reveal setting in a guided retro', () => {
    const hidden = session({ phase: 'BRAINSTORM' });
    expect(cardsVisibleToEveryone(hidden)).toBe(false);
    const revealed = session({ phase: 'BRAINSTORM' });
    revealed.settings.revealBrainstorm = true;
    expect(cardsVisibleToEveryone(revealed)).toBe(true);
  });
});

describe('allowsRegrouping', () => {
  it('regroups cards in the Group phase and on an open board only', () => {
    expect(allowsRegrouping(session())).toBe(true);
    expect(allowsRegrouping(session({ phase: 'GROUP' }))).toBe(true);
    for (const phase of GUIDED_RETRO_PHASES.filter((p) => p !== 'GROUP')) {
      expect(allowsRegrouping(session({ phase })), phase).toBe(false);
    }
  });
});
