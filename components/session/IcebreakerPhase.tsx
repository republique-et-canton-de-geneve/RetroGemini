import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { RetroSession } from '../../types';
import { toLanguage } from '../../i18n/languages';
import { ICEBREAKER_QUESTIONS, isBuiltInIcebreaker } from '../../i18n/content/icebreakers';

interface Props {
  session: RetroSession;
  isFacilitator: boolean;
  localIcebreakerQuestion: string | null;
  onQuestionChange: (value: string) => void;
  onRandom: () => void;
  onStart: () => void;
  /**
   * Turn the retro into an open board (utils/openBoard.ts). Passed only to a
   * facilitator whose retro is still going: this is the first screen after
   * creating one, so it is where choosing the wrong type is noticed.
   */
  onSwitchToOpenBoard?: () => void;
  isLive?: boolean;
}

// The question's box, shared by the field and the copies that size it below
// `sm`: a copy breaks its lines where the field does only with the same
// border, padding, size, weight and leading.
const QUESTION_BOX = 'border p-6 text-3xl max-sm:text-2xl font-medium leading-relaxed';
// A copy of a text in the field's box, wrapped as the field wraps its own.
const SIZER_CLASS = `${QUESTION_BOX} col-start-1 row-start-1 whitespace-pre-wrap break-words`;

const IcebreakerPhase: React.FC<Props> = ({
  session,
  isFacilitator,
  localIcebreakerQuestion,
  onQuestionChange,
  onRandom,
  onStart,
  onSwitchToOpenBoard,
  isLive = true
}) => {
  const { t } = useTranslation();
  const templateLanguage = toLanguage(session.templateLanguage, 'en');
  const questionLanguage = (text: string) =>
    isBuiltInIcebreaker(text, templateLanguage) ? templateLanguage : undefined;
  const question = localIcebreakerQuestion !== null ? localIcebreakerQuestion : session.icebreakerQuestion;
  const placeholder = t('phases.icebreaker.placeholder');

  return (
    // Less padding and a smaller question below `sm`: on a phone the three
    // paddings left the default question too narrow a field, which scrolled
    // inside itself (e2e/no-stray-scrollbars.spec.ts). Below `sm` the card
    // also drops its fixed 600px, which a short phone squeezed until the field
    // cut off its question: it is as tall as what it holds, and the screen
    // scrolls instead. `my-auto` centres it only while there is room to spare:
    // centred by `justify-center`, a card taller than the screen lost its top,
    // where no scroll reaches.
    <div className="flex flex-col items-center justify-center max-sm:justify-start h-full max-sm:overflow-y-auto p-8 max-sm:p-4 text-center bg-slate-900 text-white">
      <div className="bg-slate-800 p-10 max-sm:p-5 rounded-2xl shadow-xl border border-slate-700 max-w-4xl w-full sm:h-[600px] max-sm:my-auto max-sm:shrink-0 flex flex-col">
        <div className="w-16 h-16 bg-indigo-500/20 rounded-full flex items-center justify-center text-3xl mb-4 mx-auto shrink-0" aria-hidden="true">🧊</div>
        <h2 className="text-3xl font-semibold tracking-tight mb-6 shrink-0">{t('phases.icebreaker.title')}</h2>

        {/* One column of `minmax(0, 1fr)` below `sm`: an `auto` column grows
            to the widest word it holds, past the card. */}
        <div className="grow flex flex-col max-sm:grid max-sm:grid-cols-1 relative mb-8">
          {isFacilitator ? (
            <>
              <textarea
                data-testid="icebreaker-question-input"
                // A built-in question is content in the retro's template language,
                // which may differ from the page's (WCAG 3.1.2, language of parts);
                // one the facilitator typed inherits the page's language.
                lang={questionLanguage(question)}
                value={question}
                onChange={(event) => onQuestionChange(event.target.value)}
                className={`w-full h-full bg-slate-900 ${QUESTION_BOX} border-slate-500 rounded-xl text-center text-indigo-300 placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-400/25 outline-hidden resize-none grow max-sm:col-start-1 max-sm:row-start-1`}
                placeholder={placeholder}
              />
              {/* Below `sm` the field is as tall as the tallest built-in
                  question of the retro's language, or as its own words (its
                  placeholder while it is empty) when they are taller: it never
                  scrolls inside itself, with no `field-sizing` (a plain grid;
                  only Chromium measures it), and "Random" does not move the
                  buttons from one built-in question to the next (a typed
                  question taller than all of them grows the field, and the
                  next "Random" shrinks it back). These copies, never seen nor read, share the
                  field's grid cell, and the tallest gives the cell its height.
                  The space keeps a last empty line, which a copy ending in a
                  line break would not draw. */}
              <div aria-hidden="true" className="hidden max-sm:grid max-sm:grid-cols-1 col-start-1 row-start-1 invisible">
                <div lang={questionLanguage(question)} className={SIZER_CLASS}>{question || placeholder}{' '}</div>
                {ICEBREAKER_QUESTIONS[templateLanguage].map((builtIn) => (
                  <div key={builtIn} lang={templateLanguage} className={SIZER_CLASS}>{builtIn}</div>
                ))}
              </div>
            </>
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-slate-900/50 rounded-xl border border-slate-700/50 p-6">
              {/* Below `sm` in the field's type size, and a word longer than
                  the box breaks, as it does in the field: at 30px
                  "instantanément" was wider than the box of a 320px phone. */}
              <p data-testid="icebreaker-question-display" lang={questionLanguage(session.icebreakerQuestion)} className="text-3xl max-sm:text-2xl max-sm:min-w-0 max-sm:break-words text-indigo-300 font-medium leading-relaxed">{session.icebreakerQuestion}</p>
            </div>
          )}
        </div>

        <div className="shrink-0 flex justify-center space-x-4">
          {isFacilitator ? (
            <>
              <button
                onClick={onRandom}
                className="text-indigo-200 hover:text-white text-sm font-semibold flex items-center px-4 py-3 bg-slate-700 rounded-lg hover:bg-slate-600 transition"
              >
                <span className="material-symbols-outlined mr-2" aria-hidden="true">shuffle</span> {t('phases.icebreaker.random')}
              </button>
              <button
                onClick={onStart}
                className="bg-white text-slate-900 px-8 py-3 rounded-lg font-semibold hover:bg-slate-200 shadow-lg transition"
              >
                {t('phases.icebreaker.start')}
              </button>
            </>
          ) : (
            // Muted text on a dark screen is slate-300 (slate-500 read 2.6:1 on
            // this slate-800), and it no longer pulses: a pulse took it through
            // half its opacity, below the floor, and the words say the state.
            <div className="text-slate-300 italic">{t('phases.icebreaker.waiting')}</div>
          )}
        </div>

        {onSwitchToOpenBoard && (
          <div className="shrink-0 mt-4 flex justify-center">
            <button
              type="button"
              onClick={onSwitchToOpenBoard}
              disabled={!isLive}
              title={t('session.openBoard.switchToBoardHint')}
              className="text-indigo-200 hover:text-white text-sm font-semibold flex items-center px-4 py-2 rounded-lg border border-slate-600 hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span className="material-symbols-outlined mr-2" aria-hidden="true">view_kanban</span> {t('session.openBoard.switchToBoard')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default IcebreakerPhase;
