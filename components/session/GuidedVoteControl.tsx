import React, { useLayoutEffect, useRef } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { playEffect } from '../common/motion/effects';
import { GUIDED_VOTE_CLASSES, MAX_VOTE_DOTS, PRESS_ANSWER_MS } from './voteControls';

/**
 * How a card or a group is voted on in the guided Vote phase: a white pill
 * holding a minus, the viewer's own votes as dots, and a plus in the brand
 * colour. The phase keeps everyone else's votes to itself, so the pill shows
 * the viewer's alone. The handlers stay in the session screen; this is markup.
 *
 * The keyboard never loses its place (WCAG 2.4.3): both buttons are
 * `aria-disabled`, never `disabled`, and the minus is never hidden at zero —
 * the vote that used the last one, or took the last one back, would otherwise
 * turn off or remove the very button under the focus. The dots are hidden
 * from assistive technology; the number is said in words beside them.
 */

interface GuidedVoteControlProps {
  kind: 'ticket' | 'group';
  /** The viewer's votes on this item. */
  mine: number;
  /** A vote may be added now: the budget and "one vote per item" allow it. */
  canAdd: boolean;
  onAdd: () => void;
  onRemove: () => void;
  /** The plus was pressed while it could not add: the screen says why (the budget shakes). */
  onRefused?: () => void;
}

const GuidedVoteControl: React.FC<GuidedVoteControlProps> = ({ kind, mine, canAdd, onAdd, onRemove, onRefused }) => {
  const { t, tp } = useTranslation();
  const dotsRef = useRef<HTMLSpanElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const shownMine = useRef(mine);
  // When the plus was last pressed: it answers once the vote is drawn, since
  // the class the last vote gives the button would wipe an effect put on before.
  const pressedAt = useRef(0);
  // The dot a vote just added springs in (the number bumps past three dots).
  // Compared with what was shown, so a remount (a phase change) plays nothing.
  useLayoutEffect(() => {
    if (mine > shownMine.current) {
      const dots = dotsRef.current;
      if (mine <= MAX_VOTE_DOTS) playEffect(dots?.lastElementChild, 'fx-pop');
      else playEffect(dots, 'fx-bump');
      if (Date.now() - pressedAt.current < PRESS_ANSWER_MS) playEffect(plusRef.current, 'fx-press');
    }
    pressedAt.current = 0;
    shownMine.current = mine;
  }, [mine]);

  const canRemove = mine > 0;
  return (
    <div data-testid="guided-vote-control" className={GUIDED_VOTE_CLASSES.pill}>
      <button
        type="button"
        aria-disabled={!canRemove}
        onClick={() => { if (canRemove) onRemove(); }}
        className={canRemove ? GUIDED_VOTE_CLASSES.minusOn : GUIDED_VOTE_CLASSES.minusOff}
        aria-label={t(kind === 'group' ? 'session.group.removeVote' : 'session.ticket.removeVote')}
      >
        <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">remove</span>
      </button>
      <span ref={dotsRef} data-vote-count="" data-testid="my-guided-votes" aria-hidden="true" className={GUIDED_VOTE_CLASSES.dots}>
        {mine <= MAX_VOTE_DOTS
          ? Array.from({ length: mine }, (_, index) => <span key={index} className={GUIDED_VOTE_CLASSES.dot} />)
          : (
            <>
              <span className={GUIDED_VOTE_CLASSES.dot} />
              <span>{mine}</span>
            </>
          )}
      </span>
      <span className="sr-only">{tp('session.ticket.myVotes', mine)}</span>
      <button
        type="button"
        aria-disabled={!canAdd}
        ref={plusRef}
        onClick={() => {
          if (!canAdd) {
            onRefused?.();
            return;
          }
          pressedAt.current = Date.now();
          onAdd();
        }}
        className={canAdd ? GUIDED_VOTE_CLASSES.plusOn : GUIDED_VOTE_CLASSES.plusOff}
        aria-label={t(kind === 'group' ? 'session.group.addVote' : 'session.ticket.addVote')}
      >
        <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">add</span>
      </button>
    </div>
  );
};

export default GuidedVoteControl;
