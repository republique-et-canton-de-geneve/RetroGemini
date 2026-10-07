import React, { useState } from 'react';
import type { Column, Ticket } from '../../types';
import ModalDialog from '../common/ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';

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
  /**
   * Optional notification fired when a suggestion is dismissed. Dismissal is
   * tracked inside the modal, so the parent MUST NOT remove the suggestion from
   * the `suggestions` array in response — reshuffling the list reactivates
   * already-accepted groups.
   */
  onReject?: (index: number) => void;
  /** Accept every remaining suggestion (each already filtered to its included tickets). */
  onAcceptAll: (suggestions: AiSuggestedGroup[]) => void;
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
  const { t } = useTranslation();
  const [acceptedIndexes, setAcceptedIndexes] = useState<Set<number>>(new Set());
  // Suggestions dismissed during this review. Tracked here instead of mutating
  // `suggestions` so dismissing one group never reshuffles the indexes used by
  // `acceptedIndexes`/`excludedKeys` (which would reactivate accepted groups).
  const [dismissedIndexes, setDismissedIndexes] = useState<Set<number>>(new Set());
  // Ticket ids the facilitator chose to exclude from a suggested group, keyed by
  // `${groupIndex}::${ticketId}`. Every ticket is included by default.
  const [excludedKeys, setExcludedKeys] = useState<Set<string>>(new Set());

  // Reset the review state only when the modal opens or a fresh set of
  // suggestions arrives (e.g. Regenerate) — not on dismiss, which keeps the same
  // `suggestions` reference.
  React.useEffect(() => {
    if (isOpen) {
      setAcceptedIndexes(new Set());
      setDismissedIndexes(new Set());
      setExcludedKeys(new Set());
    }
  }, [isOpen, suggestions]);

  if (!isOpen) return null;

  const ticketById = new Map(tickets.map(ticket => [ticket.id, ticket]));
  const columnById = new Map(columns.map(c => [c.id, c]));

  const keyFor = (index: number, ticketId: string) => `${index}::${ticketId}`;
  const isIncluded = (index: number, ticketId: string) => !excludedKeys.has(keyFor(index, ticketId));
  const includedTicketIds = (index: number, suggestion: AiSuggestedGroup) =>
    suggestion.ticketIds.filter(id => isIncluded(index, id));

  const toggleTicket = (index: number, ticketId: string) => {
    setExcludedKeys(prev => {
      const next = new Set(prev);
      const key = keyFor(index, ticketId);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const remaining = (suggestions || []).filter(
    (_, i) => !acceptedIndexes.has(i) && !dismissedIndexes.has(i),
  );
  const visibleCount = (suggestions || []).filter((_, i) => !dismissedIndexes.has(i)).length;
  const acceptedCount = acceptedIndexes.size;

  const handleAccept = (index: number, suggestion: AiSuggestedGroup) => {
    onAccept({ ...suggestion, ticketIds: includedTicketIds(index, suggestion) });
    setAcceptedIndexes(prev => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };

  const handleAcceptAll = () => {
    const toApply: AiSuggestedGroup[] = [];
    const appliedIndexes: number[] = [];
    (suggestions || []).forEach((suggestion, index) => {
      if (acceptedIndexes.has(index) || dismissedIndexes.has(index)) return;
      const ids = includedTicketIds(index, suggestion);
      // A group needs at least two existing tickets to be created.
      if (ids.filter(id => ticketById.has(id)).length < 2) return;
      toApply.push({ ...suggestion, ticketIds: ids });
      appliedIndexes.push(index);
    });
    if (toApply.length === 0) return;
    onAcceptAll(toApply);
    setAcceptedIndexes(prev => new Set([...prev, ...appliedIndexes]));
  };

  const handleDismiss = (index: number) => {
    onReject?.(index);
    setDismissedIndexes(prev => {
      const next = new Set(prev);
      next.add(index);
      return next;
    });
  };

  return (
    // The role used to sit on the backdrop, which tells a screen reader the
    // whole page is the dialog. `ModalDialog` puts it on the panel.
    <ModalDialog
      label={t('session.aiGroups.dialogLabel')}
      onClose={onClose}
      overlayClassName="fixed inset-0 bg-slate-900/40 z-50 flex items-center justify-center p-4"
      panelClassName="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
    >
      <>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-violet-500">auto_awesome</span>
            <h2 className="font-bold text-slate-800 text-lg">{t('session.aiGroups.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 p-1 rounded-sm"
            aria-label={t('session.aiGroups.closeAria')}
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto grow">
          <p className="text-sm text-slate-600 mb-4">
            {t('session.aiGroups.intro')}
          </p>

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-violet-600">
              <span className="material-symbols-outlined animate-spin text-4xl">progress_activity</span>
              <p className="mt-3 text-sm font-medium">{t('session.aiGroups.analyzing')}</p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-base mt-0.5">error</span>
                <div>
                  <div className="font-semibold mb-1">{t('session.aiGroups.errorTitle')}</div>
                  <div>{error}</div>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && suggestions && suggestions.length === 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 text-slate-600 px-4 py-6 text-sm text-center">
              {t('session.aiGroups.noClusters')}
            </div>
          )}

          {!loading && !error && suggestions && suggestions.length > 0 && (
            <div className="space-y-3">
              {suggestions.map((suggestion, index) => {
                if (dismissedIndexes.has(index)) return null;
                const accepted = acceptedIndexes.has(index);
                const groupTickets = suggestion.ticketIds
                  .map(id => ticketById.get(id))
                  .filter((ticket): ticket is Ticket => !!ticket);
                const includedCount = groupTickets.filter(ticket => isIncluded(index, ticket.id)).length;
                const canAccept = includedCount >= 2;

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
                          {suggestion.title || t('session.aiGroups.untitledCluster')}
                        </span>
                        <span className="text-xs text-slate-500">
                          {includedCount === groupTickets.length
                            ? t(
                                groupTickets.length > 1
                                  ? 'session.aiGroups.ticketCountPlural'
                                  : 'session.aiGroups.ticketCountSingular',
                                { count: groupTickets.length }
                              )
                            : t('session.aiGroups.ticketCountPartial', {
                                included: includedCount,
                                total: groupTickets.length,
                              })}
                        </span>
                      </div>
                      {accepted ? (
                        <span className="flex items-center gap-1 text-emerald-700 text-xs font-bold">
                          <span className="material-symbols-outlined text-sm">check_circle</span>
                          {t('session.aiGroups.applied')}
                        </span>
                      ) : (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => handleDismiss(index)}
                            className="text-xs font-semibold text-slate-500 hover:text-slate-700 px-2 py-1 rounded-sm hover:bg-white"
                          >
                            {t('session.aiGroups.dismiss')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAccept(index, suggestion)}
                            disabled={!canAccept}
                            title={canAccept ? undefined : t('session.aiGroups.needTwoTicketsTitle')}
                            className="text-xs font-bold text-white bg-indigo-500 hover:bg-indigo-600 px-3 py-1 rounded-sm shadow-xs disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {t('session.aiGroups.accept')}
                          </button>
                        </div>
                      )}
                    </div>
                    <ul className="space-y-1 pl-1">
                      {groupTickets.map(ticket => {
                        const col = columnById.get(ticket.colId);
                        const included = isIncluded(index, ticket.id);
                        return (
                          <li key={ticket.id} className="text-xs flex items-start">
                            <label
                              className={`flex items-start gap-2 grow ${accepted ? 'cursor-default' : 'cursor-pointer'}`}
                            >
                              <input
                                type="checkbox"
                                checked={included}
                                disabled={accepted}
                                onChange={() => toggleTicket(index, ticket.id)}
                                className="mt-0.5 w-3.5 h-3.5 accent-indigo-600 shrink-0 disabled:opacity-60"
                                aria-label={t('session.aiGroups.includeTicket', { text: ticket.text })}
                              />
                              {col && (
                                <span
                                  className="inline-block w-2 h-2 rounded-full mt-1.5 shrink-0"
                                  style={col.customColor ? { backgroundColor: col.customColor } : undefined}
                                  aria-hidden
                                />
                              )}
                              <span
                                className={`grow whitespace-pre-wrap wrap-break-word ${
                                  included ? 'text-slate-700' : 'text-slate-500 line-through'
                                }`}
                              >
                                {ticket.text}
                                {col && (
                                  <span className="ml-2 text-[10px] uppercase tracking-wider text-slate-500">
                                    {col.title}
                                  </span>
                                )}
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    {!accepted && !canAccept && (
                      <p className="mt-2 pl-1 text-[11px] text-amber-600">
                        {t('session.aiGroups.needTwoTickets')}
                      </p>
                    )}
                  </div>
                );
              })}
              {visibleCount === 0 && (
                <div className="rounded-lg border border-slate-200 bg-slate-50 text-slate-600 px-4 py-6 text-sm text-center">
                  {t('session.aiGroups.allDismissed')}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-500">
            {visibleCount > 0 && (
              <span>
                {t('session.aiGroups.acceptedCount', { accepted: acceptedCount, total: visibleCount })}
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
              {t('session.aiGroups.regenerate')}
            </button>
            {!loading && !error && remaining.length > 1 && (
              <button
                type="button"
                onClick={handleAcceptAll}
                className="text-xs font-bold text-white bg-emerald-500 hover:bg-emerald-600 px-3 py-1.5 rounded-sm shadow-xs"
              >
                {t('session.aiGroups.acceptAllRemaining')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-bold text-slate-700 bg-white border border-slate-300 hover:bg-slate-100 px-3 py-1.5 rounded-sm"
            >
              {t('session.aiGroups.close')}
            </button>
          </div>
        </div>
      </>
    </ModalDialog>
  );
};

export default AiGroupSuggestionsModal;
