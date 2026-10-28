import React, { useRef } from 'react';
import { useTranslation } from '../../i18n/I18nContext';

/**
 * How a card or a group is voted on, on an open board — EasyRetro's shape: one
 * button that adds a vote and shows what everyone gave, the voter's own votes
 * as dots, and a cross that takes one of them back. One number on the item,
 * never two: the board used to show the total in a chip beside a −/+ counter
 * of one's own votes. The Vote phase keeps that counter, and keeps its totals
 * to itself.
 *
 * The facilitator can hide the totals (the button then carries no number) and
 * turn voting off (only the total is left, as a plain chip). A card the viewer
 * cannot read takes no vote either.
 *
 * The keyboard never loses its place (WCAG 2.4.3): a button that cannot add a
 * vote right now is `aria-disabled`, not `disabled`, because the vote that
 * used up one vote per item would otherwise disable the very button it was
 * cast with and send the focus to the page; and taking back one's last vote
 * hands the focus to the vote button before the cross that had it goes.
 */

interface Props {
  kind: 'ticket' | 'group';
  /** The votes everyone gave it. */
  total: number;
  /** The viewer's own share of them. */
  mine: number;
  /** A vote may be added now: the budget and "one vote per item" allow it. */
  canAdd: boolean;
  /** Voting is off: the total alone. */
  readOnly: boolean;
  /**
   * The viewer cannot read the item (its cards are hidden): no vote is added,
   * and the votes they gave it while it was shown are theirs to take back.
   */
  takeBackOnly?: boolean;
  countHidden: boolean;
  /** Reconnecting: a click would be dropped, so nothing is offered. */
  disabled: boolean;
  onAdd: () => void;
  onRemove: () => void;
}

/** Past this many, one's own votes read as a dot and a number. */
const MAX_DOTS = 3;

const BoardVoteControl: React.FC<Props> = ({
  kind,
  total,
  mine,
  canAdd,
  readOnly,
  takeBackOnly = false,
  countHidden,
  disabled,
  onAdd,
  onRemove
}) => {
  const { t, tp } = useTranslation();
  const addRef = useRef<HTMLButtonElement>(null);

  // A white pill, because a card can take its column's colour, dark ones
  // included. The sentence is what a screen reader announces, so the number
  // is never read as a bare "3".
  const totalPill = countHidden ? null : (
    <span data-testid="vote-total" className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-bold text-slate-700 shadow-xs">
      <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">thumb_up</span>
      <span aria-hidden="true">{total}</span>
      <span className="sr-only">{tp('session.ticket.voteTotal', total)}</span>
    </span>
  );

  const addable = canAdd && !disabled;
  const voted = mine > 0;
  if (readOnly || (takeBackOnly && !voted)) return totalPill;
  // A vote of one's own fills the button; a button that cannot add keeps its
  // total readable instead of fading it out.
  const addClasses = voted
    ? `bg-indigo-600 border-indigo-600 text-white ${addable ? 'hover:bg-indigo-700' : ''}`
    : addable
      ? 'bg-white border-indigo-200 text-indigo-700 hover:bg-indigo-50'
      : 'bg-slate-50 border-slate-200 text-slate-600';

  return (
    <div data-testid="board-vote-control" className="inline-flex items-center gap-1 rounded-full bg-white p-0.5 shadow-xs">
      {voted && (
        <>
          <span data-testid="my-votes" aria-hidden="true" className="flex items-center gap-0.5 pl-1.5 text-[11px] font-bold text-indigo-700">
            {mine <= MAX_DOTS
              ? Array.from({ length: mine }, (_, i) => <span key={i} className="block w-1.5 h-1.5 rounded-full bg-indigo-600" />)
              : (
                <>
                  <span className="block w-1.5 h-1.5 rounded-full bg-indigo-600" />
                  <span>{mine}</span>
                </>
              )}
          </span>
          <span className="sr-only">{tp('session.ticket.myVotes', mine)}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (mine === 1 && !takeBackOnly && document.activeElement === e.currentTarget) addRef.current?.focus();
              onRemove();
            }}
            disabled={disabled}
            aria-label={t(kind === 'group' ? 'session.group.removeMyVote' : 'session.ticket.removeMyVote')}
            title={t(kind === 'group' ? 'session.group.removeMyVote' : 'session.ticket.removeMyVote')}
            className="w-6 h-6 flex items-center justify-center rounded-full text-slate-600 hover:bg-slate-100 hover:text-red-600 transition disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">close</span>
          </button>
        </>
      )}
      {takeBackOnly ? totalPill : (
        <button
          ref={addRef}
          type="button"
          data-testid="vote-add"
          onClick={(e) => {
            e.stopPropagation();
            if (addable) onAdd();
          }}
          aria-disabled={!addable}
          aria-label={countHidden
            ? t(kind === 'group' ? 'session.group.addVote' : 'session.ticket.addVote')
            : tp(kind === 'group' ? 'session.group.addVoteWithTotal' : 'session.ticket.addVoteWithTotal', total)}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold transition aria-disabled:cursor-not-allowed ${addClasses}`}
        >
          <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">thumb_up</span>
          {!countHidden && <span data-testid="vote-total">{total}</span>}
        </button>
      )}
    </div>
  );
};

export default BoardVoteControl;
