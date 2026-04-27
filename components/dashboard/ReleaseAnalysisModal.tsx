import React, { useMemo, useState } from 'react';
import { RetroSession } from '../../types';

interface Props {
  retrospectives: RetroSession[];
  onClose: () => void;
}

type PromptMode = 'default' | 'custom';

const matchesKeyword = (retro: RetroSession, keyword: string): boolean => {
  const trimmed = keyword.trim();
  if (!trimmed) return false;
  return retro.name.toLowerCase().includes(trimmed.toLowerCase());
};

const ReleaseAnalysisModal: React.FC<Props> = ({ retrospectives, onClose }) => {
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

      const body: Record<string, unknown> = {
        retrospectives: payload,
        releaseLabel: keyword.trim() || undefined,
        mode: promptMode
      };
      if (promptMode === 'custom') {
        body.customPrompt = customPrompt.trim();
      } else if (additionalInstructions.trim()) {
        body.additionalInstructions = additionalInstructions.trim();
      }

      const response = await fetch('/api/ai/generate-release-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!response.ok) {
        const data = await response.json().catch(() => null);
        if (response.status === 404) {
          setError('AI is not enabled or the selected retrospectives have no content.');
        } else {
          setError(data?.message || 'Failed to generate the release analysis.');
        }
        return;
      }

      const data = await response.json();
      if (typeof data.analysis === 'string' && data.analysis.trim()) {
        setAnalysis(data.analysis);
      } else {
        setError('The AI returned an empty analysis.');
      }
    } catch (err) {
      console.error('Failed to generate release analysis', err);
      setError('Could not reach the AI service. Please try again.');
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
      title="Copy analysis to clipboard"
    >
      <span className="material-symbols-outlined text-sm">
        {copyState === 'copied' ? 'check' : copyState === 'failed' ? 'error' : 'content_copy'}
      </span>
      {copyState === 'copied' ? 'Copied!' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
    </button>
  );

  return (
    <div
      data-testid="release-analysis-modal"
      className="fixed inset-0 bg-black/50 z-100 flex items-center justify-center backdrop-blur-xs p-4"
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-start justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-violet-50 text-violet-700 flex items-center justify-center">
              <span className="material-symbols-outlined">smart_toy</span>
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-800">Release retrospective analysis</h2>
              <p className="text-xs text-slate-500">
                Combine several retrospectives into a single AI-generated synthesis: drivers, anchors,
                practice changes and new tools across the period.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700"
            aria-label="Close release analysis"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          <div>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-1">
              Release keyword (optional)
            </label>
            <p className="text-xs text-slate-500 mb-2">
              When your team names sprints with a shared release tag (for example <code>2606</code>),
              type it here to auto-select every matching retrospective. Leave it empty to pick
              retrospectives manually below.
            </p>
            <input
              type="text"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="e.g. 2606, R&S, Q2..."
              data-testid="release-analysis-keyword"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-hidden focus:border-violet-400 focus:ring-1 focus:ring-violet-100"
            />
            {keyword.trim() && (
              <p className="mt-1 text-xs text-slate-500">
                {matchedCount} retrospective{matchedCount === 1 ? '' : 's'} match this keyword.
              </p>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide">
                Retrospectives to include
              </label>
              <span className="text-xs text-slate-500">
                {selectedRetros.length} selected
              </span>
            </div>
            {retrospectives.length === 0 ? (
              <div className="text-center text-slate-400 py-6 text-sm border border-dashed border-slate-200 rounded-lg">
                No retrospectives available yet.
              </div>
            ) : (
              <ul className="border border-slate-200 rounded-lg divide-y divide-slate-100 max-h-64 overflow-y-auto">
                {retrospectives.map(retro => {
                  const checked = selectedIds.has(retro.id);
                  return (
                    <li key={retro.id} className="flex items-center justify-between gap-3 px-3 py-2">
                      <label className="flex items-center gap-3 cursor-pointer flex-1">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleSelect(retro.id)}
                          className="w-4 h-4 accent-violet-600"
                          aria-label={`Toggle ${retro.name}`}
                        />
                        <span className="flex flex-col">
                          <span className="text-sm font-semibold text-slate-700">{retro.name}</span>
                          <span className="text-[11px] uppercase tracking-wide text-slate-400">
                            {retro.date} · {retro.status.replace('_', ' ')}
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
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">
              Analysis style
            </label>
            <div className="flex gap-2 mb-3" role="radiogroup" aria-label="Analysis style">
              <button
                type="button"
                role="radio"
                aria-checked={promptMode === 'default'}
                onClick={() => setPromptMode('default')}
                data-testid="release-analysis-mode-default"
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition ${
                  promptMode === 'default'
                    ? 'bg-violet-50 border-violet-300 text-violet-700'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                Default release summary
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={promptMode === 'custom'}
                onClick={() => setPromptMode('custom')}
                data-testid="release-analysis-mode-custom"
                className={`flex-1 px-3 py-2 rounded-lg text-sm font-semibold border transition ${
                  promptMode === 'custom'
                    ? 'bg-violet-50 border-violet-300 text-violet-700'
                    : 'bg-white border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                Custom prompt
              </button>
            </div>

            {promptMode === 'default' ? (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1" htmlFor="release-analysis-additional">
                  Additional instructions (optional)
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Append extra guidance to the default release-summary prompt, e.g. focus on a particular topic
                  or output language.
                </p>
                <textarea
                  id="release-analysis-additional"
                  value={additionalInstructions}
                  onChange={(event) => setAdditionalInstructions(event.target.value)}
                  placeholder="e.g. Focus on quality and delivery topics, and write the synthesis in French."
                  rows={3}
                  data-testid="release-analysis-additional"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-hidden focus:border-violet-400 focus:ring-1 focus:ring-violet-100 resize-y"
                />
              </div>
            ) : (
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1" htmlFor="release-analysis-custom-prompt">
                  Custom prompt
                </label>
                <p className="text-xs text-slate-500 mb-2">
                  Replace the default release-summary instructions entirely. The selected retrospectives
                  will still be appended after this prompt.
                </p>
                <textarea
                  id="release-analysis-custom-prompt"
                  value={customPrompt}
                  onChange={(event) => setCustomPrompt(event.target.value)}
                  placeholder="Describe the analysis you want the AI to perform on the selected retrospectives."
                  rows={5}
                  data-testid="release-analysis-custom-prompt"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-hidden focus:border-violet-400 focus:ring-1 focus:ring-violet-100 resize-y"
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
            <div data-testid="release-analysis-result">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wide">
                  AI analysis
                </h3>
                {renderCopyButton('release-analysis-copy-inline')}
              </div>
              <div className="text-sm text-slate-700 whitespace-pre-wrap bg-slate-50 border border-slate-200 rounded-lg p-4">
                {analysis}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
          <div className="flex items-center">
            {analysis && renderCopyButton('release-analysis-copy-footer')}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-bold hover:bg-white"
            >
              Close
            </button>
            <button
              onClick={handleGenerate}
              disabled={!canGenerate}
              data-testid="release-analysis-generate"
              className={`px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 transition ${
                canGenerate
                  ? 'bg-violet-600 text-white hover:bg-violet-700'
                  : 'bg-slate-200 text-slate-400 cursor-not-allowed'
              }`}
            >
              <span className={`material-symbols-outlined text-base ${isGenerating ? 'animate-spin' : ''}`}>
                {isGenerating ? 'progress_activity' : 'smart_toy'}
              </span>
              {isGenerating ? 'Analyzing...' : 'Generate analysis'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ReleaseAnalysisModal;
