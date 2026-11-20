import React from 'react';
import type { CardTones } from '../../utils/cardTones';

/**
 * Appearance of a brainstorm/group ticket card.
 *
 * Extracted from `Session.tsx` because the rule this encodes is easy to break
 * by accident and was previously only "tested" by grepping the source: during a
 * drag the card must stay **readable**. Earlier iterations swapped the card's
 * background for `bg-blue-50`/`scale-105` while dragging, which washed out the
 * very text the user was trying to group. Selection is signalled with a ring,
 * never by repainting the card.
 *
 * The banners that go with it live in `TicketGroupingBanner.tsx`.
 */

export interface TicketCardAppearance {
  /** True while this card is the drop target of a drag in progress. */
  isDragTarget: boolean;
  /** True while this card is the one being dragged / tapped for grouping. */
  isSelected: boolean;
  /**
   * The tones of the card's hue (`utils/cardTones.ts`), or null for the
   * default white card. The card takes the soft tint and its line; its words
   * stay in the look's ink, whatever hue the facilitator picked.
   */
  tones: CardTones | null;
  /**
   * True where this card can be picked up: the Group phase, and a card the
   * viewer may move between columns in Brainstorm. Named for what it grants
   * rather than for a phase, because it is no longer one phase's property.
   */
  isDraggable: boolean;
}

export const getTicketCardClassName = ({
  isDragTarget,
  isSelected,
  tones,
  isDraggable
}: TicketCardAppearance): string =>
  // No margin of its own: the column's grid gap and a group's own grid gap
  // space the cards, and a margin here would add to the gap. A hover deepens
  // the shadow and moves nothing (boxes are measured), and only what is
  // painted transitions.
  `p-3 rounded-xl border shadow-xs group relative transition-[box-shadow,border-color,background-color] [@media(hover:hover)]:hover:shadow-md
                ${isDraggable ? 'cursor-grab active:cursor-grabbing' : ''}
                ${isDragTarget ? 'ring-4 ring-indigo-300 border-indigo-600 z-20' : isSelected ? 'ring-4 ring-indigo-200 border-indigo-600 shadow-lg z-10' : ''}
                ${!tones ? `bg-white ${isDragTarget || isSelected ? '' : 'border-slate-200'}` : ''}
            `;

export const getTicketCardStyle = ({
  isDragTarget,
  isSelected,
  tones
}: TicketCardAppearance): React.CSSProperties | undefined =>
  tones
    ? {
        // Unconditional: a dragged or selected card keeps its colour so its
        // text stays legible against it.
        backgroundColor: tones.tint,
        // The ring already marks these states; leaving the border colour unset
        // lets the ring's own border class show through.
        borderColor: isDragTarget || isSelected ? undefined : tones.line
      }
    : undefined;

// Letters that blur like words. A hidden card keeps the shape of its text —
// people see that cards are being written, and how long they are — while none
// of its words reaches the page: blurred by CSS alone, a screen reader read
// them out and a find in page matched them.
const HIDDEN_CARD_FILLER = 'loremipsumdolorsitametconsecteturadipiscingelitseddoeiusmod';

/** What a card its viewer cannot read shows, blurred: its shape, never its words. */
export const hiddenCardFiller = (text: string): string => {
  let next = 0;
  return text.replace(/\S/gu, () => HIDDEN_CARD_FILLER[next++ % HIDDEN_CARD_FILLER.length]);
};
