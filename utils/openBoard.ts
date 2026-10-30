import type { RetroSession, Ticket } from '../types';
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
 * Whether every card is readable by everyone, in Brainstorm and on an open
 * board: until the facilitator reveals them, each person reads only their own
 * cards. A board is created with its cards shown — a card there is written to
 * be voted on — and the facilitator can hide them while people write, as in a
 * guided Brainstorm ("Hide cards" on the board, "Reveal cards" there: one
 * setting). The Group and Vote phases show every card whatever this says.
 */
export const cardsVisibleToEveryone = (session: Pick<RetroSession, 'settings'>): boolean =>
  !!session.settings?.revealBrainstorm;

/**
 * Whether this viewer can read this card on a board (or in Brainstorm): their
 * own always, everyone's once the cards are shown. A card one cannot read is
 * not voted on, grouped, moved or found by a search — what it says would be
 * acted on blind, and a search would tell what it holds.
 */
export const canReadCard = (
  session: Pick<RetroSession, 'settings'>,
  ticket: Pick<Ticket, 'authorId'>,
  viewerId: string,
): boolean => ticket.authorId === viewerId || cardsVisibleToEveryone(session);

/**
 * A group is read whole: readable when every card in it is. Asked of every
 * card and group on each render, so it looks at the cards only while some are
 * hidden.
 */
export const canReadGroup = (
  session: Pick<RetroSession, 'settings' | 'tickets'>,
  groupId: string,
  viewerId: string,
): boolean => cardsVisibleToEveryone(session)
  || session.tickets.every((t) => t.groupId !== groupId || canReadCard(session, t, viewerId));

/**
 * Whether the assistant may read the cards: never while a board hides them.
 * It would read cards some people cannot, and what it writes back — a group's
 * title, its suggested groups — would tell everyone what they hold. The guided
 * phases that call it (Group) show every card.
 */
export const assistantMayReadCards = (session: Pick<RetroSession, 'phase' | 'settings'>): boolean =>
  !isOpenBoard(session) || cardsVisibleToEveryone(session);

/** Where a card held on a board can be put down: on a card, in a group, or in a column. */
export type BoardDropTarget = { kind: 'ticket' | 'group' | 'column'; id: string };

/**
 * Whether a card held on an open board may be dropped there: only a card its
 * holder can still read, and only with a card or into a group it can be read
 * with — never onto a card, or into a group, holding a card the holder cannot
 * read. Asked of the session as it is when the drop happens, not as the
 * target was drawn: the facilitator may have hidden the cards in between.
 * Anything off the board is the guided phases' business.
 */
export const canDropHeldCard = (
  session: Pick<RetroSession, 'phase' | 'settings' | 'tickets'>,
  heldId: string,
  target: BoardDropTarget,
  viewerId: string,
): boolean => {
  if (!isOpenBoard(session)) return true;
  const held = session.tickets.find((t) => t.id === heldId);
  if (!held || !canReadCard(session, held, viewerId)) return false;
  if (target.kind === 'column') return true;
  if (target.kind === 'group') return canReadGroup(session, target.id, viewerId);
  const ticket = session.tickets.find((t) => t.id === target.id);
  return !!ticket
    && canReadCard(session, ticket, viewerId)
    && (!ticket.groupId || canReadGroup(session, ticket.groupId, viewerId));
};

/**
 * The guided phases that show every card to everyone, whatever "Reveal cards"
 * says. A retro turned into a board from one of them shows its cards on the
 * board too: switching must not hide what everyone was reading a moment ago.
 */
const PHASES_SHOWING_EVERY_CARD: readonly string[] = ['GROUP', 'VOTE', 'DISCUSS', 'REVIEW'];

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
 * The card and vote settings each type starts with (`dataService.createSession`):
 * a board shows its cards and takes one vote per card, with no limit; a guided
 * retro hides them in Brainstorm and counts several votes per card. Anonymity is
 * chosen on its own and never follows the type.
 */
const BOARD_CARD_DEFAULTS = { revealBrainstorm: true, oneVotePerTicket: true, unlimitedVotes: true } as const;
const GUIDED_CARD_DEFAULTS = { revealBrainstorm: false, oneVotePerTicket: false, unlimitedVotes: false } as const;

/**
 * Called by the session's phase change before it sets `nextPhase`: leaving a
 * guided phase for the board remembers it, leaving the board forgets it, and a
 * board entered from a phase that showed every card shows them (one setting,
 * so a Brainstorm resumed later shows them too, until the facilitator hides
 * them again). Before any card is written, switching is choosing the type
 * again — the Icebreaker offers it to a facilitator who chose wrong — so the
 * session takes the new type's card and vote defaults, as if it had been
 * created that way. Mutates the session it is given, like the other session
 * helpers.
 */
export const recordBoardTypeChange = (session: RetroSession, nextPhase: string): void => {
  const toBoard = nextPhase === OPEN_BOARD_PHASE;
  const noCardYet = session.tickets.length === 0;
  if (toBoard && !isOpenBoard(session)) {
    if (noCardYet) Object.assign(session.settings, BOARD_CARD_DEFAULTS);
    else if (PHASES_SHOWING_EVERY_CARD.includes(session.phase)) session.settings.revealBrainstorm = true;
    session.guidedPhase = session.phase;
  } else if (!toBoard && isOpenBoard(session)) {
    if (noCardYet) Object.assign(session.settings, GUIDED_CARD_DEFAULTS);
    delete session.guidedPhase;
  }
};
