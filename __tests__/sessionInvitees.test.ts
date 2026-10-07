import { describe, expect, it } from 'vitest';
import { pendingInvitees, recordInvitees, restoreLostInvitees } from '../components/session/sessionInvitees';
import { User } from '../types';

/**
 * The invitee rules both session types share. The merge relies on the list
 * being add-only (restoreLostInvitees re-adds what a lost write race dropped),
 * so recording an invite round must never remove or duplicate anyone.
 */

const user = (id: string, name: string, email?: string): User => ({
  id,
  name,
  email,
  color: 'bg-indigo-500',
  role: 'participant'
});

describe('recordInvitees', () => {
  it('keeps the first invitation date and never duplicates a re-invited teammate', () => {
    const first = recordInvitees(undefined, [{ id: 'b', name: 'Bob', email: 'bob@example.com' }], '2026-01-01T00:00:00.000Z');
    const again = recordInvitees(
      first,
      [
        { id: 'b', name: 'Bob', email: 'bob@example.com' },
        { id: 'c', name: 'Cy', email: 'cy@example.com' }
      ],
      '2026-02-01T00:00:00.000Z'
    );

    expect(again.map((u) => u.id)).toEqual(['b', 'c']);
    expect(again[0].invitedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(again[1].invitedAt).toBe('2026-02-01T00:00:00.000Z');
  });
});

describe('pendingInvitees', () => {
  const invited = [
    { id: 'b', name: 'Bob', email: 'bob@example.com' },
    { id: 'c', name: 'Cy', email: 'cy@example.com' },
    { id: 'd', name: 'Dee' }
  ];

  it('lists only the invitees who have not joined, matched by id, name or email', () => {
    const joined = [
      user('b', 'Bob'),
      // Joined through the generic link under a fresh id: matched by email.
      user('fresh-1', 'Cyril', 'CY@example.com'),
      // Matched by name, whatever the case and spacing.
      user('fresh-2', '  dee ')
    ];

    expect(pendingInvitees(joined, invited)).toEqual([]);
    expect(pendingInvitees([user('b', 'Bob')], invited).map((u) => u.id)).toEqual(['c', 'd']);
  });

  it('reads a session without invitees as nobody pending', () => {
    expect(pendingInvitees([user('b', 'Bob')], undefined)).toEqual([]);
  });

  it('skips an entry that is not shaped like an invitee instead of throwing during render', () => {
    // `invitedUsers` is unvalidated session data read during render, with no
    // error boundary: a throw here blanked the session for every participant.
    const malformed = [{ id: 'x', name: 42 }, null, 'bob', { id: 'c', name: 'Cy', email: 7 }] as never;

    expect(pendingInvitees([user('b', 'Bob')], malformed).map((u) => u.id)).toEqual(['c']);
    expect(pendingInvitees([user('b', 'Bob')], { not: 'a list' } as never)).toEqual([]);
  });
});

describe('restoreLostInvitees', () => {
  it('re-adds the invitees a healed write lost, after the ones the server knows', () => {
    expect(restoreLostInvitees([{ id: 'c', name: 'Cy' }], [{ id: 'b', name: 'Bob' }, { id: 'c', name: 'Cyril' }]))
      .toEqual([{ id: 'c', name: 'Cy' }, { id: 'b', name: 'Bob' }]);
  });

  it('never re-asserts a malformed local entry', () => {
    expect(restoreLostInvitees([], [{ id: 'x', name: 42 }] as never)).toBeNull();
  });

  it('answers null when nothing was lost, so the caller does not re-send', () => {
    expect(restoreLostInvitees([{ id: 'b', name: 'Bob' }], [{ id: 'b', name: 'Bob' }])).toBeNull();
    expect(restoreLostInvitees([{ id: 'b', name: 'Bob' }], undefined)).toBeNull();
  });
});
