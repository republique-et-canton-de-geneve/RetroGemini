import { appFetch } from '../../services/publicPath';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RetroSession } from '../../types';
import { dataService } from '../../services/dataService';
import { noteRevokedResponse } from '../../services/sessionRevocation';
import MarkdownContent from '../common/MarkdownContent';
import ModalDialog from '../common/ModalDialog';
import { useTranslation } from '../../i18n/I18nContext';
import {
  DIALOG_OVERLAY,
  DIALOG_PANEL,
  FIELD,
  ICON_BUTTON,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  SECTION_LABEL
} from './dashboardLook';

interface Props {
  retrospectives: RetroSession[];
  // Team roster (including archived members), used to resolve the author of
  // each ticket and the assignee of each action into a human-readable name so
  // the AI can answer participant-specific questions ("when did Thomas last
  // create a ticket"). Optional so the modal still renders without a roster.
  members?: { id: string; name: string }[];
  onClose: () => void;
}

type PromptMode = 'default' | 'custom';

const matchesKeyword = (retro: RetroSession, keyword: string): boolean => {
  const trimmed = keyword.trim();
  if (!trimmed) return false;
  return retro.name.toLowerCase().includes(trimmed.toLowerCase());
};

const ReleaseAnalysisModal: React.FC<Props> = ({ retrospectives, members = [], onClose }) => {
  const { t, tp, tRich } = useTranslation();
  const [keyword, setKeyword] = useState('');
  // Manual additions and removals layered on top of the keyword auto-selection.
  // Splitting them keeps the two concerns separable: the keyword acts as a
  // declarative filter, while manual checkbox toggles always win.
  const [manualAdds, setManualAdds] = useState<Set<string>>(new Set());
  const [manualRemoves, setManualRemoves] = useState<Set<string>>(new Set());
  const [promptMode, setPromptMode] = useState<PromptMode>('default');
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [customPrompt, setCustomPrompt] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [highlightResult, setHighlightResult] = useState(false);
  const resultRef = useRef<HTMLDivElement | null>(null);

  // When a fresh analysis appears, scroll it into view inside the modal and
  // briefly flash a violet ring so it is impossible to miss when the user
  // was looking at the prompt or selection panel above.
  useEffect(() => {
    if (!analysis || !resultRef.current) return;
    // scrollIntoView may be missing in test renderers (jsdom) — guard the call.
    if (typeof resultRef.current.scrollIntoView === 'function') {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    setHighlightResult(true);
    const timer = window.setTimeout(() => setHighlightResult(false), 1800);
    return () => window.clearTimeout(timer);
  }, [analysis]);

  const matchedIds = useMemo(() => {
    const trimmed = keyword.trim();
    if (!trimmed) return new Set<string>();
    const ids = new Set<string>();
    retrospectives.forEach(retro => {
      if (matchesKeyword(retro, trimmed)) ids.add(retro.id);
    });
    return ids;
  }, [keyword, retrospectives]);

  const selectedIds = useMemo(() => {
    const result = new Set<string>(matchedIds);
    manualAdds.forEach(id => result.add(id));
    manualRemoves.forEach(id => result.delete(id));
    return result;
  }, [matchedIds, manualAdds, manualRemoves]);

  const toggleSelect = (retroId: string) => {
    const isSelected = selectedIds.has(retroId);
    if (isSelected) {
      setManualAdds(prev => {
        if (!prev.has(retroId)) return prev;
        const next = new Set(prev);
        next.delete(retroId);
        return next;
      });
      setManualRemoves(prev => {
        if (prev.has(retroId)) return prev;
        const next = new Set(prev);
        next.add(retroId);
        return next;
      });
    } else {
      setManualRemoves(prev => {
        if (!prev.has(retroId)) return prev;
        const next = new Set(prev);
        next.delete(retroId);
        return next;
      });
      setManualAdds(prev => {
        if (prev.has(retroId)) return prev;
        const next = new Set(prev);
        next.add(retroId);
        return next;
      });
    }
  };

  const matchedCount = matchedIds.size;

  const selectedRetros = useMemo(
    () => retrospectives.filter(r => selectedIds.has(r.id)),
    [retrospectives, selectedIds]
  );

  const customModeReady = promptMode !== 'custom' || customPrompt.trim().length > 0;
  const canGenerate = selectedRetros.length >= 1 && !isGenerating && customModeReady;

  const handleGenerate = async () => {
    setError(null);
    setAnalysis(null);
    setCopyState('idle');
    setIsGenerating(true);
    try {
      // Send a compact payload to keep prompts manageable for the LLM.
      const payload = selectedRetros.map(r => ({
        id: r.id,
        name: r.name,
        date: r.date,
        columns: r.columns,
        tickets: r.tickets,
        groups: r.groups,
        actions: r.actions,
        reviewSummary: r.reviewSummary,
        happiness: r.happiness,
        roti: r.roti
      }));

      // Only send members actually referenced by the selected retros (as a
      // ticket author or action assignee) so the payload stays compact.
      const referencedIds = new Set<string>();
      selectedRetros.forEach(r => {
        r.tickets?.forEach(t => t.authorId && referencedIds.add(t.authorId));
        r.actions?.forEach(a => a.assigneeId && referencedIds.add(a.assigneeId));
      });
      const referencedMembers = members.filter(m => referencedIds.has(m.id));

      const body: Record<string, unknown> = {
        sessionToken: dataService.getSessionToken(),
        retrospectives: payload,
        members: referencedMembers,
        releaseLabel: keyword.trim() || undefined,
        mode: promptMode
      };
      if (promptMode === 'custom') {
        body.customPrompt = customPrompt.trim();
      } else if (additionalInstructions.trim()) {
        body.additionalInstructions = additionalInstructions.trim();
      }

      const response = await appFetch('/api/ai/generate-release-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        // Decision D3b: a token a password change revoked is reported, and
        // App then says why above the Dashboard, with "Log in again".
        await noteRevokedResponse(response, body.sessionToken as string | null);
        if (response.status === 404) {
          setError(t('dashboard.releaseAnalysis.errorNotEnabled'));
        } else {
          // Audit H21: this used to render the server's `message` verbatim,
          // which on an upstream failure named the internal LLM's host, IP and
          // port, or echoed the gateway's own error body. The route no longer
          // sends it; not reading it keeps the leak closed even if some future
          // change puts a detail field back in the response.
          setError(t('dashboard.releaseAnalysis.errorFailed'));
        }
        return;
      }

      const data = await response.json();
      if (typeof data.analysis === 'string' && data.analysis.trim()) {
        setAnalysis(data.analysis);
      } else {
        setError(t('dashboard.releaseAnalysis.errorEmpty'));
      }
    } catch (err) {
      console.error('Failed to generate release analysis', err);
      setError(t('dashboard.releaseAnalysis.errorUnreachable'));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopy = async () => {
    if (!analysis) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(analysis);
      } else {
        // Fallback for environments without clipboard API access.
        const textarea = document.createElement('textarea');
        textarea.value = analysis;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'absolute';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopyState('copied');
      setTimeout(() => setCopyState('idle'), 2000);
    } catch (err) {
      console.error('Failed to copy release analysis', err);
      setCopyState('failed');
      setTimeout(() => setCopyState('idle'), 2000);
    }
  };

  const renderCopyButton = (testId: string) => (
    <button
      onClick={handleCopy}
      data-testid={testId}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200 transition"
      title={t('dashboard.releaseAnalysis.copyTitle')}
    >
      {/* The words beside it say the outcome (Copied, Copy failed): the icon is decoration. */}
      <span className="material-symbols-outlined text-sm" aria-hidden="true">
        {copyState === 'copied' ? 'check' : copyState === 'failed' ? 'error' : 'content_copy'}
      </span>
      {copyState === 'copied'
        ? t('dashboard.releaseAnalysis.copied')
        : copyState === 'failed'
          ? t('dashboard.releaseAnalysis.copyFailed')
          : t('dashboard.releaseAnalysis.copy')}
    </button>
  );

  return (
    <ModalDialog
      label={t('dashboard.releaseAnalysis.label')}
      onClose={onClose}
      // Generating an analysis takes a while and the result is not stored:
      // a stray backdrop click must not throw it away. Escape still closes.
      closeOnBackdropClick={false}
      overlayTestId="release-analysis-modal"
      overlayClassName={DIALOG_OVERLAY}
      panelClassName={`${DIALOG_PANEL} max-w-3xl max-h-[90vh] flex flex-col`}
    >
      <>
        <div className="flex items-start justify-between gap-3 px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 shrink-0 rounded-xl bg-violet-50 text-violet-700 flex items-center justify-center">
              <span className="material-symbols-outlined" aria-hidden="true">smart_toy</span>
            </div>
            <div>
              <h2 className="text-lg font-bold tracking-tight text-slate-900">{t('dashboard.releaseAnalysis.title')}</h2>
              <p className="text-xs text-slate-600">
                {t('dashboard.releaseAnalysis.intro')}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`${ICON_BUTTON} -mr-2`}
            aria-label={t('dashboard.releaseAnalysis.close')}
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <div>
            <label htmlFor="release-analysis-keyword" className={`${SECTION_LABEL} block mb-1`}>
              {t('dashboard.releaseAnalysis.keywordLabel')}
            </label>
            <p className="text-xs text-slate-500 mb-2">
              {tRich('dashboard.releaseAnalysis.keywordHint', { example: <code>2606</code> })}
            </p>
            <input
              id="release-analysis-keyword"
              type="text"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder={t('dashboard.releaseAnalysis.keywordPlaceholder')}
              data-testid="release-analysis-keyword"
              className={`${FIELD} text-sm`}
            />
            {keyword.trim() && (
              <p className="mt-1 text-xs text-slate-500">
                {tp('dashboard.releaseAnalysis.matchCount', matchedCount)}
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <span id="release-analysis-retros-label" className={`${SECTION_LABEL} block`}>
                {t('dashboard.releaseAnalysis.retrosLabel')}
              </span>
              <span className="text-xs text-slate-500">
                {tp('dashboard.releaseAnalysis.selectedCount', selectedRetros.length)}
              </span>
            </div>
            {retrospectives.length === 0 ? (
              <div className="text-center text-slate-600 py-6 text-sm border border-dashed border-slate-300 rounded-xl">
                {t('dashboard.releaseAnalysis.noRetros')}
              </div>
            ) : (
              <ul
                // Named, not re-roled. `role="group"` here would replace the
                // native list role, so a screen reader stops announcing
                // "list, N items" — one piece of information traded for
                // another (Codex, PR #437). A list takes an accessible name
                // without giving up what it is.
                aria-labelledby="release-analysis-retros-label"
                className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto"
              >
                {retrospectives.map(retro => {
                  const checked = selectedIds.has(retro.id);
                  return (
                    <li key={retro.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <label className="flex items-center gap-3 cursor-pointer flex-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(retro.id)}
                          className="w-4 h-4 accent-indigo-600"
                          aria-label={t('dashboard.releaseAnalysis.toggleRetro', { name: retro.name })}
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-900">{retro.name}</span>
                          <span className="text-xs text-slate-600">
                            {retro.date} · {t(`dashboard.retroStatus.${retro.status}`)}
                          </span>
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <span id="release-analysis-style-label" className={`${SECTION_LABEL} block mb-2`}>
              {t('dashboard.releaseAnalysis.styleLabel')}
            </span>
            <div className="flex gap-2 mb-3" role="radiogroup" aria-labelledby="release-analysis-style-label">
              <button
                type="button"
                role="radio"
                aria-checked={promptMode === 'default'}
                onClick={() => setPromptMode('default')}
                data-testid="release-analysis-mode-default"
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition ${
                  promptMode === 'default'
                    ? 'bg-indigo-50 border-indigo-600 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {t('dashboard.releaseAnalysis.modeDefault')}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={promptMode === 'custom'}
                onClick={() => setPromptMode('custom')}
                data-testid="release-analysis-mode-custom"
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition ${
                  promptMode === 'custom'
                    ? 'bg-indigo-50 border-indigo-600 text-indigo-700'
                    : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                }`}
              >
                {t('dashboard.releaseAnalysis.modeCustom')}
              </button>
            </div>

            {promptMode === 'default' ? (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1" htmlFor="release-analysis-additional">
                  {t('dashboard.releaseAnalysis.additionalLabel')}
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  {t('dashboard.releaseAnalysis.additionalHint')}
                </p>
                <textarea
                  id="release-analysis-additional"
                  value={additionalInstructions}
                  onChange={(event) => setAdditionalInstructions(event.target.value)}
                  placeholder={t('dashboard.releaseAnalysis.additionalPlaceholder')}
                  rows={3}
                  data-testid="release-analysis-additional"
                  className={`${FIELD} text-sm resize-y`}
                />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1" htmlFor="release-analysis-custom-prompt">
                  {t('dashboard.releaseAnalysis.modeCustom')}
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  {t('dashboard.releaseAnalysis.customHint')}
                </p>
                <textarea
                  id="release-analysis-custom-prompt"
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                  placeholder={t('dashboard.releaseAnalysis.customPlaceholder')}
                  rows={5}
                  data-testid="release-analysis-custom-prompt"
                  className={`${FIELD} text-sm resize-y`}
                />
              </div>
            )}
          </div>

          {error && (
            <div className="text-sm text-rose-700 bg-rose-50 border border-rose-100 rounded-lg p-3">
              {error}
            </div>
          )}

          {analysis && (
            <div
              ref={resultRef}
              data-testid="release-analysis-result"
              className={`scroll-mt-2 rounded-lg transition-shadow duration-500 ${
                highlightResult ? 'ring-4 ring-violet-300 ring-offset-2' : ''
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <h3 className={SECTION_LABEL}>
                  {t('dashboard.releaseAnalysis.resultTitle')}
                </h3>
                {renderCopyButton('release-analysis-copy-inline')}
              </div>
              <div className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-lg p-4">
                <MarkdownContent content={analysis} />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <div className="flex items-center">
            {analysis && renderCopyButton('release-analysis-copy-footer')}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className={`${SECONDARY_BUTTON} px-4 py-2 text-sm`}
            >
              {t('common.close')}
            </button>
            {/* Disabled, it is drawn by the recipe's own disabled colours,
                measured like every other pair (dashboardLook.test.tsx). */}
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              data-testid="release-analysis-generate"
              className={`${PRIMARY_BUTTON} px-4 py-2 text-sm`}
            >
              <span className={`material-symbols-outlined text-lg! leading-none ${isGenerating ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true">
                {isGenerating ? 'progress_activity' : 'smart_toy'}
              </span>
              {isGenerating ? t('dashboard.releaseAnalysis.generating') : t('dashboard.releaseAnalysis.generate')}
            </button>
          </div>
        </div>
      </>
    </ModalDialog>
  );
};

export default ReleaseAnalysisModal;
