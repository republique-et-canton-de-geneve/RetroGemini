// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createRepeatCoalescer } from '../server/services/logCoalescer.js';

/**
 * Incident ISS (2026-10-12): a client caught in a refusal loop re-sent the same
 * write about three times a second, and the server logged every refusal. The
 * super-admin log viewer keeps the last 1000 lines, so within minutes the loop
 * had pushed out everything an investigation needed — including the first line
 * that named the cause. The coalescer keeps that first line and folds the
 * repeats into one summary.
 */

describe('createRepeatCoalescer', () => {
  let clock = 0;
  let lines: { level: string; line: string }[];

  const build = (windowMs = 30_000) =>
    createRepeatCoalescer({
      windowMs,
      now: () => clock,
      emit: (level: string, line: string) => lines.push({ level, line })
    });

  beforeEach(() => {
    vi.useFakeTimers();
    clock = 0;
    lines = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const advance = (ms: number) => {
    clock += ms;
    vi.advanceTimersByTime(ms);
  };

  it('logs the first occurrence of a key immediately, in full', () => {
    const coalescer = build();
    coalescer.report({ group: 'sock1', key: 'restored:name', message: 'first line with details', label: 'short' });

    expect(lines).toEqual([{ level: 'warn', line: 'first line with details' }]);
  });

  it('folds repeats inside the window into one summary line when the window ends', () => {
    const coalescer = build();
    for (let i = 0; i < 50; i++) {
      coalescer.report({ group: 'sock1', key: 'restored:name', message: `line ${i}`, label: 'Restored name for Paul' });
      advance(100);
    }
    expect(lines).toHaveLength(1);

    advance(30_000);

    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ level: 'warn', line: 'Restored name for Paul — repeated 49 times in 30s' });
  });

  it('keeps summarising a loop that does not stop, one line per window', () => {
    // A loop that runs for an hour must cost a line per window, not a line per
    // write and not a fresh "first" line every window.
    const coalescer = build(10_000);
    for (let i = 0; i < 300; i++) {
      coalescer.report({ group: 'sock1', key: 'k', message: 'first', label: 'loop' });
      advance(100);
    }
    advance(10_000);

    expect(lines[0].line).toBe('first');
    expect(lines.slice(1).every((l) => l.line.startsWith('loop — repeated'))).toBe(true);
    expect(lines.length).toBeLessThanOrEqual(1 + Math.ceil(30_000 / 10_000) + 1);
  });

  it('forgets a key after a quiet window, so the next occurrence is logged in full again', () => {
    const coalescer = build(1_000);
    coalescer.report({ group: 'sock1', key: 'k', message: 'first' });
    advance(1_000);
    advance(1_000);
    coalescer.report({ group: 'sock1', key: 'k', message: 'again' });

    expect(lines.map((l) => l.line)).toEqual(['first', 'again']);
    expect(coalescer.size()).toBe(1);
  });

  it('summarises a socket’s pending repeats when it leaves or disconnects', () => {
    const coalescer = build();
    coalescer.report({ group: 'sock1', key: 'a', message: 'a first', label: 'a' });
    coalescer.report({ group: 'sock1', key: 'a', message: 'a again' });
    coalescer.report({ group: 'sock1', key: 'a', message: 'a again' });
    coalescer.report({ group: 'sock2', key: 'a', message: 'other socket', label: 'b' });
    coalescer.report({ group: 'sock2', key: 'a', message: 'other socket' });
    advance(2_000);

    coalescer.flushGroup('sock1');

    expect(lines.map((l) => l.line)).toEqual(['a first', 'other socket', 'a — repeated 2 times in 2s']);
    // The other socket's window is untouched, and nothing is left for sock1.
    expect(coalescer.size()).toBe(1);
    coalescer.flushGroup('sock1');
    expect(lines).toHaveLength(3);
  });

  it('writes nothing on flush when a key never repeated', () => {
    const coalescer = build();
    coalescer.report({ group: 'sock1', key: 'a', message: 'only once' });
    coalescer.flushGroup('sock1');

    expect(lines).toHaveLength(1);
    expect(coalescer.size()).toBe(0);
  });

  it('keeps keys of one group apart, and honours the level', () => {
    const coalescer = build();
    coalescer.report({ group: 'sock1', key: 'stale', level: 'log', message: 'stale write' });
    coalescer.report({ group: 'sock1', key: 'restored:name', message: 'restored' });

    expect(lines).toEqual([
      { level: 'log', line: 'stale write' },
      { level: 'warn', line: 'restored' }
    ]);
  });

  it('builds a lazy message only for the line it actually writes', () => {
    const coalescer = build();
    const message = vi.fn(() => 'expensive');
    coalescer.report({ group: 'sock1', key: 'k', message });
    coalescer.report({ group: 'sock1', key: 'k', message });
    coalescer.report({ group: 'sock1', key: 'k', message });

    expect(message).toHaveBeenCalledTimes(1);
  });

  it('does not keep the process alive for a pending summary', () => {
    const unref = vi.fn();
    const coalescer = createRepeatCoalescer({
      emit: () => {},
      setTimer: () => ({ unref }),
      clearTimer: () => {}
    });
    coalescer.report({ group: 'sock1', key: 'k', message: 'x' });

    expect(unref).toHaveBeenCalled();
  });
});
