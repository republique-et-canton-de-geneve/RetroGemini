import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import IcebreakerPhase from '../components/session/IcebreakerPhase';
import LanguageProvider from '../i18n/LanguageProvider';
import { ICEBREAKER_QUESTIONS } from '../i18n/content/icebreakers';
import type { Language } from '../i18n/languages';
import type { RetroSession } from '../types';

/**
 * The Icebreaker on a phone. Below `sm` the card drops its fixed 600px and the
 * screen scrolls instead, and the facilitator's field takes its height from
 * invisible copies of texts set in its own box: its words (its placeholder
 * while it is empty) and every built-in question of the retro's language, so
 * that it never scrolls inside itself and "Random" never moves the buttons
 * from under the finger. e2e/no-stray-scrollbars.spec.ts measures that in a
 * browser; jsdom lays nothing out and applies no media query. What it holds
 * here: the copies are the texts they must be, in the retro's language, never
 * read; and the classes of the phone layout are written for phones only, so
 * nothing changes from `sm` up.
 */

const tokens = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);

const session = (templateLanguage: Language, icebreakerQuestion: string): RetroSession => ({
  id: 'retro-1',
  teamId: 'team-1',
  name: 'Retro',
  date: '2026-11-20',
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

interface Options {
  templateLanguage?: Language;
  question?: string;
  /** What the facilitator is typing, before it is written to the session. */
  typing?: string | null;
  isFacilitator?: boolean;
  pageLanguage?: Language;
}

const renderIcebreaker = ({
  templateLanguage = 'fr',
  question = ICEBREAKER_QUESTIONS.fr[0],
  typing = null,
  isFacilitator = true,
  pageLanguage = 'en',
}: Options = {}) =>
  render(
    <LanguageProvider initialLanguage={pageLanguage}>
      <IcebreakerPhase
        session={session(templateLanguage, question)}
        isFacilitator={isFacilitator}
        localIcebreakerQuestion={typing}
        onQuestionChange={vi.fn()}
        onRandom={vi.fn()}
        onStart={vi.fn()}
      />
    </LanguageProvider>
  );

/** The copies that size the facilitator's field, beside it in its grid cell. */
const sizingCopies = () => {
  const copies = screen.getByTestId('icebreaker-question-input').parentElement!.querySelector('[aria-hidden="true"]');
  if (!copies) throw new Error('no sizing copies beside the field');
  return copies;
};
const copyTexts = () => [...sizingCopies().children].map((copy) => copy.textContent?.trim());

describe('the Icebreaker on a phone', () => {
  it("sizes the facilitator's field with copies nobody sees or hears: its question, then every built-in question of the retro's language", () => {
    renderIcebreaker();
    const copies = sizingCopies();
    // Never read, never seen, and drawn below sm only.
    expect(copies).toHaveAttribute('aria-hidden', 'true');
    expect(tokens(copies)).toEqual(expect.arrayContaining(['hidden', 'max-sm:grid', 'invisible']));
    expect(copyTexts()).toEqual([ICEBREAKER_QUESTIONS.fr[0], ...ICEBREAKER_QUESTIONS.fr]);
    // The built-in questions are content in the retro's language, whatever the page's.
    for (const copy of [...copies.children].slice(1)) expect(copy).toHaveAttribute('lang', 'fr');
    // Each copy is set in the field's own box, or it would break its lines elsewhere.
    const field = screen.getByTestId('icebreaker-question-input');
    const box = ['border', 'p-6', 'text-3xl', 'max-sm:text-2xl', 'font-medium', 'leading-relaxed'];
    expect(tokens(field)).toEqual(expect.arrayContaining(box));
    for (const copy of copies.children) expect(tokens(copy)).toEqual(expect.arrayContaining([...box, 'whitespace-pre-wrap', 'break-words']));
  });

  it("holds the placeholder while the field is empty, and the facilitator's own words as they type", () => {
    renderIcebreaker({ typing: '' });
    expect(copyTexts()[0]).toBe('Type or generate a question...');
    cleanup();
    const typed = 'Quelle a été la plus longue réunion de votre vie, et qu’en avez-vous retenu ?';
    renderIcebreaker({ typing: typed });
    expect(copyTexts()[0]).toBe(typed);
    // A question the facilitator wrote is in no known language: it carries none.
    expect(sizingCopies().children[0]).not.toHaveAttribute('lang');
  });

  it("follows the retro's language, not the reader's, and an unknown one reads as English", () => {
    renderIcebreaker({ templateLanguage: 'en', question: ICEBREAKER_QUESTIONS.en[0], pageLanguage: 'fr' });
    expect(copyTexts().slice(1)).toEqual([...ICEBREAKER_QUESTIONS.en]);
    cleanup();
    renderIcebreaker({ templateLanguage: 'de' as Language, question: 'Custom?' });
    expect(copyTexts()).toEqual(['Custom?', ...ICEBREAKER_QUESTIONS.en]);
  });

  it('writes its phone layout for phones only: from sm the card keeps its 600px and its centring', () => {
    renderIcebreaker();
    const card = screen.getByRole('heading', { name: 'Icebreaker' }).parentElement!;
    const root = card.parentElement!;
    const cell = screen.getByTestId('icebreaker-question-input').parentElement!;
    // The card: 600px from sm, as tall as what it holds below, centred while there is room.
    expect(tokens(card)).toEqual(expect.arrayContaining(['sm:h-[600px]', 'max-sm:my-auto', 'max-sm:shrink-0']));
    expect(tokens(card)).not.toContain('h-[600px]');
    // The screen: centred from sm; below it, scrolled, its top never cut off.
    expect(tokens(root)).toEqual(expect.arrayContaining(['h-full', 'justify-center', 'max-sm:justify-start', 'max-sm:overflow-y-auto']));
    expect(tokens(root)).not.toContain('overflow-y-auto');
    // The field's cell: a column from sm, one grid cell below it that no word can widen.
    expect(tokens(cell)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'max-sm:grid', 'max-sm:grid-cols-1']));
  });

  it("gives a participant's question the field's type size below sm, and breaks a word longer than its box", () => {
    renderIcebreaker({ isFacilitator: false });
    const question = screen.getByTestId('icebreaker-question-display');
    expect(tokens(question)).toEqual(expect.arrayContaining(['text-3xl', 'max-sm:text-2xl', 'max-sm:min-w-0', 'max-sm:break-words']));
    // Text, not a field: its box grows with it, so its cell holds no copies.
    const cell = question.parentElement!.parentElement!;
    expect(tokens(cell)).toContain('max-sm:grid');
    expect(cell.querySelector('[aria-hidden="true"]')).toBeNull();
  });
});
