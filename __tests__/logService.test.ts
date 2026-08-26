import { describe, it, expect, afterEach, vi } from 'vitest';
import { createLogService } from '../server/services/logService.js';

describe('logService', () => {
  // Captured once (the real console); attachConsole overrides the global
  // console methods, so every test restores them here to avoid leaking the
  // override into other tests.
  const realConsole = {
    error: console.error,
    warn: console.warn,
    info: console.info,
    log: console.log
  };

  afterEach(() => {
    console.error = realConsole.error;
    console.warn = realConsole.warn;
    console.info = realConsole.info;
    console.log = realConsole.log;
    vi.restoreAllMocks();
  });

  describe('addServerLog', () => {
    it('records level/source/message and caps the ring buffer at 1000', () => {
      const svc = createLogService();
      const entry = svc.addServerLog('info', 'server', 'hello');
      expect(entry.level).toBe('info');
      expect(entry.source).toBe('server');
      expect(entry.message).toBe('hello');
      expect(svc.getServerLogs()).toHaveLength(1);

      const svc2 = createLogService();
      for (let i = 0; i < 1005; i += 1) svc2.addServerLog('info', 'server', `m${i}`);
      const logs = svc2.getServerLogs();
      expect(logs).toHaveLength(1000);
      expect(logs[0].message).toBe('m5'); // m0..m4 evicted by the ring buffer
      expect(logs[logs.length - 1].message).toBe('m1004');
    });
  });

  describe('attachConsole (audit R25)', () => {
    it('captures console.info and console.log into the buffer at info level', () => {
      const svc = createLogService();
      console.info = vi.fn();
      console.log = vi.fn();
      svc.attachConsole();

      console.info('[Backup] created auto backup');
      console.log('[Server] User joining session');

      const logs = svc.getServerLogs();
      expect(logs).toHaveLength(2);
      expect(logs.every((l) => l.level === 'info')).toBe(true);
      expect(logs[0].message).toContain('[Backup]');
      expect(logs[1].message).toContain('[Server]');
    });

    it('still captures console.error and console.warn at their own levels', () => {
      const svc = createLogService();
      console.error = vi.fn();
      console.warn = vi.fn();
      svc.attachConsole();

      console.error('boom');
      console.warn('careful');

      expect(svc.getServerLogs().map((l) => l.level)).toEqual(['error', 'warn']);
    });

    it('classifies the source from the message prefix', () => {
      const svc = createLogService();
      console.info = vi.fn();
      svc.attachConsole();

      console.info('[Postgres] pool ready');
      console.info('[Socket.IO] adapter attached');
      console.info('SMTP mailer configured');
      console.info('[Server] generic message');

      expect(svc.getServerLogs().map((l) => l.source)).toEqual([
        'postgres',
        'socket',
        'email',
        'server'
      ]);
    });

    it('still writes to the original console method and joins multiple args', () => {
      const svc = createLogService();
      const infoSpy = vi.fn();
      console.info = infoSpy;
      svc.attachConsole();

      console.info('hello', 'world');

      expect(infoSpy).toHaveBeenCalledWith('hello', 'world');
      expect(svc.getServerLogs()[0].message).toBe('hello world');
    });

    it('truncates long messages to 500 characters', () => {
      const svc = createLogService();
      console.info = vi.fn();
      svc.attachConsole();

      console.info('x'.repeat(1000));
      expect(svc.getServerLogs()[0].message).toHaveLength(500);
    });

    it('never throws on an unserializable argument, and no longer loses the record', () => {
      const svc = createLogService();
      const infoSpy = vi.fn();
      console.info = infoSpy;
      svc.attachConsole();

      const circular: Record<string, unknown> = {};
      circular.self = circular;

      expect(() => console.info(circular)).not.toThrow();
      // Real console received it untouched, as before.
      expect(infoSpy).toHaveBeenCalledWith(circular);

      // **Changed deliberately by audit H44.** This used to assert the ring
      // stayed empty: one `JSON.stringify` covered every argument, so a single
      // circular object threw and the whole entry was dropped. That is the
      // wrong trade — the moment logging matters most is the moment something
      // is malformed. Each argument now degrades on its own, so the record
      // survives with the unserializable part named.
      const [entry] = svc.getServerLogs();
      expect(entry.message).toBe('[unserializable]');
    });
  });
});
