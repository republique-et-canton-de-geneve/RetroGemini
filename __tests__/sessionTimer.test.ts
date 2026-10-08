import { describe, expect, it } from 'vitest';
import type { HealthCheckSettings } from '../types';
import {
  DEFAULT_TIMER_SECONDS,
  HEALTH_CHECK_PHASE_TIMER_SECONDS,
  MAX_TIMER_SECONDS,
  acknowledgeTimer,
  addTimerSeconds,
  canStartTimer,
  createTimerSettings,
  finishTimer,
  formatTimer,
  getHealthCheckPhaseDefaultTimerSeconds,
  isAlarmPending,
  parseTimerInput,
  pauseTimer,
  readTimer,
  remainingSeconds,
  resetTimer,
  startTimer,
  timerEndsAt,
  type TimerSettings,
  type TimerState
} from '../utils/sessionTimer';
import { findProtectedFieldViolations, PROTECTED_SETTINGS_FIELDS } from '../server/services/sessionGuard.js';

/**
 * The session countdown shared by retrospectives and health checks. Its five
 * settings fields are a wire contract read by every client (and by the clients
 * of the previous release during a rolling update), and `timerInitial` is the
 * one the server refuses from a participant — so these pure helpers are where
 * a regression would first change what a whole room sees.
 */

const T0 = 1_700_000_000_000;
const FALLBACK = 420;

/** A run of `initial` seconds started at T0. */
const running = (overrides: TimerSettings = {}): TimerSettings => ({
  timerRunning: true,
  timerStartedAt: T0,
  timerInitial: 300,
  timerSeconds: 300,
  timerAcknowledged: false,
  ...overrides
});

/** Stopped with `timerSeconds` left of a run of `timerInitial`. */
const stopped = (overrides: TimerSettings = {}): TimerSettings => ({
  timerRunning: false,
  timerInitial: 300,
  timerSeconds: 120,
  timerAcknowledged: false,
  ...overrides
});

/** What `finishTimer` leaves behind: ran out, nobody silenced it yet. */
const ranOut = (overrides: TimerSettings = {}): TimerSettings => ({
  timerRunning: false,
  timerStartedAt: T0,
  timerInitial: 300,
  timerSeconds: 0,
  timerAcknowledged: false,
  ...overrides
});

/** A health check stored before health checks had a timer: no timer field at all. */
const legacyHealthCheckSettings = (): HealthCheckSettings => ({
  isAnonymous: false,
  revealRoti: false
});

const seconds = (n: number) => n * 1000;

describe('constants', () => {
  // Pinned because both headers and the header-fit e2e are sized to them.
  it('defaults to five minutes and caps at 99:59', () => {
    expect(DEFAULT_TIMER_SECONDS).toBe(300);
    expect(MAX_TIMER_SECONDS).toBe(5999);
    expect(formatTimer(MAX_TIMER_SECONDS)).toBe('99:59');
  });
});

