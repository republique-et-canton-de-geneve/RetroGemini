import { describe, expect, it } from 'vitest';
import { createHash } from 'crypto';
import {
  escapeHtml,
  sanitizeEmailLink,
  secureCompare,
  hashResetToken,
  pruneResetTokens
} from '../server/services/security.js';

/**
 * Behavioural coverage for `server/services/security.js` (audit H8.2).
 *
 * These are the primitives the mail and password-reset paths lean on — HTML
 * escaping for user-controlled text placed into emails, protocol filtering for
 * links, constant-time comparison for credentials, and reset-token hashing +
 * expiry pruning. The module measured **0%** because the file named
 * `security.test.ts` actually tested the frontend `dataService`.
 *
 * Note on scope: `sanitizeEmailLink` validates the *protocol only* — it does
 * not constrain the host, and it is not meant to. H4 (the open-host hole) is
 * closed one layer up, in `server/services/publicOrigin.js`, which rebuilds a
 * mailed link on this deployment's own origin before it reaches this sanitiser.
 * Its regression guard is `__tests__/publicOriginLinks.test.ts`.
 */

describe('escapeHtml', () => {
  it('escapes every character that could break out of an HTML context', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });

  it('neutralises an injected script tag in a user-supplied name', () => {
    const escaped = escapeHtml('<script>alert(1)</script>');

    expect(escaped).not.toContain('<script>');
    expect(escaped).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('escapes in a single pass, so nothing is double-escaped', () => {
    // Text that already looks like an entity must be escaped exactly once:
    // literal `&lt;` becomes `&amp;lt;` and renders as `&lt;`. A sequential
    // chain of replaces (`<` before `&`) would escape its own output and
    // corrupt every previously escaped character.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
    expect(escapeHtml('<')).toBe('&lt;');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeHtml('Sprint 42 retro')).toBe('Sprint 42 retro');
  });

  it('coerces non-string input instead of throwing', () => {
    expect(escapeHtml(undefined)).toBe('');
    expect(escapeHtml(42 as unknown as string)).toBe('42');
    expect(escapeHtml(null as unknown as string)).toBe('null');
  });
});

describe('sanitizeEmailLink', () => {
  it('accepts http and https links', () => {
    expect(sanitizeEmailLink('https://retro.example/join/abc')).toBe(
      'https://retro.example/join/abc'
    );
    expect(sanitizeEmailLink('http://retro.example/join/abc')).toBe(
      'http://retro.example/join/abc'
    );
  });

  it('rejects javascript: and data: URLs', () => {
    // Assembled rather than written as a literal: ESLint's `no-script-url`
    // rejects a literal `javascript:` URL, and adding a suppression to a
    // security test reads worse than joining the two halves here.
    const scriptUrl = ['javascript', 'alert(1)'].join(':');

    expect(sanitizeEmailLink(scriptUrl)).toBe('');
    expect(sanitizeEmailLink('data:text/html,<script>alert(1)</script>')).toBe('');
  });

  it('rejects other non-web protocols', () => {
    expect(sanitizeEmailLink('file:///etc/passwd')).toBe('');
    expect(sanitizeEmailLink('ftp://example.com/x')).toBe('');
  });

  it('rejects an unparseable URL instead of throwing', () => {
    expect(sanitizeEmailLink('not a url')).toBe('');
    expect(sanitizeEmailLink('//host/path')).toBe('');
  });

  it('returns an empty string for empty input', () => {
    expect(sanitizeEmailLink('')).toBe('');
    expect(sanitizeEmailLink(undefined)).toBe('');
    expect(sanitizeEmailLink(null)).toBe('');
  });

  it('normalises the URL it returns', () => {
    // `new URL().toString()` appends the root path — callers must not assume
    // the string comes back byte-identical.
    expect(sanitizeEmailLink('https://retro.example')).toBe('https://retro.example/');
  });

  it('accepts any host by design — the host policy lives in publicOrigin.js (audit H4)', () => {
    // This function is the *protocol* guard that stands between a URL and an
    // HTML attribute, and that is all it is. H4 is closed, but not here: a
    // mailed link's origin is now decided by `createPublicOriginResolver`
    // before it ever reaches this sanitiser (see `publicOriginLinks.test.ts`).
    // Teaching this function about hosts would put the same rule in two places
    // and leave the weaker one to rot.
    expect(sanitizeEmailLink('https://evil.example/reset')).toBe(
      'https://evil.example/reset'
    );
  });
});

describe('secureCompare', () => {
  it('returns true for identical strings', () => {
    expect(secureCompare('s3cr3t-token', 's3cr3t-token')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(secureCompare('s3cr3t-token', 's3cr3t-tokeN')).toBe(false);
  });

  it('returns false for different lengths without throwing', () => {
    // `timingSafeEqual` throws on length mismatch, so the guard must handle
    // it — a throw here would surface as a 500 on every wrong-length password.
    expect(secureCompare('short', 'a-much-longer-secret')).toBe(false);
    expect(secureCompare('a-much-longer-secret', 'short')).toBe(false);
  });

  it('returns false for non-string input', () => {
    expect(secureCompare(undefined, 'x')).toBe(false);
    expect(secureCompare('x', undefined)).toBe(false);
    expect(secureCompare(null, null)).toBe(false);
    expect(secureCompare(1234 as unknown as string, 1234 as unknown as string)).toBe(false);
  });

  it('compares two empty strings as equal', () => {
    expect(secureCompare('', '')).toBe(true);
  });

  it('compares by bytes, not by code units', () => {
    // Multi-byte characters must not confuse the length guard.
    expect(secureCompare('café', 'café')).toBe(true);
    expect(secureCompare('café', 'cafe')).toBe(false);
  });
});

describe('hashResetToken', () => {
  it('produces the SHA-256 hex digest of the token', () => {
    const token = 'reset-token-value';

    expect(hashResetToken(token)).toBe(
      createHash('sha256').update(token).digest('hex')
    );
  });

  it('is deterministic and never returns the token itself', () => {
    const token = 'reset-token-value';
    const hash = hashResetToken(token);

    expect(hashResetToken(token)).toBe(hash);
    expect(hash).not.toBe(token);
    expect(hash).toHaveLength(64);
  });

  it('produces different digests for different tokens', () => {
    expect(hashResetToken('token-a')).not.toBe(hashResetToken('token-b'));
  });
});

describe('pruneResetTokens', () => {
  it('drops expired entries and keeps live ones', () => {
    const now = Date.now();
    const live = { tokenHash: 'a', expiresAt: now + 60_000 };
    const expired = { tokenHash: 'b', expiresAt: now - 1 };

    expect(pruneResetTokens([live, expired])).toEqual([live]);
  });

  it('drops an entry that expires exactly now (strict comparison)', () => {
    const now = Date.now();

    expect(pruneResetTokens([{ tokenHash: 'a', expiresAt: now }])).toEqual([]);
  });

  it('returns an empty array for missing input', () => {
    expect(pruneResetTokens(undefined)).toEqual([]);
    expect(pruneResetTokens(null)).toEqual([]);
    expect(pruneResetTokens([])).toEqual([]);
  });

  it('does not mutate the array it was given', () => {
    const tokens = [{ tokenHash: 'b', expiresAt: Date.now() - 1 }];

    pruneResetTokens(tokens);

    expect(tokens).toHaveLength(1);
  });
});
