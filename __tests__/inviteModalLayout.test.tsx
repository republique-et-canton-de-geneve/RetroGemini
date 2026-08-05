import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import InviteModal from '../components/InviteModal';
import { Team } from '../types';

// The QR code library needs a real canvas, which jsdom does not provide, so it
// is stubbed with a data URL. The invite link itself comes from dataService,
// stubbed so the modal mounts without a logged-in team.
vi.mock('qrcode', () => ({
  default: {
    toDataURL: vi.fn(async () => 'data:image/png;base64,stub')
  }
}));

vi.mock('../services/dataService', () => ({
  dataService: {
    createSessionInvite: vi.fn(async () => ({ inviteLink: 'https://retro.example/?join=stub' })),
    createMemberInvite: vi.fn(),
    sendInviteEmail: vi.fn(),
    // The Wi-Fi lookup authenticates since H31.
    getAuthenticatedPassword: vi.fn(() => 'team-password'),
    getSessionToken: vi.fn(() => 'rg1.team-session-token')
  }
}));

const team: Team = {
  id: 'team-1',
  name: 'Rocket Squad',
  passwordHash: 'scrypt$stub',
  members: [
    { id: 'u1', name: 'Alice', color: 'bg-rose-500', role: 'facilitator', email: 'alice@example.com' },
    { id: 'u2', name: 'Bob', color: 'bg-emerald-500', role: 'participant', email: 'bob@example.com' }
  ],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
};

/**
 * The Wi-Fi lookup is the only endpoint the modal calls directly on mount.
 * Answering 404 mirrors a deployment without Wi-Fi credentials configured.
 */
const stubFetch = () => {
  const fetchMock = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url === '/api/wifi-config') {
      return { ok: false, status: 404, json: async () => ({}) } as unknown as Response;
    }
    throw new Error(`Unexpected fetch in test: ${url}`);
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
};

/** Ancestors of `node`, closest first, up to and including `root`. */
const ancestorsUpTo = (node: Element, root: Element): HTMLElement[] => {
  const chain: HTMLElement[] = [];
  let current = node.parentElement;
  while (current) {
    chain.push(current);
    if (current === root) break;
    current = current.parentElement;
  }
  return chain;
};

const classesOf = (el: Element): string[] => Array.from(el.classList);

/**
 * Vertical inset (in rem) reserved by a `max-h-[calc(100vh-Xrem)]` style class.
 * The viewport unit (`vh`/`dvh`/`svh`) and the offset unit (`rem`/`px`) are both
 * tolerated so a legitimate unit change does not fail the test; null means the
 * element carries no viewport-relative height bound at all.
 */
const viewportInsetRem = (el: Element): number | null => {
  for (const cls of classesOf(el)) {
    const match = /^max-h-\[calc\(100[ds]?vh-(\d+(?:\.\d+)?)(rem|px)\)\]$/.exec(cls);
    if (match) {
      const value = Number(match[1]);
      return match[2] === 'px' ? value / 16 : value;
    }
  }
  return null;
};

/** Vertical padding (rem) the backdrop keeps around the panel (Tailwind `p-N` is N × 0.25rem). */
const verticalPaddingRem = (el: Element): number | null => {
  for (const cls of classesOf(el)) {
    const match = /^py?-(\d+(?:\.\d+)?)$/.exec(cls);
    if (match) return Number(match[1]) * 0.25;
  }
  return null;
};

const renderModal = async (onClose = vi.fn()) => {
  const view = render(<InviteModal team={team} onClose={onClose} />);
  // The invite link is generated asynchronously on mount; flush it inside act.
  const heading = await screen.findByRole('heading', { name: /invite teammates/i });
  await waitFor(() => expect(screen.getByRole('button', { name: 'Done' })).toBeInTheDocument());
  const backdrop = view.container.firstElementChild as HTMLElement;
  const panel = ancestorsUpTo(heading, backdrop)[0];
  return { ...view, onClose, backdrop, heading, panel };
};

describe('InviteModal responsive layout', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    stubFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('bounds the rendered dialog to the viewport height', async () => {
    const { backdrop, panel } = await renderModal();

    const inset = viewportInsetRem(panel);
    const padding = verticalPaddingRem(backdrop);

    // The panel never grows past the screen…
    expect(inset).not.toBeNull();
    // …its bound leaves room for the gap the backdrop keeps above and below it,
    // otherwise the bottom of the dialog is clipped off a phone screen…
    expect(padding).not.toBeNull();
    expect(inset ?? 0).toBeGreaterThanOrEqual(2 * (padding ?? 0));
    // …and it is a column flexbox so its inner region can shrink and scroll.
    expect(classesOf(panel)).toEqual(expect.arrayContaining(['flex', 'flex-col']));
    // On a phone the panel is top-aligned and the backdrop itself scrolls.
    expect(classesOf(backdrop)).toContain('overflow-y-auto');
  });

  it('renders the tab content inside an internal scroll region', async () => {
    const { panel } = await renderModal();

    const tabContent = screen.getByPlaceholderText(/teammate@example.com/i);
    const scrollRegion = ancestorsUpTo(tabContent, panel).find(
      el => el.classList.contains('overflow-y-auto') && el.classList.contains('min-h-0')
    );

    expect(scrollRegion).toBeTruthy();
    expect(scrollRegion).not.toBe(panel);
  });

  it('exposes a close control outside the scroll region that invokes onClose', async () => {
    const user = userEvent.setup();
    const { panel, onClose } = await renderModal();

    const closeButton = screen.getByRole('button', { name: 'close' });
    // The icon-font glyph is what the user sees as the "X" affordance.
    expect(within(closeButton).getByText('close')).toHaveClass('material-symbols-outlined');
    // It is pinned to the panel, not to the scrolling content.
    expect(
      ancestorsUpTo(closeButton, panel).some(el => el.classList.contains('overflow-y-auto'))
    ).toBe(false);

    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps the Done button reachable below the scroll region', async () => {
    const user = userEvent.setup();
    const { panel, onClose } = await renderModal();

    const doneButton = screen.getByRole('button', { name: 'Done' });
    // Never squeezed away when the tab content is tall.
    expect(doneButton).toHaveClass('shrink-0');
    expect(
      ancestorsUpTo(doneButton, panel).some(el => el.classList.contains('overflow-y-auto'))
    ).toBe(false);

    await user.click(doneButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
