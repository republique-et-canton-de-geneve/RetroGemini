import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import SessionHeader from '../components/session/SessionHeader';
import { RetroSession, User } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The retrospective's header as the look (45.0) draws it. What a restyle must
 * keep is pinned beside what it adds: the hooks other code and the header-fit
 * e2e read (`phase-nav-btn`, `active`, the names, the min-w-9 group), the
 * colours as painted, and who sees their own avatar at which width.
 *
 * jsdom applies no media query, so widths are read from the responsive
 * classes; e2e/i18n.spec.ts measures the real layout.
 */

const PHASES = ['ICEBREAKER', 'WELCOME', 'OPEN_ACTIONS', 'BRAINSTORM', 'GROUP', 'VOTE', 'DISCUSS', 'REVIEW', 'CLOSE'];

const facilitator: User = { id: 'fac', name: 'Fran Martin', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'a', name: 'Alice Roux', color: 'bg-rose-500', role: 'participant' };

const session: RetroSession = {
  id: 's1',
  teamId: 'team-1',
  name: 'Retro',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'BRAINSTORM',
  participants: [facilitator, alice],
  icebreakerQuestion: 'What was the highlight of your week?',
  columns: [],
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 300,
    timerRunning: false,
    timerInitial: 300
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: []
};

const renderHeader = (viewer: User, extra: Partial<React.ComponentProps<typeof SessionHeader>> = {}) =>
  render(
    <SessionHeader
      session={session}
      phases={PHASES}
      isFacilitator={viewer.role === 'facilitator'}
      handleExit={vi.fn()}
      setPhase={vi.fn()}
      updateSession={vi.fn()}
      localParticipantsPanelCollapsed={false}
      setLocalParticipantsPanelCollapsed={vi.fn()}
      participantsCount={2}
      currentUser={viewer}
      onInvite={vi.fn()}
      isRetroTipsOpen={false}
      onToggleRetroTips={vi.fn()}
      {...extra}
    />
  );

const tokens = (element: Element) => (element.getAttribute('class') ?? '').split(/\s+/);

/** The responsive classes between an element and the header, innermost first. */
const visibilityChain = (element: Element) => {
  const chain: string[] = [];
  for (let node: Element | null = element; node && node.tagName !== 'HEADER'; node = node.parentElement) {
    chain.push(...tokens(node).filter((token) => /^(?:[\w[\]-]+:)?(?:hidden|flex|block|inline-flex)$/.test(token)));
  }
  return chain;
};

afterEach(cleanup);

describe('the phase bar', () => {
  it('keeps the hooks and the names, and sits each phase on a pill', () => {
    renderHeader(facilitator);
    const buttons = [...document.querySelectorAll('.phase-nav-btn')];
    expect(buttons).toHaveLength(PHASES.length);
    // The names stay the dictionary's (e2e and the other suites click them by name).
    const current = screen.getByRole('button', { name: 'BRAINSTORM' });
    expect(current).toHaveClass('phase-nav-btn', 'active');
    expect(document.querySelectorAll('.phase-nav-btn.active')).toHaveLength(1);
    for (const button of buttons) {
      // A pill about 32px tall, not the bar's full height.
      expect(tokens(button)).toContain('h-8');
      expect(tokens(button)).not.toContain('h-full');
      // Mixed case is drawn by CSS from the stored capitals; nothing is retyped.
      expect(tokens(button)).not.toContain('uppercase');
    }
  });

  it('writes the labels in mixed case without changing them', () => {
    renderHeader(facilitator);
    const label = within(screen.getByRole('button', { name: 'OPEN ACTIONS' })).getByText('OPEN ACTIONS');
    expect(tokens(label)).toEqual(expect.arrayContaining(['lowercase', 'first-letter:uppercase']));
  });

  it('paints the current phase and the others in colours that read', () => {
    renderHeader(facilitator);
    const current = effectivePair(screen.getByRole('button', { name: 'BRAINSTORM' }));
    expect(current).toMatchObject({ fg: 'indigo-700', bg: 'indigo-100' });
    expect(current.ratio).toBeGreaterThanOrEqual(4.5);
    const other = effectivePair(screen.getByRole('button', { name: 'GROUP' }));
    expect(other.ratio, `${other.fg} on ${other.bg}`).toBeGreaterThanOrEqual(4.5);
  });

  it('shows a participant phases they cannot press as disabled, without opacity', () => {
    renderHeader(alice);
    const group = screen.getByRole('button', { name: 'GROUP' });
    expect(group).toBeDisabled();
    expect(tokens(group).some((token) => /opacity/.test(token))).toBe(false);
    expect(tokens(group)).toContain('disabled:text-slate-400');
  });
});

