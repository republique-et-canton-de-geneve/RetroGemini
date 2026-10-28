import type { RetroSession } from '../types';
import { isSessionInProgress } from './sessionStatus';

/**
 * The open board: a retrospective whose every card activity — writing,
 * grouping, moving and voting — happens on one screen, with no phases to go
 * through, and which stays open (a Lean Coffee, a board kept for weeks).
 *
 * It is a retrospective, not a second session type: the same record, the same
 * cards, groups and votes, the same sync. What makes it a board is its phase,
 * `OPEN_BOARD`, which is none of the guided phases — so no guided phase rule
 * (the Vote phase's auto-finish, the Review step's snapshots, Close ending the
 * session) can fire on a board by accident, and every check written for a
 * guided phase keeps meaning exactly what it meant.
 *
 * The facilitator turns a guided retro into a board and back through the
 * session's one phase change (`setPhase`), and nothing on the session is lost
 * either way: what a phase shows and the board does not (actions, happiness,
 * ROTI, invitees) stays stored and is there again on the way back.
 */

export const OPEN_BOARD_PHASE = 'OPEN_BOARD';

/** The phases of a guided retrospective, in the order the session walks them. */
export const GUIDED_RETRO_PHASES = [
  'ICEBREAKER',
  'WELCOME',
  'OPEN_ACTIONS',
  'BRAINSTORM',
  'GROUP',
  'VOTE',
  'DISCUSS',
  'REVIEW',
  'CLOSE'
] as const;

/** Where a guided retro starts, and where a board created open resumes. */
const GUIDED_START_PHASE = 'ICEBREAKER';

export const isOpenBoard = (session: { phase?: string } | null | undefined): boolean =>
  session?.phase === OPEN_BOARD_PHASE;

/**
 * Cards are regrouped in the Group phase and on an open board. Asked of the
 * session the write is built on, not of what was on screen at the pick-up.
 */
export const allowsRegrouping = (session: { phase?: string }): boolean =>
  session.phase === 'GROUP' || isOpenBoard(session);

/**
 * Whether every card is readable by everyone. A board has no hidden-cards
 * stage — a card is written to be voted on — while a guided Brainstorm hides
 * the other authors' cards until the facilitator reveals them.
 */
export const cardsVisibleToEveryone = (session: Pick<RetroSession, 'phase' | 'settings'>): boolean =>
  isOpenBoard(session) || !!session.settings?.revealBrainstorm;

/**
 * A retro that reached Close is finished and stays finished
 * (utils/sessionStatus.ts), so its type is no longer switched either. A board
 * never reaches Close, so a board can always be turned back.
 */
export const canSwitchBoardType = (session: Pick<RetroSession, 'status' | 'phase'>): boolean =>
  isSessionInProgress(session);

const isResumablePhase = (phase: unknown): phase is string =>
  typeof phase === 'string'
  && phase !== 'CLOSE'
  && (GUIDED_RETRO_PHASES as readonly string[]).includes(phase);

/**
 * The phase a board turned back into a guided retro opens on: the one it was
 * at when it became a board, or the start for a board created open. Never
 * Close — reaching Close ends the session, and switching the board's type must
 * not end it as a side effect — and never a value that is not a guided phase,
 * since the stored one is read back from data another release may have written.
 */
export const guidedResumePhase = (session: Pick<RetroSession, 'guidedPhase'>): string =>
  isResumablePhase(session.guidedPhase) ? session.guidedPhase : GUIDED_START_PHASE;

/**
 * Called by the session's phase change before it sets `nextPhase`: leaving a
 * guided phase for the board remembers it, leaving the board forgets it. Mutates
 * the session it is given, like the other session helpers.
 */
export const recordBoardTypeChange = (session: RetroSession, nextPhase: string): void => {
  const toBoard = nextPhase === OPEN_BOARD_PHASE;
  if (toBoard && !isOpenBoard(session)) {
    session.guidedPhase = session.phase;
  } else if (!toBoard && isOpenBoard(session)) {
    delete session.guidedPhase;
  }
};
