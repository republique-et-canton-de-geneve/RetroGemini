import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  TimerSettings,
  acknowledgeTimer,
  addTimerSeconds,
  canStartTimer,
  finishTimer,
  isAlarmPending,
  parseTimerInput,
  pauseTimer,
  readTimer,
  remainingSeconds,
  resetTimer,
  startTimer,
  timerEndsAt
} from '../../utils/sessionTimer';

/**
 * Applies one timer change to the session through that session's own
 * `updateSession` — which keeps its offline gate (no write is made on a
 * disconnected snapshot) and its single write path.
 */
export type TimerUpdate = (mutate: (settings: TimerSettings) => void) => void;

export interface UseSessionTimerOptions {
  settings: TimerSettings | undefined;
  /** A phase change closes an open editor: the timer was reset under it. */
  phase: string;
  /** What a session stored without timer fields shows: its phase's default. */
  fallbackSeconds: number;
  /** Re-runs the countdown on reconnect, so an expiry missed offline is written. */
  isLive: boolean;
  update: TimerUpdate;
}

type TimerMutation = (draft: TimerSettings, now: number, fallbackSeconds: number) => boolean;

const ALARM_VOLUME = 0.3;

/**
 * The countdown's behaviour, shared by the retrospective and health-check
 * headers through `SessionTimer`. The ticking state lives here, inside the
 * timer, so the session around it does not re-render every second.
 */
export const useSessionTimer = ({ settings, phase, fallbackSeconds, isLive, update }: UseSessionTimerOptions) => {
  const state = readTimer(settings, fallbackSeconds);
  const { running, startedAt } = state;
  const endsAt = timerEndsAt(state);
  const alarmPending = isAlarmPending(state);
  const storedStartedAt = settings?.timerStartedAt;

  // What the handlers and the interval act on: always the latest render's
  // values, never a closure from the render that created them.
  const latest = useRef({ settings, fallbackSeconds, update });
  useLayoutEffect(() => {
    latest.current = { settings, fallbackSeconds, update };
  });

  // The clock the display is computed from. Set before paint whenever a run
  // starts or changes length, then once a second by the interval below.
  const [now, setNow] = useState<number | null>(null);
  useLayoutEffect(() => {
    if (endsAt !== null) setNow(Date.now());
  }, [endsAt]);

  // --- Alarm -------------------------------------------------------------
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const bindAudio = useCallback((element: HTMLAudioElement | null) => {
    audioRef.current = element;
    if (element) element.volume = ALARM_VOLUME;
  }, []);
  // The run (its start time) this client counted down while it still had time
  // left, and the run it last sounded for. The alarm sounds once per run, and
  // only for a run this client watched: one that was already over when the
  // session opened — a stored timer nobody stopped — is closed silently.
  const watchedRunRef = useRef<number | null>(null);
  const alarmedRunRef = useRef<number | null>(null);
  const soundAlarm = useCallback((run: number) => {
    if (watchedRunRef.current !== run || alarmedRunRef.current === run) return;
    alarmedRunRef.current = run;
    const audio = audioRef.current;
    if (!audio) return;
    try {
      // jsdom returns nothing; a browser that blocks autoplay rejects.
      const playing = audio.play() as Promise<void> | undefined;
      playing?.catch?.((error: unknown) => console.warn('[SessionTimer] The alarm could not play', error));
    } catch (error) {
      console.warn('[SessionTimer] The alarm could not play', error);
    }
  }, []);

  // Every write — a gesture or the expiry — is checked on a copy of what this
  // client is showing first, so one with nothing to change sends nothing, then
  // applied to the session as one write. The mutators re-check against the
  // state they are applied to, which in a health check is only known inside
  // React's state update.
  const apply = useCallback((mutate: TimerMutation) => {
    const { settings: current, fallbackSeconds: fallback, update: write } = latest.current;
    const at = Date.now();
    if (!mutate({ ...(current ?? {}) }, at, fallback)) return;
    write((draft) => {
      mutate(draft, at, fallback);
    });
  }, []);

  // --- Countdown and expiry ---------------------------------------------
  useEffect(() => {
    if (startedAt === null || endsAt === null) return undefined;
    const run = startedAt;
    const tick = (first = false): boolean => {
      const current = Date.now();
      setNow(current);
      if (current < endsAt) {
        if (first) watchedRunRef.current = run;
        return false;
      }
      soundAlarm(run);
      apply((draft) => finishTimer(draft, run));
      return true;
    };
    if (tick(true)) return undefined;
    const interval = setInterval(() => {
      if (tick()) clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
    // `isLive`: the write above is dropped while offline, so reconnecting runs
    // this again and writes the expiry the outage swallowed.
  }, [startedAt, endsAt, isLive, soundAlarm, apply]);

  // Another client's expiry can arrive before this client's own tick reaches
  // zero (ticks are a second apart and clocks differ): it still sounds here.
  useEffect(() => {
    if (alarmPending && typeof storedStartedAt === 'number') soundAlarm(storedStartedAt);
  }, [alarmPending, storedStartedAt, soundAlarm]);

  // --- Gestures ----------------------------------------------------------
  const toggle = () => {
    const { settings: current, fallbackSeconds: fallback } = latest.current;
    apply(readTimer(current, fallback).running ? pauseTimer : startTimer);
  };
  const addSeconds = (delta: number) =>
    apply((draft, at, fallback) => addTimerSeconds(draft, delta, at, fallback));
  const acknowledge = () => apply((draft, _at, fallback) => acknowledgeTimer(draft, fallback));

  // --- Editor ------------------------------------------------------------
  const [editing, setEditing] = useState(false);
  const [editMinutes, setEditMinutes] = useState('');
  const [editSeconds, setEditSeconds] = useState('');
  // Guards a second save of the same edit (Enter, then the blur it causes).
  const editingRef = useRef(false);
  // A phase change resets the timer under the editor, and a run started from
  // another of the facilitator's tabs replaces what was being edited: either
  // closes the editor unsaved. (Saving it would overwrite the new phase's
  // default with a value typed for the previous one.)
  const editScope = `${phase}|${running}`;
  const [openedIn, setOpenedIn] = useState(editScope);
  if (openedIn !== editScope) {
    setOpenedIn(editScope);
    setEditing(false);
  }
  useLayoutEffect(() => {
    editingRef.current = editing;
  }, [editing]);

  const openEditor = () => {
    const { settings: current, fallbackSeconds: fallback } = latest.current;
    const stopped = readTimer(current, fallback);
    if (stopped.running) return;
    setEditMinutes(String(Math.floor(stopped.seconds / 60)));
    setEditSeconds(String(stopped.seconds % 60));
    editingRef.current = true;
    setEditing(true);
  };
  const closeEditor = (): boolean => {
    if (!editingRef.current) return false;
    editingRef.current = false;
    setEditing(false);
    return true;
  };
  const saveEditor = () => {
    if (!closeEditor()) return;
    const value = parseTimerInput(editMinutes, editSeconds);
    apply((draft) => resetTimer(draft, value));
  };
  const cancelEditor = () => {
    closeEditor();
  };

  const remaining = remainingSeconds(state, now ?? startedAt ?? 0);

  return {
    remaining,
    running,
    alarmPending,
    canStart: canStartTimer(state),
    toggle,
    addSeconds,
    acknowledge,
    editing,
    editMinutes,
    editSeconds,
    setEditMinutes,
    setEditSeconds,
    openEditor,
    saveEditor,
    cancelEditor,
    bindAudio
  };
};

export type SessionTimerController = ReturnType<typeof useSessionTimer>;
