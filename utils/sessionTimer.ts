/**
 * The session countdown — one implementation for retrospectives and health
 * checks. Every timer write either session type makes goes through the
 * mutators below, and both headers render `components/session/SessionTimer`,
 * so a change to the timer lands in both by construction.
 *
 * The state lives in five `settings` fields (`SessionTimerSettings` in
 * types.ts) and is a wire contract: nothing is written per tick, every client
 * derives the remaining time from `timerStartedAt`, and the clients of the
 * previous release read the same fields during a rolling update. Change what a
 * field *means* and those clients show a different time than the new ones.
 *
 * Each mutator edits a settings draft in place and returns whether it changed
 * anything, so a gesture is exactly one session write — or none at all when
 * there is nothing to do. Two writes for one gesture would both be stamped
 * with the same revision, and the server refuses the second as stale.
 *
 * Who may write what is the server's rule (`server/services/sessionGuard.js`):
 * `timerInitial` is facilitator-only, the other four are open to every client,
 * because every client writes the expiry and anyone may silence the alarm.
 * Only `startTimer`, `addTimerSeconds` and `resetTimer` write `timerInitial`.
 */
import type { HealthCheckSession, SessionTimerSettings } from '../types';

/** A settings object as stored — health checks saved before the timer carry none of these. */
export type TimerSettings = Partial<SessionTimerSettings>;

/** What a timer shows when nothing more specific applies. */
export const DEFAULT_TIMER_SECONDS = 300;

/**
 * 99:59, the longest value the timer accepts. It keeps the display to five
 * characters, which is what the header-fit e2e measures the headers with; an
 * unbounded editor let `99999999999` minutes overflow the header.
 */
export const MAX_TIMER_SECONDS = 99 * 60 + 59;

const wholeSeconds = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null;

const clampSeconds = (value: number): number => Math.min(MAX_TIMER_SECONDS, wholeSeconds(value) ?? 0);

/**
 * The timebox each health-check phase starts with, as `retroTips.ts` holds the
 * retrospective's. A separate table on purpose: three health-check phases share
 * an id with a retro phase (DISCUSS, REVIEW, CLOSE), and looking them up in the
 * retro tips would silently hand a health check the retro's timeboxes.
 *
 * - SURVEY: silent individual rating, like the retro's Brainstorm (7 min) —
 *   about 35 s for each of the default template's eleven dimensions.
 * - DISCUSS: a timebox per dimension, as the retro's Discuss is per topic.
 * - REVIEW, CLOSE: as in a retrospective.
 *
 * All four stay under ten minutes: a sixth character in the display would eat
 * the few pixels the header keeps spare at 320px.
 */
export const HEALTH_CHECK_PHASE_TIMER_SECONDS: Readonly<Record<HealthCheckSession['phase'], number>> = {
  SURVEY: 420,
  DISCUSS: 480,
  REVIEW: 180,
  CLOSE: 180
};

export const getHealthCheckPhaseDefaultTimerSeconds = (phase: string): number =>
  Object.prototype.hasOwnProperty.call(HEALTH_CHECK_PHASE_TIMER_SECONDS, phase)
    ? HEALTH_CHECK_PHASE_TIMER_SECONDS[phase as HealthCheckSession['phase']]
    : DEFAULT_TIMER_SECONDS;

/** The fields a new session is created with: stopped at `seconds` (as `resetTimer` leaves it). */
export const createTimerSettings = (seconds: number): SessionTimerSettings => {
  const value = clampSeconds(seconds);
  return { timerSeconds: value, timerInitial: value, timerRunning: false, timerAcknowledged: value === 0 };
};

/** The stored fields, read defensively. */
export interface TimerState {
  running: boolean;
  /** When the current run started — set only while running. */
  startedAt: number | null;
  /** Length of the current run. */
  initial: number;
  /** Remaining time while stopped. */
  seconds: number;
  acknowledged: boolean;
}

/**
 * Reads the timer out of a settings object without changing it.
 *
 * A session with no timer fields — every health check stored before health
 * checks had a timer — reads as stopped at `fallbackSeconds` (its phase's
 * default). That default is never written back on a reader's behalf: a
 * participant's client that wrote `timerInitial` would have its whole write
 * refused by the server, so the fields appear the first time the facilitator
 * sets the timer or changes phase.
 *
 * A timer marked running with no usable start time cannot count down; it
 * reads as stopped, so the facilitator can start it again.
 */
export const readTimer = (settings: TimerSettings | undefined, fallbackSeconds: number): TimerState => {
  const seconds = wholeSeconds(settings?.timerSeconds);
  const initial = wholeSeconds(settings?.timerInitial);
  const startedAt = settings?.timerStartedAt;
  const hasStart = typeof startedAt === 'number' && Number.isFinite(startedAt);
  const running = settings?.timerRunning === true && hasStart;
  const stopped = seconds ?? initial ?? clampSeconds(fallbackSeconds);
  return {
    running,
    startedAt: running ? (startedAt as number) : null,
    initial: initial ?? stopped,
    seconds: stopped,
    acknowledged: settings?.timerAcknowledged === true
  };
};

/**
 * Remaining time at `now`. While running it is derived from the start time,
 * so it never drifts and nothing is written per tick. It is clamped to the
 * run's length as well as to zero: a client whose clock runs behind the
 * starter's would otherwise show more time than the run ever had.
 */
export const remainingSeconds = (state: TimerState, now: number): number => {
  if (!state.running || state.startedAt === null) return state.seconds;
  const elapsed = Math.floor((now - state.startedAt) / 1000);
  return Math.min(state.initial, Math.max(0, state.initial - elapsed));
};

