import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IcebreakerPhase from '../components/session/IcebreakerPhase';
import LanguageProvider from '../i18n/LanguageProvider';
import { ICEBREAKER_QUESTIONS, isBuiltInIcebreaker, localizeIcebreaker } from '../i18n/content/icebreakers';
import { getRetroTemplateColumns, isBuiltInColumnTitle } from '../i18n/content/retroTemplates';
import type { Language } from '../i18n/languages';
import type { RetroSession } from '../types';

/**
 * WCAG 3.1.2 (language of parts) asks for a `lang` on text whose language
 * differs from the page's. The app knows the language of exactly one kind of
 * shared text: the text it wrote itself, in the retro's template language. A
 * column title or icebreaker question the facilitator typed may be in any
 * language, so marking it with the template's would make a screen reader read
 * an English sentence with French phonetics (or the reverse); it carries no
 * `lang` and inherits the page's.
 */

describe('built-in content is recognised in its own language only', () => {
  it('recognises a catalogue column title in the language it was written in', () => {
    const french = getRetroTemplateColumns('start_stop_continue', 'fr').map(column => column.title);
    for (const title of french) {
      expect(isBuiltInColumnTitle(title, 'fr'), title).toBe(true);
    }
    expect(isBuiltInColumnTitle('Start', 'fr')).toBe(false);
    expect(isBuiltInColumnTitle('Start', 'en')).toBe(true);
    expect(isBuiltInColumnTitle('Nos victoires', 'fr')).toBe(false);
  });

  it('recognises a built-in question whatever kind of space precedes its "?"', () => {
    const french = ICEBREAKER_QUESTIONS.fr[0];
    const typedWithPlainSpace = french.replace(/\u202f/g, ' ');
    expect(typedWithPlainSpace).not.toBe(french);

    expect(isBuiltInIcebreaker(french, 'fr')).toBe(true);
    expect(isBuiltInIcebreaker(typedWithPlainSpace, 'fr')).toBe(true);
    expect(isBuiltInIcebreaker(french, 'en')).toBe(false);
    expect(isBuiltInIcebreaker('Une question maison ?', 'fr')).toBe(false);
  });

  it('carries a built-in question stored with plain spaces over to the other language', () => {
    // Retros saved before the French questions gained no-break spaces store
    // the same question with an ordinary space; it is still the built-in one.
    const legacy = ICEBREAKER_QUESTIONS.fr[3].replace(/\u202f/g, ' ');
    expect(localizeIcebreaker(legacy, 'en')).toBe(ICEBREAKER_QUESTIONS.en[3]);
    expect(localizeIcebreaker(legacy, 'fr')).toBe(ICEBREAKER_QUESTIONS.fr[3]);
  });
});

const session = (templateLanguage: Language, icebreakerQuestion: string): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: '6/10/2026',
  status: 'IN_PROGRESS',
  phase: 'ICEBREAKER',
  participants: [],
  icebreakerQuestion,
  columns: [],
  templateLanguage,
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: []
});

const renderIcebreaker = (templateLanguage: Language, question: string, isFacilitator: boolean) =>
  render(
    <LanguageProvider initialLanguage="en">
      <IcebreakerPhase
        session={session(templateLanguage, question)}
        isFacilitator={isFacilitator}
        localIcebreakerQuestion={null}
        onQuestionChange={vi.fn()}
        onRandom={vi.fn()}
        onStart={vi.fn()}
      />
    </LanguageProvider>
  );

describe('the icebreaker question names its language only when the app wrote it', () => {
  it('marks a built-in French question on an English screen, for every participant', () => {
    renderIcebreaker('fr', ICEBREAKER_QUESTIONS.fr[1], false);
    expect(screen.getByTestId('icebreaker-question-display')).toHaveAttribute('lang', 'fr');
  });

  it('marks it in the facilitator’s editable field too', () => {
    renderIcebreaker('fr', ICEBREAKER_QUESTIONS.fr[1], true);
    expect(screen.getByTestId('icebreaker-question-input')).toHaveAttribute('lang', 'fr');
  });

  it('leaves a question the facilitator typed to the page language', () => {
    renderIcebreaker('fr', 'What did you learn this sprint?', false);
    expect(screen.getByTestId('icebreaker-question-display')).not.toHaveAttribute('lang');
  });
});
