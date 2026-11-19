import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import LanguageProvider from '../i18n/LanguageProvider';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The language switch as the look (45.0) draws it: a segmented control, the
 * current language filled with the brand colour. It is on every screen, so
 * what a restyle must not lose is pinned here: each option's name in its own
 * language, starting with the code it shows (WCAG 2.5.3), its `lang`, its
 * pressed state, and colours that read in both states.
 */

afterEach(cleanup);

const renderSwitcher = (initialLanguage: 'en' | 'fr' = 'en') =>
  render(
    <LanguageProvider initialLanguage={initialLanguage}>
      <LanguageSwitcher />
    </LanguageProvider>
  );

describe('LanguageSwitcher', () => {
  it('names each option in its own language, marked with its lang', () => {
    renderSwitcher();
    const group = screen.getByRole('group', { name: 'Language' });
    const en = within(group).getByRole('button', { name: 'EN, English' });
    const fr = within(group).getByRole('button', { name: 'FR, Français' });
    expect(en).toHaveAttribute('lang', 'en');
    expect(fr).toHaveAttribute('lang', 'fr');
    expect(en).toHaveAttribute('aria-pressed', 'true');
    expect(fr).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('language-switcher')).toBe(group);
  });

  it('fills the current language and reads in both states', () => {
    renderSwitcher();
    const pressed = effectivePair(screen.getByRole('button', { name: 'EN, English' }));
    expect(pressed).toMatchObject({ fg: 'white', bg: 'indigo-600' });
    expect(pressed.ratio).toBeGreaterThanOrEqual(4.5);
    const other = effectivePair(screen.getByRole('button', { name: 'FR, Français' }));
    expect(other.bg).not.toBe('indigo-600');
    expect(other.ratio, `${other.fg} on ${other.bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('moves the fill with the choice', () => {
    renderSwitcher();
    fireEvent.click(screen.getByRole('button', { name: 'FR, Français' }));
    const fr = screen.getByRole('button', { name: 'FR, Français' });
    expect(fr).toHaveAttribute('aria-pressed', 'true');
    expect(effectivePair(fr).bg).toBe('indigo-600');
    expect(effectivePair(screen.getByRole('button', { name: 'EN, English' })).bg).not.toBe('indigo-600');
  });
});
