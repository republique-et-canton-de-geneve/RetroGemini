import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { gunzipSync, gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createSecurityHeaders } from '../server/services/securityHeaders.js';
import { createJsonCompression, JSON_COMPRESSION_THRESHOLD_BYTES } from '../server/services/jsonCompression.js';

/**
 * JSON answers are gzipped when the client accepts it (synthesis item 9).
 *
 * A team answer is 0.6 to 1 MB of JSON, and fifteen phones on one access
 * point used to pull it uncompressed. Only `res.json` is wrapped, so nothing
 * sent any other way is touched: a backup download (`res.send(Buffer)`), a
 * stream, a file, Socket.IO. A raw `node:http` client reads the bytes on the
 * wire, because `fetch` decodes them.
 */

// Well over the threshold, and compressible like a real team.
const BIG = {
  retrospectives: Array.from({ length: 200 }, (_, i) => ({ id: `retro-${i}`, name: `Sprint ${i}`, tickets: [] }))
};
const BIG_TEXT = JSON.stringify(BIG);

type Answer = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

let baseUrl: string;
let server: http.Server;
let caught: unknown = null;

const request = (
  path: string,
  { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {}
): Promise<Answer> =>
  new Promise((resolve, reject) => {
    const req = http.request(`${baseUrl}${path}`, { method, headers, agent: false }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.end();
  });

const GZIP = { 'Accept-Encoding': 'gzip, deflate, br' };

beforeAll(async () => {
  expect(BIG_TEXT.length).toBeGreaterThan(JSON_COMPRESSION_THRESHOLD_BYTES * 4);
  const app = express();
  app.use(createSecurityHeaders());
  app.use(createJsonCompression());

  app.get('/big', (_req, res) => { res.json(BIG); });
  app.head('/big', (_req, res) => { res.json(BIG); });
  app.get('/small', (_req, res) => { res.json({ ok: true }); });
  app.get('/send-object', (_req, res) => { res.send(BIG); });
  app.get('/created', (_req, res) => { res.status(201).json(BIG); });
  app.get('/failed', (_req, res) => { res.status(500).json(BIG); });
  app.get('/no-transform', (_req, res) => { res.set('Cache-Control', 'no-transform'); res.json(BIG); });
  app.get('/pre-encoded', (_req, res) => { res.set('Content-Encoding', 'identity'); res.json(BIG); });
  // The backup download's shape: an archive sent as a Buffer.
  app.get('/archive', (_req, res) => {
    res.set('Content-Type', 'application/gzip');
    res.send(gzipSync(Buffer.from(BIG_TEXT)));
  });
  app.get('/stream', (_req, res) => {
    res.set('Content-Type', 'application/json');
    res.write(BIG_TEXT.slice(0, 100));
    res.end(BIG_TEXT.slice(100));
  });
  app.get('/double', (_req, res) => {
    res.json(BIG);
    try {
      res.json({});
    } catch (err) {
      caught = err;
    }
  });
  app.get('/late-throw', (_req, res) => {
    res.json(BIG);
    throw new Error('a late failure, after the answer');
  });
  app.get('/client-gone', (req, res) => {
    res.json(BIG);
    req.socket.destroy();
  });

  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  caught = null;
});

describe('createJsonCompression', () => {
  it('gzips a large JSON answer for a client that accepts gzip, with every security header', async () => {
    const res = await request('/big', { headers: GZIP });

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers.vary).toMatch(/Accept-Encoding/i);
    expect(res.headers['content-length']).toBeUndefined();
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(gunzipSync(res.body).toString('utf8')).toBe(BIG_TEXT);
    expect(res.body.length).toBeLessThan(BIG_TEXT.length / 4);
  });

  it('answers in identity, with an exact Content-Length and Vary, without gzip in Accept-Encoding', async () => {
    for (const headers of [{}, { 'Accept-Encoding': 'gzip;q=0, identity' }]) {
      const res = await request('/big', { headers });

      expect(res.headers['content-encoding']).toBeUndefined();
      expect(res.headers['content-length']).toBe(String(Buffer.byteLength(BIG_TEXT)));
      expect(res.headers.vary).toMatch(/Accept-Encoding/i);
      expect(res.body.toString('utf8')).toBe(BIG_TEXT);
    }
  });

  it('leaves an answer below the threshold alone, without Vary', async () => {
    const res = await request('/small', { headers: GZIP });

    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers.vary).toBeUndefined();
    expect(JSON.parse(res.body.toString('utf8'))).toEqual({ ok: true });
  });

  it('compresses res.send(object), which Express routes through res.json', async () => {
    const res = await request('/send-object', { headers: GZIP });

    expect(res.headers['content-encoding']).toBe('gzip');
    expect(gunzipSync(res.body).toString('utf8')).toBe(BIG_TEXT);
  });

  it('keeps the status of a compressed answer', async () => {
    const created = await request('/created', { headers: GZIP });
    const failed = await request('/failed', { headers: GZIP });

    expect(created.status).toBe(201);
    expect(created.headers['content-encoding']).toBe('gzip');
    expect(failed.status).toBe(500);
    expect(gunzipSync(failed.body).toString('utf8')).toBe(BIG_TEXT);
  });

  it('shares one weak ETag between the encodings, and answers a fresh GET with an empty 304', async () => {
    const zipped = await request('/big', { headers: GZIP });
    const plain = await request('/big');

    expect(zipped.headers.etag).toMatch(/^W\//);
    expect(zipped.headers.etag).toBe(plain.headers.etag);

    const again = await request('/big', { headers: { ...GZIP, 'If-None-Match': zipped.headers.etag as string } });
    expect(again.status).toBe(304);
    expect(again.body.length).toBe(0);
    expect(again.headers['content-encoding']).toBeUndefined();
  });

  it('answers HEAD with identity headers and no body', async () => {
    const res = await request('/big', { method: 'HEAD', headers: GZIP });

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-length']).toBe(String(Buffer.byteLength(BIG_TEXT)));
    expect(res.body.length).toBe(0);
  });

  it('honours Cache-Control: no-transform and a Content-Encoding the route set itself', async () => {
    const noTransform = await request('/no-transform', { headers: GZIP });
    expect(noTransform.headers['content-encoding']).toBeUndefined();
    expect(noTransform.body.toString('utf8')).toBe(BIG_TEXT);

    const preEncoded = await request('/pre-encoded', { headers: GZIP });
    expect(preEncoded.headers['content-encoding']).toBe('identity');
    expect(preEncoded.body.toString('utf8')).toBe(BIG_TEXT);
  });

  it('never touches a Buffer answer (the backup download) or a stream', async () => {
    const archive = await request('/archive', { headers: GZIP });
    expect(archive.headers['content-type']).toBe('application/gzip');
    expect(archive.headers['content-encoding']).toBeUndefined();
    expect(gunzipSync(archive.body).toString('utf8')).toBe(BIG_TEXT);

    const stream = await request('/stream', { headers: GZIP });
    expect(stream.headers['content-encoding']).toBeUndefined();
    expect(stream.body.toString('utf8')).toBe(BIG_TEXT);
  });

  it('throws ERR_HTTP_HEADERS_SENT on a second answer, synchronously, and the first body arrives intact', async () => {
    const res = await request('/double', { headers: GZIP });

    expect((caught as { code?: string } | null)?.code).toBe('ERR_HTTP_HEADERS_SENT');
    expect(gunzipSync(res.body).toString('utf8')).toBe(BIG_TEXT);
  });

  // The rule the module comment and AGENTS.md state: a compressed body is
  // written after the handler returns, and the router destroys a socket whose
  // headers are sent, so a handler that throws after answering loses the
  // answer. This pins the cost rather than preventing it.
  it('loses the answer of a handler that throws after it, and keeps serving', async () => {
    await expect(request('/late-throw', { headers: GZIP })).rejects.toThrow(/ECONNRESET|socket hang up/);

    const next = await request('/big', { headers: GZIP });
    expect(gunzipSync(next.body).toString('utf8')).toBe(BIG_TEXT);
  });

  it('writes nothing, and throws nothing, for a client gone before the body is compressed', async () => {
    const uncaught = vi.fn();
    process.on('uncaughtException', uncaught);
    try {
      await expect(request('/client-gone', { headers: GZIP })).rejects.toThrow();
      // Let the compression callback run against the destroyed socket.
      await new Promise((resolve) => setTimeout(resolve, 50));

      const next = await request('/big', { headers: GZIP });
      expect(gunzipSync(next.body).toString('utf8')).toBe(BIG_TEXT);
      expect(uncaught).not.toHaveBeenCalled();
    } finally {
      process.off('uncaughtException', uncaught);
    }
  });
});

describe('wired into the real server', () => {
  it('is mounted after the security headers and before the first route', () => {
    const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
    const headers = source.indexOf('app.use(createSecurityHeaders())');
    const compression = source.indexOf('app.use(createJsonCompression())');
    const firstRoutes = source.indexOf('registerCoreRoutes(');

    expect(headers).toBeGreaterThan(-1);
    expect(compression).toBeGreaterThan(headers);
    expect(firstRoutes).toBeGreaterThan(compression);
  });
});
