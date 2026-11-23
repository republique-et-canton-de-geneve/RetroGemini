import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import TicketCommentsModal from '../components/session/TicketCommentsModal';
import AiGroupSuggestionsModal, { AiSuggestedGroup } from '../components/session/AiGroupSuggestionsModal';
import BoardSettingsDialog from '../components/session/BoardSettingsDialog';
import ShowAuthorsDialog from '../components/session/ShowAuthorsDialog';
import InviteModal from '../components/InviteModal';
import type { Column, RetroSettings, Team, Ticket, User } from '../types';
import { effectivePair, parsedColor, tokenContrast } from './helpers/tailwindTheme';
import { contrastRatio } from '../utils/colorUtils';
import { cardTones, CARD_INK } from '../utils/cardTones';

/**
 * The session's dialogs in the 45.0 look, measured rather than judged by eye.
 *
 * Every text reads at 4.5:1 on the surface it lands on, every meaningful icon
 * and every control's only edge at 3:1. A disabled control is stated in
 * colours (WCAG exempts it, but a faded `opacity` is a pair nobody can
 * measure, and the send button's read about 1.3:1). Three contrast failures
 * this replaces: "Accept" in white on indigo-500 (4.46:1), "Accept all" in
 * white on emerald-500 (2.54:1), and the comment send button at
 * `disabled:opacity-30`.
 */

vi.mock('qrcode', () => ({
  default: { toDataURL: vi.fn(async () => 'data:image/png;base64,stub') },
}));

vi.mock('../services/dataService', () => ({
  dataService: {
    createSessionInvite: vi.fn(async () => ({ inviteLink: 'https://retro.example/?join=stub' })),
    createMemberInvite: vi.fn(),
    sendInviteEmail: vi.fn(),
    getAuthenticatedPassword: vi.fn(() => 'team-password'),
    getSessionToken: vi.fn(() => 'rg1.team-session-token'),
  },
}));

const TEXT = 4.5;
const EDGE = 3;

