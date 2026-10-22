import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { precompressAssets, PRECOMPRESS_MIN_BYTES } from '../scripts/precompressAssets.mjs';

/**
 * `npm run build` writes a `.gz` beside each compressible file of the bundle
 * (synthesis item 9), so `server.js` serves it compressed with no CPU at
 * request time: about 1.07 MB of JS and CSS becomes about 268 KB on the wire
 * for a first visit.
 */

const ROOT = join(__dirname, '..');

const text = (bytes: number) => 'export const value = "retrogemini";\n'.repeat(Math.ceil(bytes / 36)).slice(0, bytes);

describe('precompressAssets', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'precompress-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('writes a .gz beside every .js and .css of at least 1 KiB, and it round-trips', async () => {
    writeFileSync(join(dir, 'index-AbCd1234.js'), text(8000));
    mkdirSync(join(dir, 'nested'));
    writeFileSync(join(dir, 'nested', 'style-Xy9z8w7v.css'), 'body { color: red; }\n'.repeat(200));

    const result = await precompressAssets(dir);

    expect(result.written.sort()).toEqual(['index-AbCd1234.js', 'nested/style-Xy9z8w7v.css']);
    for (const file of result.written) {
      const original = readFileSync(join(dir, file));
      expect(gunzipSync(readFileSync(join(dir, `${file}.gz`)))).toEqual(original);
    }
    expect(result.bytesAfter).toBeLessThan(result.bytesBefore);
  });

  it('skips what is too small, already compressed or not text', async () => {
    writeFileSync(join(dir, 'tiny.js'), text(PRECOMPRESS_MIN_BYTES - 1));
    writeFileSync(join(dir, 'cubes.png'), text(4000));
    writeFileSync(join(dir, 'font.woff2'), text(4000));
    writeFileSync(join(dir, 'alert.mp3'), text(4000));
    writeFileSync(join(dir, 'old.js.gz'), text(4000));

    const result = await precompressAssets(dir);

    expect(result.written).toEqual([]);
    expect(readdirSync(dir).sort()).toEqual(['alert.mp3', 'cubes.png', 'font.woff2', 'old.js.gz', 'tiny.js']);
  });

  it('skips a file whose gzip is not smaller', async () => {
    // Raw random bytes: base64 text would still gzip to about 75%.
    writeFileSync(join(dir, 'random-AbCd1234.js'), randomBytes(4096));

    const result = await precompressAssets(dir);

    expect(result.written).toEqual([]);
    expect(readdirSync(dir)).toEqual(['random-AbCd1234.js']);
  });

  it('is idempotent: a second run writes no .gz.gz and the same output', async () => {
    writeFileSync(join(dir, 'index-AbCd1234.js'), text(8000));
    await precompressAssets(dir);
    const first = readFileSync(join(dir, 'index-AbCd1234.js.gz'));

    const again = await precompressAssets(dir);

    expect(again.written).toEqual(['index-AbCd1234.js']);
    expect(readdirSync(dir).sort()).toEqual(['index-AbCd1234.js', 'index-AbCd1234.js.gz']);
    expect(readFileSync(join(dir, 'index-AbCd1234.js.gz'))).toEqual(first);
  });
});

describe('wired into the build', () => {
  it('runs after vite build in npm run build, which the Dockerfile and CI run', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts.build).toBe('vite build && node scripts/precompressAssets.mjs');
  });

  it('asks Vite for its manifest, without which nothing is served as immutable', () => {
    expect(readFileSync(join(ROOT, 'vite.config.ts'), 'utf8')).toMatch(/manifest:\s*true/);
  });
});
