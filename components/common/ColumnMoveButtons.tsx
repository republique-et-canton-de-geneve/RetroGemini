import React, { useLayoutEffect, useRef, useState } from 'react';
import { canMoveColumn, type MoveDirection } from '../../utils/columnOrder';
import { useTranslation } from '../../i18n/I18nContext';

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
  /** Both buttons off, e.g. while a session is reconnecting and drops edits. */
  disabled?: boolean;
  className?: string;
}

// Arrows, not chevrons: on the board, the chevrons of BoardColumnNavigator
// already mean "scroll to the other columns", one row above these.
const ICONS = {
  vertical: { previous: 'arrow_upward', next: 'arrow_downward' },
  horizontal: { previous: 'arrow_back', next: 'arrow_forward' }
} as const;

/**
 * "Earlier" and "later" buttons for one column. Plain buttons rather than a
 * drag, so the pointer and the keyboard do the same thing with the same
 * control.
 *
 * React keeps focus on the pressed button when it moves the column's node (it
 * records the focused element before a commit and restores it after). At an
 * edge it cannot: the pressed button turns disabled in that same commit, a
 * disabled button cannot hold focus, and the keyboard would land on the page.
 * So the keyboard goes to the other arrow of the same column. The new position
 * is then announced, since nothing else a screen reader hears changes: the
 * button's name is the same before and after.
 */
const ColumnMoveButtons: React.FC<Props> = ({
  index,
  count,
  onMove,
  orientation,
  previousLabel,
  nextLabel,
  disabled = false,
  className = ''
}) => {
  const { t } = useTranslation();
  const previousRef = useRef<HTMLButtonElement>(null);
  const nextRef = useRef<HTMLButtonElement>(null);
  const pendingFocus = useRef<{ direction: MoveDirection; fromIndex: number } | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const canPrevious = !disabled && canMoveColumn(index, count, -1);
  const canNext = !disabled && canMoveColumn(index, count, 1);

  // A move can be refused (a session drops edits while offline), and a request
  // left pending would later pull focus here when some other column moved this
  // one. So the request lives only until the move has rendered: the layout
  // effect runs in React's synchronous flush of the click, the timeout in
  // `move` after it.
  useLayoutEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || index === pending.fromIndex) return;
    pendingFocus.current = null;
    const pressed = pending.direction === -1 ? previousRef.current : nextRef.current;
    const other = pending.direction === -1 ? nextRef.current : previousRef.current;
    (pressed && !pressed.disabled ? pressed : other)?.focus();
    setAnnouncement(t('common.columnPosition', { position: index + 1, count }));
  }, [index, count, t]);

  const move = (direction: MoveDirection) => {
    const request = { direction, fromIndex: index };
    pendingFocus.current = request;
    onMove(direction);
    setTimeout(() => {
      if (pendingFocus.current === request) pendingFocus.current = null;
    }, 0);
  };

  const icons = ICONS[orientation];
  // 24px is the WCAG 2.2 minimum target. Stacked, the pair is 48px: the height
  // of the Settings builder's rows, and it sets that of the new-retro editor's.
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
      <span className="sr-only" role="status">{announcement}</span>
    </div>
  );
};

export default ColumnMoveButtons;
