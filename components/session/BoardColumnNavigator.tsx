import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';

/**
 * The strip above a board whose columns do not all fit: every column by name,
 * the ones off screen marked as such, and buttons to bring them in. Shown to
 * everyone, facilitator and participants alike, because both missed the fifth
 * column of a Starfish retro when the only sign of it was a scrollbar at the
 * bottom of a tall board.
 *
 * Off screen is said with an icon and with words, not with colour alone
 * (WCAG 1.4.1). Each chip is named by its column's title, which is its visible
 * text (2.5.3).
 */

export interface NavigatorColumn {
  id: string;
  title: string;
  /** `lang` of a title the app wrote, as the column header marks it. */
  lang?: string;
  /** The ink of the column's hue (utils/cardTones.ts), for its dot; none for a column with no hue. */
  ink?: string | null;
}

interface Props {
  columns: readonly NavigatorColumn[];
  visibleIds: readonly string[];
  canScrollLeft: boolean;
  canScrollRight: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onReveal: (columnId: string) => void;
}

const BoardColumnNavigator: React.FC<Props> = ({
  columns,
  visibleIds,
  canScrollLeft,
  canScrollRight,
  onPrevious,
  onNext,
  onReveal
}) => {
  const { t } = useTranslation();
  const visible = new Set(visibleIds);
  const shown = columns.filter((column) => visible.has(column.id)).length;

  const arrowClass = (enabled: boolean) =>
    // Off, its arrow is still drawn at 3:1 (slate-400 measured 2.6:1): a
    // control that says where the board ends.
    `shrink-0 w-8 h-8 flex items-center justify-center rounded-full border transition-colors ${
      enabled
        ? 'border-indigo-600 bg-indigo-600 text-white hover:bg-indigo-700 shadow-xs'
        : 'border-slate-200 bg-white text-slate-500 cursor-not-allowed'
    }`;

  return (
    <nav
      aria-label={t('session.board.columnNavigator')}
      className="bg-white border-b border-slate-200 px-4 md:px-6 py-2 flex items-center gap-2 shrink-0"
      data-testid="board-column-navigator"
    >
      <button
        type="button"
        onClick={onPrevious}
        disabled={!canScrollLeft}
        aria-label={t('session.board.previousColumns')}
        title={t('session.board.previousColumns')}
        className={arrowClass(canScrollLeft)}
      >
        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">chevron_left</span>
      </button>
      <ul className="flex items-center gap-1.5 min-w-0 overflow-x-auto [scrollbar-width:none] py-0.5">
        {columns.map((column, index) => {
          const inView = visible.has(column.id);
          return (
            <li key={column.id} className="shrink-0">
              <button
                type="button"
                onClick={() => onReveal(column.id)}
                className={`flex items-center gap-1 max-w-48 px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors ${
                  inView
                    ? 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50'
                    : 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                }`}
                data-testid={`board-column-chip-${column.id}`}
                data-in-view={inView ? 'true' : 'false'}
              >
                {/* The spaces are for the accessible name ("5. Start Doing
                    (off screen)"); a flex row renders none of them. */}
                {/* The column's hue, as its cards and its head show it. */}
                {column.ink && (
                  <span className="w-2 h-2 shrink-0 rounded-full" style={{ backgroundColor: column.ink }} aria-hidden="true" />
                )}
                <span className="tabular-nums">{index + 1}.</span>{' '}
                <span className="truncate" lang={column.lang}>{column.title}</span>
                {!inView && (
                  <>
                    {' '}
                    <span className="material-symbols-outlined text-sm! leading-none" aria-hidden="true">visibility_off</span>
                    <span className="sr-only">{` ${t('session.board.columnOffScreen')}`}</span>
                  </>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <button
        type="button"
        onClick={onNext}
        disabled={!canScrollRight}
        aria-label={t('session.board.nextColumns')}
        title={t('session.board.nextColumns')}
        className={arrowClass(canScrollRight)}
      >
        <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">chevron_right</span>
      </button>
      <span className="ml-auto shrink-0 text-xs text-slate-600 whitespace-nowrap hidden sm:inline">
        {t('session.board.columnsInView', { shown, total: columns.length })}
      </span>
    </nav>
  );
};

export default BoardColumnNavigator;
