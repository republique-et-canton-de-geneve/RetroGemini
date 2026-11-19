import React, { useEffect, useRef } from 'react';
import { appPath } from '../../services/publicPath';
import { useTranslation } from '../../i18n/I18nContext';
import { TimerSettings, formatTimer, isTimerEnding, timerRingFraction } from '../../utils/sessionTimer';
import { TimerUpdate, useSessionTimer } from './useSessionTimer';

interface Props {
  settings: TimerSettings | undefined;
  phase: string;
  /** What a session stored without timer fields shows: its phase's default. */
  fallbackSeconds: number;
  isFacilitator: boolean;
  isLive: boolean;
  onUpdate: TimerUpdate;
}

/**
 * The session countdown, rendered by both the retrospective header
 * (`SessionHeader`) and the health-check header. Its behaviour is
 * `useSessionTimer` + `utils/sessionTimer.ts`; nothing about the timer lives
 * in either session component, so a change here reaches both.
 *
 * Everyone sees the time. The facilitator runs it: while stopped the time
 * itself is a button that sets the duration, next to play/pause and, from
 * `md`, the +30 s / +1 min shortcuts. When it runs out it bounces, the alarm
 * sounds, and the time becomes a button anyone can press to silence it for
 * everyone.
 *
 * Keep the display a single `span.font-mono.font-bold.text-lg` in M:SS:
 * `e2e/retro-full-flow.spec.ts` reads the phase defaults through it, and
 * `e2e/i18n.spec.ts` finds the play button by its icon's ligature.
 *
 * The ring before the time is a picture of the same number (what is left of
 * the run), drawn from `useSessionTimer`'s `initial`; it moves once a second
 * with the digits and is the first thing to go when the header is short of
 * room: hidden on phones, and from lg to 1440px, where the phase bar needs
 * its 28px at 1280px in French. (`sm:max-lg:` rather than `lg:hidden`:
 * Tailwind emits an arbitrary `min-[…]` before the named breakpoints, so
 * `lg:hidden` would win over it.)
 */
// The +30 s / +1 min pills: secondary buttons, quieter than play.
const STEP_CLASS =
  'h-7 rounded-lg border border-slate-200 bg-white px-1.5 text-xs font-semibold tabular-nums text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400';

