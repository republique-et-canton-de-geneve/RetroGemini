import { describe, it, expect } from 'vitest';
import {
  canMoveGroupInBrainstorm,
  canMoveSelectionInBrainstorm,
  canMoveTicketInBrainstorm,
  getBrainstormMoveAriaLabel,
  getBrainstormMoveButtonText,
  resolveBrainstormMoveActivation
} from '../components/session/brainstormMove';

/**
 * Who may move what in Brainstorm, and what each target announces.
 *
 * The two rules under test are the ones a reader of the feature will want to
 * check: you can only move a card you can read, and a group moves whole.
 */

describe('canMoveTicketInBrainstorm', () => {
  it('lets an author move their own card while the cards are hidden', () => {
    expect(
      canMoveTicketInBrainstorm({
        ticket: { authorId: 'me', groupId: null },
        currentUserId: 'me',
        revealBrainstorm: false
      })
    ).toBe(true);
  });

  it('refuses someone else’s card while the cards are hidden', () => {
    // The card is blurred: moving it would mean placing an idea you cannot read.
    expect(
      canMoveTicketInBrainstorm({
        ticket: { authorId: 'other', groupId: null },
        currentUserId: 'me',
        revealBrainstorm: false
      })
    ).toBe(false);
  });

  it('opens every card once the facilitator reveals them', () => {
    expect(
      canMoveTicketInBrainstorm({
        ticket: { authorId: 'other', groupId: null },
        currentUserId: 'me',
        revealBrainstorm: true
      })
    ).toBe(true);
  });

  it('refuses a grouped card even when it is the user’s own and revealed', () => {
    expect(
      canMoveTicketInBrainstorm({
        ticket: { authorId: 'me', groupId: 'g1' },
        currentUserId: 'me',
        revealBrainstorm: true
      })
    ).toBe(false);
  });
});

describe('canMoveGroupInBrainstorm', () => {
  it('lets anyone move a group once the cards are revealed', () => {
    expect(
      canMoveGroupInBrainstorm({
        members: [{ authorId: 'a' }, { authorId: 'b' }],
        currentUserId: 'me',
        revealBrainstorm: true
      })
    ).toBe(true);
  });

  it('refuses a group holding a card this user cannot read', () => {
    expect(
      canMoveGroupInBrainstorm({
        members: [{ authorId: 'me' }, { authorId: 'other' }],
        currentUserId: 'me',
        revealBrainstorm: false
      })
    ).toBe(false);
  });

  it('allows a group made only of this user’s own cards while hidden', () => {
    expect(
      canMoveGroupInBrainstorm({
        members: [{ authorId: 'me' }, { authorId: 'me' }],
        currentUserId: 'me',
        revealBrainstorm: false
      })
    ).toBe(true);
  });

  it('refuses an empty group — there is nothing to move', () => {
    expect(
      canMoveGroupInBrainstorm({ members: [], currentUserId: 'me', revealBrainstorm: true })
    ).toBe(false);
  });
});

describe('canMoveSelectionInBrainstorm — the permission re-asked at drop time', () => {
  // A hold outlives the state it was made in: picked up while the cards were
  // revealed, dropped after the facilitator hid them again (Codex, PR #483).
  const tickets = [
    { id: 'mine', authorId: 'me', groupId: null },
    { id: 'theirs', authorId: 'other', groupId: null },
    { id: 'g-mine', authorId: 'me', groupId: 'g1' },
    { id: 'g-theirs', authorId: 'other', groupId: 'g1' }
  ];

  it('refuses a held card once the cards are hidden again', () => {
    expect(
      canMoveSelectionInBrainstorm({
        selection: { kind: 'ticket', id: 'theirs' },
        tickets,
        currentUserId: 'me',
        revealBrainstorm: true
      })
    ).toBe(true);
    expect(
      canMoveSelectionInBrainstorm({
        selection: { kind: 'ticket', id: 'theirs' },
        tickets,
        currentUserId: 'me',
        revealBrainstorm: false
      })
    ).toBe(false);
  });

  it('keeps the user’s own held card movable when the cards are hidden', () => {
    expect(
      canMoveSelectionInBrainstorm({
        selection: { kind: 'ticket', id: 'mine' },
        tickets,
        currentUserId: 'me',
        revealBrainstorm: false
      })
    ).toBe(true);
  });

  it('refuses a held group that holds a card this user cannot read', () => {
    expect(
      canMoveSelectionInBrainstorm({
        selection: { kind: 'group', id: 'g1' },
        tickets,
        currentUserId: 'me',
        revealBrainstorm: false
      })
    ).toBe(false);
  });

  it('refuses a selection whose card has gone', () => {
    expect(
      canMoveSelectionInBrainstorm({
        selection: { kind: 'ticket', id: 'deleted-by-someone-else' },
        tickets,
        currentUserId: 'me',
        revealBrainstorm: true
      })
    ).toBe(false);
  });

  it('refuses a selection whose group has gone (no members left)', () => {
    expect(
      canMoveSelectionInBrainstorm({
        selection: { kind: 'group', id: 'dissolved' },
        tickets,
        currentUserId: 'me',
        revealBrainstorm: true
      })
    ).toBe(false);
  });
});

