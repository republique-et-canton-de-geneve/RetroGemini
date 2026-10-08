import React, { useLayoutEffect, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock, MockInstance } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import LanguageProvider from '../i18n/LanguageProvider';
import SessionTimer from '../components/session/SessionTimer';
import { TimerUpdate } from '../components/session/useSessionTimer';
import { MAX_TIMER_SECONDS, TimerSettings, createTimerSettings } from '../utils/sessionTimer';

/**
 * The countdown both session headers render (`components/session/SessionTimer`),
 * driven the way a session drives it: the settings live in the parent's state,
 * and every change comes back through `onUpdate` as one mutation of a draft —
 * dropped while offline, like the sessions' own `updateSession`.
 *
 * Every write is recorded with the keys it assigned, because who may write what
 * is a server rule (`sessionGuard.js` refuses a participant's `timerInitial`):
 * a participant client that so much as re-assigns that field has its whole
 * write refused.
 */

const T0 = Date.UTC(2026, 9, 8, 10, 0, 0);

interface Write {
  before: TimerSettings | undefined;
  after: TimerSettings;
  /** Every key the mutation assigned, even to the value it already had. */
  assigned: string[];
}

interface Recorder {
  /** Every call the timer made to `onUpdate`, including those dropped offline. */
  attempts: Mock<TimerUpdate>;
  /** The writes that reached the session state. */
  writes: Write[];
  current: TimerSettings | undefined;
  /** Another client's write arriving through the sync service. */
  setRemote: (next: TimerSettings | undefined) => void;
}

interface HarnessProps {
  recorder: Recorder;
  initial: TimerSettings | undefined;
  phase?: string;
  fallbackSeconds?: number;
  isFacilitator?: boolean;
  isLive?: boolean;
}

const Harness: React.FC<HarnessProps> = ({
  recorder,
  initial,
  phase = 'BRAINSTORM',
  fallbackSeconds = 300,
  isFacilitator = false,
  isLive = true
}) => {
  const [settings, setSettings] = useState<TimerSettings | undefined>(initial);
  useLayoutEffect(() => {
    recorder.current = settings;
    recorder.setRemote = setSettings;
  }, [recorder, settings]);

  const onUpdate: TimerUpdate = (mutate) => {
    recorder.attempts(mutate);
    // The sessions' offline gate: no change is made on a disconnected snapshot.
    if (!isLive) return;
    setSettings((prev) => {
      const next: TimerSettings = { ...(prev ?? {}) };
      const assigned = new Set<string>();
      const draft = new Proxy<TimerSettings>(next, {
        set: (target, key, value) => {
          assigned.add(String(key));
          return Reflect.set(target, key, value);
        }
      });
      mutate(draft);
      recorder.writes.push({ before: prev, after: { ...next }, assigned: [...assigned] });
      return next;
    });
  };

  return (
    <SessionTimer
      settings={settings}
      phase={phase}
      fallbackSeconds={fallbackSeconds}
      isFacilitator={isFacilitator}
      isLive={isLive}
      onUpdate={onUpdate}
    />
  );
};

type Options = Omit<HarnessProps, 'recorder' | 'initial'>;

const renderTimer = (
  initial: TimerSettings | undefined,
  options: Options = {},
  wrap: (ui: React.ReactElement) => React.ReactElement = (ui) => ui
) => {
  const recorder: Recorder = {
    attempts: vi.fn<TimerUpdate>(),
    writes: [],
    current: initial,
    setRemote: () => undefined
  };
  let props: Options = options;
  const ui = () => wrap(<Harness recorder={recorder} initial={initial} {...props} />);
  const utils = render(ui());
  const rerender = (next: Options) => {
    props = { ...props, ...next };
    utils.rerender(ui());
  };
  /** The time: one `span.font-mono.font-bold.text-lg` (e2e/retro-full-flow.spec.ts reads it). */
  const display = (): HTMLElement => {
    const faces = utils.container.querySelectorAll('span.font-mono.font-bold.text-lg');
    expect(faces).toHaveLength(1);
    return faces[0] as HTMLElement;
  };
  const remote = (next: TimerSettings | undefined) => {
    act(() => {
      recorder.setRemote(next);
    });
  };
  return { recorder, rerender, display, remote, container: utils.container };
};

