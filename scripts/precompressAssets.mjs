#!/usr/bin/env node
/**
 * Writes `<file>.gz` beside every compressible build output in `dist/assets`
 * (synthesis item 9), so `server.js` serves the bundle compressed with no CPU
 * at request time: about 1.07 MB of JS and CSS becomes about 268 KB on the
 * wire for a first visit, which is what fifteen phones on one access point
 * pull at once when an invite link goes round.
 *
 * Run by `npm run build` right after `vite build`, so the Dockerfile, CI and
 * `playwright.prod.config.ts` all get it without a change of their own. Vite
 * empties `dist/` on every build, so no `.gz` outlives the file it was made
 * from. Gzip only, at the best level: browsers send `br` over HTTPS alone, and
 * some internal deployments serve plain HTTP.
 *
 * `public/assets` files (png, mp3, jpg, webp) land in the same directory and
 * are skipped by extension: they are compressed formats already.
 */
import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { constants, gzipSync } from 'node:zlib';

export const PRECOMPRESSED_EXTENSIONS = new Set([
  '.js', '.mjs', '.css', '.svg', '.json', '.html', '.txt', '.xml', '.map', '.wasm'
]);
// Below this, a `.gz` saves less than its own header and the extra lookup.
export const PRECOMPRESS_MIN_BYTES = 1024;

const walk = async (dir) => {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (entry.isFile()) files.push(path);
  }
  return files;
};

/**
 * Writes a `.gz` for every file of `dir` (recursively) whose extension is in
 * PRECOMPRESSED_EXTENSIONS, that is at least `minBytes` long and whose gzip is
 * smaller than itself. Returns the files written, as posix paths relative to
 * `dir`, and the bytes before and after for those files.
 */
export const precompressAssets = async (dir, { minBytes = PRECOMPRESS_MIN_BYTES } = {}) => {
  const written = [];
  let bytesBefore = 0;
  let bytesAfter = 0;
  for (const file of (await walk(dir)).sort()) {
    if (!PRECOMPRESSED_EXTENSIONS.has(extname(file).toLowerCase())) continue;
    // One read, then the size of what was read: a stat before the read could
    // describe another version of the file than the one compressed.
    const content = await readFile(file);
    if (content.length < minBytes) continue;
    const gz = gzipSync(content, { level: constants.Z_BEST_COMPRESSION });
    if (gz.length >= content.length) continue;
    await writeFile(`${file}.gz`, gz);
    written.push(relative(dir, file).split(sep).join('/'));
    bytesBefore += content.length;
    bytesAfter += gz.length;
  }
  return { written, bytesBefore, bytesAfter };
};

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = resolve(process.argv[2] || join('dist', 'assets'));
  try {
    if (!(await stat(dir)).isDirectory()) throw new Error('not a directory');
  } catch {
    console.error(`[precompress] ${dir} is missing: run vite build first`);
    process.exit(1);
  }
  const { written, bytesBefore, bytesAfter } = await precompressAssets(dir);
  console.info(`[precompress] ${written.length} file(s): ${bytesBefore} → ${bytesAfter} bytes`);
}
