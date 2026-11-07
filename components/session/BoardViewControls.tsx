import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import type { MessageKey } from '../../i18n/translate';
import { BOARD_SORTS, type BoardSort, toBoardSort } from '../../utils/boardView';

/**
 * The search and the sort of an open board (utils/boardView.ts), on its bar.
 * Both belong to the person looking: nothing here is written to the session,
 * so two people can read the same board in two orders.
 */

interface Props {
  search: string;
  onSearch: (query: string) => void;
  sort: BoardSort;
  onSort: (sort: BoardSort) => void;
  /** False while the facilitator hides the totals: the ranking would show them. */
  canSortByVotes: boolean;
  /** How many cards and groups the search finds, or null with no search. */
  resultCount: number | null;
}

const SORT_LABELS: Record<BoardSort, MessageKey> = {
  newest: 'session.openBoard.sortNewest',
  oldest: 'session.openBoard.sortOldest',
  votes: 'session.openBoard.sortVotes',
};

const BoardViewControls: React.FC<Props> = ({ search, onSearch, sort, onSort, canSortByVotes, resultCount }) => {
  const { t, tp } = useTranslation();

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <span className="material-symbols-outlined text-base! leading-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" aria-hidden="true">search</span>
        <input
          type="search"
          value={search}
          onChange={(e) => onSearch(e.target.value)}
          onKeyDown={(e) => {
            // Escape empties the search, as in a browser's own field; it does
            // not reach the board, where it would put a held card down.
            if (e.key === 'Escape' && search) {
              e.stopPropagation();
              onSearch('');
            }
          }}
          aria-label={t('session.openBoard.search')}
          placeholder={t('session.openBoard.searchPlaceholder')}
          className="w-40 sm:w-48 text-sm bg-white border border-slate-300 rounded-sm pl-7 pr-2 py-1 text-slate-900 placeholder:text-slate-500 hover:border-slate-400"
        />
      </div>
      {/* Always in the page, empty with no search: a status region added (or
          shown) at the moment it has something to say is not reliably
          announced. Visually hidden while empty, so it takes no room. */}
      <span role="status" className={`text-xs font-medium text-slate-600 whitespace-nowrap ${resultCount === null ? 'sr-only' : ''}`}>
        {resultCount === null ? '' : tp('session.openBoard.searchResults', resultCount)}
      </span>
      <div className="flex items-center gap-1">
        <span className="material-symbols-outlined text-base! leading-none text-slate-500" aria-hidden="true">sort</span>
        <select
          aria-label={t('session.openBoard.sortBy')}
          value={sort}
          onChange={(e) => onSort(toBoardSort(e.target.value))}
          className="text-xs bg-white border border-slate-300 rounded-sm px-2 py-1 text-slate-700 font-medium cursor-pointer hover:border-slate-400"
        >
          {BOARD_SORTS.map((option) => (
            <option key={option} value={option} disabled={option === 'votes' && !canSortByVotes}>
              {t(SORT_LABELS[option])}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
};

export default BoardViewControls;