const tick = (ms: number) => {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
};

const running = (startedAt: number, initial: number): TimerSettings => ({
  timerRunning: true,
  timerStartedAt: startedAt,
  timerInitial: initial,
  timerSeconds: initial,
  timerAcknowledged: false
});

/** As `finishTimer` leaves it: stopped at 0, alarm pending, the run's start kept. */
const expired = (startedAt: number, initial: number): TimerSettings => ({
  timerRunning: false,
  timerStartedAt: startedAt,
  timerInitial: initial,
  timerSeconds: 0,
  timerAcknowledged: false
});

const isBouncing = (element: HTMLElement) => element.classList.contains('motion-safe:animate-bounce');

let play: MockInstance<HTMLMediaElement['play']>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  // jsdom does not implement media playback.
  play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('SessionTimer — what a participant can do', () => {
  it('shows the time and offers no control while the timer is at rest', () => {
    // Guards: the facilitator's controls leaking to participants, whose writes
    // to timerInitial the server refuses.
    const { display } = renderTimer(createTimerSettings(300), { isFacilitator: false });

    expect(display()).toHaveTextContent('5:00');
    expect(display().closest('button')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Start timer' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+30s' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '+1m' })).not.toBeInTheDocument();
  });

  it('silences the alarm for everyone in one write that never touches timerInitial', () => {
    // Guards: acknowledging through a facilitator-only field (the whole write
    // is refused), or acknowledging and resetting in two writes.
    const { recorder, display } = renderTimer(expired(T0 - 300_000, 300), { isFacilitator: false });
    expect(recorder.attempts).not.toHaveBeenCalled();

    const silence = screen.getByRole('button', { name: 'Time is up: stop the alarm' });
    expect(silence).toContainElement(display());
    fireEvent.click(silence);

    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes).toHaveLength(1);
    const [write] = recorder.writes;
    expect(write.assigned).not.toContain('timerInitial');
    expect(write.after).toMatchObject({ timerAcknowledged: true, timerSeconds: 300, timerInitial: 300, timerRunning: false });
    expect(display()).toHaveTextContent('5:00');
    expect(screen.queryAllByRole('button')).toHaveLength(0);
  });
});

