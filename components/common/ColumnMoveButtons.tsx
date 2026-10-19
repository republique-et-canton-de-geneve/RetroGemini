import React, { useLayoutEffect, useRef } from 'react';
import { canMoveColumn, type MoveDirection } from '../../utils/columnOrder';

interface Props {
  /** The column's place in the list, and the list's length. */
  index: number;
  count: number;
  onMove: (direction: MoveDirection) => void;
  /** A list of rows (the Dashboard editors) or a board of columns (a session). */
  orientation: 'vertical' | 'horizontal';
  /** Full names, saying which column moves: an icon is not a name (H52). */
  previousLabel: string;
  nextLabel: string;
  className?: string;
}

const ICONS = {
  vertical: { previous: 'arrow_upward', next: 'arrow_downward' },
  horizontal: { previous: 'chevron_left', next: 'chevron_right' }
} as const;

/**
 * "Earlier" and "later" buttons for one column. Plain buttons rather than a
 * drag, so the pointer and the keyboard do the same thing with the same
 * control.
 *
 * A move re-renders the column in a new place, and React may re-insert the
 * very node holding focus, which drops it. So the button keeps the keyboard on
 * the column just moved: on the button pressed while it still applies, on the
 * other one once the column reaches an edge and the pressed one is disabled.
 */
const ColumnMoveButtons: React.FC<Props> = ({ index, count, onMove, orientation, previousLabel, nextLabel, className = '' }) => {
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ direction: MoveDirection; fromIndex: number } | null>(null);
  const canPrevious = canMoveColumn(index, count, -1);
  const canNext = canMoveColumn(index, count, 1);

  // A move can be refused (a session drops edits while offline), and a request
  // left pending would later pull focus here when some other column moved this
  // one. So the request lives only until the move has rendered: the layout
  // effect runs in React's synchronous flush of the click, the timeout after it.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending) return;
    pendingFocus.current = null;
    if (index === pending.fromIndex) return;
    const pressed = pending.direction === -1 ? previousRef.current : nextRef.current;
    const other = pending.direction === -1 ? nextRef.current : previousRef.current;
    (pressed && !pressed.disabled ? pressed : other)?.focus();
  });

  const move = (direction: MoveDirection) => {
    const request = { direction, fromIndex: index };
    pendingFocus.current = request;
    onMove(direction);
    setTimeout(() => {
      if (pendingFocus.current === request) pendingFocus.current = null;
    }, 0);
  };

  const icons = ICONS[orientation];
  // Stacked, two 24px buttons fit beside a 48px editor row; side by side they
  // sit in a column header. 24px is the WCAG 2.2 minimum target either way.
  const size = orientation === 'vertical' ? 'w-7 h-6' : 'w-7 h-7';
  const buttonClass = `${size} rounded-sm flex items-center justify-center text-slate-600 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed shrink-0`;

  return (
    <div className={`flex ${orientation === 'vertical' ? 'flex-col' : 'flex-row'} ${className}`}>
      <button
        ref={previousRef}
        type="button"
        disabled={!canPrevious}
        onClick={() => move(-1)}
        aria-label={previousLabel}
        title={previousLabel}
        className={buttonClass}
      >
        <span className="material-symbols-outlined text-lg" aria-hidden="true">{icons.previous}</span>
      </button>
      <button
        ref={nextRef}
        type="button"
        disabled={!canNext}
        onClick={() => move(1)}
        aria-label={nextLabel}
        title={nextLabel}
        className={buttonClass}
      >
        <span className="material-symbols-outlined text-lg" aria-hidden="true">{icons.next}</span>
      </button>
    </div>
  );
};

export default ColumnMoveButtons;