describe('resolveBrainstormMoveActivation', () => {
  const context = {
    isBrainstormPhase: true,
    hasSelection: false,
    isSelected: false,
    target: 'item' as const,
    canPickUp: true
  };

  it('picks an item up when nothing is held', () => {
    expect(resolveBrainstormMoveActivation(context)).toBe('pick-up');
  });

  it('does nothing outside the Brainstorm phase', () => {
    expect(resolveBrainstormMoveActivation({ ...context, isBrainstormPhase: false })).toBe('none');
  });

  it('does nothing for an item this user may not move', () => {
    expect(resolveBrainstormMoveActivation({ ...context, canPickUp: false })).toBe('none');
  });

  it('cancels when the held item is activated again', () => {
    expect(
      resolveBrainstormMoveActivation({ ...context, hasSelection: true, isSelected: true })
    ).toBe('cancel');
  });

  it('moves the held item when a column is activated', () => {
    expect(
      resolveBrainstormMoveActivation({ ...context, hasSelection: true, target: 'column' })
    ).toBe('move');
  });

  it('refuses to act on another card while one is held — that would be grouping', () => {
    expect(resolveBrainstormMoveActivation({ ...context, hasSelection: true })).toBe('none');
  });

  it('ignores a column while nothing is held', () => {
    expect(resolveBrainstormMoveActivation({ ...context, target: 'column' })).toBe('none');
  });
});

describe('the announcements', () => {
  it('says what a card control does, in terms of columns rather than grouping', () => {
    expect(
      getBrainstormMoveAriaLabel({
        name: 'Deploys are scary',
        kind: 'ticket',
        heldKind: null,
        isSelected: false
      })
    ).toBe('Move the card Deploys are scary to another column.');
  });

  it('names the group, so a group control is never mistaken for a card', () => {
    expect(
      getBrainstormMoveAriaLabel({ name: 'Releases', kind: 'group', heldKind: null, isSelected: false })
    ).toBe('Move the group Releases to another column.');
  });

  it('describes the pending move on a column, not the column itself', () => {
    expect(
      getBrainstormMoveAriaLabel({
        name: 'Went wrong',
        kind: 'column',
        heldKind: 'group',
        isSelected: false
      })
    ).toBe('Move the selected group to Went wrong.');
  });

  it('offers the way out on the held item', () => {
    expect(
      getBrainstormMoveAriaLabel({ name: 'Deploys', kind: 'ticket', heldKind: 'ticket', isSelected: true })
    ).toContain('press Escape to cancel');
  });

  it('falls back to a name rather than announcing an empty string', () => {
    expect(
      getBrainstormMoveAriaLabel({ name: '   ', kind: 'group', heldKind: null, isSelected: false })
    ).toBe('Move the group Untitled group to another column.');
  });

  it('keeps the button text in step with the action', () => {
    expect(getBrainstormMoveButtonText({ target: 'item', isSelected: false })).toBe('Move');
    expect(getBrainstormMoveButtonText({ target: 'item', isSelected: true })).toBe('Cancel');
    expect(getBrainstormMoveButtonText({ target: 'column', isSelected: false })).toBe('Move here');
  });
});
