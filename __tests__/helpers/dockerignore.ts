import { posix } from 'path';

/**
 * What `docker build` leaves out of its build context, read from a
 * `.dockerignore` exactly as Docker reads it: a port, for POSIX paths, of
 * `github.com/moby/patternmatcher` v0.6.0 — `ignorefile.ReadAll`, which turns
 * the file into patterns, and `PatternMatcher.MatchesOrParentMatches`, which
 * BuildKit and the Docker CLI ask for every path of the context.
 *
 * A test asks this, not the file's text, because the file's text misleads:
 * every pattern is anchored at the context's root (`*.md` leaves out the
 * root's Markdown files and no other, `node_modules` the root's directory
 * alone), the last pattern that matches decides (so `!CHANGELOG.md` keeps the
 * file only when it comes after `*.md`), and a directory left out takes
 * everything under it. The port's answers were compared with the real
 * matcher's, path by path, when it was written.
 */

/** Go's `filepath.Clean` on a slash path: Node's `normalize`, less a trailing slash. */
const clean = (path: string): string => {
  const normalized = posix.normalize(path);
  return normalized.length > 1 && normalized.endsWith('/') ? normalized.slice(0, -1) : normalized;
};

/** `ignorefile.ReadAll`: one pattern per line, `!` kept in front. */
const readPatterns = (source: string): string[] => {
  const patterns: string[] = [];
  source.split('\n').forEach((rawLine, index) => {
    // bufio.ScanLines drops a line's `\r`; the BOM is stripped from the first line.
    let line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (index === 0) line = line.replace(/^\uFEFF/, '');
    // A comment is a `#` in the first column, before the line is trimmed.
    if (line.startsWith('#')) return;
    let pattern = line.trim();
    if (pattern === '') return;
    const invert = pattern.startsWith('!');
    if (invert) pattern = pattern.slice(1).trim();
    if (pattern.length > 0) {
      pattern = clean(pattern);
      if (pattern.length > 1 && pattern.startsWith('/')) pattern = pattern.slice(1);
    }
    patterns.push(invert ? `!${pattern}` : pattern);
  });
  return patterns;
};

type Pattern = { exclusion: boolean; match: (path: string) => boolean };

/** `Pattern.compile` and `Pattern.match`: the four kinds of match Docker tells apart. */
const compile = (rawPattern: string): Pattern => {
  let cleaned = clean(rawPattern.trim());
  const exclusion = cleaned.startsWith('!');
  if (exclusion) cleaned = cleaned.slice(1);

  let kind: 'exact' | 'prefix' | 'suffix' | 'regexp' = 'exact';
  let source = '^';
  const chars = [...cleaned];
  for (let at = 0, step = 0; at < chars.length; step += 1) {
    const char = chars[at++];
    if (char === '*') {
      if (chars[at] === '*') {
        at += 1;
        if (chars[at] === '/') at += 1; // `**/` reads as `**`
        if (at >= chars.length) {
          // A trailing `**` takes everything below.
          if (kind === 'exact') kind = 'prefix';
          else {
            source += '.*';
            kind = 'regexp';
          }
        } else {
          source += '(.*/)?';
          kind = 'regexp';
        }
        if (step === 0) kind = 'suffix';
      } else {
        source += '[^/]*';
        kind = 'regexp';
      }
    } else if (char === '?') {
      source += '[^/]';
      kind = 'regexp';
    } else if ('.+()|{}$'.includes(char)) {
      source += `\\${char}`;
    } else if (char === '\\') {
      if (at < chars.length) {
        source += `\\${chars[at++]}`;
        kind = 'regexp';
      } else {
        source += '\\'; // as Go does: it then escapes the closing `$`
      }
    } else if (char === '[' || char === ']') {
      source += char;
      kind = 'regexp';
    } else {
      source += char;
    }
  }

  if (kind === 'exact') return { exclusion, match: (path) => path === cleaned };
  if (kind === 'prefix') return { exclusion, match: (path) => path.startsWith(cleaned.slice(0, -2)) };
  if (kind === 'suffix') {
    const suffix = cleaned.slice(2);
    return {
      exclusion,
      match: (path) => path.endsWith(suffix) || (suffix.startsWith('/') && path === suffix.slice(1)),
    };
  }
  const regexp = new RegExp(`${source}$`);
  return { exclusion, match: (path) => regexp.test(path) };
};

/**
 * A predicate answering, for a path relative to the context's root (no
 * leading `./`), whether `docker build` leaves it out of the build context.
 */
export const dockerContextExcludes = (dockerignore: string): ((path: string) => boolean) => {
  const patterns = readPatterns(dockerignore).map(compile);
  return (file: string) => {
    const parentPath = posix.dirname(file);
    const parentDirs = parentPath.split('/');
    let matched = false;
    for (const pattern of patterns) {
      // An inclusion is not asked again once the path is left out, nor an
      // exception before it is.
      if (pattern.exclusion !== matched) continue;
      let match = pattern.match(file);
      if (!match && parentPath !== '.') {
        for (let depth = 1; depth <= parentDirs.length && !match; depth += 1) {
          match = pattern.match(parentDirs.slice(0, depth).join('/'));
        }
      }
      if (match) matched = !pattern.exclusion;
    }
    return matched;
  };
};
