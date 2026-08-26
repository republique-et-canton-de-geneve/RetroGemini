/**
 * Pointerless access to the Group phase.
 *
 * The Group phase used to be pointer-only (H42, WCAG 2.1.1) — a core phase of
 * the product that a keyboard or switch user simply could not perform. The card
 * was a `div` with `draggable="true"`, `tabIndex: -1`, no role and no key
 * handler, so a tab walk never reached it.
 *
 * **This does not invent a second interaction model.** `Session.tsx` already
 * carries a pointerless one for touch: tap a card to pick it up, tap a second
 * card, a group or a column to drop it there. Every target now exposes that
 * same flow as an ordinary **button**, so the keyboard gets native activation
 * and there is one flow to reason about.
 *
 * **Why a button inside the card rather than a card that is itself a button.**
 * That was the first shape, and axe caught it on the Group phase:
 * `nested-interactive`. A ticket card holds its own reaction buttons and an
 * edit control, and a `role="button"` wrapping those is a control containing
 * controls — which screen readers do not reliably announce and which breaks
 * focus for assistive technology. The rule generalises: when a rich element
 * needs an action, give it a button; do not turn it into one.
 */

/** What activating a target means for the grouping flow. */
export type GroupingAction =
  /** Nothing to do. */
  | 'none'
  /** Pick this card up, so the next confirmed target groups it. */
  | 'pick-up'
  /** Put the held card back down, changing nothing. */
  | 'cancel'
  /** Group the held card into this target. */
  | 'drop';

export interface GroupingActivationContext {
  /** Cards are only regrouped in the Group phase. */
  isGroupPhase: boolean;
  /** A card is currently held, by pointer or by keyboard. */
  hasSelection: boolean;
  /** This target is the held card itself. */
  isSelected: boolean;
  /** Ticket cards can start a selection; groups and columns only receive one. */
  canPickUp: boolean;
}

export const resolveGroupingActivation = ({
  isGroupPhase,
  hasSelection,
  isSelected,
  canPickUp
}: GroupingActivationContext): GroupingAction => {
  if (!isGroupPhase) return 'none';
  if (isSelected) return 'cancel';
  if (hasSelection) return 'drop';
  return canPickUp ? 'pick-up' : 'none';
};

/**
 * Escape puts a held card back down. Handled once on the board rather than per
 * target, so it works wherever focus happens to be after a pick-up.
 */
export const isGroupingCancelKey = (key: string): boolean => key === 'Escape';

export interface GroupingLabelContext {
  /** The ticket text, the group title, or the column title. */
  name: string;
  kind: 'ticket' | 'group' | 'column';
  /** A card is currently held. */
  hasSelection: boolean;
  /** This target is the held card itself. */
  isSelected: boolean;
}

const FALLBACK_NAME: Record<GroupingLabelContext['kind'], string> = {
  ticket: 'Untitled ticket',
  group: 'Untitled group',
  column: 'Untitled column'
};

/**
 * What the target announces. Once a card is held every target describes the
 * **pending action** rather than itself, because that is the question the user
 * is answering while tabbing: not "what is this", but "what happens if I
 * confirm here".
 */
export const getGroupingAriaLabel = ({
  name,
  kind,
  hasSelection,
  isSelected
}: GroupingLabelContext): string => {
  const label = name.trim() || FALLBACK_NAME[kind];

  if (isSelected) {
    return `Selected for grouping: ${label}. Activate or press Escape to cancel.`;
  }

  if (hasSelection) {
    switch (kind) {
      case 'ticket':
        return `Group the selected ticket with ${label}.`;
      case 'group':
        return `Add the selected ticket to the group ${label}.`;
      case 'column':
        return `Move the selected ticket out of its group, into ${label}.`;
    }
  }

  return `Pick up the ticket ${label} for grouping.`;
};

/**
 * The few words shown on the button. Kept beside the accessible name so the two
 * cannot drift into describing different actions.
 */
export const getGroupingButtonText = ({
  hasSelection,
  isSelected
}: Pick<GroupingLabelContext, 'hasSelection' | 'isSelected'>): string => {
  if (isSelected) return 'Cancel';
  if (hasSelection) return 'Group here';
  return 'Pick up';
};
