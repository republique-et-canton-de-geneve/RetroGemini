import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createVersionService } from '../server/services/versionService.js';

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
