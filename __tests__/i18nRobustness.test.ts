import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  getCustomTemplateStarterColumns,
  getDefaultRetroName,
  getRetroTemplateColumns,
  getRetroTemplateWords,
  initialTemplateLanguage
} from '../i18n/content/retroTemplates';
import {
  ICEBREAKER_QUESTIONS,
  getDefaultIcebreaker,
  getRandomIcebreaker,
  localizeIcebreaker
} from '../i18n/content/icebreakers';
import { intlLocaleFor, toLanguage } from '../i18n/languages';
import { createTranslator, interpolate } from '../i18n/translate';
import { translateErrorMessage } from '../i18n/errorMessages';
import { localizeDecimal } from '../i18n/formatNumber';
import errorsEn from '../i18n/locales/en/errors';
import type { Language } from '../i18n/languages';

/**
 * Values that cross a trust or version boundary before they reach the i18n
 * layer. A template language is read back from persisted retros — written by a
 * newer pod during a rolling update or rollback, or posted directly by anyone
 * holding a team credential — and a locale tag comes from the browser. Neither
 * may take the page down: the app has no error boundary, so a throw during the
 * dashboard's first render blanks it for the whole team.
 */

const UNKNOWN = ['de', '', 'constructor', '__proto__', 'toString'] as unknown as Language[];

describe('a template language this build does not know', () => {
  it.each(UNKNOWN)('falls back instead of throwing for %j', (bad) => {
    expect(() => getRetroTemplateColumns('start_stop_continue', bad)).not.toThrow();
    expect(getRetroTemplateColumns('start_stop_continue', bad).map(c => c.title)).toEqual(['Start', 'Stop', 'Continue']);
    expect(getRetroTemplateWords('kalm', bad).name).toBe('KALM');
    expect(getCustomTemplateStarterColumns(bad).map(c => c.title)).toEqual(['Start', 'Stop']);
    expect(getDefaultRetroName(bad, new Date(2026, 9, 6))).toMatch(/^Retrospective /);
    expect(getDefaultIcebreaker(bad)).toBe(ICEBREAKER_QUESTIONS.en[0]);
    expect(ICEBREAKER_QUESTIONS.en).toContain(getRandomIcebreaker(bad));
    expect(localizeIcebreaker(ICEBREAKER_QUESTIONS.fr[2], bad)).toBe(ICEBREAKER_QUESTIONS.en[2]);
  });

  it('opens the dialog on the interface language when the stored one is unknown', () => {
    for (const bad of UNKNOWN) {
      expect(initialTemplateLanguage({ templateLanguage: bad }, 'fr')).toBe('fr');
    }
  });

  it('reads a retro from before the feature as English, like the session does', () => {
    // Every retro created before templates were bilingual was English; a team
    // that ran them keeps getting English proposed whoever facilitates.
    expect(initialTemplateLanguage({}, 'fr')).toBe('en');
    // Only a team with no retro at all starts in the interface language.
    expect(initialTemplateLanguage(undefined, 'fr')).toBe('fr');
  });

  it('narrows any value to a supported language', () => {
    expect(toLanguage('fr', 'en')).toBe('fr');
    expect(toLanguage('de', 'en')).toBe('en');
    expect(toLanguage(undefined, 'fr')).toBe('fr');
    expect(toLanguage({}, 'en')).toBe('en');
  });
});

describe('browser locale tags', () => {
  it('canonicalises an underscore tag instead of handing it to Intl', () => {
    const locale = intlLocaleFor('fr', ['fr_CH']);
    expect(locale).toBe('fr-CH');
    expect(() => localizeDecimal('3.5', locale)).not.toThrow();
    expect(() => new Date().toLocaleDateString(locale)).not.toThrow();
  });

  it('skips a tag Intl cannot parse and falls back', () => {
    const locale = intlLocaleFor('fr', ['fr-!!', 'en-US']);
    expect(locale).toBe('fr-CH');
    expect(() => localizeDecimal('3.5', locale)).not.toThrow();
  });
});

describe('user text inside translated sentences', () => {
  it('is inserted exactly as written, even when it looks like a pattern', () => {
    // A replacement *string* would expand $& and $1; ticket text and team names
    // reach these placeholders, so the replacer must stay a function.
    expect(interpolate('Move {label} now', { label: "$& $1 $' {label} {other}" }))
      .toBe("Move $& $1 $' {label} {other} now");
  });
});

describe('errors shown to the user', () => {
  const en = createTranslator('en');
  const fr = createTranslator('fr');

  it('shows every English data-layer sentence unchanged', () => {
    for (const message of Object.values(errorsEn).filter(m => !m.includes('{'))) {
      expect(translateErrorMessage(message, en), message).toBe(message);
    }
  });

  it('never shows a raw server code the login and team-creation routes can return', () => {
    for (const code of ['login_failed', 'failed_to_create', 'unknown_error', 'too_many_attempts', 'team_name_exists', 'team_not_found', 'invalid_password']) {
      expect(translateErrorMessage(code, en), code).not.toBe(code);
      expect(translateErrorMessage(code, fr), code).not.toBe(code);
    }
  });

  it('translates every literal message services/dataService.ts throws', () => {
    // The data layer's English sentences are the lookup keys of
    // i18n/errorMessages.ts: rewording or adding a throw without a matching
    // entry would silently put English back on French screens.
    const source = readFileSync(join(__dirname, '..', 'services', 'dataService.ts'), 'utf8');
    const thrown = [...source.matchAll(/new (?:InviteAutoJoin)?Error\(\s*'((?:[^'\\]|\\.)*)'\s*\)/g)].map(m => m[1]);
    expect(thrown.length).toBeGreaterThan(15);
    for (const message of thrown) {
      expect(translateErrorMessage(message, fr), message).not.toBe(message);
    }
  });
});
