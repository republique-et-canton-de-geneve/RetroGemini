import React from 'react';

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
  /** Resolved background colour of the card, or null for the default white. */
  cardBgHex: string | null;
  /** True in the Group phase, where cards are draggable. */
  isGroupMode: boolean;
}

export const getTicketCardClassName = ({
  isDragTarget,
  isSelected,
  cardBgHex,
  isGroupMode
}: TicketCardAppearance): string =>
  `p-3 rounded shadow-xs border group relative mb-2 transition-all
                ${isGroupMode ? 'cursor-grab active:cursor-grabbing' : ''}
                ${isDragTarget ? 'ring-4 ring-indigo-400 border-indigo-500 z-20' : isSelected ? 'ring-4 ring-blue-400 border-blue-500 shadow-lg z-10' : ''}
                ${!cardBgHex ? 'bg-white border-slate-200' : ''}
            `;

export const getTicketCardStyle = ({
  isDragTarget,
  isSelected,
  cardBgHex
}: TicketCardAppearance): React.CSSProperties | undefined =>
  cardBgHex
    ? {
        // Unconditional: a dragged or selected card keeps its colour so its
        // text stays legible against it.
        backgroundColor: cardBgHex,
        // The ring already marks these states; leaving the border colour unset
        // lets the ring's own border class show through.
        borderColor: isDragTarget ? undefined : isSelected ? undefined : cardBgHex,
        borderWidth: '2px'
      }
    : undefined;