describe('the controls of the bar', () => {
  it('keeps the back arrow in its own group that never shrinks below it', () => {
    renderHeader(facilitator);
    const back = screen.getByRole('button', { name: 'Leave the retrospective' });
    expect(back.textContent).toContain('arrow_back');
    expect(tokens(back.parentElement!)).toContain('min-w-9');
    const pair = effectivePair(back.querySelector('.material-symbols-outlined')!);
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(3);
  });

  it('draws the tips button as an amber tile whose bulb reads on it', () => {
    renderHeader(facilitator);
    const tips = screen.getByRole('button', { name: 'Show retro tips' });
    const bulb = within(tips).getByText('tips_and_updates');
    expect(bulb).toHaveAttribute('aria-hidden', 'true');
    const pair = effectivePair(bulb);
    expect(pair.bg).toMatch(/^amber-/);
    expect(pair.ratio).toBeGreaterThanOrEqual(3);
  });

  it('keeps the invite button found by its icon and named by its words', () => {
    renderHeader(facilitator);
    const invite = screen.getByRole('button', { name: 'Invite / Join' });
    expect(invite.textContent).toContain('qr_code_2');
    const pair = effectivePair(within(invite).getByText('qr_code_2'));
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(3);
  });
});

describe("the viewer's own avatar", () => {
  it('shows for a participant at every width', () => {
    // The avatar picker opens from it, phones included (AGENTS.md, *Avatars*).
    renderHeader(alice);
    const avatar = screen.getByRole('button', { name: 'AL, Alice Roux, choose my avatar' });
    expect(visibilityChain(avatar)).not.toContain('hidden');
  });

  it('shows for a facilitator from 360px, whose header also carries invite and play', () => {
    renderHeader(facilitator);
    const avatar = screen.getByRole('button', { name: /^FR, Fran Martin, choose my avatar$/ });
    const chain = visibilityChain(avatar);
    expect(chain).toContain('hidden');
    expect(chain.some((token) => token.startsWith('min-[360px]:'))).toBe(true);
    // Nothing wider than 360px hides it again.
    expect(chain.filter((token) => /^\w+:hidden$/.test(token) || /^min-\[\d+px\]:hidden$/.test(token))).toEqual([]);
  });

  it('is the control that opens the picker, by keyboard too, with a visible focus and a 24px target', () => {
    const onOpenAvatarPicker = vi.fn();
    renderHeader(alice, { onOpenAvatarPicker });
    const button = screen.getByRole('button', { name: /choose my avatar/ });
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.hasAttribute('data-viewer-avatar')).toBe(true);
    // A native button: Enter and Space click it.
    button.focus();
    expect(document.activeElement).toBe(button);
    fireEvent.click(button);
    expect(onOpenAvatarPicker).toHaveBeenCalledTimes(1);
    expect(tokens(button).some((token) => token.startsWith('focus-visible:outline'))).toBe(true);
    // The avatar inside is decoration, 32px: the button is named, the picture is not.
    expect(within(button).queryByRole('img')).toBeNull();
    expect(button.querySelector('.w-8.h-8')).not.toBeNull();
  });

  it('draws the picture the viewer chose, and is then named without initials', () => {
    renderHeader(alice, { viewerAvatarId: 'fox' });
    const button = screen.getByRole('button', { name: 'Alice Roux, choose my avatar' });
    expect(button.querySelector('[data-avatar-art="fox"]')).not.toBeNull();
  });

  // While the one-time avatar hint shows under the header (AGENTS.md,
  // *Avatars*), the opener carries a dot: a sign on the control itself.
  it('carries a still dot while the avatar hint shows, its name, class and box unchanged', () => {
    renderHeader(alice, { viewerAvatarMarked: true });
    const marked = screen.getByRole('button', { name: 'AL, Alice Roux, choose my avatar' });
    const dot = marked.querySelector('[data-avatar-hint-dot]') as HTMLElement;
    expect(dot).not.toBeNull();
    expect(dot).toHaveAttribute('aria-hidden', 'true');
    // Drawn over the corner, out of the flow: the button keeps its size.
    expect(tokens(dot)).toEqual(expect.arrayContaining(['absolute', 'bg-indigo-600', 'ring-white']));
    expect(tokens(dot).filter((token) => token.startsWith('fx-') || token.startsWith('animate-'))).toEqual([]);
    expect(tokens(marked)).toContain('relative');
    expect(within(marked).queryByRole('img')).toBeNull();
    const markedClass = marked.className;
    cleanup();

    renderHeader(alice);
    const plain = screen.getByRole('button', { name: 'AL, Alice Roux, choose my avatar' });
    expect(plain.querySelector('[data-avatar-hint-dot]')).toBeNull();
    expect(plain.className).toBe(markedClass);
  });

  it("hands its button to the screen, which focuses it before opening the picker from the hint", () => {
    const viewerAvatarRef = React.createRef<HTMLButtonElement>();
    renderHeader(alice, { viewerAvatarRef });
    expect(viewerAvatarRef.current).toBe(screen.getByRole('button', { name: /choose my avatar/ }));
  });
});
