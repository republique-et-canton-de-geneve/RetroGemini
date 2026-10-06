import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import { createVersionService, parseChangelog } from '../server/services/versionService.js';

/**
 * French readers see "What's New" in French, so every release written in
 * CHANGELOG.md needs its twin in CHANGELOG.fr.md. The modal falls back to the
 * English text for a release the French file lacks, so forgetting it breaks
 * nothing visibly — which is exactly why it has to fail here instead.
 *
 * It goes through the server's own parser on the repository's real files: a
 * version typo, a translated "### Ajouté" or a missing bullet would otherwise
 * show English to French readers with no error anywhere. Whether the French
 * says what the English says is the reviewer's job, but a bullet copied over
 * in English is caught.
 */

type Item = { type: string; description: string };
type Announcement = { version: string; date: string; items: Item[]; localized?: { fr?: { items: Item[] } } };

const ROOT = join(__dirname, '..');
const { announcements } = createVersionService({ rootDir: ROOT, cacheTtlMs: 0 }).getVersionInfo() as {
  announcements: Announcement[];
};
const frenchBlocks = parseChangelog(readFileSync(join(ROOT, 'CHANGELOG.fr.md'), 'utf8'), { language: 'fr' }) as Array<{
  version: string;
  date: string;
}>;

describe('CHANGELOG.fr.md mirrors CHANGELOG.md', () => {
  it('reads every release of the English file', () => {
    expect(announcements.length).toBeGreaterThan(30);
  });

  it('lists exactly the English releases, in order, with the same dates', () => {
    expect(frenchBlocks.map((block) => `${block.version} ${block.date}`)).toEqual(
      announcements.map((announcement) => `${announcement.version} ${announcement.date}`)
    );
  });

  it('gives every release its French items, of the same types and number', () => {
    const types = (items: Item[]) => items.map((item) => item.type);
    for (const announcement of announcements) {
      expect(announcement.localized?.fr, announcement.version).toBeDefined();
      expect(types(announcement.localized!.fr!.items), announcement.version).toEqual(types(announcement.items));
    }
  });

  it('translates every bullet instead of copying the English one', () => {
    for (const announcement of announcements) {
      announcement.items.forEach((item, index) => {
        const french = announcement.localized?.fr?.items[index]?.description ?? '';
        expect(french.trim(), `${announcement.version} #${index + 1}`).not.toBe('');
        expect(french, `${announcement.version} #${index + 1}`).not.toBe(item.description);
      });
    }
  });
});
