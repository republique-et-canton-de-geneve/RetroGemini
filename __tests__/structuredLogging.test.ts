import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  DEFAULT_REDACTION,
  collectKnownSecrets,
  formatLogLine,
  redactSecrets,
  resolveLogFormat
} from '../server/services/structuredLog.js';
import {
  createRequestContext,
  currentContext,
  runWithContext,
  setContextValue
} from '../server/services/logContext.js';
import { createLogService } from '../server/services/logService.js';

/**
 * Audit H44 — **the running system leaves a record you can search.**
 *
 * Before this, logging was `console.log` mirrored into a 1000-entry in-memory
 * ring per pod: unstructured, no level control, and — the part that matters at
 * `replicas: 2` — **nothing tying one line to the request that produced it.**
 * The failure scenario in the tracker is a facilitator reporting lost votes at
 * 14:20: two pods hold different fragments, a rolling update has emptied both,
 * and no line says which HTTP call or which socket a given message belongs to.
 *
 * Three properties are pinned here, and they fail for different reasons:
 *
 *  1. **One record is one line of valid JSON.** A stack trace is the case that
 *     breaks a naive formatter: it arrives with newlines in it, and a log
 *     aggregator splits on newlines, so an unescaped trace becomes twenty
 *     records of which nineteen have no level and no timestamp.
 *  2. **A correlation id reaches the line without the call site knowing.**
 *     H44 asks for a wrapper, not a find-and-replace over hundreds of
 *     `console.log`s, so the id travels in `AsyncLocalStorage` and is read at
 *     emit time. The test that matters is the interleaved one: two requests in
 *     flight must not borrow each other's id.
 *  3. **A secret is never interpolated.** Redaction is by *value* first — the
 *     process knows its own `SESSION_TOKEN_SECRET`, `SUPER_ADMIN_PASSWORD` and
 *     database password, so any line containing one is caught whatever wording
 *     produced it — and by key pattern second, for the secrets the process
 *     does not hold (an operator's LLM key lives in the database).
 *
 * The fourth property is compatibility: the super-admin viewer reads the same
 * ring, so the entry shape it parses may gain a field and must never lose one.
 */

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

// --------------------------------------------------------------------------
// 1. One record, one line, valid JSON
// --------------------------------------------------------------------------

describe('H44 — the formatter', () => {
  it('emits a single line of valid JSON carrying level, timestamp and source', () => {
    const line = formatLogLine({
      level: 'warn',
      source: 'postgres',
      message: 'connection lost',
      timestamp: '2026-08-26T10:00:00.000Z'
    });

    expect(line).not.toContain('\n');
    const parsed = JSON.parse(line);
    expect(parsed).toMatchObject({
      level: 'warn',
      source: 'postgres',
      message: 'connection lost',
      timestamp: '2026-08-26T10:00:00.000Z'
    });
  });

  it('keeps a stack trace as one record instead of twenty', () => {
    const trace = 'Error: boom\n    at handler (server.js:10:5)\n    at next (express.js:1:1)';

    const line = formatLogLine({ level: 'error', source: 'server', message: trace });

    // The whole point: an aggregator splits on newlines, so a raw trace would
    // arrive as three records, two of them with no level and no timestamp.
    expect(line.split('\n')).toHaveLength(1);
    expect(JSON.parse(line).message).toBe(trace);
  });

  it('omits the correlation id rather than emitting a null one', () => {
    const parsed = JSON.parse(formatLogLine({ level: 'info', source: 'server', message: 'hi' }));

    expect('correlationId' in parsed).toBe(false);
  });

  it('reads the correlation id from the ambient context', () => {
    const line = runWithContext({ correlationId: 'req-123' }, () =>
      formatLogLine({ level: 'info', source: 'server', message: 'hi' })
    );

    expect(JSON.parse(line).correlationId).toBe('req-123');
  });
});

// --------------------------------------------------------------------------
// 2. The correlation id, and the interleaving that would break it
// --------------------------------------------------------------------------

