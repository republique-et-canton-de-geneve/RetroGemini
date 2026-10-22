/**
 * Serving the built frontend (synthesis item 9).
 *
 * It used to be one `express.static(dist)` with no options: every file came
 * back uncompressed with `Cache-Control: public, max-age=0`, so each phone
 * re-validated a 1 MB bundle on every load, and a missing `/assets/x.js` fell
 * through to the SPA fallback — a 200 `text/html` the browser refused to run.
 *
 * Three rules now, each one a line of AGENTS.md → *Compression and caching*:
 * - **Immutable means listed in Vite's manifest and carrying its content
 *   hash.** Everything else under `/assets` comes from `public/assets` and
 *   keeps its name across releases, so it is revalidated (`no-cache`). Either
 *   condition alone is not enough: the hash pattern alone would make a public
 *   file named like `foo-12345678.png` immutable, and the manifest alone would
 *   make an entry whose name does not change with its content (a later
 *   `entryFileNames` setting) stale for a year.
 * - **`index.html` and every root file are revalidated**, so a release is
 *   picked up on the next load. Its validator is `send`'s stat ETag (size and
 *   mtime): never normalise file timestamps in the image build.
 * - **A missing asset is a `no-store` text 404**, through an error handler
 *   scoped to `/assets`, so it keeps our CSP (`send`'s own 404 would replace
 *   it with `default-src 'none'` and HTML) and cannot be cached by a proxy.
 *
 * The bundle is precompressed at build time (`scripts/precompressAssets.mjs`,
 * run by `npm run build`), so a gzip-accepting browser gets the `.gz` with no
 * CPU spent here.
 *
 * Read once, at registration: an image's `dist/` never changes while the pod
 * runs. With no build at all (the default e2e job and `npm run dev` start
 * `server.js` without one), nothing is found, nothing throws, and the static
 * layer answers 404.
 */
import express from 'express';
import rateLimit from 'express-rate-limit';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';

export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
export const REVALIDATE_CACHE_CONTROL = 'no-cache';
// Vite's content hash: `index-DkbmKqvM.js`. Required on top of the manifest,
// so an entry whose name does not change with its content is never cached for
// a year.
export const CONTENT_HASHED_NAME = /-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/;

const MANIFEST_PATH = join('.vite', 'manifest.json');

/**
 * The files under `assets/` that may be cached for a year, as the paths
 * `/assets` serves them ('/index-C9hvX6MM.js'): every `file`, `css[]` and
 * `assets[]` of `dist/.vite/manifest.json` whose name carries a content hash.
 * An entry without one is left out, with one warn line naming it. No
 * `dist/index.html` (no build): an empty set, without a warning. A build
 * without its manifest, or an unreadable one: an empty set and one warning.
 * Nothing is cached as immutable in any of these cases, which is safe.
 */
export const readImmutableAssets = (distDir) => {
  const immutable = new Set();
  if (!existsSync(join(distDir, 'index.html'))) {
    console.info('[Server] Static assets: no build in this image (dist/index.html is missing); the static layer serves nothing');
    return immutable;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(distDir, MANIFEST_PATH), 'utf8'));
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('not an object');
  } catch (err) {
    console.warn(`[Server] Static assets: no readable dist/${MANIFEST_PATH.split(sep).join('/')} (${err.message}); nothing is served as immutable`);
    return immutable;
  }
  const unhashed = new Set();
  for (const entry of Object.values(manifest)) {
    if (!entry || typeof entry !== 'object') continue;
    const files = [entry.file, ...(Array.isArray(entry.css) ? entry.css : []), ...(Array.isArray(entry.assets) ? entry.assets : [])];
    for (const file of files) {
      if (typeof file !== 'string' || !file.startsWith('assets/')) continue;
      const served = file.slice('assets'.length);
      if (CONTENT_HASHED_NAME.test(served)) immutable.add(served);
      else unhashed.add(served);
    }
  }
  if (unhashed.size > 0) {
    console.warn(`[Server] Static assets: built files without a content hash are revalidated, never cached for a year: ${[...unhashed].sort().join(', ')}`);
  }
  return immutable;
};