describe('SessionTimer — running the countdown', () => {
  it('starts in one write from the time shown, then counts down', () => {
    // Guards: a start that does not stamp the run, or a display that does not tick.
    const { recorder, display } = renderTimer(createTimerSettings(300), { isFacilitator: true });

    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));

    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes[0].after).toEqual({
      timerRunning: true,
      timerStartedAt: T0,
      timerInitial: 300,
      timerSeconds: 300,
      timerAcknowledged: false
    });
    expect(display()).toHaveTextContent('5:00');
    tick(1000);
    expect(display()).toHaveTextContent('4:59');
    tick(1000);
    expect(display()).toHaveTextContent('4:58');
    tick(60_000);
    expect(display()).toHaveTextContent('3:58');
    expect(screen.getByRole('button', { name: 'Pause timer' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Start timer' })).not.toBeInTheDocument();
    // Nothing is written per tick: every client derives the time from the start.
    expect(recorder.attempts).toHaveBeenCalledTimes(1);
  });

  it('writes the expiry once, sounds the alarm once and bounces until silenced', () => {
    // Guards: a missing expiry write, a write per tick after zero, a repeated
    // alarm, and a participant's expiry write touching timerInitial.
    const { recorder, display } = renderTimer(running(T0, 3), { isFacilitator: false });
    expect(display()).toHaveTextContent('0:03');

    tick(2000);
    expect(display()).toHaveTextContent('0:01');
    expect(recorder.attempts).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();

    tick(1000);
    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes).toHaveLength(1);
    expect(recorder.writes[0].after).toEqual({
      timerRunning: false,
      timerStartedAt: T0,
      timerInitial: 3,
      timerSeconds: 0,
      timerAcknowledged: false
    });
    expect(recorder.writes[0].assigned).not.toContain('timerInitial');
    expect(play).toHaveBeenCalledTimes(1);
    expect(display()).toHaveTextContent('0:00');
    expect(isBouncing(display())).toBe(true);

    tick(10_000);
    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays a self-hosted chime at a moderate volume', () => {
    // Guards: the offline rule (no remote asset) and the 0.3 volume.
    const { container } = renderTimer(createTimerSettings(300));
    const audio = container.querySelector('audio') as HTMLAudioElement;
    expect(audio).not.toBeNull();
    expect(audio.getAttribute('src')).toBe('/assets/timer-alert.mp3');
    expect(audio.volume).toBeCloseTo(0.3);
  });

  it('closes a run that was already over when the session opened, without sounding', () => {
    // Guards: an alarm going off for a stored timer nobody stopped, the moment
    // someone opens the session.
    const { recorder, display } = renderTimer(running(T0 - 600_000, 300), { isFacilitator: false });

    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes[0].after).toMatchObject({
      timerRunning: false,
      timerSeconds: 0,
      timerAcknowledged: false,
      timerStartedAt: T0 - 600_000
    });
    expect(display()).toHaveTextContent('0:00');
    tick(5000);
    expect(play).not.toHaveBeenCalled();
    expect(recorder.attempts).toHaveBeenCalledTimes(1);
  });

  it("sounds once when another client's expiry arrives before this client's own tick", () => {
    // Guards: the alarm staying silent on the client whose tick lost the race,
    // and replaying on every later update of the same run.
    const { recorder, display, remote } = renderTimer(running(T0, 300));
    tick(2000);
    expect(display()).toHaveTextContent('4:58');

    remote(expired(T0, 300));
    expect(play).toHaveBeenCalledTimes(1);
    expect(display()).toHaveTextContent('0:00');
    expect(isBouncing(display())).toBe(true);

    remote(expired(T0, 300));
    tick(5000);
    expect(play).toHaveBeenCalledTimes(1);
    // The other client wrote the expiry; this one has nothing to add.
    expect(recorder.attempts).not.toHaveBeenCalled();
  });

  it('restarts a run-out timer from its length in one write', () => {
    // Guards: play acknowledging then starting in two writes — both stamped
    // with the same revision, so the server refused the second and one click
    // only silenced the alarm.
    const { recorder, display } = renderTimer(expired(T0 - 300_000, 300), { isFacilitator: true });
    expect(screen.getByRole('button', { name: 'Time is up: stop the alarm' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));

    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes[0].after).toEqual({
      timerRunning: true,
      timerStartedAt: T0,
      timerInitial: 300,
      timerSeconds: 300,
      timerAcknowledged: false
    });
    expect(display()).toHaveTextContent('5:00');
    expect(isBouncing(display())).toBe(false);
    tick(1000);
    expect(display()).toHaveTextContent('4:59');
  });

  it('pauses at the time on the clock, not the time last painted', () => {
    // Guards: pausing from a stale display — a backgrounded tab repaints about
    // once a minute, so the paused time could be a minute too long.
    const { recorder, display } = renderTimer(running(T0, 300), { isFacilitator: true });
    vi.setSystemTime(T0 + 61_500);
    expect(display()).toHaveTextContent('5:00');

    fireEvent.click(screen.getByRole('button', { name: 'Pause timer' }));

    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes[0].after).toMatchObject({ timerRunning: false, timerSeconds: 239, timerStartedAt: undefined });
    expect(display()).toHaveTextContent('3:59');
    expect(screen.getByRole('button', { name: 'Start timer' })).toBeInTheDocument();
  });

  it('pauses when the facilitator presses the running time', () => {
    // Guards: the time losing its pause action while running.
    const { recorder } = renderTimer(running(T0, 300), { isFacilitator: true });
    tick(10_000);

    fireEvent.click(screen.getByRole('button', { name: 'Pause timer (4:50)' }));

    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes[0].after).toMatchObject({ timerRunning: false, timerSeconds: 290 });
  });
});