describe('H44 — the request context', () => {
  it('generates an id and echoes it on the response', () => {
    const middleware = createRequestContext();
    const headers: Record<string, string> = {};
    const req = { headers: {} };
    const res = { setHeader: (k: string, v: string) => { headers[k] = v; } };

    let seen: string | undefined;
    middleware(req, res, () => { seen = currentContext()?.correlationId; });

    expect(seen).toMatch(/^[0-9a-f-]{8,}$/);
    expect(headers['X-Request-Id']).toBe(seen);
  });

  it('adopts a caller-supplied request id, so a trace survives the proxy hop', () => {
    const middleware = createRequestContext();
    const req = { headers: { 'x-request-id': 'edge-42_abc' } };
    const res = { setHeader: () => {} };

    let seen: string | undefined;
    middleware(req, res, () => { seen = currentContext()?.correlationId; });

    expect(seen).toBe('edge-42_abc');
  });

  it('refuses a hostile request id rather than logging whatever a caller sends', () => {
    const middleware = createRequestContext();
    // Anyone who can reach the deployment sets this header. Left alone it is a
    // log-injection and log-bloat vector; JSON encoding neutralises the first,
    // nothing but a length and charset check neutralises the second.
    for (const hostile of ['x'.repeat(200), 'a b', 'id\nlevel=error', '../../etc/passwd']) {
      const req = { headers: { 'x-request-id': hostile } };
      let seen: string | undefined;
      middleware(req, { setHeader: () => {} }, () => { seen = currentContext()?.correlationId; });
      expect(seen).not.toBe(hostile);
      expect(seen).toMatch(/^[0-9a-f-]{8,}$/);
    }
  });

  it('does not let two requests in flight borrow each other’s id', async () => {
    const middleware = createRequestContext();
    const run = (id: string) =>
      new Promise<string | undefined>((resolve) => {
        middleware({ headers: { 'x-request-id': id } }, { setHeader: () => {} }, () => {
          // Yield, so the two requests are genuinely interleaved rather than
          // running to completion one after the other.
          setTimeout(() => resolve(currentContext()?.correlationId), 5);
        });
      });

    const [first, second] = await Promise.all([run('req-aaa'), run('req-bbb')]);

    expect(first).toBe('req-aaa');
    expect(second).toBe('req-bbb');
  });

  it('lets a handler enrich the context once it knows the session', () => {
    const seen = runWithContext({ correlationId: 'sock-1' }, () => {
      setContextValue('sessionId', 'session-9');
      return JSON.parse(formatLogLine({ level: 'info', source: 'socket', message: 'joined' }));
    });

    expect(seen.sessionId).toBe('session-9');
    expect(seen.correlationId).toBe('sock-1');
  });
});

// --------------------------------------------------------------------------
// 3. Secrets
// --------------------------------------------------------------------------

describe('H44 — a secret is never interpolated', () => {
  it('redacts a known secret value wherever it appears in the text', () => {
    const secrets = ['s3cret-signing-key', 'sup3r-admin-password'];

    const out = redactSecrets(
      'token signed with s3cret-signing-key by sup3r-admin-password',
      secrets
    );

    expect(out).not.toContain('s3cret-signing-key');
    expect(out).not.toContain('sup3r-admin-password');
    expect(out).toContain(DEFAULT_REDACTION);
  });

  it('redacts by key pattern for the secrets this process does not hold', () => {
    // The LLM key lives in the database, so value-based redaction cannot see
    // it; only the shape of the line can.
    const out = redactSecrets('calling AI with apiKey=sk-live-abcdefghijklmnop and model=x', []);

    expect(out).not.toContain('sk-live-abcdefghijklmnop');
    expect(out).toContain('model=x');
  });

  it.each([
    ['Authorization: Bearer eyJhbGciOiJIUzI1NiJ9', 'eyJhbGciOiJIUzI1NiJ9'],
    ['{"password":"hunter22-and-more"}', 'hunter22-and-more'],
    ['sessionToken: abcdefghijklmnop', 'abcdefghijklmnop']
  ])('redacts %s', (input, secret) => {
    expect(redactSecrets(input, [])).not.toContain(secret);
  });

  it('leaves ordinary text alone, including a short env value that is not a secret', () => {
    // A value-based sweep with no length floor would redact the word "true"
    // out of every line the moment some short variable held it.
    const secrets = collectKnownSecrets({ BACKUP_ENABLED: 'true', SESSION_TOKEN_SECRET: 'x' });

    expect(secrets).toEqual([]);
    expect(redactSecrets('backup enabled: true for team Alpha', secrets)).toBe(
      'backup enabled: true for team Alpha'
    );
  });

  it('collects only the secret-bearing variables, and only usable ones', () => {
    const secrets = collectKnownSecrets({
      SESSION_TOKEN_SECRET: 'a-long-signing-secret',
      SUPER_ADMIN_PASSWORD: 'another-long-password',
      POSTGRES_PASSWORD: '',
      PORT: '3000'
    });

    expect(secrets).toContain('a-long-signing-secret');
    expect(secrets).toContain('another-long-password');
    expect(secrets).not.toContain('');
    expect(secrets).not.toContain('3000');
  });
});