const SessionTimer: React.FC<Props> = ({ settings, phase, fallbackSeconds, isFacilitator, isLive, onUpdate }) => {
  const { t } = useTranslation();
  const timer = useSessionTimer({ settings, phase, fallbackSeconds, isLive, update: onUpdate });
  const faceRef = useRef<HTMLButtonElement>(null);
  const faceTextRef = useRef<HTMLSpanElement>(null);
  const minutesRef = useRef<HTMLInputElement>(null);
  // Set when the editor closes from the keyboard, or when the time stops being
  // a button under the keyboard (a participant silencing the alarm), so focus
  // goes back to the time rather than to the page; a click elsewhere keeps its
  // own focus.
  const refocusFaceRef = useRef(false);

  const time = formatTimer(timer.remaining);
  // red-700 clears 4.5:1 on the chip (slate-50, red-50 in the last seconds);
  // the red-500 it once replaced did not.
  const urgent = timer.alarmPending || timer.remaining < 60;
  const faceTone = timer.alarmPending
    ? 'text-red-700 motion-safe:animate-bounce'
    : urgent
      ? 'text-red-700'
      : 'text-slate-900';
  const faceClass = `font-mono font-bold text-lg leading-none tabular-nums ${faceTone}`;
  // The last ten seconds are said by more than the red: the chip gains a
  // frame of its own (a ring outside its border), which takes no width.
  const ending = isTimerEnding(timer.remaining, timer.running);
  const chipClass = ending
    ? 'bg-red-50 border-red-700 ring-1 ring-red-700'
    : 'bg-slate-50 border-slate-200';
  const fraction = timerRingFraction(timer.remaining, timer.initial);

  // The time is a control only when pressing it does something: silencing the
  // alarm (anyone) or setting the duration (the facilitator, while stopped).
  // A running time is text, not a button: its name would change every second,
  // and a screen reader re-announces a focused control's name on each change.
  // The pause button beside it does that job, for the mouse and the keyboard.
  // Both names carry the time shown, so a voice user can say what they see
  // (WCAG 2.5.3).
  const faceAction = timer.alarmPending
    ? { kind: 'acknowledge', onPress: timer.acknowledge, label: t('phases.timer.acknowledge', { time }) }
    : isFacilitator && !timer.running
      ? { kind: 'set', onPress: timer.openEditor, label: t('phases.timer.set', { time }) }
      : null;
  const faceKind = faceAction?.kind ?? 'text';

  useEffect(() => {
    if (timer.editing) {
      // The editor replaces the button that opened it, so focus would
      // otherwise fall to the page — and with no focus inside the editor, no
      // blur would ever save or close it.
      minutesRef.current?.focus();
      minutesRef.current?.select();
    } else if (refocusFaceRef.current) {
      refocusFaceRef.current = false;
      (faceRef.current ?? faceTextRef.current)?.focus();
    }
  }, [timer.editing, faceKind]);

  const pressFace = () => {
    if (!faceAction) return;
    // Silencing the alarm can turn the button into text (for a participant):
    // keep keyboard focus on the time instead of losing it to the page.
    if (faceAction.kind === 'acknowledge' && document.activeElement === faceRef.current) {
      refocusFaceRef.current = true;
    }
    faceAction.onPress();
  };

  const closeFromKeyboard = (close: () => void) => {
    refocusFaceRef.current = true;
    close();
  };
  const onEditorKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      closeFromKeyboard(timer.saveEditor);
    } else if (event.key === 'Escape') {
      // Leave the session's dialogs alone: Escape here only cancels the edit.
      event.stopPropagation();
      closeFromKeyboard(timer.cancelEditor);
    }
  };
  const digitsOnly = (set: (value: string) => void) => (event: React.ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value;
    if (value === '' || /^\d+$/.test(value)) set(value);
  };
  const inputClass =
    'w-12 sm:w-14 h-8 text-lg border border-slate-400 rounded-md px-1 bg-white text-slate-900 text-center font-bold tabular-nums focus:border-indigo-600 focus:outline-hidden focus:ring-4 focus:ring-indigo-600/15';

  return (
    <div
      data-timer-chip
      data-timer-ending={ending || undefined}
      className={`flex shrink-0 items-center gap-1 sm:gap-1.5 h-10 rounded-xl border pl-1 sm:pl-2 pr-1 mr-1 sm:mr-3 ${chipClass}`}
    >
      {/* The alarm chime: no speech to caption. Self-hosted, like every asset. */}
      <audio ref={timer.bindAudio} src={appPath('/assets/timer-alert.mp3')} preload="auto" />
      {!timer.editing ? (
        <>
          {/* Decoration: the digits say the same thing. A stroke offset set by
              style, eased over the second it moves in, only while it runs (a
              reset would otherwise sweep backwards) and only for readers who
              allow motion. */}
          <svg
            data-timer-ring
            viewBox="0 0 20 20"
            aria-hidden="true"
            focusable="false"
            className="hidden sm:max-lg:block min-[1440px]:block w-5 h-5 shrink-0 -rotate-90"
          >
            <circle cx="10" cy="10" r="8" fill="none" strokeWidth="3" className="stroke-slate-300" />
            {fraction > 0 && (
              <circle
                data-timer-ring-arc
                cx="10"
                cy="10"
                r="8"
                fill="none"
                strokeWidth="3"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray="100"
                style={{ strokeDashoffset: (1 - fraction) * 100 }}
                className={`${urgent ? 'stroke-red-700' : 'stroke-indigo-600'} ${
                  timer.running ? 'motion-safe:transition-[stroke-dashoffset] motion-safe:duration-1000 motion-safe:ease-linear' : ''
                }`}
              />
            )}
          </svg>
          {faceAction ? (
            <button
              ref={faceRef}
              type="button"
              onClick={pressFace}
              disabled={!isLive}
              aria-label={faceAction.label}
              title={faceAction.label}
              className="cursor-pointer rounded-md sm:px-0.5 py-1 leading-none transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:hover:bg-transparent"
            >
              <span className={faceClass}>{time}</span>
            </button>
          ) : (
            // Focusable from script only, so focus has somewhere to land when
            // the button it was on becomes text.
            <span ref={faceTextRef} tabIndex={-1} className={faceClass}>
              {time}
            </span>
          )}
          {isFacilitator && (
            <button
              type="button"
              onClick={timer.toggle}
              disabled={!isLive || (!timer.running && !timer.canStart)}
              // A round button in the brand colour: the one main action of the
              // chip. Disabled, it goes grey rather than translucent.
              className="grid place-items-center w-6 h-6 sm:w-7 sm:h-7 shrink-0 rounded-full bg-indigo-600 text-white hover:bg-indigo-700 enabled:active:bg-indigo-800 transition disabled:bg-slate-400 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600"
              aria-label={timer.running ? t('phases.timer.pause') : t('phases.timer.start')}
            >
              <span className="material-symbols-outlined text-lg! sm:text-xl! leading-none" aria-hidden="true">
                {timer.running ? 'pause' : 'play_arrow'}
              </span>
            </button>
          )}
          {isFacilitator && (
            // The +30 s / +1 min shortcuts give their width back below md; the
            // time itself stays settable by pressing it.
            <div className="hidden md:flex items-center gap-1">
              <button
                type="button"
                onClick={() => timer.addSeconds(30)}
                disabled={!isLive}
                className={STEP_CLASS}
                title={t('phases.timer.add30Title')}
              >
                {t('phases.timer.add30')}
              </button>
              <button
                type="button"
                onClick={() => timer.addSeconds(60)}
                disabled={!isLive}
                className={STEP_CLASS}
                title={t('phases.timer.add60Title')}
              >
                {t('phases.timer.add60')}
              </button>
            </div>
          )}
        </>
      ) : (
        <div
          className="flex items-center space-x-1"
          onBlur={(event) => {
            // Leaving the two fields saves, as Enter does; moving between them does not.
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) timer.saveEditor();
          }}
        >
          <input
            ref={minutesRef}
            type="text"
            inputMode="numeric"
            value={timer.editMinutes}
            onChange={digitsOnly(timer.setEditMinutes)}
            onKeyDown={onEditorKeyDown}
            className={inputClass}
            placeholder={t('phases.timer.minutesPlaceholder')}
            aria-label={t('phases.timer.minutes')}
          />
          <span className="text-slate-500 font-bold" aria-hidden="true">:</span>
          <input
            type="text"
            inputMode="numeric"
            value={timer.editSeconds}
            onChange={digitsOnly(timer.setEditSeconds)}
            onKeyDown={onEditorKeyDown}
            className={inputClass}
            placeholder={t('phases.timer.secondsPlaceholder')}
            aria-label={t('phases.timer.seconds')}
          />
        </div>
      )}
    </div>
  );
};

export default SessionTimer;
