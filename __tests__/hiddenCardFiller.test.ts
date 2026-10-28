import { describe, it, expect } from 'vitest';
import { hiddenCardFiller } from '../components/session/ticketCardAppearance';

/**
 * A card its viewer cannot read (Brainstorm and the open board with the cards
 * hidden) shows a blurred filler instead of its words: blurred by CSS alone, a
 * screen reader read them out and a find in page matched them.
 */
describe('hiddenCardFiller', () => {
  it('keeps the shape of the text, and none of its words', () => {
    const text = 'Slow rollbacks\non Fridays';
    const filler = hiddenCardFiller(text);
    expect(filler).toHaveLength(text.length);
    expect(filler.split('\n').map((line) => line.split(' ').map((word) => word.length)))
      .toEqual(text.split('\n').map((line) => line.split(' ').map((word) => word.length)));
    for (const word of ['Slow', 'rollbacks', 'Fridays']) expect(filler).not.toContain(word);
  });

  it('counts an emoji as one letter, never as half of one', () => {
    expect(hiddenCardFiller('🚀 go')).toBe('l or');
  });
});
