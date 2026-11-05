import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * `publiccode.yml` is the Swiss open-source catalogue's description of the
 * product. The release workflow publishes the version in `VERSION` whenever it
 * changes on `main`, so the catalogue must describe that very version
 * (AGENTS.md → *Version Management*), in English and in French alike.
 *
 * Read line by line rather than with a YAML parser: the repository declares
 * none, and the two facts pinned here sit on lines of a fixed shape.
 */

const root = resolve(__dirname, '..');
const publiccode = readFileSync(resolve(root, 'publiccode.yml'), 'utf8');
const version = readFileSync(resolve(root, 'VERSION'), 'utf8').trim();

/** The bullets of the `features:` list under `description.<language>`. */
const featuresOf = (language: 'en' | 'fr'): string[] => {
  const lines = publiccode.split('\n');
  const start = lines.findIndex((line) => line === `  ${language}:`);
  if (start < 0) throw new Error(`no description in ${language}`);
  const features = lines.findIndex((line, index) => index > start && line === '    features:');
  if (features < 0) throw new Error(`no features in ${language}`);
  const items: string[] = [];
  for (const line of lines.slice(features + 1)) {
    if (line.startsWith('      - ')) items.push(line.slice(8));
    else if (line.startsWith('        ') && items.length > 0) items[items.length - 1] += ` ${line.trim()}`;
    else break;
  }
  return items;
};

describe('publiccode.yml', () => {
  it('describes the version VERSION publishes', () => {
    const match = publiccode.match(/^softwareVersion: "([^"]+)"$/m);
    expect(match?.[1]).toBe(version);
  });

  it('lists as many features in French as in English, none empty', () => {
    const english = featuresOf('en');
    const french = featuresOf('fr');
    expect(english.length).toBeGreaterThan(0);
    expect(french).toHaveLength(english.length);
    for (const feature of [...english, ...french]) expect(feature.trim()).not.toBe('');
  });
});