/**
 * '/x.js' for every `x.js` under `assetsDir` with an `x.js.gz` beside it. A
 * missing directory is an empty set, never a throw.
 */
export const findPrecompressedAssets = (assetsDir) => {
  const found = new Set();
  let entries;
  try {
    entries = readdirSync(assetsDir, { recursive: true, withFileTypes: true });
  } catch {
    return found;
  }
  const files = new Set(
    entries
      .filter((entry) => entry.isFile())
      .map((entry) => relative(assetsDir, join(entry.parentPath ?? entry.path, entry.name)).split(sep).join('/'))
  );
  for (const file of files) {
    if (file.endsWith('.gz') && files.has(file.slice(0, -3))) found.add(`/${file.slice(0, -3)}`);
  }
  return found;
};

// Serves `<file>.gz` in place of `<file>` to a client that accepts gzip, for
// an exact member of the set only (so a request can reach no other file).
// `send` keeps the Content-Type set here, the original's, and computes the
// length, ETag and ranges of the `.gz` it actually sends.
const servePrecompressed = (precompressed) => (req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  const queryAt = req.url.indexOf('?');
  const pathname = queryAt === -1 ? req.url : req.url.slice(0, queryAt);
  const search = queryAt === -1 ? '' : req.url.slice(queryAt);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return next();
  }
  if (!precompressed.has(decoded)) return next();
  // Whichever encoding is sent, a cache must key on it.
  res.vary('Accept-Encoding');
  if (req.acceptsEncodings('gzip', 'identity') === 'gzip') {
    res.setHeader('Content-Encoding', 'gzip');
    res.type(extname(decoded));
    req.url = `${pathname}.gz${search}`;
  }
  return next();
};

// Errors of the `/assets` static handler: a missing file, a directory, a
// traversal. Answered here so the answer keeps our CSP and is never cached.
const assetError = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error('[Server] Failed to serve a static asset', err);
  res.removeHeader('Content-Encoding');
  res.removeHeader('Content-Type');
  res.removeHeader('Content-Length');
  res.status(status);
  res.setHeader('Cache-Control', 'no-store');
  res.type('text/plain');
  return res.send(status === 404 ? 'Not Found' : 'Error');
};

export const registerStaticRoutes = ({ app, distDir, spaLimiterMax = 600 }) => {
  const assetsDir = join(distDir, 'assets');
  const immutable = readImmutableAssets(distDir);
  const precompressed = findPrecompressedAssets(assetsDir);
  console.info(`[Server] Static assets: ${immutable.size} immutable, ${precompressed.size} precompressed`);

  app.use(
    '/assets',
    servePrecompressed(precompressed),
    express.static(assetsDir, {
      // A missing file is an error for `assetError`, never the SPA page.
      fallthrough: false,
      index: false,
      redirect: false,
      setHeaders: (res, filePath) => {
        let served = '/' + relative(assetsDir, filePath).split(sep).join('/');
        if (res.getHeader('Content-Encoding') === 'gzip' && served.endsWith('.gz')) served = served.slice(0, -3);
        res.setHeader('Cache-Control', immutable.has(served) ? IMMUTABLE_CACHE_CONTROL : REVALIDATE_CACHE_CONTROL);
      }
    }),
    assetError
  );

  // `index.html` for "/", the fonts, every other root file: revalidated. "/"
  // stays here, outside the SPA limiter below: invite links land on
  // "/?join=…", and a whole office opens the same one at once.
  app.use(express.static(distDir, {
    setHeaders: (res) => res.setHeader('Cache-Control', REVALIDATE_CACHE_CONTROL)
  }));

  const spaLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: spaLimiterMax,
    message: { error: 'too_many_requests', retryAfter: '1 minute' },
    standardHeaders: true,
    legacyHeaders: false
  });

  app.get(/.*/, spaLimiter, (_req, res) => {
    // The page that names the hashed assets: always revalidated, so a release
    // is picked up on the next load.
    res.set('Cache-Control', REVALIDATE_CACHE_CONTROL);
    res.sendFile(join(distDir, 'index.html'));
  });
};
