import fs from 'fs';
import { join } from 'path';

/**
 * Section headings are machine keys, not prose: `CHANGELOG.fr.md` keeps the
 * English `### Added` / `### Changed` / … so both files map onto the same
 * announcement types.
 */
const SECTION_TYPES = {
  Added: 'feature',
  Changed: 'improvement',
  Fixed: 'fix',
  Removed: 'removed',
  Security: 'security'
};

/**
 * French spacing before punctuation, applied by the parser so a translator
 * types an ordinary space and the reader still never sees "!" or "»" wrap onto
 * a line of its own — the rule the interface dictionaries follow (U+202F before
 * ? ! ;, U+00A0 before : and inside « »). Only an existing run of spaces is
 * replaced: a colon with nothing before it (a URL, a time) is left alone.
 */
const frenchTypography = (text) => text
  .replace(/ +([?!;])/g, ' $1')
  .replace(/ +:/g, ' :')
  .replace(/« +/g, '« ')
  .replace(/ +»/g, ' »');

const TYPOGRAPHY = { fr: frenchTypography };

const asWritten = (text) => text;

const COMMENT_OPEN = '<!--';
const COMMENT_CLOSE = '-->';

/**
 * Removes every HTML comment. A scan, not a regex pass: one pass of
 * `/<!--[\s\S]*?-->/` turns `<!<!---->--` back into `<!--`, so what it leaves
 * can still open a comment. Here the output never contains `<!--` at all.
 *
 * An opener with no closer hides the rest of its own line only: a forgotten
 * `-->` must not swallow every release below it and silently empty the list.
 * A `-->` that comes only after another `<!--` is that other comment's closer
 * (both files end with a closed maintainer guide), so it does not count.
 */
const stripHtmlComments = (text) => {
  let result = '';
  let rest = text;
  for (;;) {
    const open = rest.indexOf(COMMENT_OPEN);
    if (open === -1) return result + rest;
    result += rest.slice(0, open);
    const close = rest.indexOf(COMMENT_CLOSE, open + COMMENT_OPEN.length);
    const nextOpen = rest.indexOf(COMMENT_OPEN, open + COMMENT_OPEN.length);
    if (close !== -1 && (nextOpen === -1 || close < nextOpen)) {
      rest = rest.slice(close + COMMENT_CLOSE.length);
    } else {
      const lineEnd = rest.indexOf('\n', open);
      rest = lineEnd === -1 ? '' : rest.slice(lineEnd);
    }
    // Removing a span can join `<!` and `--` across it, so the last few
    // characters kept are scanned again with what follows. Each turn removes
    // at least four characters and gives back at most three: it terminates.
    const carry = result.slice(-(COMMENT_OPEN.length - 1));
    result = result.slice(0, result.length - carry.length);
    rest = carry + rest;
  }
};

/**
 * One changelog file → its dated releases, in file order. Used for
 * `CHANGELOG.md` and for every translation, so the files cannot drift apart in
 * what they accept.
 *
 * HTML comments are removed first: both files end with a maintainer guide whose
 * examples look like releases, and a bullet inside a comment is a note, not an
 * announcement. A block with no `- YYYY-MM-DD` date (`[Unreleased]`, the
 * guide's `[X.Y]`) or no recognised item is dropped.
 */
const parseChangelog = (content, { language = 'en' } = {}) => {
  const typography = TYPOGRAPHY[language] ?? asWritten;
  const releases = [];
  const uncommented = stripHtmlComments(content);
  const versionBlocks = uncommented.split(/(?=^## \[)/m).filter((block) => block.trim());

  for (const block of versionBlocks) {
    const headerMatch = block.match(/^## \[([^\]]+)\] - (\d{4}-\d{2}-\d{2})/);
    if (!headerMatch) continue;

    const version = headerMatch[1];
    const date = headerMatch[2];
    const items = [];

    const sections = block.split(/^### /m).slice(1);
    for (const section of sections) {
      const lines = section.split('\n');
      const type = SECTION_TYPES[lines[0].trim()];
      if (!type) continue;

      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.startsWith('-') && !line.match(/^-+$/)) {
          const description = line.substring(1).trim();
          if (description && !description.match(/^-+$/)) {
            items.push({ type, description: typography(description) });
          }
        }
      }
    }

    if (items.length > 0) {
      releases.push({ version, date, items });
    }
  }

  return releases;
};

/**
 * Translated release notes, one file per interface language other than
 * English. `CHANGELOG.md` is the list of releases; a translation only ever adds
 * text to a release that list already has.
 */
const TRANSLATIONS = [{ language: 'fr', file: 'CHANGELOG.fr.md' }];

/** Every file the service reads at run time, so the image must ship them all. */
const CHANGELOG_FILES = ['CHANGELOG.md', ...TRANSLATIONS.map(({ file }) => file)];

const createVersionService = ({ rootDir, cacheTtlMs } = {}) => {
  const resolvedTtl = typeof cacheTtlMs === 'number'
    ? cacheTtlMs
    : (process.env.NODE_ENV === 'production' ? 60000 : 0);

  let cachedVersionInfo = null;
  let versionCacheTime = 0;

  /** version → translated items; empty when the file is absent or unreadable. */
  const readTranslation = ({ language, file }) => {
    const byVersion = new Map();
    try {
      const path = join(rootDir, file);
      if (!fs.existsSync(path)) return byVersion;
      for (const release of parseChangelog(fs.readFileSync(path, 'utf8'), { language })) {
        // The first block wins, as the newest release sits at the top.
        if (!byVersion.has(release.version)) byVersion.set(release.version, release.items);
      }
    } catch (err) {
      // A broken translation must never cost the English announcements.
      console.warn(`[Server] Failed to parse ${file}:`, err?.message);
      byVersion.clear();
    }
    return byVersion;
  };

  const parseVersionAndChangelog = () => {
    let currentVersion = '1.0';
    let announcements = [];

    try {
      const versionPath = join(rootDir, 'VERSION');
      if (fs.existsSync(versionPath)) {
        currentVersion = fs.readFileSync(versionPath, 'utf8').trim();
      }
    } catch (err) {
      console.warn('[Server] Failed to read VERSION file:', err?.message);
    }

    try {
      const changelogPath = join(rootDir, 'CHANGELOG.md');
      if (fs.existsSync(changelogPath)) {
        announcements = parseChangelog(fs.readFileSync(changelogPath, 'utf8'));
      }
    } catch (err) {
      console.warn('[Server] Failed to parse CHANGELOG.md:', err?.message);
    }

    if (announcements.length > 0) {
      for (const translation of TRANSLATIONS) {
        const translated = readTranslation(translation);
        for (const announcement of announcements) {
          const items = translated.get(announcement.version);
          if (!items) continue;
          // `items` stays the English text an older client reads during a
          // rolling update; the translation rides beside it.
          announcement.localized = { ...announcement.localized, [translation.language]: { items } };
        }
      }
    }

    return { current: currentVersion, announcements };
  };

  const getVersionInfo = () => {
    const now = Date.now();
    if (!cachedVersionInfo || (now - versionCacheTime) > resolvedTtl) {
      cachedVersionInfo = parseVersionAndChangelog();
      versionCacheTime = now;
    }
    return cachedVersionInfo;
  };

  return { getVersionInfo };
};

export { CHANGELOG_FILES, createVersionService, parseChangelog };
