# Compression and caching

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


A team answer is 0.6 to 1 MB of JSON and the bundle 1.47 MB of JS and CSS, and
an invite link sends fifteen phones on one access point after both at once.
Nothing was compressed and every file was revalidated on every load. Two
modules fix that, with **no new dependency** (the reasoning `helmet` got):

- **`server/services/jsonCompression.js` gzips JSON answers** of 1 KiB and
  more, at level 4, for a client whose `Accept-Encoding` allows it. It wraps
  `res.json` **alone** (`res.send(object)` goes through it), so a body sent any
  other way is never touched: `res.send(Buffer)` (the backup downloads, already
  gzip), files, streams, and Socket.IO, which engine.io answers before Express.
  It is mounted right after the security headers, before the first route. The
  headers are committed synchronously, as Express would commit them; the body
  is compressed on libuv's pool, not the event loop every live session shares,
  so it goes out chunked with no `Content-Length`. Its weak ETag is the
  identity body's, shared by both encodings, and `Vary: Accept-Encoding` is set
  on every answer large enough to have been compressed. HEAD, a status without
  a body, a `Content-Encoding` the route set itself and `no-transform` are left
  in identity.
- ⚠️ **A handler must not throw, nor do anything that can throw, after it has
  answered.** The compressed body is written after the handler returns, and the
  router destroys a socket whose headers are sent, so the answer is lost (an
  identity answer usually survived, because it was already on the wire).
  Best-effort work after an answer goes in its own `.catch`, as the rename
  route's live-session propagation does. `__tests__/jsonCompression.test.ts` →
  *loses the answer of a handler that throws after it* pins the cost.
- **`npm run build` precompresses the bundle**: `scripts/precompressAssets.mjs`
  runs after `vite build` and writes a `.gz` beside each compressible file of
  `dist/assets` at the best level, when it is smaller (1.47 MB → 373 KB
  today). The Dockerfile, CI and `playwright.prod.config.ts` run `npm run
  build`, so none of them names the script. Gzip only: browsers send `br` over
  HTTPS alone, and some deployments serve plain HTTP.
- **`server/routes/staticRoutes.js` serves `dist/`.** **Immutable** (`max-age`
  a year) **means listed in Vite's manifest** (`build.manifest: true` →
  `dist/.vite/manifest.json`) **and carrying its content hash**: the hash rule
  alone would cache a public file named like `foo-12345678.png` for a year, the
  manifest alone an entry whose name stopped changing with its content.
  Everything from `public/assets` is revalidated (`no-cache`): **never rely on
  renaming a public file to bust a cache.** A precompressed file goes to a
  client that accepts gzip, with the original's type and `Vary`.
- **`index.html`, the fonts and every root file are `no-cache`.** ⚠️ The
  page's validator is `send`'s stat ETag (size and mtime), and hashed names
  have a fixed length, so its size rarely changes between releases: **never
  normalise file timestamps in the image build** (kaniko `--reproducible`,
  BuildKit `rewrite-timestamp`, a `SOURCE_DATE_EPOCH` applied to files). Every
  release would carry the same validator, and returning browsers would keep the
  previous page and its deleted bundle. Give `index.html` a content ETag first.
- **A missing `/assets` file is a `no-store` text 404 that keeps our CSP**, not
  the SPA page a browser refused to run. During a rolling update, a page from
  one pod whose bundle is asked of the other build is still a blank page until
  a reload (H9's accepted residual), but it can no longer be cached.
- **The server boots without a build.** The default e2e job runs `node
  server.js` with no `dist/`: the static layer then serves nothing, logs one
  info line, and never throws. A build without its manifest makes nothing
  immutable, which is safe, and logs one warning.

Two test layers: `__tests__/jsonCompression.test.ts`,
`__tests__/staticRoutes.test.ts` and `__tests__/precompressAssets.test.ts` pin
each rule on a synthetic `dist/`; `e2e-prod/static-delivery.spec.ts` drives the
real build in a browser (`npm run test:e2e:prod`). Leave router compression
off: an answer that already carries `Content-Encoding` is not compressed again
by HAProxy or ingress-nginx, and the application's is the one that is tested.
