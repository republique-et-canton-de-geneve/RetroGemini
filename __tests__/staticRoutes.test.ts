import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import express from 'express';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { createSecurityHeaders } from '../server/services/securityHeaders.js';
import {
  CONTENT_HASHED_NAME,
  IMMUTABLE_CACHE_CONTROL,
  REVALIDATE_CACHE_CONTROL,
  findPrecompressedAssets,
  readImmutableAssets,
  registerStaticRoutes
} from '../server/routes/staticRoutes.js';
import { precompressAssets } from '../scripts/precompressAssets.mjs';

/**
 * How the built frontend is served (synthesis item 9).
 *
 * Before: `express.static(dist)` with no options, so every file came back
 * `max-age=0` and uncompressed, and a missing `/assets/x.js` fell through to
 * the SPA fallback — a 200 `text/html` the browser refused to run. Now the
 * hashed bundle is gzipped (precompressed at build time) and cached for a
 * year, everything else is revalidated, and a missing asset is a 404 that
 * keeps our CSP.
 */

const JS = 'app-AbCd12_-.js';
const CSS = 'app-Xy9z8w7v.css';
const JS_TEXT = 'export const greeting = "hello from the bundle";\n'.repeat(80);
const CSS_TEXT = '.board { display: grid; gap: 1rem; }\n'.repeat(80);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');

const makeDist = async ({ manifest }: { manifest: Record<string, unknown> | null }) => {
  const dist = mkdtempSync(join(tmpdir(), 'static-dist-'));
  mkdirSync(join(dist, 'assets'));
  mkdirSync(join(dist, 'fonts'));
  writeFileSync(join(dist, 'index.html'), `<!doctype html><html><head><script type="module" src="/assets/${JS}"></script></head><body><div id="root"></div></body></html>`);
  writeFileSync(join(dist, 'assets', JS), JS_TEXT);
  writeFileSync(join(dist, 'assets', CSS), CSS_TEXT);
  writeFileSync(join(dist, 'assets', 'app.js'), JS_TEXT);
  writeFileSync(join(dist, 'assets', 'cubes.png'), PNG);
  writeFileSync(join(dist, 'fonts', 'f.woff2'), PNG);
  if (manifest) {
    mkdirSync(join(dist, '.vite'));
    writeFileSync(join(dist, '.vite', 'manifest.json'), JSON.stringify(manifest));
  }
  await precompressAssets(join(dist, 'assets'));
  return dist;
};

const MANIFEST = { 'index.html': { file: `assets/${JS}`, css: [`assets/${CSS}`], isEntry: true, src: 'index.html' } };

type Answer = { status: number; headers: http.IncomingHttpHeaders; body: Buffer };

const serve = async (distDir: string) => {
  const app = express();
  app.use(createSecurityHeaders());
  app.get('/api/ping', (_req, res) => { res.json({ pong: true }); });
  registerStaticRoutes({ app, distDir });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (
    path: string,
    { method = 'GET', headers = {} }: { method?: string; headers?: Record<string, string> } = {}
  ): Promise<Answer> =>
    new Promise((resolve, reject) => {
      const req = http.request(`${base}${path}`, { method, headers, agent: false }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      });
      req.on('error', reject);
      req.end();
    });
  return { request, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
};

const GZIP = { 'Accept-Encoding': 'gzip, deflate, br' };