describe('SessionTimer — +30s / +1m', () => {
  it('lengthens a running run without restarting it', () => {
    // Guards: a shortcut that restarts the run or rewrites its start time.
    const { recorder, display } = renderTimer(running(T0, 300), { isFacilitator: true });
    tick(10_000);
    expect(display()).toHaveTextContent('4:50');

    const add30 = screen.getByRole('button', { name: '+30s' });
    expect(add30).toHaveAttribute('title', 'Add 30 seconds');
    fireEvent.click(add30);

    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes[0].assigned).toEqual(['timerInitial']);
    expect(recorder.writes[0].after).toMatchObject({ timerInitial: 330, timerRunning: true, timerStartedAt: T0 });
    expect(display()).toHaveTextContent('5:20');
    tick(1000);
    expect(display()).toHaveTextContent('5:19');
  });

  it('sets a stopped timer to a run of the new length', () => {
    // Guards: a stopped timer whose length and remaining time disagree.
    const { recorder, display } = renderTimer(createTimerSettings(300), { isFacilitator: true });

    fireEvent.click(screen.getByRole('button', { name: '+30s' }));
    expect(recorder.writes[0].after).toMatchObject({ timerSeconds: 330, timerInitial: 330, timerRunning: false });
    expect(display()).toHaveTextContent('5:30');

    const add60 = screen.getByRole('button', { name: '+1m' });
    expect(add60).toHaveAttribute('title', 'Add 1 minute');
    fireEvent.click(add60);
    expect(recorder.writes[1].after).toMatchObject({ timerSeconds: 390, timerInitial: 390, timerRunning: false });
    expect(display()).toHaveTextContent('6:30');
    expect(recorder.attempts).toHaveBeenCalledTimes(2);
  });
});

