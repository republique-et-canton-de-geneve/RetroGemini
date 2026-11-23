import React, { useLayoutEffect, useRef } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { playEffect } from '../common/motion/effects';
import { BOARD_VOTE_CLASSES, MAX_VOTE_DOTS as MAX_DOTS, PRESS_ANSWER_MS } from './voteControls';

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
 * hands the focus to the vote button before the cross that had it goes — or,
 * on an item that takes no vote, to the card or group itself, which the
 * session marks `data-vote-focus-host` and makes focusable.
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
  /** The thumb was pressed while it could not add, connected: the screen says why (the budget shakes). */
  onRefused?: () => void;
  /**
   * Whether the board is quiet right now (Session.tsx → motionQuiet): read when
   * the viewer's count changes, never while drawing. A count that rises then
   * is drawn without its spring, unless this thumb was just pressed.
   */
  motionQuiet: () => boolean;
}

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
  onRemove,
  onRefused,
  motionQuiet
}) => {
  const { t, tp } = useTranslation();
  const addRef = useRef<HTMLButtonElement>(null);
  const dotsRef = useRef<HTMLSpanElement>(null);
  const shownMine = useRef(mine);
  // When the thumb was last pressed: it answers once the vote is drawn, since
  // the class that vote gives the button would wipe an effect put on before.
  const pressedAt = useRef(0);
  // The dot a vote just added springs in (the number bumps past three dots).
  // Compared with what was shown, so a remount (a phase change) plays nothing;
  // and quiet with the board, so the votes the server's first state or a
  // reconnection's snapshot brings back are drawn without playing. A press of
  // this thumb is answered all the same.
  useLayoutEffect(() => {
    if (mine > shownMine.current) {
      const pressed = Date.now() - pressedAt.current < PRESS_ANSWER_MS;
      if (pressed || !motionQuiet()) {
        const dots = dotsRef.current;
        if (mine <= MAX_DOTS) playEffect(dots?.lastElementChild, 'fx-pop');
        else playEffect(dots, 'fx-bump');
        if (pressed) playEffect(addRef.current, 'fx-press');
      }
    }
    pressedAt.current = 0;
    shownMine.current = mine;
  }, [mine, motionQuiet]);

  // A white pill, because a card takes a tint of its column's colour, and
  // the number must read the same on every tint. The sentence is what a screen reader announces, so the number
  // is never read as a bare "3".
  const totalPill = countHidden ? null : (
    <span data-testid="vote-total" className={BOARD_VOTE_CLASSES.total}>
      <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">thumb_up</span>
      <span data-vote-count="" aria-hidden="true">{total}</span>
      <span className="sr-only">{tp('session.ticket.voteTotal', total)}</span>
    </span>
  );

  const addable = canAdd && !disabled;
  const voted = mine > 0;
  if (readOnly || (takeBackOnly && !voted)) return totalPill;
  // A vote of one's own fills the button; a button that cannot add keeps its
  // total readable instead of fading it out.
  const addClasses = voted
    ? `${BOARD_VOTE_CLASSES.voted} ${addable ? BOARD_VOTE_CLASSES.votedHover : ''}`
    : addable
      ? BOARD_VOTE_CLASSES.addable
      : BOARD_VOTE_CLASSES.blocked;

  return (
    <div data-testid="board-vote-control" className={BOARD_VOTE_CLASSES.pill}>
      {voted && (
        <>
          <span ref={dotsRef} data-testid="my-votes" aria-hidden="true" className={BOARD_VOTE_CLASSES.dots}>
            {mine <= MAX_DOTS
              ? Array.from({ length: mine }, (_, i) => <span key={i} className={BOARD_VOTE_CLASSES.dot} />)
              : (
                <>
                  <span className={BOARD_VOTE_CLASSES.dot} />
                  <span>{mine}</span>
                </>
              )}
          </span>
          <span className="sr-only">{tp('session.ticket.myVotes', mine)}</span>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (mine === 1 && document.activeElement === e.currentTarget) {
                // An item that takes no vote has no vote button to hand the
                // focus to, and its row may go with the cross: the card or
                // group itself takes it (`data-vote-focus-host`).
                if (takeBackOnly) e.currentTarget.closest<HTMLElement>('[data-vote-focus-host]')?.focus();
                else addRef.current?.focus();
              }
              onRemove();
            }}
            disabled={disabled}
            aria-label={t(kind === 'group' ? 'session.group.removeMyVote' : 'session.ticket.removeMyVote')}
            title={t(kind === 'group' ? 'session.group.removeMyVote' : 'session.ticket.removeMyVote')}
            className={BOARD_VOTE_CLASSES.cross}
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
            if (!addable) {
              if (!disabled) onRefused?.();
              return;
            }
            pressedAt.current = Date.now();
            onAdd();
          }}
          aria-disabled={!addable}
          aria-label={countHidden
            ? t(kind === 'group' ? 'session.group.addVote' : 'session.ticket.addVote')
            : tp(kind === 'group' ? 'session.group.addVoteWithTotal' : 'session.ticket.addVoteWithTotal', total)}
          className={`${BOARD_VOTE_CLASSES.add} ${addClasses}`}
        >
          <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">thumb_up</span>
          {!countHidden && <span data-testid="vote-total" data-vote-count="">{total}</span>}
        </button>
      )}
    </div>
  );
};

export default BoardVoteControl;