describe('registerStaticRoutes, on a build with its manifest', () => {
  let dist: string;
  let app: Awaited<ReturnType<typeof serve>>;
  // What registration warned about, read before any test runs.
  let staticWarnings: string[];

  beforeAll(async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    dist = await makeDist({ manifest: { ...MANIFEST, 'legacy.js': { file: 'assets/app.js' } } });
    app = await serve(dist);
    staticWarnings = warn.mock.calls.map((call) => call.join(' ')).filter((line) => line.includes('[Server] Static'));
    warn.mockRestore();
  });

  afterAll(async () => {
    await app.close();
    rmSync(dist, { recursive: true, force: true });
  });

  it('serves the hashed bundle gzipped and immutable to a client that accepts gzip', async () => {
    const res = await app.request(`/assets/${JS}`, { headers: GZIP });

    expect(res.status).toBe(200);
    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['content-type']).toBe('text/javascript; charset=utf-8');
    expect(res.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(res.headers.vary).toMatch(/Accept-Encoding/i);
    expect(res.headers['content-length']).toBe(String(readFileSync(join(dist, 'assets', `${JS}.gz`)).length));
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(gunzipSync(res.body).toString('utf8')).toBe(JS_TEXT);
  });

  it('serves the same file in identity with the same cache header and its own ETag', async () => {
    const plain = await app.request(`/assets/${JS}`);
    const zipped = await app.request(`/assets/${JS}`, { headers: GZIP });
    const refused = await app.request(`/assets/${JS}`, { headers: { 'Accept-Encoding': 'gzip;q=0' } });

    expect(plain.headers['content-encoding']).toBeUndefined();
    expect(plain.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL);
    expect(plain.headers.vary).toMatch(/Accept-Encoding/i);
    expect(plain.body.toString('utf8')).toBe(JS_TEXT);
    expect(plain.headers.etag).not.toBe(zipped.headers.etag);
    expect(refused.headers['content-encoding']).toBeUndefined();
  });

  it('answers 304 on each variant\'s own ETag', async () => {
    const zipped = await app.request(`/assets/${JS}`, { headers: GZIP });
    const plain = await app.request(`/assets/${JS}`);

    const zipped304 = await app.request(`/assets/${JS}`, { headers: { ...GZIP, 'If-None-Match': zipped.headers.etag as string } });
    const plain304 = await app.request(`/assets/${JS}`, { headers: { 'If-None-Match': plain.headers.etag as string } });

    expect(zipped304.status).toBe(304);
    expect(plain304.status).toBe(304);
  });

  it('serves the hashed CSS immutable and gzipped too', async () => {
    const res = await app.request(`/assets/${CSS}`, { headers: GZIP });

    expect(res.headers['content-encoding']).toBe('gzip');
    expect(res.headers['content-type']).toBe('text/css; charset=utf-8');
    expect(res.headers['cache-control']).toBe(IMMUTABLE_CACHE_CONTROL);
  });

  it('answers a missing asset with a no-store text 404 that keeps the CSP, never the SPA page', async () => {
    const res = await app.request('/assets/app-Missing00.js', { headers: GZIP });

    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/^text\/plain/);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['content-encoding']).toBeUndefined();
    expect(res.headers['content-security-policy']).toContain("default-src 'self'");
    expect(res.body.toString('utf8')).toBe('Not Found');
  });

  it('revalidates what keeps its name across releases: public assets and an unhashed manifest entry', async () => {
    const png = await app.request('/assets/cubes.png', { headers: GZIP });
    expect(png.status).toBe(200);
    expect(png.headers['cache-control']).toBe(REVALIDATE_CACHE_CONTROL);
    expect(png.headers['content-encoding']).toBeUndefined();

    const unhashed = await app.request('/assets/app.js', { headers: GZIP });
    expect(unhashed.status).toBe(200);
    expect(unhashed.headers['cache-control']).toBe(REVALIDATE_CACHE_CONTROL);
    // One warn line, naming the entry it refused to cache for a year.
    expect(staticWarnings).toHaveLength(1);
    expect(staticWarnings[0]).toContain('/app.js');
  });

  it('revalidates the page, the fonts and every SPA route, with the CSP', async () => {
    for (const path of ['/', '/index.html', '/some/route', '/session/abc']) {
      const res = await app.request(path, { headers: GZIP });
      expect(res.status, path).toBe(200);
      expect(res.headers['cache-control'], path).toBe(REVALIDATE_CACHE_CONTROL);
      expect(res.headers['content-type'], path).toMatch(/^text\/html/);
      expect(res.headers['content-security-policy'], path).toContain("default-src 'self'");
    }
    const font = await app.request('/fonts/f.woff2');
    expect(font.status).toBe(200);
    expect(font.headers['cache-control']).toBe(REVALIDATE_CACHE_CONTROL);
  });

  it('never serves the manifest itself, a directory, a traversal or a write', async () => {
    const manifest = await app.request('/.vite/manifest.json');
    expect(manifest.headers['content-type']).toMatch(/^text\/html/);

    expect((await app.request('/assets/')).status).toBe(404);
    expect((await app.request('/assets')).status).toBe(404);
    const traversal = await app.request('/assets/..%2findex.html');
    expect(traversal.status).toBe(403);
    expect(traversal.headers['content-type']).toMatch(/^text\/plain/);
    expect((await app.request(`/assets/${JS}`, { method: 'POST' })).status).toBe(405);
  });

  it('leaves a route registered before it alone', async () => {
    const res = await app.request('/api/ping');
    expect(JSON.parse(res.body.toString('utf8'))).toEqual({ pong: true });
  });
});