describe('SessionTimer — setting the duration', () => {
  const openEditor = (time = '5:00') => {
    fireEvent.click(screen.getByRole('button', { name: `Set the timer (${time})` }));
    return {
      minutes: screen.getByRole('textbox', { name: 'Minutes' }) as HTMLInputElement,
      seconds: screen.getByRole('textbox', { name: 'Seconds' }) as HTMLInputElement
    };
  };

  it('opens on the stopped time with the minutes focused, and Enter saves one write', () => {
    // Guards: an editor that opens unfocused (no blur would ever close it), a
    // save in more than one write, and focus lost to the page after saving.
    const { recorder, display } = renderTimer(createTimerSettings(300), { isFacilitator: true });
    const { minutes, seconds } = openEditor();

    expect(minutes).toHaveValue('5');
    expect(seconds).toHaveValue('0');
    expect(minutes).toHaveAttribute('placeholder', 'MM');
    expect(seconds).toHaveAttribute('placeholder', 'SS');
    expect(minutes).toHaveFocus();

    fireEvent.change(minutes, { target: { value: '2' } });
    fireEvent.change(seconds, { target: { value: '30' } });
    fireEvent.keyDown(seconds, { key: 'Enter' });

    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes[0].after).toMatchObject({
      timerSeconds: 150,
      timerInitial: 150,
      timerRunning: false,
      timerAcknowledged: false
    });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(display()).toHaveTextContent('2:30');
    expect(screen.getByRole('button', { name: 'Set the timer (2:30)' })).toHaveFocus();
  });

  it('cancels on Escape without writing', () => {
    // Guards: Escape saving what was typed.
    const { recorder, display } = renderTimer(createTimerSettings(300), { isFacilitator: true });
    const { minutes } = openEditor();
    fireEvent.change(minutes, { target: { value: '9' } });

    fireEvent.keyDown(minutes, { key: 'Escape' });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(recorder.attempts).not.toHaveBeenCalled();
    expect(display()).toHaveTextContent('5:00');
    expect(screen.getByRole('button', { name: 'Set the timer (5:00)' })).toHaveFocus();
  });

  it('refuses anything but digits', () => {
    // Guards: a minus sign, a decimal or a letter reaching parseTimerInput.
    renderTimer(createTimerSettings(300), { isFacilitator: true });
    const { minutes, seconds } = openEditor();

    fireEvent.change(minutes, { target: { value: '2a' } });
    expect(minutes).toHaveValue('5');
    fireEvent.change(minutes, { target: { value: '-1' } });
    expect(minutes).toHaveValue('5');
    fireEvent.change(seconds, { target: { value: '1.5' } });
    expect(seconds).toHaveValue('0');
    fireEvent.change(minutes, { target: { value: '' } });
    expect(minutes).toHaveValue('');
  });

  it('saves when focus leaves both fields, not when it moves between them', () => {
    // Guards: a save (and an editor closing) on Tab from minutes to seconds.
    const { recorder, display } = renderTimer(createTimerSettings(300), { isFacilitator: true });
    const { minutes, seconds } = openEditor();
    fireEvent.change(minutes, { target: { value: '3' } });

    fireEvent.blur(minutes, { relatedTarget: seconds });
    expect(recorder.attempts).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Seconds' })).toBeInTheDocument();

    fireEvent.blur(seconds, { relatedTarget: null });
    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes[0].after).toMatchObject({ timerSeconds: 180, timerInitial: 180 });
    expect(display()).toHaveTextContent('3:00');
  });

  it('reads 0:00 set by hand as stopped, not as a run-out alarm', () => {
    // Guards: a timer set to zero bouncing and offering "stop the alarm".
    const { recorder, display } = renderTimer(createTimerSettings(300), { isFacilitator: true });
    const { minutes, seconds } = openEditor();
    fireEvent.change(minutes, { target: { value: '0' } });
    fireEvent.change(seconds, { target: { value: '0' } });
    fireEvent.keyDown(minutes, { key: 'Enter' });

    expect(recorder.writes[0].after).toMatchObject({ timerSeconds: 0, timerInitial: 0, timerAcknowledged: true });
    expect(display()).toHaveTextContent('0:00');
    expect(isBouncing(display())).toBe(false);
    expect(screen.queryByRole('button', { name: 'Time is up: stop the alarm' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set the timer (0:00)' })).toBeInTheDocument();
    expect(play).not.toHaveBeenCalled();
  });

  it('caps what is typed at 99:59', () => {
    // Guards: an unbounded editor overflowing the header (header-fit e2e).
    const { recorder, display } = renderTimer(createTimerSettings(300), { isFacilitator: true });
    const { minutes } = openEditor();
    fireEvent.change(minutes, { target: { value: '99999999999' } });
    fireEvent.keyDown(minutes, { key: 'Enter' });

    expect(recorder.writes[0].after).toMatchObject({ timerSeconds: MAX_TIMER_SECONDS, timerInitial: MAX_TIMER_SECONDS });
    expect(display()).toHaveTextContent('99:59');
  });

  it('closes unsaved when the phase changes under it', () => {
    // Guards: a value typed for one phase overwriting the next phase's default.
    const { recorder, rerender, display } = renderTimer(createTimerSettings(300), {
      isFacilitator: true,
      phase: 'BRAINSTORM'
    });
    const { minutes } = openEditor();
    fireEvent.change(minutes, { target: { value: '9' } });

    rerender({ phase: 'GROUP' });

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(recorder.attempts).not.toHaveBeenCalled();
    expect(display()).toHaveTextContent('5:00');
  });

  it("closes unsaved when a run starts from another of the facilitator's tabs", () => {
    // Guards: saving the editor stopping a run another tab just started.
    const { recorder, remote, display } = renderTimer(createTimerSettings(300), { isFacilitator: true });
    const { minutes } = openEditor();
    fireEvent.change(minutes, { target: { value: '9' } });

    remote(running(T0, 300));

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(recorder.attempts).not.toHaveBeenCalled();
    expect(display()).toHaveTextContent('5:00');
    expect(screen.getByRole('button', { name: 'Pause timer' })).toBeInTheDocument();
  });
});

describe('SessionTimer — offline', () => {
  it('disables every control while the session is not live', () => {
    // Guards: a gesture made on a disconnected snapshot (the write would be
    // dropped and the click silently lost).
    renderTimer(createTimerSettings(300), { isFacilitator: true, isLive: false });

    expect(screen.getByRole('button', { name: 'Start timer' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Set the timer (5:00)' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+30s' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '+1m' })).toBeDisabled();
  });

  it("disables a participant's stop-the-alarm while the session is not live", () => {
    renderTimer(expired(T0 - 1000, 300), { isFacilitator: false, isLive: false });
    expect(screen.getByRole('button', { name: 'Time is up: stop the alarm' })).toBeDisabled();
  });

  it('writes an expiry reached offline once the session is live again', () => {
    // Guards: the expiry the outage swallowed never being written, leaving the
    // timer "running" at 0:00 for every client.
    const { recorder, rerender } = renderTimer(running(T0, 3), { isFacilitator: false, isLive: true });
    rerender({ isLive: false });

    tick(5000);
    expect(recorder.attempts).toHaveBeenCalledTimes(1);
    expect(recorder.writes).toHaveLength(0);
    expect(play).toHaveBeenCalledTimes(1);

    rerender({ isLive: true });

    expect(recorder.writes).toHaveLength(1);
    expect(recorder.writes[0].after).toMatchObject({
      timerRunning: false,
      timerSeconds: 0,
      timerAcknowledged: false,
      timerStartedAt: T0
    });
    expect(play).toHaveBeenCalledTimes(1);
    tick(5000);
    expect(recorder.writes).toHaveLength(1);
  });
});

describe('SessionTimer — a gesture with nothing to change writes nothing', () => {
  it('disables play on a timer at 0:00 with no run length', () => {
    // Guards: a start that would run a zero-length timer straight into the alarm.
    const { recorder } = renderTimer(
      { timerSeconds: 0, timerInitial: 0, timerRunning: false, timerAcknowledged: true },
      { isFacilitator: true }
    );
    const start = screen.getByRole('button', { name: 'Start timer' });
    expect(start).toBeDisabled();
    fireEvent.click(start);
    expect(recorder.attempts).not.toHaveBeenCalled();
  });

  it('writes nothing when +30s cannot go past 99:59', () => {
    // Guards: the dry run — a no-op click still sending a session write.
    const stoppedAtMax = renderTimer(createTimerSettings(MAX_TIMER_SECONDS), { isFacilitator: true });
    fireEvent.click(screen.getByRole('button', { name: '+30s' }));
    expect(stoppedAtMax.recorder.attempts).not.toHaveBeenCalled();
    expect(stoppedAtMax.display()).toHaveTextContent('99:59');
    cleanup();

    const runningAtMax = renderTimer(running(T0, MAX_TIMER_SECONDS), { isFacilitator: true });
    fireEvent.click(screen.getByRole('button', { name: '+1m' }));
    expect(runningAtMax.recorder.attempts).not.toHaveBeenCalled();
  });

  it('writes nothing when the editor is saved without an edit', () => {
    // Guards: the editor's save skipping the dry run — pressing the time by
    // mistake and clicking away (blur saves) or pressing Enter sent an identical
    // session write, bumping the revision every client races against.
    const { recorder, display } = renderTimer(createTimerSettings(300), { isFacilitator: true });

    fireEvent.click(screen.getByRole('button', { name: 'Set the timer (5:00)' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Minutes' }), { key: 'Enter' });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Set the timer (5:00)' }));
    fireEvent.blur(screen.getByRole('textbox', { name: 'Seconds' }), { relatedTarget: null });
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();

    expect(recorder.attempts).not.toHaveBeenCalled();
    expect(display()).toHaveTextContent('5:00');
  });
});

describe('SessionTimer — sessions stored without a timer', () => {
  it.each([
    ['an empty settings object', {}],
    ['no settings at all', undefined]
  ])('shows the phase default for %s and writes nothing, even as a participant', (_label, settings) => {
    // Guards: a participant's client "repairing" a legacy health check by
    // writing timerInitial (the server refuses the whole write), or reading it
    // as a run-out alarm.
    const { recorder, display } = renderTimer(settings as TimerSettings | undefined, {
      isFacilitator: false,
      fallbackSeconds: 420
    });

    expect(display()).toHaveTextContent('7:00');
    expect(isBouncing(display())).toBe(false);
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    tick(5000);
    expect(recorder.attempts).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it('lets the facilitator start a legacy timer from the phase default', () => {
    // Guards: the fallback being display-only, so play would start nothing.
    const { recorder, display } = renderTimer({}, { isFacilitator: true, fallbackSeconds: 420 });
    expect(recorder.attempts).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Set the timer (7:00)' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Start timer' }));

    expect(recorder.writes[0].after).toEqual({
      timerRunning: true,
      timerStartedAt: T0,
      timerInitial: 420,
      timerSeconds: 420,
      timerAcknowledged: false
    });
    tick(1000);
    expect(display()).toHaveTextContent('6:59');
  });
});

