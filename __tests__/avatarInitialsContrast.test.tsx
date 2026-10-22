import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ParticipantsPanel from '../components/session/ParticipantsPanel';
import TicketCommentsModal from '../components/session/TicketCommentsModal';
import type { RetroSession, Ticket, User } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The avatars as the screens render them, measured against Tailwind's theme.
 *
 * Avatars are found by their initials, never by a class, so these tests ran
 * unchanged before the fix and failed for the reason they exist: white
 * initials on seven of the eight participant colours (lime at 1.96:1), a
 * departed participant faded to 50%, "no tickets" in near-white, and the
 * comment dialog's author line at 70% opacity. The audited e2e screens had
 * one participant, the facilitator, whose indigo is the one colour where white
 * passes — which is how all of it went unseen.
 */

const FLOOR = 4.5;

const user = (id: string, name: string, color: string, role: User['role'] = 'participant'): User => ({ id, name, color, role });

// One participant per palette colour, plus one the palette does not know.
const facilitator = user('fac', 'Indigo', 'bg-indigo-500', 'facilitator');
const palette: User[] = [
  facilitator,
  user('em', 'Emerald', 'bg-emerald-500'),
  user('am', 'Amber', 'bg-amber-500'),
  user('ro', 'Rose', 'bg-rose-500'),
  user('cy', 'Cyan', 'bg-cyan-500'),
  user('fu', 'Fuchsia', 'bg-fuchsia-500'),
  user('li', 'Lime', 'bg-lime-500'),
  user('pi', 'Pink', 'bg-pink-500'),
  user('sk', 'Sky', 'bg-sky-500'),
];

const ticket = (id: string, authorId: string): Ticket => ({ id, colId: 'col-1', text: `idea ${id}`, authorId, groupId: null, votes: [] });

const makeSession = (overrides: Partial<RetroSession> = {}): RetroSession => ({
  id: 's1',
  teamId: 'team-1',
  name: 'Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [],
  icebreakerQuestion: '',
  columns: [
    { id: 'col-1', title: 'Went well', color: 'bg-emerald-500', border: 'border-emerald-500', icon: 'thumb_up', text: 'text-emerald-700', ring: 'ring-emerald-300' },
  ],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0,
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides,
});

const initialsOf = (member: User) => member.name.slice(0, 2).toUpperCase();

const renderPanel = (session: RetroSession, participants: User[], currentUser: User = facilitator) =>
  render(
    <ParticipantsPanel
      session={session}
      participants={participants}
      connectedUsers={new Set(participants.map((p) => p.id))}
      currentUser={currentUser}
      isFacilitator={currentUser.role === 'facilitator'}
      isCollapsed={false}
      activityUsers={{}}
      onToggleCollapse={vi.fn()}
      onInvite={vi.fn()}
      onToggleLeft={vi.fn()}
      getMemberDisplay={(member) => ({ displayName: member.name, initials: initialsOf(member) })}
    />,
  );

const rowOf = (name: string) => {
  const row = screen.getAllByTestId('participant-row').find((candidate) => within(candidate).queryByText(name));
  if (!row) throw new Error(`no participant row for ${name}`);
  return row;
};

const avatarOf = (member: User) => within(rowOf(member.name)).getByText(initialsOf(member));

describe('participants panel avatars', () => {
  it.each(palette.map((member) => [member.color, member]))('%s: the initials clear 4.5:1', (_color, member) => {
    renderPanel(makeSession(), palette);
    const pair = effectivePair(avatarOf(member as User));
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });

  it('draws a departed participant readable, not faded', () => {
    const lime = palette.find((member) => member.name === 'Lime') as User;
    renderPanel(makeSession({ leftUsers: [lime.id] }), palette);
    const avatar = avatarOf(lime);
    expect(avatar.className).not.toMatch(/\bopacity-\d+|\bgrayscale\b/);
    expect(effectivePair(avatar).ratio).toBeGreaterThanOrEqual(FLOOR);
  });

  it('never writes a stored colour into the avatar\'s classes', () => {
    const intruder = user('x', 'Xavier', 'fixed inset-0 z-50');
    renderPanel(makeSession(), [facilitator, intruder]);
    const classes = avatarOf(intruder).className.split(/\s+/);
    for (const token of ['fixed', 'inset-0', 'z-50']) expect(classes).not.toContain(token);
  });
});

