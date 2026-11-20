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
      overlayClassName="fixed inset-0 bg-slate-900/45 z-50 flex items-center justify-center p-4"
      panelClassName="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden"
    >
      <>
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span className="w-8 h-8 flex items-center justify-center rounded-lg bg-violet-50 text-violet-700 shrink-0" aria-hidden="true">
              <span className="material-symbols-outlined text-lg! leading-none">auto_awesome</span>
            </span>
            <h2 className="font-semibold tracking-tight text-slate-900 text-lg">{t('session.aiGroups.title')}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition shrink-0"
            aria-label={t('session.aiGroups.closeAria')}
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto grow">
          <p className="text-sm text-slate-600 mb-4">
            {t('session.aiGroups.intro')}
          </p>

          {loading && (
            <div className="flex flex-col items-center justify-center py-10 text-violet-700">
              <span className="material-symbols-outlined motion-safe:animate-spin text-4xl! leading-none" aria-hidden="true">progress_activity</span>
              <p className="mt-3 text-sm font-medium">{t('session.aiGroups.analyzing')}</p>
            </div>
          )}

          {!loading && error && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
              <div className="flex items-start gap-2">
                <span className="material-symbols-outlined text-base! leading-none mt-0.5" aria-hidden="true">error</span>
                <div>
                  <div className="font-semibold mb-1">{t('session.aiGroups.errorTitle')}</div>
                  <div>{error}</div>
                </div>
              </div>
            </div>
          )}

          {!loading && !error && suggestions && suggestions.length === 0 && (
            <div className="rounded-xl border border-slate-200 bg-slate-50 text-slate-600 px-4 py-6 text-sm text-center">
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
                    // An applied group is told by its tint and its "Applied"
                    // chip, never by fading it: 70% opacity took its words
                    // below 4.5:1.
                    className={`rounded-xl border p-3 transition-shadow ${
                      accepted
                        ? 'border-emerald-200 bg-emerald-50'
                        : 'border-slate-200 bg-white shadow-xs hover:shadow-md'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-2">
                      <div className="flex items-center gap-2 min-w-0 flex-wrap">
                        <span className="material-symbols-outlined text-indigo-600 text-base! leading-none" aria-hidden="true">layers</span>
                        <span className="font-semibold text-slate-900 text-sm">
                          {suggestion.title || t('session.aiGroups.untitledCluster')}
                        </span>
                        <span className="text-xs text-slate-600 tabular-nums">
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
                        <span className="flex items-center gap-1 rounded-full px-2.5 py-0.5 bg-emerald-100 text-emerald-800 text-xs font-semibold shrink-0">
                          <span className="material-symbols-outlined text-sm! leading-none" aria-hidden="true">check_circle</span>
                          {t('session.aiGroups.applied')}
                        </span>
                      ) : (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleDismiss(index)}
                            className="text-xs font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 px-2.5 py-1.5 rounded-lg transition"
                          >
                            {t('session.aiGroups.dismiss')}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleAccept(index, suggestion)}
                            disabled={!canAccept}
                            title={canAccept ? undefined : t('session.aiGroups.needTwoTicketsTitle')}
                            // White on indigo-500 measured 4.46:1. Both states
                            // are colours a test can measure, not an opacity.
                            className={`text-xs font-semibold px-3 py-1.5 rounded-lg transition ${
                              canAccept
                                ? 'bg-indigo-600 text-white hover:bg-indigo-700 btn-brand-glow enabled:active:bg-indigo-800'
                                : 'bg-slate-200 text-slate-600 cursor-not-allowed'
                            }`}
                          >
                            {t('session.aiGroups.accept')}
                          </button>
                        </div>
                      )}
                    </div>
                    <ul className="space-y-1.5 pl-1">
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
                                className="mt-0.5 w-4 h-4 accent-indigo-600 shrink-0"
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
                                  included ? 'text-slate-700' : 'text-slate-600 line-through'
                                }`}
                              >
                                {ticket.text}
                                {col && (
                                  <span className="ml-2 text-xs text-slate-600">
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
                      <p className="mt-2 pl-1 text-xs text-amber-700">
                        {t('session.aiGroups.needTwoTickets')}
                      </p>
                    )}
                  </div>
                );
              })}
              {visibleCount === 0 && (
                <div className="rounded-xl border border-slate-200 bg-slate-50 text-slate-600 px-4 py-6 text-sm text-center">
                  {t('session.aiGroups.allDismissed')}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-3">
          <div className="text-xs text-slate-600 tabular-nums">
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
              className={`text-xs font-semibold px-3 py-1.5 rounded-lg flex items-center gap-1 transition ${
                loading ? 'text-slate-600 cursor-not-allowed' : 'text-violet-700 hover:bg-violet-50'
              }`}
            >
              <span className="material-symbols-outlined text-base! leading-none" aria-hidden="true">refresh</span>
              {t('session.aiGroups.regenerate')}
            </button>
            {!loading && !error && remaining.length > 1 && (
              <button
                type="button"
                onClick={handleAcceptAll}
                // White on emerald-500 measured 2.54:1: the footer's main
                // action takes the brand, like every primary button.
                className="text-xs font-semibold text-white bg-indigo-600 hover:bg-indigo-700 btn-brand-glow enabled:active:bg-indigo-800 px-3 py-1.5 rounded-lg transition"
              >
                {t('session.aiGroups.acceptAllRemaining')}
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="text-xs font-semibold text-slate-700 bg-white border border-slate-200 hover:border-slate-300 hover:bg-slate-50 px-3 py-1.5 rounded-lg transition"
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