describe('SessionTimer — French', () => {
  const inFrench = (ui: React.ReactElement) => <LanguageProvider initialLanguage="fr">{ui}</LanguageProvider>;

  it("names the facilitator's controls in French", () => {
    // Guards: an untranslated key (the raw key or English would show).
    renderTimer(createTimerSettings(300), { isFacilitator: true }, inFrench);

    expect(screen.getByRole('button', { name: 'Démarrer le minuteur' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Régler le minuteur (5:00)' })).toBeInTheDocument();
    // getByRole does not normalise the no-break spaces of French typography.
    expect(screen.getByRole('button', { name: '+30 s' })).toHaveAttribute('title', 'Ajouter 30 secondes');
    expect(screen.getByRole('button', { name: '+1 min' })).toHaveAttribute('title', 'Ajouter 1 minute');

    fireEvent.click(screen.getByRole('button', { name: 'Régler le minuteur (5:00)' }));
    expect(screen.getByRole('textbox', { name: 'Minutes' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Secondes' })).toBeInTheDocument();
  });

  it('names the stop-the-alarm control in French', () => {
    renderTimer(expired(T0 - 1000, 300), { isFacilitator: false }, inFrench);
    expect(screen.getByRole('button', { name: "Temps écoulé : arrêter l'alarme" })).toBeInTheDocument();
  });
});

describe('SessionTimer — contrast and motion', () => {
  it('bounces a pending alarm only for readers who allow motion, in a contrasting red', () => {
    // Guards: red-500 (under 4.5:1 on the slate-100 chip) and a bounce that
    // ignores prefers-reduced-motion.
    const { display } = renderTimer(expired(T0 - 1000, 300));
    const face = display();

    expect(face).toHaveClass('text-red-700', 'motion-safe:animate-bounce');
    expect(face).not.toHaveClass('text-red-500');
    expect(face).not.toHaveClass('animate-bounce');
  });

  it('turns red without bouncing in the last minute of a run', () => {
    const { display } = renderTimer(running(T0, 30));
    expect(display()).toHaveClass('text-red-700');
    expect(isBouncing(display())).toBe(false);
    expect(display()).not.toHaveClass('text-red-500');
  });
});
