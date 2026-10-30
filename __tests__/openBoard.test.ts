import { describe, expect, it } from 'vitest';
import type { RetroSession } from '../types';
import {
  GUIDED_RETRO_PHASES,
  OPEN_BOARD_PHASE,
  allowsRegrouping,
  assistantMayReadCards,
  canDropHeldCard,
  canReadCard,
  canReadGroup,
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

  it('shows the cards on a board entered from a phase that showed them all', () => {
    for (const phase of ['GROUP', 'VOTE', 'DISCUSS', 'REVIEW']) {
      const retro = session({ phase });
      recordBoardTypeChange(retro, OPEN_BOARD_PHASE);
      expect(retro.settings.revealBrainstorm, phase).toBe(true);
    }
  });

  it('keeps the cards hidden on a board entered while they were hidden', () => {
    const card = { id: 't1', colId: 'c', text: 'mine', authorId: 'me', groupId: null, votes: [] };
    for (const phase of ['ICEBREAKER', 'WELCOME', 'OPEN_ACTIONS', 'BRAINSTORM']) {
      const retro = session({ phase, tickets: [card] });
      recordBoardTypeChange(retro, OPEN_BOARD_PHASE);
      expect(retro.settings.revealBrainstorm, phase).toBe(false);
    }
    // And the way back leaves the setting as the board had it.
    const board = session({ guidedPhase: 'BRAINSTORM', tickets: [card] });
    recordBoardTypeChange(board, 'BRAINSTORM');
    expect(board.settings.revealBrainstorm).toBe(false);
  });

  it('gives the new type its own card and vote settings before any card is written', () => {
    // A facilitator who chose the wrong type switches from the Icebreaker:
    // they get what creating the right one would have given them.
    const retro = session({ phase: 'ICEBREAKER' });
    retro.settings.isAnonymous = false;
    recordBoardTypeChange(retro, OPEN_BOARD_PHASE);
    expect(retro.settings).toMatchObject({ revealBrainstorm: true, oneVotePerTicket: true, unlimitedVotes: true });
    // Anonymity is its own choice.
    expect(retro.settings.isAnonymous).toBe(false);

    // And the other way: the Vote phase counts votes again, and ends itself.
    const board = session({ settings: { ...session().settings, revealBrainstorm: true, oneVotePerTicket: true, unlimitedVotes: true } });
    recordBoardTypeChange(board, 'ICEBREAKER');
    expect(board.settings).toMatchObject({ revealBrainstorm: false, oneVotePerTicket: false, unlimitedVotes: false });
  });

  it('keeps the settings of a session that already holds a card, either way', () => {
    const card = { id: 't1', colId: 'c', text: 'mine', authorId: 'me', groupId: null, votes: ['u1', 'u1'] };
    const board = session({ tickets: [card], settings: { ...session().settings, revealBrainstorm: true, unlimitedVotes: true } });
    recordBoardTypeChange(board, 'VOTE');
    expect(board.settings).toMatchObject({ revealBrainstorm: true, unlimitedVotes: true });
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
  it('hides the other authors\u2019 cards on an open board too, until they are revealed', () => {
    const hidden = session();
    hidden.settings.revealBrainstorm = false;
    expect(cardsVisibleToEveryone(hidden)).toBe(false);
    const shown = session();
    shown.settings.revealBrainstorm = true;
    expect(cardsVisibleToEveryone(shown)).toBe(true);
  });

  it('follows the reveal setting in a guided retro', () => {
    const hidden = session({ phase: 'BRAINSTORM' });
    expect(cardsVisibleToEveryone(hidden)).toBe(false);
    const revealed = session({ phase: 'BRAINSTORM' });
    revealed.settings.revealBrainstorm = true;
    expect(cardsVisibleToEveryone(revealed)).toBe(true);
  });
});

describe('canReadCard and canReadGroup', () => {
  const board = (revealBrainstorm: boolean) => {
    const s = session({
      tickets: [
        { id: 'mine', colId: 'c', text: 'mine', authorId: 'me', groupId: 'g-mine', votes: [] },
        { id: 'also-mine', colId: 'c', text: 'also mine', authorId: 'me', groupId: 'g-mixed', votes: [] },
        { id: 'theirs', colId: 'c', text: 'theirs', authorId: 'them', groupId: 'g-mixed', votes: [] }
      ]
    });
    s.settings.revealBrainstorm = revealBrainstorm;
    return s;
  };

  it('reads one’s own cards always, and the others’ once they are shown', () => {
    expect(canReadCard(board(false), { authorId: 'me' }, 'me')).toBe(true);
    expect(canReadCard(board(false), { authorId: 'them' }, 'me')).toBe(false);
    expect(canReadCard(board(true), { authorId: 'them' }, 'me')).toBe(true);
  });

  it('reads a group only when every card in it can be read', () => {
    expect(canReadGroup(board(false), 'g-mine', 'me')).toBe(true);
    expect(canReadGroup(board(false), 'g-mixed', 'me')).toBe(false);
    expect(canReadGroup(board(true), 'g-mixed', 'me')).toBe(true);
    expect(canReadGroup(board(false), 'g-empty', 'me')).toBe(true);
  });
});

describe('assistantMayReadCards', () => {
  it('never lets the assistant read a board that hides its cards', () => {
    const hidden = session();
    expect(assistantMayReadCards(hidden)).toBe(false);
    hidden.settings.revealBrainstorm = true;
    expect(assistantMayReadCards(hidden)).toBe(true);
    // The Group phase shows every card, whatever "Reveal cards" says.
    expect(assistantMayReadCards(session({ phase: 'GROUP' }))).toBe(true);
  });
});

describe('canDropHeldCard', () => {
  // Hidden cards: "theirs" sits in g-mixed with one of mine, "loose" is
  // another author's card on its own.
  const board = (revealBrainstorm: boolean, phase = OPEN_BOARD_PHASE) => {
    const s = session({
      phase,
      tickets: [
        { id: 'mine', colId: 'c', text: 'mine', authorId: 'me', groupId: null, votes: [] },
        { id: 'grouped-mine', colId: 'c', text: 'mine too', authorId: 'me', groupId: 'g-mixed', votes: [] },
        { id: 'theirs', colId: 'c', text: 'theirs', authorId: 'them', groupId: 'g-mixed', votes: [] },
        { id: 'loose', colId: 'c', text: 'loose', authorId: 'them', groupId: null, votes: [] }
      ]
    });
    s.settings.revealBrainstorm = revealBrainstorm;
    return s;
  };

  it('puts a card down only with what its holder can read', () => {
    const hidden = board(false);
    expect(canDropHeldCard(hidden, 'mine', { kind: 'column', id: 'c' }, 'me')).toBe(true);
    // A readable card of a group holding a hidden one is not readable with it.
    expect(canDropHeldCard(hidden, 'mine', { kind: 'ticket', id: 'grouped-mine' }, 'me')).toBe(false);
    expect(canDropHeldCard(hidden, 'mine', { kind: 'ticket', id: 'loose' }, 'me')).toBe(false);
    expect(canDropHeldCard(hidden, 'mine', { kind: 'group', id: 'g-mixed' }, 'me')).toBe(false);
    expect(canDropHeldCard(hidden, 'mine', { kind: 'ticket', id: 'gone' }, 'me')).toBe(false);
    // Shown, everything is.
    const shown = board(true);
    expect(canDropHeldCard(shown, 'mine', { kind: 'ticket', id: 'loose' }, 'me')).toBe(true);
    expect(canDropHeldCard(shown, 'mine', { kind: 'group', id: 'g-mixed' }, 'me')).toBe(true);
  });

  it('puts nothing down once the held card is hidden or gone', () => {
    const hidden = board(false);
    expect(canDropHeldCard(hidden, 'loose', { kind: 'column', id: 'c' }, 'me')).toBe(false);
    expect(canDropHeldCard(hidden, 'gone', { kind: 'column', id: 'c' }, 'me')).toBe(false);
  });

  it('leaves the guided phases their own rules', () => {
    expect(canDropHeldCard(board(false, 'GROUP'), 'loose', { kind: 'ticket', id: 'theirs' }, 'me')).toBe(true);
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
