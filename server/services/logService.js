import { currentContext } from './logContext.js';
import { collectKnownSecrets, formatLogLine, redactSecrets, resolveLogFormat } from './structuredLog.js';

const createLogService = ({
  format = resolveLogFormat(),
  secrets = collectKnownSecrets()
} = {}) => {
  // Bounded ring buffer. Raised from 500 to 1000 alongside capturing the
  // info/log operational trail (audit R25): the higher volume would otherwise
  // evict recent errors/warnings from the buffer too quickly. ~1000 × 500-char
  // entries is well under 1 MB per pod, and the logs route filters by
  // level/source server-side so admin responses stay small.
  const MAX_LOG_ENTRIES = 1000;
  const serverLogs = [];
  let logIdCounter = 0;

  const addServerLog = (level, source, message, details = null) => {
    const context = currentContext();
    const entry = {
      id: String(++logIdCounter),
      timestamp: new Date().toISOString(),
      level,
      source,
      // Redacted before the ring, not only before stdout: the super admin can
      // read this buffer through the log viewer, and a support export is a file
      // that leaves the cluster (audit H44).
      message: redactSecrets(message, secrets),
      details: details ? redactSecrets(details, secrets) : undefined,
      correlationId: context?.correlationId
    };
    serverLogs.push(entry);
    if (serverLogs.length > MAX_LOG_ENTRIES) {
      serverLogs.shift();
    }
    return entry;
  };

  const getServerLogs = () => [...serverLogs];

  const clearServerLogs = () => {
    serverLogs.length = 0;
  };

  // Classify a log line's source from its message prefix so the super-admin
  // viewer's source filter (server / postgres / socket / email) works across
  // every captured level. Shared by all console levels.
  const classifySource = (message) => {
    if (message.includes('[Postgres]') || message.includes('postgres') || message.includes('pg_')) {
      return 'postgres';
    }
    if (message.includes('[Socket') || message.includes('Socket IO')) {
      return 'socket';
    }
    if (message.includes('email') || message.includes('SMTP') || message.includes('mailer')) {
      return 'email';
    }
    return 'server';
  };

  /**
   * Join a console call's arguments into one message. An argument that cannot
   * be serialised (a circular object is the everyday case) must not cost the
   * whole line: the moment logging matters most is the moment something is
   * malformed, so each argument degrades on its own.
   */
  const joinArgs = (args) =>
    args
      .map((arg) => {
        if (typeof arg !== 'object' || arg === null) return String(arg);
        try {
          return JSON.stringify(arg);
        } catch {
          return '[unserializable]';
        }
      })
      .join(' ');

  const attachConsole = () => {
    const original = {
      error: console.error,
      warn: console.warn,
      info: console.info,
      log: console.log
    };

    // Mirror a console method into the in-memory server log buffer while still
    // writing to the real stdout/stderr. Capturing info + log — not just
    // error/warn — surfaces the operational trail (backups, startup, socket
    // session activity) in the super-admin log viewer (audit R25); before this,
    // only errors and warnings ever reached it. console.log is recorded at the
    // 'info' level because the viewer's level filter is error/warn/info.
    //
    // Audit H44 made this the single choke point for structured output too. In
    // `json` mode the real console receives **one JSON line instead of** the
    // original arguments — not as well as, which would double every line in the
    // aggregator. The original stream is kept per level, so an error still
    // reaches stderr.
    //
    // Everything after the console call is best-effort and wrapped: the real
    // write has already happened by then, so no failure in this file can cost
    // a log line.
    const mirror = (level, originalFn) => (...args) => {
      let message = null;

      if (format === 'json') {
        try {
          message = redactSecrets(joinArgs(args), secrets);
          originalFn.call(console, formatLogLine({ level, source: classifySource(message), message }));
        } catch {
          // Structured emission failed; the line is worth more than its shape.
          originalFn.apply(console, args);
        }
      } else {
        originalFn.apply(console, args);
      }

      try {
        if (message === null) message = joinArgs(args);
        addServerLog(level, classifySource(message), message.substring(0, 500));
      } catch {
        /* never let log mirroring break logging */
      }
    };

    console.error = mirror('error', original.error);
    console.warn = mirror('warn', original.warn);
    console.info = mirror('info', original.info);
    console.log = mirror('info', original.log);
  };

  return {
    addServerLog,
    getServerLogs,
    clearServerLogs,
    attachConsole,
    format
  };
};

export { createLogService };
