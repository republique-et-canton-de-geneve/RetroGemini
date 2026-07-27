const createLogService = () => {
  // Bounded ring buffer. Raised from 500 to 1000 alongside capturing the
  // info/log operational trail (audit R25): the higher volume would otherwise
  // evict recent errors/warnings from the buffer too quickly. ~1000 × 500-char
  // entries is well under 1 MB per pod, and the logs route filters by
  // level/source server-side so admin responses stay small.
  const MAX_LOG_ENTRIES = 1000;
  const serverLogs = [];
  let logIdCounter = 0;

  const addServerLog = (level, source, message, details = null) => {
    const entry = {
      id: String(++logIdCounter),
      timestamp: new Date().toISOString(),
      level,
      source,
      message,
      details: details || undefined
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
    // 'info' level because the viewer's level filter is error/warn/info. The
    // mirror is best-effort and wrapped in try/catch so a value that cannot be
    // serialized (e.g. a circular object) can never break the real console call,
    // which has already run above.
    const mirror = (level, originalFn) => (...args) => {
      originalFn.apply(console, args);
      try {
        const message = args
          .map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
          .join(' ');
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
    attachConsole
  };
};

export { createLogService };
