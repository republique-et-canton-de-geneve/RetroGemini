// Folds a repeating log line into one summary.
//
// Incident ISS (2026-10-12): a client caught in a refusal loop re-sent the same
// session write about three times a second, and the server logged each refusal.
// The super-admin log viewer keeps the last 1000 lines (logService.js), so the
// loop pushed out everything an investigation needed within minutes — the first
// line that named the cause included. A log that a misbehaving client can flush
// is no evidence at all.
//
// So the first occurrence of a key is logged immediately and in full (that is
// the line that explains what is happening), and the repeats are counted and
// written as one line — "<label> — repeated N times in Ts" — when the window
// ends or when the group is flushed (the socket left or disconnected). A loop
// that never stops therefore costs one line per window, not one per write. A
// key that stays quiet for a whole window is forgotten, so its next occurrence
// is logged in full again.
//
// Keys are scoped to a `group` (the socket id in socketHandlers.js) so a
// disconnect can summarise exactly that socket's pending repeats. Timers are
// injected for the unit tests and unref'd so a pending summary never keeps the
// process alive.

const DEFAULT_WINDOW_MS = 30_000;

const defaultEmit = (level, line) => {
  const write = typeof console[level] === 'function' ? console[level] : console.warn;
  write.call(console, line);
};

const createRepeatCoalescer = ({
  windowMs = DEFAULT_WINDOW_MS,
  now = Date.now,
  emit = defaultEmit,
  setTimer = setTimeout,
  clearTimer = clearTimeout
} = {}) => {
  // compositeKey -> { group, level, label, count, windowStart, timer }
  const entries = new Map();

  const compositeKey = (group, key) => `${group}\u0000${key}`;

  const summarise = (entry, elapsedMs) => {
    const seconds = Math.max(1, Math.round(elapsedMs / 1000));
    emit(entry.level, `${entry.label} — repeated ${entry.count} times in ${seconds}s`);
  };

  const schedule = (id) => {
    const handle = setTimer(() => windowEnded(id), windowMs);
    if (typeof handle?.unref === 'function') handle.unref();
    return handle;
  };

  function windowEnded(id) {
    const entry = entries.get(id);
    if (!entry) return;
    if (entry.count === 0) {
      entries.delete(id);
      return;
    }
    summarise(entry, windowMs);
    // Still repeating: keep counting in a fresh window rather than logging the
    // full first line again — the reader already has it.
    entry.count = 0;
    entry.windowStart += windowMs;
    entry.timer = schedule(id);
  }

  const report = ({ group, key, level = 'warn', message, label }) => {
    const id = compositeKey(group, key);
    const existing = entries.get(id);
    if (existing) {
      existing.count += 1;
      return;
    }
    const line = typeof message === 'function' ? message() : message;
    emit(level, line);
    entries.set(id, {
      group,
      level,
      label: label ?? line,
      count: 0,
      windowStart: now(),
      timer: schedule(id)
    });
  };

  const flushWhere = (predicate) => {
    for (const [id, entry] of entries) {
      if (!predicate(entry)) continue;
      clearTimer(entry.timer);
      entries.delete(id);
      if (entry.count > 0) summarise(entry, now() - entry.windowStart);
    }
  };

  return {
    report,
    flushGroup: (group) => flushWhere((entry) => entry.group === group),
    flushAll: () => flushWhere(() => true),
    size: () => entries.size
  };
};

export { createRepeatCoalescer };