/** The moment the current run reaches zero, or null when it is not running. */
export const timerEndsAt = (state: TimerState): number | null =>
  state.running && state.startedAt !== null ? state.startedAt + state.initial * 1000 : null;

/** Ran out and nobody has silenced it yet: the display bounces. */
export const isAlarmPending = (state: TimerState): boolean =>
  !state.running && state.seconds === 0 && !state.acknowledged;

/** Whether pressing play would start anything. */
export const canStartTimer = (state: TimerState): boolean =>
  !state.running && (state.seconds > 0 || state.initial > 0);

/**
 * Start from the remaining time. A timer that ran out starts again from the
 * length of the run that just ended, in the same write that silences its
 * alarm — pressing play used to acknowledge and start in two writes, and the
 * second always lost the revision race, so one click only silenced it.
 */
export const startTimer = (settings: TimerSettings, now: number, fallbackSeconds: number): boolean => {
  const state = readTimer(settings, fallbackSeconds);
  if (!canStartTimer(state)) return false;
  const from = state.seconds > 0 ? state.seconds : state.initial;
  settings.timerRunning = true;
  settings.timerStartedAt = now;
  settings.timerInitial = from;
  settings.timerSeconds = from;
  settings.timerAcknowledged = false;
  return true;
};

/**
 * Stop, keeping the remaining time. The remaining time is computed at the
 * click, not read from the display: a backgrounded tab repaints about once a
 * minute, so its display can be a minute stale when someone switches back to
 * it and pauses.
 */
export const pauseTimer = (settings: TimerSettings, now: number, fallbackSeconds: number): boolean => {
  const state = readTimer(settings, fallbackSeconds);
  if (!state.running) return false;
  settings.timerRunning = false;
  settings.timerSeconds = remainingSeconds(state, now);
  settings.timerStartedAt = undefined;
  return true;
};

/**
 * The +30 s / +1 min shortcuts. A running timer lengthens its run (the
 * remaining time is the run's length minus the elapsed time); a stopped one
 * becomes a run of the new length. Never past `MAX_TIMER_SECONDS`.
 */
export const addTimerSeconds = (
  settings: TimerSettings,
  delta: number,
  // Same shape as the other gestures; lengthening a run does not depend on
  // how much of it has elapsed.
  _now: number,
  fallbackSeconds: number
): boolean => {
  const state = readTimer(settings, fallbackSeconds);
  if (state.running) {
    // Bound the run's length, not only what is left of it: the length is what
    // the display returns to once the alarm is silenced, and what a restart
    // runs again. (Remaining never exceeds the length, so this bounds both.)
    const added = Math.min(delta, MAX_TIMER_SECONDS - state.initial);
    if (added <= 0) return false;
    settings.timerInitial = state.initial + added;
    return true;
  }
  const next = Math.min(MAX_TIMER_SECONDS, Math.max(0, state.seconds + delta));
  if (next === state.seconds) return false;
  settings.timerSeconds = next;
  settings.timerInitial = next;
  return true;
};

/**
 * Stop and set to `seconds`: the editor's value, or the default of the phase
 * being entered (both session types call this from their `setPhase`). A 0:00
 * set this way has not run out, so there is no alarm to silence — it reads as
 * stopped, not as a bouncing alarm. Says whether anything changed, so an
 * editor saved without an edit sends nothing.
 */
export const resetTimer = (settings: TimerSettings, seconds: number): boolean => {
  const value = clampSeconds(seconds);
  const acknowledged = value === 0;
  const unchanged =
    settings.timerRunning === false &&
    settings.timerStartedAt === undefined &&
    settings.timerSeconds === value &&
    settings.timerInitial === value &&
    settings.timerAcknowledged === acknowledged;
  settings.timerRunning = false;
  settings.timerStartedAt = undefined;
  settings.timerSeconds = value;
  settings.timerInitial = value;
  settings.timerAcknowledged = acknowledged;
  return !unchanged;
};

/**
 * Silence the alarm, for everyone, and show the run's length again. Any
 * client may do it, so it never writes `timerInitial`.
 */
export const acknowledgeTimer = (settings: TimerSettings, fallbackSeconds: number): boolean => {
  const state = readTimer(settings, fallbackSeconds);
  if (!isAlarmPending(state)) return false;
  settings.timerAcknowledged = true;
  settings.timerSeconds = state.initial;
  settings.timerStartedAt = undefined;
  return true;
};

/**
 * The expiry, written by every client whose countdown reaches zero — the
 * facilitator's tab may be closed or throttled in the background, so nobody
 * can be the only writer. Applied only to the run the client watched: a write
 * built for one run must not stop the next one, which a health check (whose
 * session updater runs later, inside React's state update) would otherwise do
 * after a quick restart. `timerStartedAt` is kept so every client can tell
 * which run ended.
 */
export const finishTimer = (settings: TimerSettings, startedAt: number): boolean => {
  if (settings.timerRunning !== true || settings.timerStartedAt !== startedAt) return false;
  settings.timerRunning = false;
  settings.timerSeconds = 0;
  settings.timerAcknowledged = false;
  return true;
};

/** M:SS, unpadded minutes. Anything that is not a non-negative number reads as 0:00. */
export const formatTimer = (seconds: number): string => {
  const value = wholeSeconds(seconds) ?? 0;
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`;
};

/** The editor's two fields as seconds; seconds past 59 carry over (0:90 is 1:30). */
export const parseTimerInput = (minutes: string, seconds: string): number => {
  const m = Number.parseInt(minutes, 10);
  const s = Number.parseInt(seconds, 10);
  const total = (Number.isFinite(m) ? m : 0) * 60 + (Number.isFinite(s) ? s : 0);
  return clampSeconds(total);
};
