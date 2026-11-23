import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import ParticipantsPanel from '../components/session/ParticipantsPanel';
import TicketCommentsModal from '../components/session/TicketCommentsModal';
import type { ParticipantActivity, RetroSession, Ticket, User } from '../types';
import { classColor, effectivePair, tokenContrast } from './helpers/tailwindTheme';

/**
 * The avatars as the screens render them, measured against the tokens the
 * build paints (Tailwind's theme, then index.css: since 45.0 a person's tone,
 * ink initials on a pastel body of the same hue).
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

const renderPanel = (
  session: RetroSession,
  participants: User[],
  currentUser: User = facilitator,
  { activityUsers = {}, isCollapsed = false }: { activityUsers?: Record<string, ParticipantActivity>; isCollapsed?: boolean } = {},
) =>
  render(
    <ParticipantsPanel
      session={session}
      participants={participants}
      connectedUsers={new Set(participants.map((p) => p.id))}
      currentUser={currentUser}
      isFacilitator={currentUser.role === 'facilitator'}
      isCollapsed={isCollapsed}
      activityUsers={activityUsers}
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
    // Its own tone, or the neutral one for a colour the palette does not know.
    const hue = /^bg-(indigo|emerald|amber|rose|cyan|fuchsia|lime|pink)-500$/.exec((member as User).color)?.[1] ?? 'neutral';
    expect(pair).toMatchObject({ fg: `person-${hue}-ink`, bg: `person-${hue}` });
  });

  it('draws a departed participant readable, not faded', () => {
    const lime = palette.find((member) => member.name === 'Lime') as User;
    renderPanel(makeSession({ leftUsers: [lime.id] }), palette);
    const avatar = avatarOf(lime);
    expect(avatar.className).not.toMatch(/\bopacity-\d+|\bgrayscale\b/);
    expect(effectivePair(avatar)).toMatchObject({ fg: 'person-neutral-ink', bg: 'person-neutral' });
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
  // The row is tinted with the brand's soft tint, `bg-indigo-100` since 45.0
  // (it was `bg-indigo-50`, where the old `text-slate-500` fell to 4.26:1), and
  // the panel's muted labels sit on it.
  const me = user('me', 'Mina', 'bg-amber-500');

  it('"no tickets" clears 4.5:1 on the tinted row', () => {
    renderPanel(makeSession({ tickets: [ticket('t1', 'fac')] }), [facilitator, me], me);
    const label = within(rowOf('Mina')).getByText('no tickets');
    const pair = effectivePair(label);
    expect(pair.bg).toBe('indigo-100');
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

  // 45.0: plain words in the brand's ink, measured on each surface they land on.
  it('the votes-left line clears 4.5:1 on the tinted row and on another row', () => {
    renderPanel(makeSession({ phase: 'VOTE' }), [facilitator, me], me);
    for (const [name, surface] of [['Mina', 'indigo-100'], ['Indigo', 'white']]) {
      const pair = effectivePair(within(rowOf(name)).getByText('5 votes left'));
      expect(pair.bg, name).toBe(surface);
      expect(pair.ratio, `${name}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
    }
  });
});

// 43.0: the line above the list that names who is typing, and its count on the
// collapsed rail. The e2e audits walk both states of the line (nobody writing,
// in 'retro-brainstorm' and on the open board, and someone writing, in
// 'retro-brainstorm-typing'); the collapsed rail is measured only here, since no
// audited state has a collapsed panel while someone types.
describe('the panel\'s typing line and rail', () => {
  const lime = palette.find((member) => member.name === 'Lime') as User;

  it('the line clears 4.5:1, someone writing or nobody', () => {
    const { unmount } = renderPanel(makeSession(), [facilitator, lime]);
    const nobody = effectivePair(screen.getByTestId('typing-now'));
    expect(nobody.bg).toBe('white');
    expect(nobody.fg).toBe('slate-600');
    expect(nobody.ratio, `${nobody.fg} on ${nobody.bg}`).toBeGreaterThanOrEqual(FLOOR);
    unmount();

    renderPanel(makeSession(), [facilitator, lime], facilitator, { activityUsers: { li: 'brainstorm' } });
    const writing = effectivePair(screen.getByTestId('typing-now'));
    expect(writing.bg).toBe('white');
    expect(writing.fg).toBe('indigo-700');
    expect(writing.ratio, `${writing.fg} on ${writing.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });

  it('the collapsed rail\'s count clears 4.5:1', () => {
    renderPanel(makeSession(), [facilitator, lime], facilitator, { activityUsers: { li: 'brainstorm' }, isCollapsed: true });
    const pair = effectivePair(within(screen.getByTestId('typing-now-rail')).getByText('1'));
    expect(pair.bg).toBe('white');
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });
});

// The check is the only sign on a row that its person is done ("Finished",
// "Vote recorded"): a graphic needed to understand the row, so WCAG 1.4.11's
// 3:1 against what it is drawn on. It measured 1.73 to 2.46:1 in emerald-400
// and -500 (review of 43.0). Since 45.0 it is a green disc with a white tick:
// the disc against the row, and the tick against the disc. The health check
// draws the same check (SessionParticipantsPanel → RowStatus), so this
// measures it too.
describe('the row\'s status check', () => {
  const NON_TEXT_FLOOR = 3;
  const me = user('me', 'Mina', 'bg-amber-500');
  const lime = palette.find((member) => member.name === 'Lime') as User;

  const checkOf = (name: string, label: string) => within(rowOf(name)).getByRole('img', { name: label });
  const discOf = (check: HTMLElement) => {
    const disc = classColor(check.className, 'bg');
    if (!disc) throw new Error('the check paints no disc');
    return disc;
  };

  it.each([
    ['the soft tone, "Finished"', makeSession({ phase: 'VOTE', finishedUsers: ['me', 'li'] }), 'Finished'],
    ['the strong tone, "Vote recorded"', makeSession({ phase: 'WELCOME', happiness: { me: 4, li: 3 } }), 'Vote recorded'],
  ])('%s clears 3:1 on the tinted row and on another row', (_label, session, label) => {
    renderPanel(session, [facilitator, me, lime], me);
    for (const [name, surface] of [['Mina', 'indigo-100'], ['Lime', 'white']]) {
      const check = checkOf(name, label);
      // What the check sits on is what the row's name sits on.
      const around = effectivePair(within(rowOf(name)).getByText(name)).bg;
      expect(around, name).toBe(surface);
      const disc = discOf(check);
      expect(tokenContrast(disc, around), `${name}: ${disc} on ${around}`).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
      const tick = effectivePair(check);
      expect(tick.ratio, `${name}: ${tick.fg} on ${tick.bg}`).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
    }
  });

  it('keeps the strong tone darker than the soft one', () => {
    const soft = renderPanel(makeSession({ phase: 'VOTE', finishedUsers: ['li'] }), [facilitator, lime]);
    const softColor = discOf(checkOf('Lime', 'Finished'));
    soft.unmount();
    renderPanel(makeSession({ phase: 'WELCOME', happiness: { li: 3 } }), [facilitator, lime]);
    const strongColor = discOf(checkOf('Lime', 'Vote recorded'));

    expect(tokenContrast(strongColor, 'white')).toBeGreaterThan(tokenContrast(softColor, 'white'));
  });
});

// 45.0: every word a row, the head and the foot show, and the marks that carry
// a meaning (the presence dot), on each surface they land on: white, and the
// reader's own indigo-100 row. A contrast fix is directional (AGENTS.md), so
// each is measured where it is painted, not judged by its class.
describe('the panel\'s words and marks, on each surface', () => {
  const me = user('me', 'Mina', 'bg-amber-500');
  const lime = palette.find((member) => member.name === 'Lime') as User;
  const NON_TEXT_FLOOR = 3;

  const expectReadable = (element: HTMLElement, what: string, floor = FLOOR) => {
    const pair = effectivePair(element);
    expect(pair.ratio, `${what}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(floor);
    return pair;
  };

  it('the name, "(you)", the role and the contribution line read on both rows', () => {
    renderPanel(makeSession({ tickets: [ticket('t1', 'li')] }), [facilitator, me, lime], me);
    expect(expectReadable(within(rowOf('Mina')).getByText('(you)'), '(you)').bg).toBe('indigo-100');
    for (const name of ['Mina', 'Lime']) {
      expectReadable(within(rowOf(name)).getByText(name), `${name}'s name`);
      expectReadable(within(rowOf(name)).getByText('participant'), `${name}'s role`);
    }
    expectReadable(within(rowOf('Indigo')).getByText('no tickets'), '"no tickets" on white');
  });

  it('the presence dot clears 3:1 against the ring that sets it off, on both rows', () => {
    renderPanel(makeSession(), [facilitator, me, lime], me);
    for (const [name, surface] of [['Mina', 'indigo-100'], ['Lime', 'white']]) {
      const dot = rowOf(name).querySelector<HTMLElement>('[data-presence-dot]');
      expect(dot, name).not.toBeNull();
      const fill = classColor(dot!.className, 'bg');
      // Its ring is the row's own surface, so the dot reads against the row.
      expect(dot!.className.split(/\s+/), name).toContain(`border-${surface}`);
      expect(effectivePair(within(rowOf(name)).getByText(name)).bg, name).toBe(surface);
      expect(tokenContrast(fill!, surface), `${name}: ${fill} on ${surface}`).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
    }
  });

  it('a departed row\'s chip and an invitee\'s words read', () => {
    renderPanel(
      makeSession({ leftUsers: ['li'], invitedUsers: [{ id: 'inv', name: 'Ivo', email: 'ivo@example.com' }] } as Partial<RetroSession>),
      [facilitator, me, lime],
      facilitator,
    );
    expectReadable(within(rowOf('Lime')).getByText('Left the session'), 'the departed chip');
    expectReadable(within(rowOf('Lime')).getByText('Lime'), 'a departed name');
    const invitee = screen.getByTestId('invited-row');
    expectReadable(within(invitee).getByText('Ivo'), 'the invitee\'s name');
    expectReadable(within(invitee).getByText('Invited'), 'the invited chip');
    expectReadable(within(screen.getByTestId('invited-section')).getByText(/waiting to join/), 'the waiting list\'s heading');
  });

  it('the title, the footer and the invite button read', () => {
    renderPanel(makeSession(), [facilitator, me], facilitator);
    expectReadable(screen.getByText('Participants (2)'), 'the title');
    expectReadable(screen.getByText('0 tickets added so far'), 'the footer');
    const invite = screen.getByRole('button', { name: 'Invite Team' });
    expect(expectReadable(invite, 'the invite button').bg).toBe('indigo-600');
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
