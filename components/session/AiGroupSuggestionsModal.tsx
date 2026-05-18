import React, { useState } from 'react';
import type { Column, Ticket } from '../../types';

export interface AiSuggestedGroup {
  title: string;
  ticketIds: string[];
}

interface Props {
  isOpen: boolean;
  loading: boolean;
  error: string | null;
  suggestions: AiSuggestedGroup[] | null;
  tickets: Ticket[];
  columns: Column[];
  /** Called when the facilitator accepts a single suggestion. */
  onAccept: (suggestion: AiSuggestedGroup) => void;
  /** Called when the facilitator rejects/dismisses a single suggestion. */
  onReject: (index: number) => void;
  /** Accept every remaining suggestion. */
  onAcceptAll: () => void;
  /** Re-run the suggestion. */
  onRegenerate: () => void;
  /** Close the modal. */
  onClose: () => void;
}

const AiGroupSuggestionsModal: React.FC<Props> = ({
  isOpen,
  loading,
  error,
  suggestions,
  tickets,
  columns,
  onAccept,
  onReject,
  onAcceptAll,
  onRegenerate,
  onClose,
}) => {
  const [acceptedIndexes, setAcceptedIndexes] = useState<Set<number>>(new Set());

  React.useEffect(() => {
    if (isOpen) setAcceptedIndexes(new Set());
  }, [isOpen, suggestions]);

  if (!isOpen) return null;

  const ticketById = new Map(tickets.map(t => [t.id, t]));
  const columnById = new Map(columns.map(c => [c.id, c]));

  const remaining = (suggestions || []).filter((_, i) => !acceptedIndexes.has(i));
  const totalCount = suggestions?.length ?? 0;
  const acceptedCount = acceptedIndexes.size;

  const handleAccept = (index: number, suggestion: AiSuggestedGroup) => {
    onAccept(suggestion);
    setAcceptedIndexes(prev => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };

  const handleAcceptAll = () => {
    onAcceptAll();
    setAcceptedIndexes(new Set(Array.from({ length: totalCount }, (_, i) => i)));
  };

  return (
    <div
      className="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="AI group suggestions"
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-violet-500">auto_awesome</span>
            <h2 className="font-bold text-slate-800 text-lg">AI Group Suggestions</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 p-1 rounded-sm"
            aria-label="Close suggestions"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto grow">
          <p className="text-sm text-slate-600 mb-4">
            The assistant proposes clusters based on the brainstormed tickets.
            Review each one and accept the groupings you find relevant — nothing
            is applied automatically.
          </p>

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-violet-600">
              <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
              <p className="mt-3 text-sm font-medium">Analyzing tickets...</p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-base mt-0.5">error</span>
                <div>
                  <div className="font-semibold mb-1">Could not generate suggestions</div>
                  <div>{error}</div>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && suggestions && suggestions.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 text-slate-600 px-4 py-6 text-sm text-center">
              The assistant did not find clusters that obviously belong together.
              You can still group cards manually.
            </div>
          )}

          {!loading && !error && suggestions && suggestions.length > 0 && (
            <div className="space-y-3">
              {suggestions.map((suggestion, index) => {
                const accepted = acceptedIndexes.has(index);
                const groupTickets = suggestion.ticketIds
                  .map(id => ticketById.get(id))
                  .filter((t): t is Ticket => !!t);

                return (
                  <div
                    key={`${suggestion.title}-${index}`}
                    className={`rounded-xl border-2 p-3 transition ${
                      accepted
                        ? 'border-emerald-300 bg-emerald-50/50 opacity-70'
                        : 'border-indigo-200 bg-indigo-50/40'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-outlined text-indigo-500 text-base">layers</span>
                        <span className="font-bold text-slate-800 text-sm">
                          {suggestion.title || 'Untitled cluster'}
                        </span>
                        <span className="text-xs text-slate-500">
                          ({groupTickets.length} ticket{groupTickets.length > 1 ? 's' : ''})
                        </span>
                      </div>
                      {accepted ? (
                        <span className="flex items-center gap-1 text-emerald-700 text-xs font-bold">
                          <span className="material-symbols-outlined text-sm">check_circle</span>
                          Applied
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => onReject(index)}
                            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 rounded-sm hover:bg-white"
                          >
                            Dismiss
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAccept(index, suggestion)}
                            className="text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-600 px-3 py-1 rounded-sm shadow-xs"
                          >
                            Accept
                          </button>
                        </div>
                      )}
                    </div>
                    <ul className="space-y-1 pl-2">
                      {groupTickets.map(t => {
                        const col = columnById.get(t.colId);
                        return (
                          <li key={t.id} className="text-xs text-slate-700 flex items-start gap-2">
                            {col && (
                              <span
                                className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0"
                                style={col.customColor ? { backgroundColor: col.customColor } : undefined}
                                aria-hidden
                              />
                            )}
                            <span className="grow whitespace-pre-wrap wrap-break-word">
                              {t.text}
                              {col && (
                                <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-400">
                                  {col.title}
                                </span>
                              )}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {totalCount > 0 && (
              <span>
                {acceptedCount} of {totalCount} accepted
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onRegenerate}
              disabled={loading}
              className="text-xs font-semibold text-violet-700 hover:text-violet-900 px-3 py-1 rounded-sm hover:bg-white disabled:opacity-50 flex items-center gap-1"
            >
              <span className="material-symbols-outlined text-sm">refresh</span>
              Regenerate
            </button>
            {!loading && !error && remaining.length > 1 && (
              <button
                type="button"
                onClick={handleAcceptAll}
                className="text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 rounded-sm shadow-xs"
              >
                Accept all remaining
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 px-3 py-1.5 rounded-sm"
            >
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AiGroupSuggestionsModal;
