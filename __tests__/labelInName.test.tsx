import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LanguageProvider from '../i18n/LanguageProvider';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import { createTranslator } from '../i18n/translate';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';

/**
 * WCAG 2.5.3 Label in Name — **a control whose name differs from its visible
 * text must contain that text, as words.** A voice-control user says what they
 * see ("click FR", "click 7:00"); a name that does not hold those words gives
 * them nothing to say.
 *
 * axe-core 4.14 turned `label-content-name-mismatch` on by default and made it
 * stricter, and the e2e audit went red on every screen: the switcher was named
 * "English"/"Français" over a visible "EN"/"FR", and the timer "Set the timer
 * (7:00)" over a visible "7:00". `containsLabel` is the rule as 4.14 applies it
 * — parentheticals are dropped from both sides, punctuation becomes a space,
 * and the visible words must appear as a contiguous run of the name's words —
 * which is why the time inside parentheses did not count.
 *
 * Unit-level on purpose: the e2e audit only walks a stopped timer, so the
 * alarm's name ("Time is up (0:00)…" had the same flaw) would otherwise be
 * guarded by nothing.
 */

const words = (text: string): string[] => {
  let out = text.normalize('NFKD').toLowerCase();
  let previous;
  do {
    previous = out;
    out = out.replace(/\([^()]*\)/g, '');
  } while (out !== previous);
  return out.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
};

const containsLabel = (visible: string, name: string): boolean => {
  const label = words(visible);
  const haystack = words(name);
  if (label.length === 0) return true;
  for (let start = 0; start + label.length <= haystack.length; start++) {
    if (label.every((word, offset) => haystack[start + offset] === word)) return true;
  }
  return false;
};

describe('label in name (WCAG 2.5.3)', () => {
  it('the helper reproduces the cases axe-core 4.14 reported', () => {
    expect(containsLabel('7:00', 'Set the timer (7:00)')).toBe(false);
    expect(containsLabel('en', 'English')).toBe(false);
    expect(containsLabel('7:00', '7:00, set the timer')).toBe(true);
    expect(containsLabel('fr', 'FR, Français')).toBe(true);
  });

  it.each(SUPPORTED_LANGUAGES)('the timer names carry the time they show (%s)', (language) => {
    const t = createTranslator(language);
    for (const time of ['0:00', '7:00', '99:59']) {
      expect(containsLabel(time, t('phases.timer.set', { time }))).toBe(true);
      expect(containsLabel(time, t('phases.timer.acknowledge', { time }))).toBe(true);
    }
  });

  it.each(SUPPORTED_LANGUAGES)('each language button is named with the code it shows (%s screen)', (language) => {
    render(
      <LanguageProvider initialLanguage={language}>
        <LanguageSwitcher />
      </LanguageProvider>,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(SUPPORTED_LANGUAGES.length);
    for (const button of buttons) {
      const name = button.getAttribute('aria-label') ?? '';
      expect(containsLabel(button.textContent ?? '', name), `${button.textContent} in "${name}"`).toBe(true);
    }
  });
});