const expectText = (element: Element, what: string) => {
  const pair = effectivePair(element);
  expect(pair.ratio, `${what}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(TEXT);
  return pair;
};
const expectIcon = (element: Element, what: string) => {
  const pair = effectivePair(element);
  expect(pair.ratio, `${what}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(EDGE);
  return pair;
};

/** The colour token of a `border-<token>` class on an element. */
const borderToken = (element: Element): string => {
  const token = Array.from(element.classList).find((c) => /^border-[a-z]+-\d+$/.test(c));
  if (!token) throw new Error(`no border colour on <${element.tagName.toLowerCase()} class="${element.className}">`);
  return token.replace(/^border-/, '');
};

/** No ancestor of the element fades it: a faded look is what no pair can state. */
const expectNoOpacity = (element: Element) => {
  for (let node: Element | null = element; node; node = node.parentElement) {
    for (const token of Array.from(node.classList)) {
      expect(token, `<${node.tagName.toLowerCase()} class="${node.className}">`).not.toMatch(/^(?:[a-z-]+:)*opacity-(?:[0-9]|[1-9][0-9])$/);
    }
  }
};

const veilOf = (dialog: HTMLElement) => dialog.parentElement as HTMLElement;

/** The frame every dialog of this package shares. */
const expectFrame = (dialog: HTMLElement) => {
  const veil = veilOf(dialog);
  // No blur behind a dialog: the costly effect, and the one that drew doubled
  // content in software compositing.
  expect(veil.className).not.toMatch(/backdrop-blur/);
  expect(veil.classList).toContain('bg-slate-900/45');
  // A hairline around a white panel, so it holds on a white page too.
  expect(dialog.classList).toContain('bg-white');
  expect(dialog.classList).toContain('border');
  expect(dialog.classList).toContain('border-slate-200');
};

const user = (id: string, name: string, color: string): User => ({ id, name, color, role: 'participant' });

describe('ticket comments dialog', () => {
  const amber = user('am', 'Amber', 'bg-amber-500');
  const lime = user('li', 'Lime', 'bg-lime-500');
  const commented: Ticket = {
    id: 't1', colId: 'c1', text: 'Deploys are scary', authorId: lime.id, groupId: null, votes: [],
    comments: [{ id: 'k1', authorId: lime.id, authorName: 'Lime', text: 'Agreed', createdAt: new Date().toISOString() }],
  };
  const renderModal = (props: Partial<React.ComponentProps<typeof TicketCommentsModal>> = {}) =>
    render(
      <TicketCommentsModal
        ticket={commented}
        currentUser={amber}
        participants={[lime, amber]}
        isFacilitator
        onAddComment={vi.fn()}
        onEditComment={vi.fn()}
        onDeleteComment={vi.fn()}
        onClose={vi.fn()}
        cardBgHex={null}
        isAnonymous={false}
        {...props}
      />,
    );

  it('takes the shared frame', () => {
    renderModal();
    expectFrame(screen.getByRole('dialog'));
  });

  it("draws each person's picture the session resolves, and initials without one", () => {
    const { unmount } = renderModal();
    expect(document.querySelectorAll('[data-avatar-art]').length).toBe(0);
    unmount();
    // What Session passes: sessionAvatarOf, which already answers null in an anonymous session.
    renderModal({ avatarIdOf: (id) => (id === lime.id ? 'fox' : id === amber.id ? 'owl' : null) });
    const drawn = [...document.querySelectorAll('[data-avatar-art]')].map((element) => element.getAttribute('data-avatar-art'));
    expect(drawn).toContain('fox');
    expect(drawn).toContain('owl');
  });

  it('the send button states both its looks in colours, never an opacity', () => {
    renderModal();
    const send = screen.getByRole('button', { name: 'Send comment' });
    expect(send).toBeDisabled();
    expect(send.className).not.toMatch(/opacity/);
    expectIcon(within(send).getByText('send'), 'the disabled send icon');

    fireEvent.change(screen.getByTestId('add-comment-input'), { target: { value: 'Yes' } });
    expect(send).toBeEnabled();
    expect(expectIcon(within(send).getByText('send'), 'the send icon').bg).toBe('indigo-600');
    // The two looks differ in more than a shade.
    expect(effectivePair(within(send).getByText('send')).fg).not.toBe('slate-500');
  });

  it('a comment’s name, time and words read, and the edit and delete controls are seen', () => {
    renderModal();
    const comment = screen.getByTestId('ticket-comment');
    expectText(within(comment).getAllByText('Lime')[0], 'the commenter');
    expectText(within(comment).getByText(/just now/), 'the time');
    expectText(within(comment).getByTestId('comment-text'), 'the comment');
    expectIcon(within(screen.getByTestId('edit-comment-btn')).getByText('edit'), 'the edit icon');
    expectIcon(within(screen.getByTestId('delete-comment-btn')).getByText('delete'), 'the delete icon');
    // Hidden only where a pointer hovers, and shown on focus (AGENTS.md).
    const controls = screen.getByTestId('edit-comment-btn').parentElement as HTMLElement;
    expect(controls.className).toContain('[@media(hover:hover)]:opacity-0');
    expect(controls.className).toContain('focus-within:opacity-100');
  });

  it('the composer field draws its edge at 3:1 and its placeholder reads', () => {
    renderModal();
    const field = screen.getByTestId('add-comment-input');
    const surface = 'slate-50';
    expect(tokenContrast(borderToken(field), surface)).toBeGreaterThanOrEqual(EDGE);
    expect(field.className).toContain('placeholder:text-slate-500');
    expect(tokenContrast('slate-500', 'white')).toBeGreaterThanOrEqual(TEXT);
    // A visible focus indicator stays (2.4.7).
    expect(field.className).toMatch(/focus:ring-4/);
  });

  it('the card on top reads on the tint the board passes, of any column colour', () => {
    const ink = parsedColor('slate-900').toHexString();
    expect(ink.toLowerCase()).toBe(CARD_INK);
    for (const hex of ['#16a34a', '#dc2626', '#2563eb', '#facc15', '#7c3aed', '#64748b']) {
      const tones = cardTones(hex);
      expect(tones).not.toBeNull();
      const { unmount } = renderModal({ cardBgHex: tones!.tint });
      const text = screen.getByText('Deploys are scary');
      expect(text.className).toContain('text-slate-900');
      const header = text.closest('[style]') as HTMLElement;
      expect(header.style.backgroundColor).not.toBe('');
      expect(contrastRatio(ink, tones!.tint), hex).toBeGreaterThanOrEqual(TEXT);
      // The close button and the author's name take the card's words' colour.
      expect(screen.getByRole('button', { name: 'Close comments' }).className).toContain('text-slate-900');
      unmount();
    }
  });
});

describe('AI group suggestions dialog', () => {
  const columns: Column[] = [
    { id: 'c1', title: 'Liked', color: 'bg-emerald-50', border: 'border-emerald-300', icon: 'thumb_up', text: 'text-emerald-700', ring: 'focus:ring-emerald-200' },
  ];
  const tickets: Ticket[] = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, colId: 'c1', text: `Card ${id}`, authorId: 'u', groupId: null, votes: [] }));
  const suggestions: AiSuggestedGroup[] = [
    { title: 'Pair one', ticketIds: ['a', 'b'] },
    { title: 'Pair two', ticketIds: ['c', 'd'] },
    { title: 'Lonely', ticketIds: ['e'] },
  ];
  const renderModal = () =>
    render(
      <AiGroupSuggestionsModal
        isOpen
        loading={false}
        error={null}
        suggestions={suggestions}
        tickets={tickets}
        columns={columns}
        onAccept={vi.fn()}
        onReject={vi.fn()}
        onAcceptAll={vi.fn()}
        onRegenerate={vi.fn()}
        onClose={vi.fn()}
      />,
    );

  it('takes the shared frame', () => {
    renderModal();
    expectFrame(screen.getByRole('dialog'));
  });

  it('"Accept" and "Accept all" read at 4.5:1 (they measured 4.46 and 2.54)', () => {
    renderModal();
    const [accept, , disabledAccept] = screen.getAllByRole('button', { name: 'Accept' });
    expect(expectText(accept, 'Accept').bg).toBe('indigo-600');
    expect(disabledAccept).toBeDisabled();
    expect(disabledAccept.className).not.toMatch(/opacity/);
    expectText(disabledAccept, 'a disabled Accept');
    expectText(screen.getByRole('button', { name: 'Accept all remaining' }), 'Accept all');
  });

  it('the quiet controls, the counts and the hints read', () => {
    renderModal();
    expectText(screen.getAllByRole('button', { name: 'Dismiss' })[0], 'Dismiss');
    expectText(screen.getByRole('button', { name: 'Regenerate' }), 'Regenerate');
    expectText(screen.getByRole('button', { name: 'Close' }), 'Close');
    expectText(screen.getByText('0 of 3 accepted'), 'the accepted count');
    expectText(screen.getByText('Include at least 2 tickets to create this group.'), 'the two-cards hint');
    expectText(screen.getAllByText('Liked')[0], 'a column’s title');
    expectText(screen.getAllByText('(2 tickets)')[0], 'a card count');
  });

  it('an applied group stays readable: tinted, never faded', () => {
    renderModal();
    fireEvent.click(screen.getAllByRole('button', { name: 'Accept' })[0]);
    const applied = screen.getByText('Applied');
    expectText(applied, 'the Applied chip');
    const card = screen.getByText('Card a');
    expectNoOpacity(card);
    expectText(card, 'a card of an applied group');
  });
});

