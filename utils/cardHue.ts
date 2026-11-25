import type { Column, RetroSettings, Ticket, User } from '../types';
import { columnHue } from './columnHue';
import { participantToneHex } from './participantColors';
import { getTicketOriginColumn } from './retroGrouping';

/**
 * The hue a card is tinted with: one rule for the board's card, the comments
 * dialog's copy of it and the Discuss topic it becomes (AGENTS.md, *A card's
 * colour*). `utils/cardTones.ts` turns the hue into the card's tint, its line
 * and its ink; `null` gives the white card.
 *
 * - **By topic**, the default: the column the card was written in when
 *   grouping took it to another one (the "from ..." chip names it), like a
 *   post-it moved on a wall; else the column it is in.
 * - **By author**: the author's tone (`participantToneHex(color).pop`), and the
 *   white card for an author the screen does not list. Never while the session
 *   is anonymous, whatever `colorBy` stores: each person keeps one colour, so a
 *   card in its author's colour names its author. A card hidden from its
 *   reader takes its topic's tint, for the same reason.
 */
export const cardHue = (
  ticket: Pick<Ticket, 'colId' | 'originColId'>,
  context: {
    columns: Column[];
    settings: Pick<RetroSettings, 'isAnonymous' | 'colorBy'>;
    /** The author among the people the screen lists, or nobody. */
    author: Pick<User, 'color'> | undefined;
    /** Whether the person looking can read the card. */
    readable: boolean;
  },
): string | null => {
  const { columns, settings, author, readable } = context;
  if (!settings.isAnonymous && settings.colorBy === 'author' && readable) {
    return author ? participantToneHex(author.color).pop : null;
  }
  return columnHue(getTicketOriginColumn(ticket, columns) ?? columns.find((c) => c.id === ticket.colId));
};
