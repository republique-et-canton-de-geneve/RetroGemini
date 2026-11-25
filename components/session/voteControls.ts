import { playEffect } from '../common/motion/effects';

/**
 * What the vote controls and the vote budget share with the screen around
 * them, kept out of the component files so those export components alone:
 * the class list of each state, written whole so the contrast tests measure
 * what is painted (never an `aria-disabled:` variant they cannot see), and the
 * hooks a vote's flight and a refused vote use.
 */

/** Past this many, one's own votes read as a dot and a number (both controls). */
export const MAX_VOTE_DOTS = 3;

/** A vote drawn this soon after its button was pressed is that press's: the button answers it (ms). */
export const PRESS_ANSWER_MS = 1000;

/**
 * `BoardVoteControl`, on an open board. The pill carries an edge of 3:1 on any
 * card tint; the add button is filled by the viewer's own vote, in the brand
 * colour.
 */
export const BOARD_VOTE_CLASSES = Object.freeze({
  pill: 'inline-flex items-center gap-1 rounded-full border border-slate-500 bg-white p-0.5 shadow-xs',
  total: 'inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-700 shadow-xs tabular-nums',
  dots: 'flex items-center gap-[3px] pl-1.5 text-xs font-bold text-indigo-700 tabular-nums',
  dot: 'block size-[9px] rounded-full bg-indigo-600',
  cross: 'w-6 h-6 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 hover:text-rose-700 transition disabled:cursor-not-allowed',
  add: 'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums transition aria-disabled:cursor-not-allowed',
  voted: 'bg-indigo-600 border-indigo-600 text-white',
  votedHover: 'hover:bg-indigo-700',
  addable: 'bg-indigo-50 border-indigo-50 text-indigo-700 hover:bg-indigo-100 hover:border-indigo-100',
  blocked: 'bg-slate-100 border-slate-100 text-slate-600',
});

/**
 * `GuidedVoteControl`, in the guided Vote phase. On a touch screen a
 * pseudo-element grows each target to 44px high; it grows them only 2px
 * sideways, inside the pill's 4px gap, so the minus and the plus never cover
 * each other.
 */
const TARGET = 'relative w-6 h-6 flex items-center justify-center rounded-full transition pointer-coarse:after:absolute pointer-coarse:after:-inset-y-2.5 pointer-coarse:after:-inset-x-0.5';
export const GUIDED_VOTE_CLASSES = Object.freeze({
  pill: 'inline-flex items-center gap-1 rounded-full border border-slate-500 bg-white p-0.5 shadow-xs',
  minusOn: `${TARGET} text-slate-700 hover:bg-slate-100`,
  minusOff: `${TARGET} text-slate-400 cursor-not-allowed`,
  plusOn: `${TARGET} bg-indigo-600 text-white hover:bg-indigo-700`,
  plusOff: `${TARGET} bg-slate-200 text-slate-600 cursor-not-allowed`,
  dots: 'flex items-center gap-[3px] text-xs font-bold text-indigo-700 tabular-nums',
  dot: 'block size-[9px] rounded-full bg-indigo-600',
});

/** Past this many votes per person, the budget says its sentence alone. */
export const MAX_VOTE_TOKENS = 10;

/** Where a vote's flight starts and where one taken back lands (`VoteBudget`). */
export const VOTE_BUDGET_HOOKS = Object.freeze({
  /** The chip: what shakes when a vote is refused, and the start of a flight when there is no token. */
  chip: '[data-vote-budget]',
  /** The row of tokens: where a vote taken back lands. */
  row: '[data-vote-tokens]',
  /** The next token a vote will use (the last one still filled). */
  next: '[data-vote-next]',
});

/** A vote still to cast, and one cast (an outline: 3:1 against the chip, measured). */
export const TOKEN_LEFT_CLASSES = 'block size-2.5 rounded-full bg-indigo-600';
export const TOKEN_CAST_CLASSES = 'block size-2.5 rounded-full border-[1.5px] border-slate-400';
/** The budget chip: its sentence is measured on its own background. */
export const VOTE_BUDGET_CHIP_CLASSES =
  'inline-flex items-center gap-2 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-sm font-medium text-slate-700 whitespace-nowrap tabular-nums';

/** The element a vote's flight starts from: the next token, else the chip. */
export function voteFlightStart(root: Document | Element = document): Element | null {
  return root.querySelector(VOTE_BUDGET_HOOKS.next) ?? root.querySelector(VOTE_BUDGET_HOOKS.chip);
}

/** The element a vote taken back flies home to: the row, else the chip. */
export function voteFlightHome(root: Document | Element = document): Element | null {
  return root.querySelector(VOTE_BUDGET_HOOKS.row) ?? root.querySelector(VOTE_BUDGET_HOOKS.chip);
}

/** A vote was refused for lack of votes: the budget chip shakes. Answers whether it did. */
export function shakeVoteBudget(root: Document | Element = document): boolean {
  return playEffect(root.querySelector(VOTE_BUDGET_HOOKS.chip), 'fx-nope');
}
