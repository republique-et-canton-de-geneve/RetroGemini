const createLogService = () => {
  const MAX_LOG_ENTRIES = 500;
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

  const attachConsole = () => {
    const originalConsoleError = console.error;
    const originalConsoleWarn = console.warn;

    console.error = (...args) => {
      originalConsoleError.apply(console, args);
      const message = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      let source = 'server';
      if (message.includes('[Postgres]') || message.includes('postgres') || message.includes('pg_')) {
        source = 'postgres';
      } else if (message.includes('[Socket') || message.includes('Socket IO')) {
        source = 'socket';
      } else if (message.includes('email') || message.includes('SMTP') || message.includes('mailer')) {
        source = 'email';
      }
      addServerLog('error', source, message.substring(0, 500));
    };

    console.warn = (...args) => {
      originalConsoleWarn.apply(console, args);
      const message = args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
      let source = 'server';
      if (message.includes('[Postgres]') || message.includes('postgres')) {
        source = 'postgres';
      } else if (message.includes('[Socket') || message.includes('Socket IO')) {
        source = 'socket';
      }
      addServerLog('warn', source, message.substring(0, 500));
    };
  };

  return {
    addServerLog,
    getServerLogs,
    clearServerLogs,
    attachConsole
  };
};

export { createLogService };