describe('open board settings and the authors question', () => {
  const settings = {
    isAnonymous: true, revealBrainstorm: false, oneVotePerTicket: false, maxVotes: 5,
    votingDisabled: true, voteCountHidden: true, unlimitedVotes: false,
  } as unknown as RetroSettings;

  it('settings: the frame, and every label, hint and legend reads', () => {
    render(
      <BoardSettingsDialog
        settings={settings}
        disabled={false}
        onClose={vi.fn()}
        onToggleAnonymous={vi.fn()}
        onHideCards={vi.fn()}
        onDisableVoting={vi.fn()}
        onHideVoteCount={vi.fn()}
        onUnlimitedVotes={vi.fn()}
        onOneVotePerItem={vi.fn()}
        maxVotesControl={<span />}
        colorByControl={<span />}
      />,
    );
    const dialog = screen.getByRole('dialog');
    expectFrame(dialog);
    for (const legend of dialog.querySelectorAll('legend')) expectText(legend, `legend ${legend.textContent}`);
    for (const label of dialog.querySelectorAll('label')) expectText(label, `label ${label.textContent}`);
    for (const hint of dialog.querySelectorAll('p')) expectText(hint, `hint ${hint.textContent}`);
    // Native checkboxes stay native, in the brand colour.
    for (const box of screen.getAllByRole('checkbox')) expect(box.className).toContain('accent-indigo-600');
    expectIcon(within(screen.getByRole('button', { name: 'Close' })).getByText('close'), 'the close icon');
  });

  it.each([false, true])('the authors question (reconnecting: %s): the frame and both buttons read, in colours', (disabled) => {
    render(<ShowAuthorsDialog disabled={disabled} onKeepAnonymous={vi.fn()} onShowAuthors={vi.fn()} />);
    expectFrame(screen.getByRole('dialog'));
    expectText(screen.getByRole('button', { name: 'Keep it anonymous' }), 'Keep it anonymous');
    const show = screen.getByRole('button', { name: 'Show the authors' });
    expect(show.className).not.toMatch(/opacity/);
    const pair = expectText(show, 'Show authors');
    expect(pair.bg).toBe(disabled ? 'slate-200' : 'indigo-600');
    expectText(screen.getByText(/will show their author too/), 'the body');
  });
});

