import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';

/**
 * French readers see "What's New" in French, so every release written in
 * CHANGELOG.md needs its twin in CHANGELOG.fr.md. The modal falls back to the
 * English text for a release the French file lacks, so forgetting it breaks
 * nothing visibly — which is exactly why it has to fail here instead.
 *
 * The comparison is structural (version, date, section keyword, bullet count
 * and order); whether the French says what the English says is the reviewer's
 * job, but a bullet copied over in English is caught.
 */

type Release = { version: string; date: string; sections: Array<{ name: string; bullets: string[] }> };

const ROOT = join(__dirname, '..');

const parse = (file: string): Release[] => {
  const text = readFileSync(join(ROOT, file), 'utf8')
    .replace(/\r\n/g, '\n')
    .replace(/<!--[\s\S]*?-->/g, '');
  return text
    .split(/(?=^## \[)/m)
    .map((block) => {
      const header = block.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})/);
      if (!header) return null;
      const sections = block
        .split(/^### /m)
        .slice(1)
        .map((section) => {
          const [name, ...lines] = section.split('\n');
          const bullets = lines
            .map((line) => line.trim())
            .filter((line) => /^- \S/.test(line))
            .map((line) => line.slice(2).trim());
          return { name: name.trim(), bullets };
        });
      return { version: header[1], date: header[2], sections };
    })
    .filter((release): release is Release => release !== null);
};

const english = parse('CHANGELOG.md');
const french = parse('CHANGELOG.fr.md');
const frenchByVersion = new Map(french.map((release) => [release.version, release]));

describe('CHANGELOG.fr.md mirrors CHANGELOG.md', () => {
  it('reads both files', () => {
    expect(english.length).toBeGreaterThan(30);
    expect(french.length).toBeGreaterThan(0);
  });

  it('has a French twin for every English release, with the same date', () => {
    const missing = english.filter((release) => !frenchByVersion.has(release.version)).map((r) => r.version);
    expect(missing, 'releases with no French text in CHANGELOG.fr.md').toEqual([]);
    for (const release of english) {
      expect(frenchByVersion.get(release.version)?.date, release.version).toBe(release.date);
    }
  });

  it('names no release the English file does not have, and keeps its order', () => {
    expect(french.map((release) => release.version)).toEqual(english.map((release) => release.version));
  });

  it('keeps the section keywords and the number of bullets of each release', () => {
    for (const release of english) {
      const twin = frenchByVersion.get(release.version);
      expect(
        twin?.sections.map((section) => [section.name, section.bullets.length]),
        release.version
      ).toEqual(release.sections.map((section) => [section.name, section.bullets.length]));
    }
  });

  it('translates every bullet instead of copying the English one', () => {
    for (const release of english) {
      const twin = frenchByVersion.get(release.version);
      release.sections.forEach((section, s) => {
        section.bullets.forEach((bullet, b) => {
          const translated = twin?.sections[s]?.bullets[b] ?? '';
          expect(translated.trim(), `${release.version} ${section.name} #${b + 1}`).not.toBe('');
          expect(translated, `${release.version} ${section.name} #${b + 1}`).not.toBe(bullet);
        });
      });
    }
  });
});
