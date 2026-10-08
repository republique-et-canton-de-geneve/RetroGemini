import React, { useEffect, useRef } from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { TimerSettings, formatTimer } from '../../utils/sessionTimer';
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
 * Everyone sees the time. The facilitator runs it: the time itself is a
 * button (pause while running, set the duration while stopped), next to
 * play/pause and, from `md`, the +30 s / +1 min shortcuts. When it runs out it
 * bounces and the alarm sounds, and anyone can silence it for everyone.
 *
 * Keep the display a single `span.font-mono.font-bold.text-lg` in M:SS:
 * `e2e/retro-full-flow.spec.ts` reads the phase defaults through it.
 */
const SessionTimer: React.FC<Props> = ({ settings, phase, fallbackSeconds, isFacilitator, isLive, onUpdate }) => {
  const { t } = useTranslation();
  const timer = useSessionTimer({ settings, phase, fallbackSeconds, isLive, update: onUpdate });
  const faceRef = useRef<HTMLButtonElement>(null);
  const minutesRef = useRef<HTMLInputElement>(null);
  // Set when the editor closes from the keyboard, so focus goes back to the
  // time rather than to the page; a click elsewhere keeps its own focus.
  const refocusFaceRef = useRef(false);

  useEffect(() => {
    if (timer.editing) {
      // The editor replaces the button that opened it, so focus would
      // otherwise fall to the page — and with no focus inside the editor, no
      // blur would ever save or close it.
      minutesRef.current?.focus();
      minutesRef.current?.select();
    } else if (refocusFaceRef.current) {
      refocusFaceRef.current = false;
      faceRef.current?.focus();
    }
  }, [timer.editing]);

  const time = formatTimer(timer.remaining);
  // red-700 clears 4.5:1 on the slate-100 chip; the red-500 it replaces did not.
  const faceTone = timer.alarmPending
    ? 'text-red-700 motion-safe:animate-bounce'
    : timer.remaining < 60
      ? 'text-red-700'
      : 'text-slate-700';
  const face = <span className={`font-mono font-bold text-lg ${faceTone}`}>{time}</span>;

  // The time is a control only when pressing it does something: silencing
  // the alarm (anyone), pausing or setting the duration (the facilitator).
  const faceAction = timer.alarmPending
    ? { onPress: timer.acknowledge, label: t('phases.timer.acknowledge') }
    : !isFacilitator
      ? null
      : timer.running
        ? { onPress: timer.toggle, label: t('phases.timer.pauseAt', { time }) }
        : { onPress: timer.openEditor, label: t('phases.timer.set', { time }) };

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
    'w-12 sm:w-16 h-10 text-xl border border-slate-300 rounded-sm px-1 bg-white text-slate-900 text-center font-bold';

  return (
    <div className="flex shrink-0 items-center bg-slate-100 rounded-lg px-1 sm:px-3 py-1 mr-1 sm:mr-4">
      {/* The alarm chime: no speech to caption. Self-hosted, like every asset. */}
      <audio ref={timer.bindAudio} src="/assets/timer-alert.mp3" preload="auto" />
      {!timer.editing ? (
        <>
          {faceAction ? (
            <button
              ref={faceRef}
              type="button"
              onClick={faceAction.onPress}
              disabled={!isLive}
              aria-label={faceAction.label}
              title={faceAction.label}
              className="rounded-sm leading-none disabled:cursor-not-allowed"
            >
              {face}
            </button>
          ) : (
            face
          )}
          {isFacilitator && (
            <button
              type="button"
              onClick={timer.toggle}
              disabled={!isLive || (!timer.running && !timer.canStart)}
              className="ml-1 sm:ml-2 text-slate-500 hover:text-indigo-600 disabled:opacity-50 disabled:hover:text-slate-500"
              aria-label={timer.running ? t('phases.timer.pause') : t('phases.timer.start')}
            >
              <span className="material-symbols-outlined text-lg">
                {timer.running ? 'pause' : 'play_arrow'}
              </span>
            </button>
          )}
          {isFacilitator && (
            // The +30 s / +1 min shortcuts give their width back below md; the
            // time itself stays settable by pressing it.
            <div className="hidden md:flex items-center ml-2 space-x-1">
              <button
                type="button"
                onClick={() => timer.addSeconds(30)}
                disabled={!isLive}
                className="text-xs bg-slate-200 hover:bg-indigo-100 text-slate-700 hover:text-indigo-700 px-2 py-1 rounded-sm font-bold transition disabled:opacity-50"
                title={t('phases.timer.add30Title')}
              >
                {t('phases.timer.add30')}
              </button>
              <button
                type="button"
                onClick={() => timer.addSeconds(60)}
                disabled={!isLive}
                className="text-xs bg-slate-200 hover:bg-indigo-100 text-slate-700 hover:text-indigo-700 px-2 py-1 rounded-sm font-bold transition disabled:opacity-50"
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