describe('invite dialog', () => {
  const team: Team = {
    id: 'team-1', name: 'Rocket Squad', passwordHash: 'scrypt$stub',
    members: [
      { id: 'u1', name: 'Alice', color: 'bg-rose-500', role: 'facilitator', email: 'alice@example.com' },
      { id: 'u2', name: 'Bob', color: 'bg-emerald-500', role: 'participant', email: 'bob@example.com' },
    ],
    customTemplates: [], retrospectives: [], globalActions: [],
  };
  const originalFetch = globalThis.fetch;
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ ssid: 'Office', password: 'pw' }) }) as unknown as Response) as unknown as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const renderModal = async () => {
    render(<InviteModal team={team} onClose={vi.fn()} />);
    await screen.findByRole('button', { name: 'WI-FI' });
    return screen.getByRole('dialog');
  };

  it('takes the shared frame', async () => {
    expectFrame(await renderModal());
  });

  it('the tabs: the chosen one is pressed and every state reads', async () => {
    await renderModal();
    const tabs = screen.getAllByTestId('invite-tab');
    expect(tabs).toHaveLength(3);
    const pressed = tabs.filter((tab) => tab.getAttribute('aria-pressed') === 'true');
    expect(pressed.map((tab) => tab.textContent)).toEqual(['EMAIL']);
    for (const tab of tabs) expectText(tab, `tab ${tab.textContent}`);
    fireEvent.click(screen.getByRole('button', { name: 'CODE & LINK' }));
    expect(screen.getByRole('button', { name: 'CODE & LINK' })).toHaveAttribute('aria-pressed', 'true');
    for (const tab of screen.getAllByTestId('invite-tab')) expectText(tab, `tab ${tab.textContent}`);
  });

  it('a member row says whether it is chosen, in words for a screen reader, and reads either way', async () => {
    await renderModal();
    const alice = screen.getByRole('button', { name: /Alice/ });
    expect(alice).toHaveAttribute('aria-pressed', 'true');
    // The state is no longer read out as a glyph's name.
    expect(alice).not.toHaveAccessibleName(/toggle/);
    expectText(within(alice).getByText('Alice'), 'a chosen member');
    expectText(within(alice).getByText('alice@example.com'), 'a chosen member’s address');
    fireEvent.click(alice);
    expect(alice).toHaveAttribute('aria-pressed', 'false');
    expectText(within(alice).getByText('alice@example.com'), 'an address');
    // The empty box draws its edge at 3:1 on the white row.
    expect(tokenContrast(borderToken(within(alice).getByTestId('invite-member-check')), 'white')).toBeGreaterThanOrEqual(EDGE);
  });

  it('the hints, the send and done buttons and the address field read', async () => {
    await renderModal();
    expectText(screen.getByText('Invite by email'), 'the heading');
    expectText(screen.getByText(/personal links/i), 'the description');
    const send = screen.getByRole('button', { name: 'Send invites' });
    expect(expectText(send, 'Send invites').bg).toBe('indigo-600');
    expectText(screen.getByRole('button', { name: 'Done' }), 'Done');
    const field = screen.getByPlaceholderText(/teammate@example.com/i);
    expect(tokenContrast(borderToken(field), 'white')).toBeGreaterThanOrEqual(EDGE);

    // With nobody chosen, the send button is off and says so in colours.
    fireEvent.click(screen.getByRole('button', { name: 'Unselect all' }));
    expect(send).toBeDisabled();
    expect(send.className).not.toMatch(/opacity/);
    expectText(send, 'a disabled Send invites');
  });

  it('the link and Wi-Fi tabs read, their QR codes unchanged', async () => {
    await renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'CODE & LINK' }));
    await waitFor(() => expect(screen.getByAltText(/QR/)).toHaveAttribute('src', 'data:image/png;base64,stub'));
    expectText(screen.getByText('https://retro.example/?join=stub'), 'the link');
    expectText(screen.getByRole('button', { name: 'Copy' }), 'Copy');

    fireEvent.click(screen.getByRole('button', { name: 'WI-FI' }));
    expectText(screen.getByText('Office'), 'the network');
    expectText(screen.getByText('Network'), 'the network label');
    expectIcon(within(screen.getByRole('button', { name: 'Show Wi-Fi password' })).getByText('visibility'), 'the reveal icon');
  });
});