describe('the current user\'s own row', () => {
  // The row is tinted `bg-indigo-50`, which is where `text-slate-500` falls to
  // 4.26:1 — and the panel's muted labels sit on it.
  const me = user('me', 'Mina', 'bg-amber-500');

  it('"no tickets" clears 4.5:1 on the tinted row', () => {
    renderPanel(makeSession({ tickets: [ticket('t1', 'fac')] }), [facilitator, me], me);
    const label = within(rowOf('Mina')).getByText('no tickets');
    const pair = effectivePair(label);
    expect(pair.bg).toBe('indigo-50');
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });

  it('the "+N" overflow clears 4.5:1 on the tinted row', () => {
    const tickets = Array.from({ length: 12 }, (_, index) => ticket(`t${index}`, 'me'));
    renderPanel(makeSession({ tickets }), [facilitator, me], me);
    const overflow = within(rowOf('Mina')).getByText('+4');
    const pair = effectivePair(overflow);
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });

  it('the rating progress clears 4.5:1 on the tinted row', () => {
    const session = makeSession({
      phase: 'OPEN_ACTIONS',
      closedActionsSnapshot: [
        { id: 'a1', text: 'Closed one', assigneeId: null, done: true, type: 'new', proposalVotes: {}, closedAt: new Date().toISOString() },
        { id: 'a2', text: 'Closed two', assigneeId: null, done: true, type: 'new', proposalVotes: {}, closedAt: new Date().toISOString() },
      ],
    } as Partial<RetroSession>);
    renderPanel(session, [facilitator, me], me);
    const progress = within(rowOf('Mina')).getByText('0/2');
    const pair = effectivePair(progress);
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });
});

describe('ticket comments dialog avatars', () => {
  const lime = user('li', 'Lime', 'bg-lime-500');
  const amber = user('am', 'Amber', 'bg-amber-500');
  const commented: Ticket = {
    ...ticket('t1', lime.id),
    comments: [
      { id: 'c1', authorId: amber.id, authorName: 'Amber', text: 'Agreed', createdAt: new Date().toISOString() },
      // Someone the session no longer lists: drawn with the fallback.
      { id: 'c2', authorId: 'gone', authorName: 'Gaston', text: 'Old note', createdAt: new Date().toISOString() },
    ],
  };

  const renderModal = () =>
    render(
      <TicketCommentsModal
        ticket={commented}
        currentUser={amber}
        participants={[lime, amber]}
        isFacilitator={false}
        onAddComment={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
        onClose={vi.fn()}
        cardBgHex={null}
        cardTextColor="text-slate-900"
        isAnonymous={false}
      />,
    );

  it.each([['the card author', 'LI'], ['a commenter the session no longer lists', 'GA']])(
    '%s: the initials clear 4.5:1, with no opacity on the way to the dialog',
    (_who, initials) => {
      renderModal();
      const pair = effectivePair(screen.getByText(initials));
      expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
    },
  );

  it('the current user and a listed commenter: every amber avatar clears 4.5:1', () => {
    renderModal();
    const avatars = screen.getAllByText('AM');
    expect(avatars).toHaveLength(2);
    for (const avatar of avatars) expect(effectivePair(avatar).ratio).toBeGreaterThanOrEqual(FLOOR);
  });

  it('the card author\'s name clears 4.5:1 and is not faded', () => {
    renderModal();
    const pair = effectivePair(screen.getByText('Lime'));
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });
});
