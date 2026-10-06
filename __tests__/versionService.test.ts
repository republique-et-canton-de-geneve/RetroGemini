import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHANGELOG_FILES, createVersionService } from '../server/services/versionService.js';

/**
 * The version service is what `/api/version` answers with, and its CHANGELOG
 * parser is what turns release notes into the in-app announcements. It had no
 * test at all, so a formatting change in `CHANGELOG.md` could silently empty
 * the announcement list.
 */

const dirs: string[] = [];

const makeRoot = (files: Record<string, string>) => {
  const dir = mkdtempSync(join(tmpdir(), 'version-service-'));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
};

afterEach(() => {
  while (dirs.length) {
    rmSync(dirs.pop()!, { recursive: true, force: true });
  }
  vi.restoreAllMocks();
});

describe('createVersionService', () => {
  it('reads the trimmed VERSION file', () => {
    const rootDir = makeRoot({ 'VERSION': '27.25\n' });

    expect(createVersionService({ rootDir }).getVersionInfo().current).toBe('27.25');
  });

  it('falls back to 1.0 when there is no VERSION file', () => {
    const rootDir = makeRoot({});

    expect(createVersionService({ rootDir }).getVersionInfo()).toEqual({
      current: '1.0',
      announcements: []
    });
  });

  it('maps every changelog section to its announcement type', () => {
    const rootDir = makeRoot({
      'VERSION': '3.0',
      'CHANGELOG.md': [
        '# Changelog',
        '',
        '## [3.0] - 2026-07-01',
        '',
        '### Added',
        '- Add a dark mode toggle',
        '',
        '## [2.0] - 2026-06-01',
        '',
        '### Changed',
        '- Improve the timer',
        '',
        '### Removed',
        '- Remove the legacy export',
        '',
        '## [1.5] - 2026-05-01',
        '',
        '### Fixed',
        '- Fix a sync bug',
        '',
        '### Security',
        '- Patch a hole',
        ''
      ].join('\n')
    });

    const { announcements } = createVersionService({ rootDir }).getVersionInfo();

    expect(announcements).toEqual([
      { version: '3.0', date: '2026-07-01', items: [{ type: 'feature', description: 'Add a dark mode toggle' }] },
      {
        version: '2.0',
        date: '2026-06-01',
        items: [
          { type: 'improvement', description: 'Improve the timer' },
          { type: 'removed', description: 'Remove the legacy export' }
        ]
      },
      {
        version: '1.5',
        date: '2026-05-01',
        items: [
          { type: 'fix', description: 'Fix a sync bug' },
          { type: 'security', description: 'Patch a hole' }
        ]
      }
    ]);
  });

  it('skips unknown sections, comments, rules and version blocks with no items', () => {
    const rootDir = makeRoot({
      'VERSION': '2.0',
      'CHANGELOG.md': [
        '## [2.0] - 2026-06-01',
        '',
        '### Deprecated',
        '- Something in a section the UI cannot render',
        '',
        '### Added',
        '- <!-- a hidden note -->',
        '- ---',
        '- A real feature',
        '',
        '## [Unreleased]',
        '',
        '### Added',
        '- Work in progress with no release date',
        ''
      ].join('\n')
    });

    const { announcements } = createVersionService({ rootDir }).getVersionInfo();

    // `[Unreleased]` has no `- YYYY-MM-DD` header, so it never reaches users.
    expect(announcements).toEqual([
      { version: '2.0', date: '2026-06-01', items: [{ type: 'feature', description: 'A real feature' }] }
    ]);
  });

  it('parses the repository CHANGELOG without dropping it', () => {
    // Guards the real file against a formatting change that would silently
    // empty the in-app announcements.
    const { current, announcements } = createVersionService({ rootDir: process.cwd() }).getVersionInfo();

    expect(current).toMatch(/^\d+\.\d+$/);
    expect(announcements.length).toBeGreaterThan(0);
    expect(announcements[0]).toMatchObject({
      version: expect.stringMatching(/^\d+\.\d+$/),
      date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/)
    });
  });

  it('serves a cached answer within the TTL and re-reads after it', () => {
    const rootDir = makeRoot({ 'VERSION': '1.0' });
    const service = createVersionService({ rootDir, cacheTtlMs: 60000 });

    expect(service.getVersionInfo().current).toBe('1.0');
    writeFileSync(join(rootDir, 'VERSION'), '2.0', 'utf8');
    expect(service.getVersionInfo().current).toBe('1.0');

    const later = Date.now() + 60001;
    vi.spyOn(Date, 'now').mockReturnValue(later);
    expect(service.getVersionInfo().current).toBe('2.0');
  });

  it('re-reads on the next tick when the TTL is zero', () => {
    const rootDir = makeRoot({ 'VERSION': '1.0' });
    const service = createVersionService({ rootDir, cacheTtlMs: 0 });
    // The staleness check is `elapsed > ttl`, so with a zero TTL two calls
    // inside the same millisecond still share one read; the clock is pinned
    // here so the assertion does not depend on how long the file write took.
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);

    expect(service.getVersionInfo().current).toBe('1.0');
    writeFileSync(join(rootDir, 'VERSION'), '2.0', 'utf8');

    expect(service.getVersionInfo().current).toBe('1.0');
    clock.mockReturnValue(now + 1);
    expect(service.getVersionInfo().current).toBe('2.0');
  });

  it('still answers when the files cannot be read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // A directory in place of VERSION makes readFileSync throw rather than
    // simply be absent — the catch branch, not the existsSync branch.
    const rootDir = makeRoot({});

    const service = createVersionService({ rootDir: join(rootDir, 'missing', 'deeper') });
    expect(service.getVersionInfo()).toEqual({ current: '1.0', announcements: [] });
    warn.mockRestore();
  });
});