describe('readTimer', () => {
  // Guards the legacy fill-in: without it a health check saved before the
  // timer reads as 0:00 with a bouncing alarm on every client.
  it('reads a legacy health check (no timer fields) as stopped at the fallback, silent', () => {
    const state = readTimer(legacyHealthCheckSettings(), FALLBACK);
    expect(state).toEqual({ running: false, startedAt: null, initial: FALLBACK, seconds: FALLBACK, acknowledged: false });
    expect(isAlarmPending(state)).toBe(false);
    expect(canStartTimer(state)).toBe(true);
  });

  it('reads undefined settings the same way', () => {
    expect(readTimer(undefined, FALLBACK)).toEqual({
      running: false,
      startedAt: null,
      initial: FALLBACK,
      seconds: FALLBACK,
      acknowledged: false
    });
  });

  // A participant's client that wrote the fallback back would send
  // timerInitial and have its whole write refused by the server.
  it('never writes the fallback back onto the settings it reads', () => {
    const settings = legacyHealthCheckSettings();
    const state = readTimer(settings, FALLBACK);
    remainingSeconds(state, T0);
    isAlarmPending(state);
    canStartTimer(state);
    timerEndsAt(state);
    expect(settings).toStrictEqual(legacyHealthCheckSettings());
  });

  it('reads a running timer with its start time', () => {
    expect(readTimer(running(), FALLBACK)).toEqual({
      running: true,
      startedAt: T0,
      initial: 300,
      seconds: 300,
      acknowledged: false
    });
  });

  // A run with no usable start cannot count down; reading it as running would
  // freeze the display and hide the play button from the facilitator.
  it.each([
    ['missing', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a string', '1700000000000' as unknown as number]
  ])('reads a running flag with a %s start time as stopped', (_label, startedAt) => {
    const state = readTimer(running({ timerStartedAt: startedAt }), FALLBACK);
    expect(state.running).toBe(false);
    expect(state.startedAt).toBeNull();
    expect(canStartTimer(state)).toBe(true);
  });

  it('exposes no start time once stopped, even if a stale one is stored', () => {
    expect(readTimer(ranOut(), FALLBACK).startedAt).toBeNull();
  });

  it('floors fractional values and clamps negative ones to zero', () => {
    expect(readTimer(stopped({ timerSeconds: 90.9, timerInitial: 120.5 }), FALLBACK)).toMatchObject({
      seconds: 90,
      initial: 120
    });
    expect(readTimer(stopped({ timerSeconds: -5, timerInitial: -1 }), FALLBACK)).toMatchObject({
      seconds: 0,
      initial: 0
    });
  });

  it('falls back field by field when a stored value is not a finite number', () => {
    // Bad remaining time: the run's length stands in.
    expect(readTimer(stopped({ timerSeconds: Number.NaN }), FALLBACK)).toMatchObject({ seconds: 300, initial: 300 });
    // Bad run length: the remaining time stands in.
    expect(readTimer(stopped({ timerInitial: Number.POSITIVE_INFINITY }), FALLBACK)).toMatchObject({
      seconds: 120,
      initial: 120
    });
    // Both bad: the fallback.
    expect(
      readTimer(stopped({ timerSeconds: Number.NaN, timerInitial: 'x' as unknown as number }), FALLBACK)
    ).toMatchObject({ seconds: FALLBACK, initial: FALLBACK });
  });

  it('sanitises the fallback itself', () => {
    expect(readTimer(undefined, 90.7).seconds).toBe(90);
    expect(readTimer(undefined, -30).seconds).toBe(0);
    expect(readTimer(undefined, Number.NaN).seconds).toBe(0);
    expect(readTimer(undefined, 1e9).seconds).toBe(MAX_TIMER_SECONDS);
  });

  it('counts only a literal true as acknowledged', () => {
    expect(readTimer(ranOut({ timerAcknowledged: true }), FALLBACK).acknowledged).toBe(true);
    expect(readTimer(ranOut({ timerAcknowledged: undefined }), FALLBACK).acknowledged).toBe(false);
    expect(readTimer(ranOut({ timerAcknowledged: 'true' as unknown as boolean }), FALLBACK).acknowledged).toBe(false);
  });
});

describe('remainingSeconds', () => {
  const state = readTimer(running(), FALLBACK);

  // Derived from the start time, never from a per-tick write.
  it('subtracts the whole seconds elapsed since the start', () => {
    expect(remainingSeconds(state, T0)).toBe(300);
    expect(remainingSeconds(state, T0 + 10_999)).toBe(290);
    expect(remainingSeconds(state, T0 + 11_000)).toBe(289);
  });

  it('never goes below zero after the run has ended', () => {
    expect(remainingSeconds(state, T0 + seconds(300))).toBe(0);
    expect(remainingSeconds(state, T0 + seconds(10_000))).toBe(0);
  });

  // A reader whose clock is behind the starter's would otherwise show more
  // time than the run ever had.
  it('never exceeds the run length when the reader clock is behind the starter', () => {
    expect(remainingSeconds(state, T0 - seconds(5))).toBe(300);
  });

  it('returns the stored remaining time while stopped, whatever the clock', () => {
    const paused = readTimer(stopped(), FALLBACK);
    expect(remainingSeconds(paused, T0)).toBe(120);
    expect(remainingSeconds(paused, T0 + seconds(1000))).toBe(120);
  });

  it('treats a running state with no start time as stopped', () => {
    const odd: TimerState = { running: true, startedAt: null, initial: 300, seconds: 42, acknowledged: false };
    expect(remainingSeconds(odd, T0)).toBe(42);
  });
});

describe('timerEndsAt', () => {
  it('is the start plus the run length while running', () => {
    expect(timerEndsAt(readTimer(running({ timerInitial: 90 }), FALLBACK))).toBe(T0 + seconds(90));
  });

  it('is null while stopped or without a start time', () => {
    expect(timerEndsAt(readTimer(stopped(), FALLBACK))).toBeNull();
    expect(timerEndsAt({ running: true, startedAt: null, initial: 300, seconds: 300, acknowledged: false })).toBeNull();
  });
});

describe('isAlarmPending / canStartTimer', () => {
  it('rings only once stopped at zero and not yet silenced', () => {
    expect(isAlarmPending(readTimer(ranOut(), FALLBACK))).toBe(true);
    expect(isAlarmPending(readTimer(ranOut({ timerAcknowledged: true }), FALLBACK))).toBe(false);
    expect(isAlarmPending(readTimer(stopped(), FALLBACK))).toBe(false);
    expect(isAlarmPending(readTimer(running({ timerSeconds: 0 }), FALLBACK))).toBe(false);
  });

  it('can start anything stopped with either a remaining time or a run length', () => {
    expect(canStartTimer(readTimer(stopped(), FALLBACK))).toBe(true);
    expect(canStartTimer(readTimer(ranOut(), FALLBACK))).toBe(true);
    expect(canStartTimer(readTimer(stopped({ timerSeconds: 10, timerInitial: 0 }), FALLBACK))).toBe(true);
    expect(canStartTimer(readTimer(stopped({ timerSeconds: 0, timerInitial: 0 }), FALLBACK))).toBe(false);
    expect(canStartTimer(readTimer(running(), FALLBACK))).toBe(false);
  });
});

describe('startTimer', () => {
  it('starts from the remaining time and makes it the run length', () => {
    const settings = stopped({ timerSeconds: 120, timerInitial: 300 });
    expect(startTimer(settings, T0, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({
      timerRunning: true,
      timerStartedAt: T0,
      timerInitial: 120,
      timerSeconds: 120,
      timerAcknowledged: false
    });
    expect(remainingSeconds(readTimer(settings, FALLBACK), T0 + seconds(20))).toBe(100);
  });

  // Pressing play on a run-out timer used to acknowledge and start in two
  // writes; the second lost the revision race, so one click only silenced it.
  it('restarts a run-out timer from its run length and clears the alarm in one call', () => {
    const settings = ranOut({ timerInitial: 180 });
    const later = T0 + seconds(600);
    expect(startTimer(settings, later, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({
      timerRunning: true,
      timerStartedAt: later,
      timerInitial: 180,
      timerSeconds: 180,
      timerAcknowledged: false
    });
    const state = readTimer(settings, FALLBACK);
    expect(isAlarmPending(state)).toBe(false);
    expect(remainingSeconds(state, later)).toBe(180);
  });

  it('starts a legacy health check from its phase default', () => {
    const settings: TimerSettings = legacyHealthCheckSettings();
    expect(startTimer(settings, T0, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({ timerRunning: true, timerStartedAt: T0, timerInitial: FALLBACK, timerSeconds: FALLBACK });
  });

  it('restarts a running flag that has no usable start time', () => {
    const settings = running({ timerStartedAt: undefined, timerSeconds: 60 });
    expect(startTimer(settings, T0, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({ timerRunning: true, timerStartedAt: T0, timerSeconds: 60, timerInitial: 60 });
  });

  // A no-op must write nothing: a spurious write would bump the revision and
  // make a concurrent real write lose its race.
  it('does nothing at 0:00 with no run to repeat', () => {
    const settings = stopped({ timerSeconds: 0, timerInitial: 0, timerAcknowledged: true });
    const before = structuredClone(settings);
    expect(startTimer(settings, T0, FALLBACK)).toBe(false);
    expect(settings).toStrictEqual(before);
  });

  // Restarting a run already going would silently reset everyone's countdown.
  it('does nothing while already running', () => {
    const settings = running();
    const before = structuredClone(settings);
    expect(startTimer(settings, T0 + seconds(30), FALLBACK)).toBe(false);
    expect(settings).toStrictEqual(before);
  });
});

describe('pauseTimer', () => {
  // The display of a backgrounded tab can be a minute stale; the remaining
  // time must be computed at the click, not read from the stored value.
  it('keeps the time remaining at the click, not the stored remaining time', () => {
    const settings = running({ timerInitial: 300, timerSeconds: 300 });
    expect(pauseTimer(settings, T0 + 61_500, FALLBACK)).toBe(true);
    expect(settings.timerRunning).toBe(false);
    expect(settings.timerSeconds).toBe(239);
    expect(settings.timerStartedAt).toBeUndefined();
    expect(settings.timerInitial).toBe(300);
    expect(remainingSeconds(readTimer(settings, FALLBACK), T0 + seconds(9999))).toBe(239);
  });

  it('pauses past the end at 0:00, which then reads as ran out', () => {
    const settings = running();
    expect(pauseTimer(settings, T0 + seconds(400), FALLBACK)).toBe(true);
    expect(settings.timerSeconds).toBe(0);
    expect(isAlarmPending(readTimer(settings, FALLBACK))).toBe(true);
  });

  it('does nothing while stopped', () => {
    const settings = stopped();
    const before = structuredClone(settings);
    expect(pauseTimer(settings, T0, FALLBACK)).toBe(false);
    expect(settings).toStrictEqual(before);
  });
});

describe('addTimerSeconds', () => {
  // Rewriting the start or the remaining time instead would jump every
  // client's countdown; only the run length moves.
  it('lengthens a running timer by lengthening its run only', () => {
    const settings = running({ timerInitial: 300 });
    const now = T0 + seconds(100);
    expect(addTimerSeconds(settings, 30, now, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({ timerRunning: true, timerStartedAt: T0, timerInitial: 330, timerSeconds: 300 });
    expect(remainingSeconds(readTimer(settings, FALLBACK), now)).toBe(230);
  });

  it('caps a running timer at the maximum remaining time', () => {
    const settings = running({ timerInitial: MAX_TIMER_SECONDS - 9 });
    expect(addTimerSeconds(settings, 30, T0, FALLBACK)).toBe(true);
    expect(settings.timerInitial).toBe(MAX_TIMER_SECONDS);
    expect(remainingSeconds(readTimer(settings, FALLBACK), T0)).toBe(MAX_TIMER_SECONDS);
  });

  // Capping only what is left let the run's length pass 99:59 once some of it
  // had elapsed; silencing the alarm then showed that length — '100:59', a
  // sixth character the header-fit e2e (which measures 99:59) never checked —
  // and a restart ran it.
  it('never lengthens a run past the maximum, however much of it has elapsed', () => {
    const settings = running({ timerInitial: MAX_TIMER_SECONDS - 10 });
    expect(addTimerSeconds(settings, 60, T0 + seconds(100), FALLBACK)).toBe(true);
    expect(settings.timerInitial).toBe(MAX_TIMER_SECONDS);

    expect(finishTimer(settings, T0, T0 + seconds(MAX_TIMER_SECONDS))).toBe(true);
    expect(acknowledgeTimer(settings, FALLBACK)).toBe(true);
    expect(formatTimer(readTimer(settings, FALLBACK).seconds)).toBe('99:59');
  });

  it('does nothing to a running timer already at the cap', () => {
    const settings = running({ timerInitial: MAX_TIMER_SECONDS });
    const before = structuredClone(settings);
    expect(addTimerSeconds(settings, 60, T0, FALLBACK)).toBe(false);
    expect(settings).toStrictEqual(before);
  });

  it('turns a stopped timer into a run of the new length', () => {
    const settings = stopped({ timerSeconds: 120, timerInitial: 300 });
    expect(addTimerSeconds(settings, 60, T0, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({ timerRunning: false, timerSeconds: 180, timerInitial: 180 });
  });

  it('turns a run-out timer into a fresh 0:30, no longer ringing', () => {
    const settings = ranOut();
    expect(addTimerSeconds(settings, 30, T0, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({ timerSeconds: 30, timerInitial: 30 });
    expect(isAlarmPending(readTimer(settings, FALLBACK))).toBe(false);
  });

  it('adds to a legacy health check from its phase default', () => {
    const settings: TimerSettings = legacyHealthCheckSettings();
    expect(addTimerSeconds(settings, 30, T0, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({ timerSeconds: FALLBACK + 30, timerInitial: FALLBACK + 30 });
  });

  it('caps a stopped timer at the maximum', () => {
    const settings = stopped({ timerSeconds: MAX_TIMER_SECONDS - 20 });
    expect(addTimerSeconds(settings, 60, T0, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({ timerSeconds: MAX_TIMER_SECONDS, timerInitial: MAX_TIMER_SECONDS });
  });

  it('does nothing to a stopped timer already at the cap', () => {
    const settings = stopped({ timerSeconds: MAX_TIMER_SECONDS, timerInitial: MAX_TIMER_SECONDS });
    const before = structuredClone(settings);
    expect(addTimerSeconds(settings, 30, T0, FALLBACK)).toBe(false);
    expect(settings).toStrictEqual(before);
  });
});

describe('resetTimer', () => {
  // The editor's save goes through the same dry run as every gesture, so a
  // save that changes nothing must say so — otherwise it is sent anyway.
  it('says whether it changed anything', () => {
    const atFiveMinutes = createTimerSettings(300);
    expect(resetTimer(atFiveMinutes, 300)).toBe(false);
    expect(resetTimer(atFiveMinutes, 240)).toBe(true);
    expect(resetTimer(running(), 300)).toBe(true);
    expect(resetTimer(ranOut(), 300)).toBe(true);
    expect(resetTimer(legacyHealthCheckSettings(), FALLBACK)).toBe(true);
  });

  it('stops a running timer at the given value', () => {
    const settings = running();
    resetTimer(settings, 480);
    expect(settings).toMatchObject({
      timerRunning: false,
      timerSeconds: 480,
      timerInitial: 480,
      timerAcknowledged: false
    });
    expect(settings.timerStartedAt).toBeUndefined();
  });

  // A 0:00 set from the editor has not run out: it must not bounce.
  it('marks only a reset to zero as acknowledged, so 0:00 does not ring', () => {
    const zero = running();
    resetTimer(zero, 0);
    expect(zero.timerAcknowledged).toBe(true);
    expect(isAlarmPending(readTimer(zero, FALLBACK))).toBe(false);
    expect(canStartTimer(readTimer(zero, FALLBACK))).toBe(false);

    const one = ranOut({ timerAcknowledged: true });
    resetTimer(one, 1);
    expect(one.timerAcknowledged).toBe(false);
  });

  // Entering a phase resets to its default: a ringing alarm from the previous
  // phase must not follow the room into the next one.
  it('silences a pending alarm', () => {
    const settings = ranOut();
    resetTimer(settings, 180);
    expect(isAlarmPending(readTimer(settings, FALLBACK))).toBe(false);
    expect(readTimer(settings, FALLBACK).seconds).toBe(180);
  });

  it.each([
    [-30, 0, true],
    [Number.NaN, 0, true],
    [1e9, MAX_TIMER_SECONDS, false],
    [90.7, 90, false]
  ])('clamps %s to %s', (input, expected, acknowledged) => {
    const settings: TimerSettings = {};
    resetTimer(settings, input);
    expect(settings).toMatchObject({ timerSeconds: expected, timerInitial: expected, timerAcknowledged: acknowledged });
  });
});

describe('acknowledgeTimer', () => {
  it('silences a pending alarm and shows the run length again', () => {
    const settings = ranOut({ timerInitial: 180 });
    expect(acknowledgeTimer(settings, FALLBACK)).toBe(true);
    expect(settings).toMatchObject({ timerRunning: false, timerAcknowledged: true, timerSeconds: 180, timerInitial: 180 });
    expect(settings.timerStartedAt).toBeUndefined();
    expect(isAlarmPending(readTimer(settings, FALLBACK))).toBe(false);
  });

  // Acknowledging is open to participants; the server refuses timerInitial
  // from them, so writing it would lose the whole write.
  it('never writes timerInitial, even when the stored settings carry none', () => {
    const settings: TimerSettings = { timerSeconds: 0, timerRunning: false };
    expect(acknowledgeTimer(settings, FALLBACK)).toBe(true);
    expect(settings.timerAcknowledged).toBe(true);
    expect(Object.keys(settings)).not.toContain('timerInitial');
  });

  // A participant whose clock reached zero first must not stop a run that is
  // still going for the server.
  it('does nothing while running, even past the end by the local clock', () => {
    const settings = running({ timerSeconds: 0 });
    const before = structuredClone(settings);
    expect(acknowledgeTimer(settings, FALLBACK)).toBe(false);
    expect(settings).toStrictEqual(before);
  });

  it.each([
    ['already acknowledged', ranOut({ timerAcknowledged: true })],
    ['stopped with time left', stopped()],
    ['a legacy health check', legacyHealthCheckSettings() as TimerSettings]
  ])('does nothing when %s', (_label, settings) => {
    const before = structuredClone(settings);
    expect(acknowledgeTimer(settings, FALLBACK)).toBe(false);
    expect(settings).toStrictEqual(before);
  });
});

describe('finishTimer', () => {
  it('stops the run it was built for at 0:00, ringing, keeping its start time', () => {
    const settings = running({ timerInitial: 300 });
    expect(finishTimer(settings, T0, T0 + seconds(300))).toBe(true);
    expect(settings).toStrictEqual({
      timerRunning: false,
      timerStartedAt: T0,
      timerInitial: 300,
      timerSeconds: 0,
      timerAcknowledged: false
    });
    expect(isAlarmPending(readTimer(settings, FALLBACK))).toBe(true);
  });

  // A finish built for one run must not stop the next one after a quick
  // restart (the health check's updater runs late, inside React's state update).
  it('does nothing to a different run', () => {
    const settings = running({ timerStartedAt: T0 + seconds(5) });
    const before = structuredClone(settings);
    expect(finishTimer(settings, T0, T0 + seconds(1000))).toBe(false);
    expect(settings).toStrictEqual(before);
  });

  // The same run, lengthened: +30 s / +1 min keep the start time. In a health
  // check the expiry is applied to the newest queued state, so a tick overdue
  // from a suspended phone would otherwise end a run the facilitator just
  // extended — and, stamped with the newer revision, the server would accept it.
  it('does nothing to the run it was built for while that run still has time left', () => {
    const settings = running({ timerInitial: 60 });
    expect(addTimerSeconds(settings, 30, T0 + seconds(58), FALLBACK)).toBe(true);
    const before = structuredClone(settings);
    expect(finishTimer(settings, T0, T0 + seconds(60))).toBe(false);
    expect(settings).toStrictEqual(before);
    expect(finishTimer(settings, T0, T0 + seconds(90))).toBe(true);
  });

  // Every client writes the expiry; the second writer must be a no-op, and a
  // finish must not re-ring an alarm someone already silenced.
  it.each([
    ['already finished by another client', ranOut()],
    ['already finished and silenced', ranOut({ timerAcknowledged: true, timerSeconds: 300 })],
    ['paused', stopped({ timerStartedAt: T0 })],
    ['a legacy health check', legacyHealthCheckSettings() as TimerSettings]
  ])('does nothing when %s', (_label, settings) => {
    const before = structuredClone(settings);
    expect(finishTimer(settings, T0, T0 + seconds(1000))).toBe(false);
    expect(settings).toStrictEqual(before);
  });
});

describe('formatTimer', () => {
  it.each([
    [0, '0:00'],
    [5, '0:05'],
    [61, '1:01'],
    [600, '10:00'],
    [MAX_TIMER_SECONDS, '99:59'],
    [59.9, '0:59'],
    [-5, '0:00'],
    [Number.NaN, '0:00'],
    [Number.POSITIVE_INFINITY, '0:00']
  ])('formats %s as %s', (value, expected) => {
    expect(formatTimer(value)).toBe(expected);
  });
});

describe('parseTimerInput', () => {
  it.each([
    ['', '', 0],
    ['abc', 'x', 0],
    ['2', '', 120],
    ['', '45', 45],
    ['05', '07', 307],
    ['0', '90', 90],
    ['1', '90', 150],
    ['-1', '30', 0],
    ['100', '0', MAX_TIMER_SECONDS],
    ['99', '99', MAX_TIMER_SECONDS]
  ])('reads %j min %j s as %s seconds', (minutes, secs, expected) => {
    expect(parseTimerInput(minutes, secs)).toBe(expected);
  });
});

describe('createTimerSettings', () => {
  it('creates a stopped timer at the given length, with no start time', () => {
    expect(createTimerSettings(300)).toStrictEqual({
      timerSeconds: 300,
      timerInitial: 300,
      timerRunning: false,
      timerAcknowledged: false
    });
  });

  it('reads back as stopped and silent at that length', () => {
    const state = readTimer(createTimerSettings(420), DEFAULT_TIMER_SECONDS);
    expect(state).toEqual({ running: false, startedAt: null, initial: 420, seconds: 420, acknowledged: false });
    expect(isAlarmPending(state)).toBe(false);
  });

  it('clamps the length', () => {
    expect(createTimerSettings(1e9).timerSeconds).toBe(MAX_TIMER_SECONDS);
    expect(createTimerSettings(90.7).timerInitial).toBe(90);
  });

  // A session created at 0:00 has not run out: it must read as silent, the way
  // resetTimer leaves a 0:00 set by hand, not as an alarm nobody started.
  it('creates a 0:00 timer that does not ring', () => {
    const settings = createTimerSettings(0);
    expect(settings.timerAcknowledged).toBe(true);
    expect(isAlarmPending(readTimer(settings, FALLBACK))).toBe(false);
  });
});

describe('health-check phase defaults', () => {
  it('pins each phase timebox', () => {
    expect(HEALTH_CHECK_PHASE_TIMER_SECONDS).toEqual({ SURVEY: 420, DISCUSS: 480, REVIEW: 180, CLOSE: 180 });
  });

  it.each([
    ['SURVEY', 420],
    ['DISCUSS', 480],
    ['REVIEW', 180],
    ['CLOSE', 180]
  ])('gives %s %s seconds', (phase, expected) => {
    expect(getHealthCheckPhaseDefaultTimerSeconds(phase)).toBe(expected);
  });

  // A prototype key must not resolve to a function (the display would read
  // NaN and the reset write would carry garbage).
  it.each(['BRAINSTORM', 'survey', '', 'constructor', 'toString', 'hasOwnProperty', '__proto__'])(
    'falls back to the default for %j',
    (phase) => {
      expect(getHealthCheckPhaseDefaultTimerSeconds(phase)).toBe(DEFAULT_TIMER_SECONDS);
    }
  );

  // A default is stored as it stands (createTimerSettings and resetTimer
  // clamp silently), so one past the maximum would quietly become 99:59 —
  // and 99:59 is the widest display the header-fit e2e measures.
  it('keeps every default within what the timer accepts', () => {
    for (const value of Object.values(HEALTH_CHECK_PHASE_TIMER_SECONDS)) {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(MAX_TIMER_SECONDS);
      expect(formatTimer(value).length).toBeLessThanOrEqual(5);
    }
  });
});

describe('who may write timerInitial (mirrors server/services/sessionGuard.js)', () => {
  type Gesture = (settings: TimerSettings) => boolean | void;

  const gestures: Record<string, Gesture> = {
    startTimer: (s) => startTimer(s, T0 + seconds(1000), FALLBACK),
    pauseTimer: (s) => pauseTimer(s, T0 + seconds(30), FALLBACK),
    addTimerSeconds: (s) => addTimerSeconds(s, 30, T0 + seconds(30), FALLBACK),
    resetTimer: (s) => resetTimer(s, 240),
    acknowledgeTimer: (s) => acknowledgeTimer(s, FALLBACK),
    finishTimer: (s) => finishTimer(s, T0, T0 + seconds(1000))
  };

  const fixtures: Record<string, () => TimerSettings> = {
    running: () => running(),
    stopped: () => stopped(),
    ranOut: () => ranOut(),
    acknowledged: () => ranOut({ timerAcknowledged: true, timerSeconds: 300 }),
    legacy: () => legacyHealthCheckSettings(),
    legacyAtZero: () => ({ timerSeconds: 0, timerRunning: false })
  };

  const writesTimerInitial = (gesture: Gesture, fixture: () => TimerSettings): boolean => {
    const before = fixture();
    const after = structuredClone(before);
    gesture(after);
    return (
      Object.prototype.hasOwnProperty.call(after, 'timerInitial') !==
        Object.prototype.hasOwnProperty.call(before, 'timerInitial') || after.timerInitial !== before.timerInitial
    );
  };

  it('protects timerInitial and leaves the four runtime fields open to every client', () => {
    expect(PROTECTED_SETTINGS_FIELDS).toContain('timerInitial');
    for (const field of ['timerRunning', 'timerSeconds', 'timerStartedAt', 'timerAcknowledged']) {
      expect(PROTECTED_SETTINGS_FIELDS).not.toContain(field);
    }
  });

  // Any participant may silence the alarm and every client writes the expiry.
  // Either one writing timerInitial would have the participant's whole write
  // refused by the server: the alarm would keep ringing, the expiry never land.
  it.each(['acknowledgeTimer', 'finishTimer', 'pauseTimer'])(
    '%s never touches timerInitial, from any state',
    (name) => {
      for (const [state, fixture] of Object.entries(fixtures)) {
        expect(writesTimerInitial(gestures[name], fixture), `${name} on ${state}`).toBe(false);
      }
    }
  );

  it.each(['acknowledgeTimer', 'finishTimer'])(
    'a participant %s passes the server guard',
    (name) => {
      for (const fixture of Object.values(fixtures)) {
        const authoritative = { settings: fixture() };
        const incoming = structuredClone(authoritative);
        gestures[name](incoming.settings);
        expect(findProtectedFieldViolations(incoming, authoritative)).toEqual([]);
      }
    }
  );

  it('only startTimer, addTimerSeconds and resetTimer write timerInitial', () => {
    const writers = Object.keys(gestures).filter((name) =>
      Object.values(fixtures).some((fixture) => writesTimerInitial(gestures[name], fixture))
    );
    expect(writers.sort()).toEqual(['addTimerSeconds', 'resetTimer', 'startTimer']);
  });

  it('the server refuses those writers from a participant', () => {
    for (const name of ['startTimer', 'addTimerSeconds', 'resetTimer']) {
      const authoritative = { settings: stopped() };
      const incoming = structuredClone(authoritative);
      gestures[name](incoming.settings);
      expect(findProtectedFieldViolations(incoming, authoritative), name).toEqual(['settings.timerInitial']);
    }
  });
});
