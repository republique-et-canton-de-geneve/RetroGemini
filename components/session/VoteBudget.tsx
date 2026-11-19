import React, { useLayoutEffect, useRef } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { playEffect } from '../common/motion/effects';
import { MAX_VOTE_TOKENS, TOKEN_CAST_CLASSES, TOKEN_LEFT_CLASSES, VOTE_BUDGET_CHIP_CLASSES, VOTE_BUDGET_HOOKS } from './voteControls';

/**
 * What the Vote bar says about the viewer's own votes: the sentence "N votes
 * remaining", and beside it one token per vote of the budget, filled while it
 * is left and an outline once it is cast.
 *
 * The sentence is the information, exactly as before (tests and the e2e
 * suite read it, in both languages); the tokens repeat it for the eye and are
 * hidden from assistive technology. Past ten votes a row of tokens is no
 * longer read at a glance, so there is none; with unlimited votes there is
 * nothing to count and nothing is drawn (the bar's own rule, kept).
 *
 * The tokens are where a vote's flight starts and lands
 * (`components/common/motion/flight.ts`): `VOTE_BUDGET_HOOKS` in `voteControls.ts`.
 */

interface VoteBudgetProps {
  /** Votes the viewer can still cast (the bar's "votes remaining" number). */
  left: number;
  /** Votes per person (`voteBudget(settings)`). */
  budget: number;
  /** Votes are unlimited: nothing is counted, nothing is drawn. */
  unlimited: boolean;
}

const VoteBudget: React.FC<VoteBudgetProps> = ({ left, budget, unlimited }) => {
  const { tp } = useTranslation();
  const remaining = Math.max(0, Math.floor(left));
  const chipRef = useRef<HTMLDivElement>(null);
  const shownLeft = useRef(remaining);
  // A vote taken back refills its token, which springs in. Compared with the
  // number shown before, so a bar drawn again (a phase change) plays nothing.
  useLayoutEffect(() => {
    if (remaining > shownLeft.current) playEffect(chipRef.current?.querySelector(VOTE_BUDGET_HOOKS.next), 'fx-pop');
    shownLeft.current = remaining;
  }, [remaining]);
  if (unlimited) return null;
  const total = Math.max(0, Math.floor(budget));
  const tokens = total > 0 && total <= MAX_VOTE_TOKENS;
  const filled = Math.min(remaining, total);

  return (
    <div ref={chipRef} data-vote-budget="" className={VOTE_BUDGET_CHIP_CLASSES}>
      {tp('session.board.votesRemaining', remaining)}
      {tokens && (
        <span data-vote-tokens="" aria-hidden="true" className="flex items-center gap-1">
          {Array.from({ length: total }, (_, index) => {
            const isLeft = index < filled;
            return (
              <span
                key={index}
                data-vote-token={isLeft ? 'left' : 'cast'}
                data-vote-next={isLeft && index === filled - 1 ? '' : undefined}
                className={isLeft ? TOKEN_LEFT_CLASSES : TOKEN_CAST_CLASSES}
              />
            );
          })}
        </span>
      )}
    </div>
  );
};

export default VoteBudget;