describe('registerStaticRoutes, without a manifest', () => {
  it('serves everything, and nothing as immutable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dist = await makeDist({ manifest: null });
    const app = await serve(dist);
    try {
      const res = await app.request(`/assets/${JS}`, { headers: GZIP });
      expect(res.status).toBe(200);
      expect(res.headers['content-encoding']).toBe('gzip');
      expect(res.headers['cache-control']).toBe(REVALIDATE_CACHE_CONTROL);
      expect(warn.mock.calls.some((call) => String(call[0]).includes('manifest'))).toBe(true);
    } finally {
      warn.mockRestore();
      await app.close();
      rmSync(dist, { recursive: true, force: true });
    }
  });
});

describe('registerStaticRoutes, with no build at all', () => {
  // The default e2e job runs `node server.js` with no `dist/`, and so does a
  // developer on `npm run dev`. Throwing here would stop the server booting.
  it('boots without a warning, and the static layer answers 404', async () => {
    const warn = vi.spyOn(console, 'warn');
    warn.mockClear();
    const app = await serve(join(tmpdir(), 'no-such-dist-' + Date.now()));
    try {
      const asset = await app.request('/assets/x.js');
      expect(asset.status).toBe(404);
      expect(asset.headers['content-type']).toMatch(/^text\/plain/);
      expect(JSON.parse((await app.request('/api/ping')).body.toString('utf8'))).toEqual({ pong: true });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
      await app.close();
    }
  });
});

describe('the helpers', () => {
  let dist: string;

  afterEach(() => {
    if (dist) rmSync(dist, { recursive: true, force: true });
  });

  it('readImmutableAssets keeps the manifest files that carry a content hash', async () => {
    dist = await makeDist({ manifest: { ...MANIFEST, _chunk: { file: 'assets/chunk-Q1w2E3r4.js', assets: ['assets/logo-Zz99Yy88.svg'] } } });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect([...readImmutableAssets(dist)].sort()).toEqual([
        `/${JS}`,
        `/${CSS}`,
        '/chunk-Q1w2E3r4.js',
        '/logo-Zz99Yy88.svg'
      ].sort());
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('readImmutableAssets answers an empty set for an unreadable manifest, with a warning', async () => {
    dist = await makeDist({ manifest: null });
    mkdirSync(join(dist, '.vite'));
    writeFileSync(join(dist, '.vite', 'manifest.json'), '{ not json');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(readImmutableAssets(dist).size).toBe(0);
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('findPrecompressedAssets lists the files with a .gz beside them, and a missing directory is empty', async () => {
    dist = await makeDist({ manifest: MANIFEST });
    expect([...findPrecompressedAssets(join(dist, 'assets'))].sort()).toEqual([`/${CSS}`, `/${JS}`, '/app.js'].sort());
    expect(findPrecompressedAssets(join(dist, 'missing')).size).toBe(0);
  });

  it('CONTENT_HASHED_NAME matches Vite\'s hashed names, not a plain public file', () => {
    expect(CONTENT_HASHED_NAME.test('index-DkbmKqvM.js')).toBe(true);
    expect(CONTENT_HASHED_NAME.test('index-C9h-X6MM.css')).toBe(true);
    expect(CONTENT_HASHED_NAME.test('app.js')).toBe(false);
    expect(CONTENT_HASHED_NAME.test('cubes.png')).toBe(false);
    expect(CONTENT_HASHED_NAME.test('timer-alert.mp3')).toBe(false);
  });
});

describe('wired into the real server', () => {
  it('registers the static routes after the socket handlers, and no bare express.static is left', () => {
    const source = readFileSync(join(__dirname, '..', 'server.js'), 'utf8');
    const sockets = source.indexOf('registerSocketHandlers(');
    const statics = source.indexOf('registerStaticRoutes(');

    expect(sockets).toBeGreaterThan(-1);
    expect(statics).toBeGreaterThan(sockets);
    expect(source).not.toContain('express.static(');
  });
});
