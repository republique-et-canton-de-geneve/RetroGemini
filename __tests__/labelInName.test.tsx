import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import LanguageProvider from '../i18n/LanguageProvider';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import { createTranslator } from '../i18n/translate';
import { SUPPORTED_LANGUAGES } from '../i18n/languages';
import type { Translator } from '../i18n/translate';
import { getGroupingAriaLabel, getGroupingButtonText } from '../components/session/groupingKeyboard';
import { getBrainstormMoveAriaLabel, getBrainstormMoveButtonText } from '../components/session/brainstormMove';

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

  // Every control of the board that shows words and carries a different
  // name, paired the way `Session.tsx` renders them. The e2e audit never holds
  // a card or opens the tips panel, so without this list these would ship
  // failing 2.5.3 behind a green audit.
  const boardPairs = (t: Translator): [string, string, string][] => {
    const name = 'Faster builds';
    return [
      ['Group: pick-up button', getGroupingButtonText({ hasSelection: false, isSelected: false }, t),
        getGroupingAriaLabel({ name, kind: 'ticket', hasSelection: false, isSelected: false }, t)],
      ['Group: card target while a card is held', getGroupingButtonText({ hasSelection: true, isSelected: false }, t),
        getGroupingAriaLabel({ name, kind: 'ticket', hasSelection: true, isSelected: false }, t)],
      ['Group: the held card', getGroupingButtonText({ hasSelection: true, isSelected: true }, t),
        getGroupingAriaLabel({ name, kind: 'ticket', hasSelection: true, isSelected: true }, t)],
      ['Group: group target', t('session.group.addSelectedCard'),
        getGroupingAriaLabel({ name, kind: 'group', hasSelection: true, isSelected: false }, t)],
      ['Group: column target', t('session.column.moveSelectedCardHere'),
        getGroupingAriaLabel({ name, kind: 'column', hasSelection: true, isSelected: false }, t)],
      ['Brainstorm: move a card', getBrainstormMoveButtonText({ target: 'item', isSelected: false }, t),
        getBrainstormMoveAriaLabel({ name, kind: 'ticket', heldKind: null, isSelected: false }, t)],
      ['Brainstorm: move a group', getBrainstormMoveButtonText({ target: 'item', isSelected: false }, t),
        getBrainstormMoveAriaLabel({ name, kind: 'group', heldKind: null, isSelected: false }, t)],
      ['Brainstorm: the held item', getBrainstormMoveButtonText({ target: 'item', isSelected: true }, t),
        getBrainstormMoveAriaLabel({ name, kind: 'ticket', heldKind: 'ticket', isSelected: true }, t)],
      ['Brainstorm: column target, card held', getBrainstormMoveButtonText({ target: 'column', isSelected: false }, t),
        getBrainstormMoveAriaLabel({ name, kind: 'column', heldKind: 'ticket', isSelected: false }, t)],
      ['Brainstorm: column target, group held', getBrainstormMoveButtonText({ target: 'column', isSelected: false }, t),
        getBrainstormMoveAriaLabel({ name, kind: 'column', heldKind: 'group', isSelected: false }, t)],
      ['Tips panel: hide', t('phases.tips.hide'), t('phases.tips.closePanel')]
    ];
  };

  it.each(SUPPORTED_LANGUAGES)('every board control carries the words it shows (%s)', (language) => {
    const failures = boardPairs(createTranslator(language))
      .filter(([, visible, name]) => !containsLabel(visible, name))
      .map(([control, visible, name]) => `${control}: "${visible}" not in "${name}"`);
    expect(failures).toEqual([]);
  });

  // The Jira controls name the action they act on after the words they show
  // ("Create in Jira, Speed up the build"), so a list of them stays apart. Each
  // pair is the visible text and the name `components/jira/` renders together.
  const jiraPairs = (t: Translator): [string, string, string][] => {
    const text = 'Speed up the build';
    const key = 'TEAM-12';
    return [
      ['Jira: create one action', t('jira.create'), t('jira.action.createLabel', { text })],
      ['Jira: sending', t('jira.creating'), t('jira.action.creatingLabel', { text })],
      ['Jira: the issue link', key, t('jira.action.openLabel', { key })],
      ['Jira: check an uncertain creation', t('jira.action.check'), t('jira.action.checkLabel', { text })],
      ['Jira: create anyway', t('jira.action.createAnyway'), t('jira.action.createAnywayLabel', { text })],
      ['Jira: confirm create anyway', t('jira.action.confirmForceYes'), t('jira.action.confirmForceYesLabel', { text })]
    ];
  };

  it.each(SUPPORTED_LANGUAGES)('every Jira control carries the words it shows (%s)', (language) => {
    const failures = jiraPairs(createTranslator(language))
      .filter(([, visible, name]) => !containsLabel(visible, name))
      .map(([control, visible, name]) => `${control}: "${visible}" not in "${name}"`);
    expect(failures).toEqual([]);
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
