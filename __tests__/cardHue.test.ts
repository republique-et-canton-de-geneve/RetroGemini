import { describe, expect, it } from 'vitest';
import { cardHue } from '../utils/cardHue';
import { columnHue } from '../utils/columnHue';
import { participantToneHex } from '../utils/participantColors';
import type { Column, RetroSettings } from '../types';

/**
 * Where a card's hue comes from (AGENTS.md, *A card's colour*): the rule the
 * board's card, its comments dialog and its Discuss topic share.
 * `__tests__/discussTopicTint.test.tsx` holds the screens to it.
 */

const column = (id: string, customColor: string): Column => ({
  id, title: id, color: '', border: '', icon: 'play_arrow', text: '', ring: '', customColor
});
const START = column('start', '#3b82f6');
const STOP = column('stop', '#f59e0b');
const COLUMNS = [START, STOP];

const author = { color: 'bg-emerald-500' };
const authorTone = participantToneHex(author.color).pop;

type Settings = Pick<RetroSettings, 'isAnonymous' | 'colorBy'>;
/** `who` absent is the author; `who: undefined` is an author the screen does not list. */
const hueOf = (
  ticket: { colId: string; originColId?: string },
  settings: Settings,
  options: { readable?: boolean; who?: { color: string } } = {},
) => cardHue(ticket, {
  columns: COLUMNS,
  settings,
  author: 'who' in options ? options.who : author,
  readable: options.readable ?? true
});

const byTopic: Settings = { isAnonymous: false, colorBy: 'topic' };
const byAuthor: Settings = { isAnonymous: false, colorBy: 'author' };

describe('cardHue', () => {
  it('takes the hue of the column a card is in, by topic (the default, also when nothing is stored)', () => {
    expect(hueOf({ colId: 'stop' }, byTopic)).toBe(columnHue(STOP));
    expect(hueOf({ colId: 'stop' }, { isAnonymous: false })).toBe(columnHue(STOP));
  });

  it('takes the column a card was written in first, once grouping took it to another one', () => {
    expect(hueOf({ colId: 'stop', originColId: 'start' }, byTopic)).toBe(columnHue(START));
    // An origin that is its own column, or a column removed since, names nothing.
    expect(hueOf({ colId: 'stop', originColId: 'stop' }, byTopic)).toBe(columnHue(STOP));
    expect(hueOf({ colId: 'stop', originColId: 'gone' }, byTopic)).toBe(columnHue(STOP));
  });

  it('gives no hue to a card whose column is gone, nor in a column with no colour: the white card', () => {
    expect(hueOf({ colId: 'gone' }, byTopic)).toBeNull();
    expect(cardHue({ colId: 'plain' }, { columns: [{ ...column('plain', ''), customColor: undefined }], settings: byTopic, author, readable: true })).toBeNull();
  });

  it('takes the author’s tone on a board coloured by author, the origin column aside', () => {
    expect(hueOf({ colId: 'stop', originColId: 'start' }, byAuthor)).toBe(authorTone);
  });

  it('draws the white card for an author the screen does not list', () => {
    expect(hueOf({ colId: 'stop' }, byAuthor, { who: undefined })).toBeNull();
  });

  it('never colours by author in an anonymous session, whatever "Colour by" stores', () => {
    expect(hueOf({ colId: 'stop', originColId: 'start' }, { isAnonymous: true, colorBy: 'author' })).toBe(columnHue(START));
  });

  it('takes its topic’s hue for a card hidden from its reader, where the tone would name its author', () => {
    expect(hueOf({ colId: 'stop' }, byAuthor, { readable: false })).toBe(columnHue(STOP));
    expect(hueOf({ colId: 'stop' }, byAuthor, { readable: false, who: undefined })).toBe(columnHue(STOP));
  });

  it('reads a stored "Colour by" it does not know as by topic: settings are data', () => {
    expect(hueOf({ colId: 'stop' }, { isAnonymous: false, colorBy: 'mood' as never })).toBe(columnHue(STOP));
  });
});