/**
 * The French "What's New". `CHANGELOG.fr.md` mirrors `CHANGELOG.md` release for
 * release; the payload keeps the English items exactly where an older client
 * reads them (a rolling update serves both) and adds the French text beside
 * them, so a reader whose interface is French reads the release notes in
 * French and everyone else sees what they always saw.
 */
describe('createVersionService with a French changelog', () => {
  const ENGLISH = [
    '# Changelog',
    '',
    '## [3.0] - 2026-07-01',
    '',
    '### Added',
    '- Add a dark mode toggle',
    '',
    '## [2.0] - 2026-06-01',
    '',
    '### Changed',
    '- Improve the timer',
    '',
    '### Removed',
    '- Remove the legacy export',
    ''
  ].join('\n');

  const ENGLISH_ONLY = [
    { version: '3.0', date: '2026-07-01', items: [{ type: 'feature', description: 'Add a dark mode toggle' }] },
    {
      version: '2.0',
      date: '2026-06-01',
      items: [
        { type: 'improvement', description: 'Improve the timer' },
        { type: 'removed', description: 'Remove the legacy export' }
      ]
    }
  ];

  const announcementsOf = (files: Record<string, string>) =>
    createVersionService({ rootDir: makeRoot({ 'VERSION': '3.0', 'CHANGELOG.md': ENGLISH, ...files }) })
      .getVersionInfo().announcements;

  it('attaches the French items of the same release under localized.fr', () => {
    const announcements = announcementsOf({
      'CHANGELOG.fr.md': [
        '# Journal des modifications',
        '',
        '## [3.0] - 2026-07-01',
        '',
        // The section keywords stay English: they are keys, not prose.
        '### Added',
        '- Ajoute un mode sombre',
        '',
        '## [2.0] - 2026-06-01',
        '',
        '### Changed',
        '- Améliore le minuteur',
        '',
        '### Removed',
        '- Supprime l’ancien export',
        ''
      ].join('\n')
    });

    expect(announcements).toEqual([
      {
        ...ENGLISH_ONLY[0],
        localized: { fr: { items: [{ type: 'feature', description: 'Ajoute un mode sombre' }] } }
      },
      {
        ...ENGLISH_ONLY[1],
        localized: {
          fr: {
            items: [
              { type: 'improvement', description: 'Améliore le minuteur' },
              { type: 'removed', description: 'Supprime l’ancien export' }
            ]
          }
        }
      }
    ]);
  });

  it('applies French typography to the French text, and only to it', () => {
    const rootDir = makeRoot({
      'VERSION': '3.0',
      'CHANGELOG.md': [
        '## [3.0] - 2026-07-01',
        '',
        '### Added',
        '- Pick a language : English or French ; see https://retro.example:8443/help ?',
        ''
      ].join('\n'),
      'CHANGELOG.fr.md': [
        '## [3.0] - 2026-07-01',
        '',
        '### Added',
        '- Choisissez la langue : français ou anglais ; l’aide est sur https://retro.example:8443/aide ? Oui  !',
        '- Le bouton « Plus tard » repose la question à 10:30',
        ''
      ].join('\n')
    });

    const [release] = createVersionService({ rootDir }).getVersionInfo().announcements;

    // English is served exactly as written, odd spacing included.
    expect(release.items).toEqual([
      { type: 'feature', description: 'Pick a language : English or French ; see https://retro.example:8443/help ?' }
    ]);
    // A run of spaces before ? ! ; becomes one U+202F, before : one U+00A0, and
    // the space inside « » U+00A0 — so the mark never wraps onto a line of its
    // own. A colon with no space before it (a URL, a time) is not punctuation
    // spacing and is left alone.
    expect(release.localized.fr.items).toEqual([
      {
        type: 'feature',
        description:
          'Choisissez la langue : français ou anglais ; l’aide est sur https://retro.example:8443/aide ? Oui !'
      },
      { type: 'feature', description: 'Le bouton « Plus tard » repose la question à 10:30' }
    ]);
    for (const item of release.localized.fr.items) {
      // The rule i18nDictionaries.test.ts applies to every French message.
      expect(item.description).not.toMatch(/ [?!:;»]|« /);
    }
  });

  it('shows English alone for a release the French changelog does not cover', () => {
    const announcements = announcementsOf({
      'CHANGELOG.fr.md': ['## [3.0] - 2026-07-01', '', '### Added', '- Ajoute un mode sombre', ''].join('\n')
    });

    expect(announcements[0].localized).toEqual({ fr: { items: [{ type: 'feature', description: 'Ajoute un mode sombre' }] } });
    // Not an empty translation: no `localized` at all, so the client falls back.
    expect(announcements[1]).toEqual(ENGLISH_ONLY[1]);
    expect(announcements[1]).not.toHaveProperty('localized');
  });

  it('ignores a French release the English changelog does not list', () => {
    // English is the list of releases; a translation cannot add one.
    const announcements = announcementsOf({
      'CHANGELOG.fr.md': [
        '## [4.0] - 2026-08-01',
        '',
        '### Added',
        '- Une version qui n’existe pas en anglais',
        '',
        '## [3.0] - 2026-07-01',
        '',
        '### Added',
        '- Ajoute un mode sombre',
        ''
      ].join('\n')
    });

    expect(announcements.map((a: { version: string }) => a.version)).toEqual(['3.0', '2.0']);
    expect(JSON.stringify(announcements)).not.toContain('n’existe pas');
    expect(announcements[0].localized.fr.items).toEqual([{ type: 'feature', description: 'Ajoute un mode sombre' }]);
  });

  it('answers exactly as before when there is no French changelog', () => {
    expect(announcementsOf({})).toEqual(ENGLISH_ONLY);
  });

  it('leaves English intact when the French changelog is malformed', () => {
    const announcements = announcementsOf({
      'CHANGELOG.fr.md': [
        'Ceci n’est pas un journal des modifications.',
        '',
        '## [3.0] - date inconnue',
        '### Added',
        '- Une puce sous un en-tête sans date valide',
        '',
        // A translated section keyword is not a key the UI knows: the block
        // has no item, so the release is not "translated" into nothing.
        '## [2.0] - 2026-06-01',
        '### Modifié',
        '- Une puce sous un mot-clé traduit',
        ''
      ].join('\n')
    });

    expect(announcements).toEqual(ENGLISH_ONLY);
  });

  it('leaves English intact when the French changelog cannot be read', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const rootDir = makeRoot({ 'VERSION': '3.0', 'CHANGELOG.md': ENGLISH });
    // A directory in its place makes the read throw rather than find nothing.
    mkdirSync(join(rootDir, 'CHANGELOG.fr.md'));

    expect(createVersionService({ rootDir }).getVersionInfo()).toEqual({ current: '3.0', announcements: ENGLISH_ONLY });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('CHANGELOG.fr.md'), expect.anything());
  });

  it('ignores HTML comments in the French changelog', () => {
    const announcements = announcementsOf({
      'CHANGELOG.fr.md': [
        '## [3.0] - 2026-07-01',
        '',
        '### Added',
        '- Ajoute un mode sombre',
        '<!--',
        '- Note aux traducteurs : une seule puce par version',
        '-->',
        '',
        '---',
        '',
        // Like the guide at the end of CHANGELOG.md: a commented example that
        // names a real release must not become that release's translation.
        '<!--',
        'GUIDE DU FORMAT',
        '## [2.0] - 2026-06-01',
        '### Changed',
        '- Exemple de puce dans le guide',
        '-->',
        ''
      ].join('\n')
    });

    expect(announcements[0].localized).toEqual({ fr: { items: [{ type: 'feature', description: 'Ajoute un mode sombre' }] } });
    expect(announcements[1]).toEqual(ENGLISH_ONLY[1]);
  });

  it('ignores HTML comments in the English changelog the same way', () => {
    const rootDir = makeRoot({
      'CHANGELOG.md': [
        '## [2.0] - 2026-06-01',
        '',
        '### Added',
        '- A real feature',
        '<!--',
        '- A note to maintainers',
        '-->',
        ''
      ].join('\n')
    });

    expect(createVersionService({ rootDir }).getVersionInfo().announcements).toEqual([
      { version: '2.0', date: '2026-06-01', items: [{ type: 'feature', description: 'A real feature' }] }
    ]);
  });

  it('caches the French text with the rest of the answer', () => {
    const french = (text: string) => ['## [3.0] - 2026-07-01', '', '### Added', `- ${text}`, ''].join('\n');
    const rootDir = makeRoot({ 'VERSION': '3.0', 'CHANGELOG.md': ENGLISH, 'CHANGELOG.fr.md': french('Première version') });
    const service = createVersionService({ rootDir, cacheTtlMs: 60000 });
    const frenchOf = () => service.getVersionInfo().announcements[0].localized.fr.items[0].description;

    expect(frenchOf()).toBe('Première version');
    writeFileSync(join(rootDir, 'CHANGELOG.fr.md'), french('Seconde version'), 'utf8');
    expect(frenchOf()).toBe('Première version');

    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 60001);
    expect(frenchOf()).toBe('Seconde version');
  });
});

describe('the changelogs in the production image', () => {
  // The service reads them from the image at run time. `.dockerignore` drops
  // every `*.md` it does not re-include and the Dockerfile copies files one by
  // one, so a translation left out of either ships an image whose French
  // readers silently get English — no error, no failing request.
  const dockerfile = readFileSync(join(process.cwd(), 'Dockerfile'), 'utf8');
  const dockerignore = readFileSync(join(process.cwd(), '.dockerignore'), 'utf8').split('\n').map((line) => line.trim());

  it.each(CHANGELOG_FILES)('ships %s', (file: string) => {
    // A `COPY` whose source is missing fails `docker build`, so naming the
    // file in the Dockerfile proves nothing unless the file is really there.
    expect(existsSync(join(process.cwd(), file)), file).toBe(true);
    expect(dockerignore).toContain(`!${file}`);
    expect(dockerfile).toMatch(new RegExp(`^COPY .*\\b${file.replace(/\./g, '\\.')}\\b`, 'm'));
  });
});