// --------------------------------------------------------------------------
// 4. The service, and the viewer that reads the same ring
// --------------------------------------------------------------------------

describe('H44 — logService in json mode', () => {
  it('writes exactly one JSON line per console call, not the raw line as well', () => {
    const written: unknown[][] = [];
    console.log = ((...args: unknown[]) => { written.push(args); }) as typeof console.log;
    const svc = createLogService({ format: 'json' });
    svc.attachConsole();

    console.log('[Server] session joined');

    expect(written).toHaveLength(1);
    expect(written[0]).toHaveLength(1);
    expect(JSON.parse(String(written[0][0]))).toMatchObject({
      level: 'info',
      source: 'server',
      message: '[Server] session joined'
    });
  });

  it('keeps the human-readable line untouched in text mode', () => {
    const written: unknown[][] = [];
    console.warn = ((...args: unknown[]) => { written.push(args); }) as typeof console.warn;
    const svc = createLogService({ format: 'text' });
    svc.attachConsole();

    console.warn('[Postgres] slow query', 42);

    expect(written).toEqual([['[Postgres] slow query', 42]]);
  });

  it('gives the super-admin viewer the shape it already parses, plus the id', () => {
    console.info = (() => {}) as typeof console.info;
    const svc = createLogService({ format: 'json' });
    svc.attachConsole();

    runWithContext({ correlationId: 'req-7' }, () => console.info('[Backup] created'));

    const [entry] = svc.getServerLogs();
    // Every field ServerLogEntry declares, because the viewer renders them.
    expect(entry).toMatchObject({
      id: expect.any(String),
      timestamp: expect.any(String),
      level: 'info',
      source: 'server',
      message: '[Backup] created',
      correlationId: 'req-7'
    });
  });

  it('redacts before the ring, so a downloaded log ring cannot leak a secret either', () => {
    console.error = (() => {}) as typeof console.error;
    const svc = createLogService({ format: 'json', secrets: ['top-secret-value'] });
    svc.attachConsole();

    console.error('failed to sign with top-secret-value');

    expect(svc.getServerLogs()[0].message).not.toContain('top-secret-value');
  });

  it('survives an argument that cannot be serialised', () => {
    const written: unknown[][] = [];
    console.log = ((...args: unknown[]) => { written.push(args); }) as typeof console.log;
    const svc = createLogService({ format: 'json' });
    svc.attachConsole();

    // A circular object is what a real handler passes by accident, and
    // JSON.stringify throws on it. Losing the line would be the worst outcome:
    // the moment logging matters most is the moment something is malformed.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    console.log('cycle', circular);

    expect(written).toHaveLength(1);
    expect(String(written[0][0])).toContain('cycle');
    expect(svc.getServerLogs()).toHaveLength(1);
  });
});

describe('H44 — choosing the format', () => {
  it('defaults to json in production and text elsewhere', () => {
    expect(resolveLogFormat({ NODE_ENV: 'production' })).toBe('json');
    expect(resolveLogFormat({ NODE_ENV: 'development' })).toBe('text');
    expect(resolveLogFormat({})).toBe('text');
  });

  it('lets an operator pin either format', () => {
    expect(resolveLogFormat({ NODE_ENV: 'production', LOG_FORMAT: 'text' })).toBe('text');
    expect(resolveLogFormat({ NODE_ENV: 'development', LOG_FORMAT: 'json' })).toBe('json');
  });

  it('falls back to the default on an unusable value instead of inventing a third mode', () => {
    expect(resolveLogFormat({ NODE_ENV: 'production', LOG_FORMAT: 'yaml' })).toBe('json');
    expect(resolveLogFormat({ LOG_FORMAT: '' })).toBe('text');
  });
});
