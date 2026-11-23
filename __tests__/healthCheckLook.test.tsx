import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import HealthCheckSession from '../components/HealthCheckSession';
import SessionHeader from '../components/session/SessionHeader';
import { HealthCheckSession as HealthCheckSessionType, RetroSession, Team, User } from '../types';
import { dataService } from '../services/dataService';
import { syncService } from '../services/syncService';
import { classColor, effectivePair, tokenContrast } from './helpers/tailwindTheme';

/**
 * The health check screen in the 45.0 look ("Clarté"): what it paints,
 * measured, and the header it shares with the retrospective.
 *
 * The e2e audit walks the survey and the close screen once, as the
 * facilitator sees them, on its first state. It never sees a chosen rating,
 * the anonymous notice, the Discuss screen (the score tiles, the vote
 * distribution, its hover tooltip, the comments, an accepted action), the
 * Review rows (a done action, a participant's disabled assignee) or the
 * revealed ROTI results. Those are measured here with the engine the gate
 * uses (helpers/tailwindTheme), which refuses a colour it cannot name — an
 * `opacity-*` fade, an arbitrary value — instead of passing it.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn(),
    getHealthCheck: vi.fn(),
    updateHealthCheckSession: vi.fn(),
    persistParticipants: vi.fn(),
    applyRemoteHealthCheckSession: vi.fn(),
    getSessionToken: vi.fn(() => null),
    getAuthenticatedPassword: vi.fn(() => null),
    toggleGlobalAction: vi.fn(),
    updateGlobalAction: vi.fn()
  }
}));

vi.mock('../services/syncService', () => ({
  syncService: {
    connect: vi.fn(() => Promise.resolve()),
    joinSession: vi.fn(),
    updateSession: vi.fn(),
    onSessionUpdate: vi.fn(() => () => {}),
    onMemberJoined: vi.fn(() => () => {}),
    onMemberLeft: vi.fn(() => () => {}),
    onRoster: vi.fn(() => () => {}),
    getCurrentSessionId: vi.fn(),
    leaveSession: vi.fn(),
    onConnectionChange: vi.fn(() => () => {}),
    onJoinDenied: vi.fn(() => () => {}),
    onUpdateRefused: vi.fn(() => () => {}),
    onSyncHealth: vi.fn(() => () => {}),
    getSyncHealth: vi.fn(() => 'ok'),
    getResendDelayMs: vi.fn(() => 0),
    isConnected: vi.fn(() => true)
  }
}));

const TEXT = 4.5;
const NON_TEXT = 3;

const facilitator: User = { id: 'fac', name: 'Claire', color: 'bg-indigo-500', role: 'facilitator' };
const alice: User = { id: 'a', name: 'Alice', color: 'bg-rose-500', role: 'participant' };
const bob: User = { id: 'b', name: 'Bob', color: 'bg-cyan-500', role: 'participant' };

// Three dimensions whose averages fall in the three score ranges (good,
// middling, poor), so every score tile is drawn.
const createSession = (overrides: Partial<HealthCheckSessionType> = {}): HealthCheckSessionType => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Team Health',
  date: new Date().toISOString(),
  status: 'IN_PROGRESS',
  phase: 'SURVEY',
  templateId: 'template-1',
  templateName: 'Team Health',
  dimensions: [
    { id: 'd-good', name: 'Fun', goodDescription: 'We enjoy it', badDescription: 'Boring' },
    { id: 'd-mid', name: 'Speed', goodDescription: 'Fast', badDescription: 'Slow' },
    { id: 'd-poor', name: 'Process', goodDescription: 'Light', badDescription: 'Heavy' }
  ],
  participants: [facilitator, alice, bob],
  settings: { isAnonymous: false, revealRoti: false, showParticipantVotes: false },
  ratings: {
    fac: { 'd-good': { rating: 5, comment: 'Great' }, 'd-mid': { rating: 3 }, 'd-poor': { rating: 1 } },
    a: { 'd-good': { rating: 4 }, 'd-mid': { rating: 3 }, 'd-poor': { rating: 2 } }
  },
  actions: [],
  discussionFocusId: 'd-good',
  roti: {},
  finishedUsers: [],
  ...overrides
});

const renderSession = (session: HealthCheckSessionType, user: User = facilitator) => {
  const team: Team = {
    id: 'team-1',
    name: 'Team',
    passwordHash: 'hash',
    members: [facilitator, alice, bob],
    customTemplates: [],
    retrospectives: [],
    globalActions: [],
    healthChecks: [session]
  };
  vi.mocked(dataService.getTeam).mockReturnValue(team);
  vi.mocked(dataService.getHealthCheck).mockReturnValue(session);
  vi.mocked(syncService.getCurrentSessionId).mockReturnValue(session.id);
  return render(<HealthCheckSession team={team} currentUser={user} sessionId={session.id} onExit={vi.fn()} />);
};

const measured = (element: Element, floor = TEXT) => {
  const pair = effectivePair(element);
  expect(pair.ratio, `${element.textContent?.trim() || element.tagName}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(floor);
};

/**
 * The edge a control shows at rest, measured against the surface it sits on:
 * the one border colour with no variant (a `hover:` or `focus:` edge is not
 * what is painted at rest), on the control's own background, white when it has
 * none. A control whose only edge is its border needs 3:1 (WCAG 1.4.11).
 */
const restingEdge = (element: Element, floor = NON_TEXT) => {
  const className = element.getAttribute('class') ?? '';
  const edges = className.split(/\s+/).filter((token) => /^border-[a-z]+-\d+$/.test(token));
  expect(edges, `one resting border colour in "${className}"`).toHaveLength(1);
  const edge = edges[0].replace(/^border-/, '');
  const surface = classColor(className, 'bg') ?? 'white';
  expect(tokenContrast(edge, surface), `${edge} edge on ${surface}`).toBeGreaterThanOrEqual(floor);
};

const iconButton = (scope: HTMLElement, ligature: string) =>
  [...scope.querySelectorAll('button')].find((button) => button.textContent?.includes(ligature)) as HTMLButtonElement;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(window.HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() });
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ enabled: false }) })) as unknown as typeof fetch;
});

afterEach(() => cleanup());

describe('the header is the retrospective header', () => {
  // The two headers are measured together by the header-fit e2e at five
  // widths: a class that drifts in one of them is a fit that drifts too.
  const retroHeader = (user: User) => {
    const retro = {
      id: 'r-1', teamId: 'team-1', name: 'Retro', date: '', status: 'IN_PROGRESS', phase: 'BRAINSTORM',
      participants: [facilitator, alice], columns: [], tickets: [], groups: [], actions: [],
      settings: { isAnonymous: false, maxVotes: 5, oneVotePerTicket: false, revealBrainstorm: true },
      leftUsers: [], finishedUsers: []
    } as unknown as RetroSession;
    return render(
      <SessionHeader
        session={retro}
        phases={['BRAINSTORM', 'GROUP', 'VOTE']}
        isFacilitator={user.role === 'facilitator'}
        handleExit={vi.fn()}
        setPhase={vi.fn()}
        updateSession={vi.fn()}
        localParticipantsPanelCollapsed
        participantsCount={2}
        currentUser={user}
        onInvite={vi.fn()}
        isRetroTipsOpen={false}
        onToggleRetroTips={vi.fn()}
        // Nobody here chose an avatar: the one-time hint shows, and marks the opener.
        viewerAvatarMarked
      />
    ).container.querySelector('header') as HTMLElement;
  };

  const shape = (header: HTMLElement) => {
    const bar = header.querySelector('.phase-nav-btn')?.parentElement as HTMLElement;
    const invite = iconButton(header, 'qr_code_2');
    // The sync chip: the first element with a title that is not a button.
    const sync = header.querySelector('[title]:not(button)') as HTMLElement | null;
    // The participants' count, found by its icon (it has no title).
    const chip = ([...header.querySelectorAll('span.material-symbols-outlined')].find((icon) => icon.textContent === 'groups')
      ?.parentElement ?? null) as HTMLElement | null;
    return {
      header: header.className,
      back: iconButton(header, 'arrow_back').className,
      backGroup: iconButton(header, 'arrow_back').parentElement?.className,
      bar: bar.className,
      active: header.querySelector('.phase-nav-btn.active')?.className,
      inactive: header.querySelector('.phase-nav-btn:not(.active)')?.className,
      // The current phase is said as a state, the same way in both headers.
      activeState: header.querySelector('.phase-nav-btn.active')?.getAttribute('aria-current') ?? null,
      inactiveState: header.querySelector('.phase-nav-btn:not(.active)')?.getAttribute('aria-current') ?? null,
      label: header.querySelector('.phase-nav-btn span')?.className,
      cluster: (invite ?? header.querySelector('[data-viewer-avatar]'))?.parentElement?.className,
      invite: invite?.className,
      sync: sync?.className,
      syncChildren: sync ? [...sync.children].map((child) => child.className) : null,
      chip: chip?.className,
      chipChildren: chip ? [...chip.children].map((child) => child.className) : null,
      name: header.querySelector('[data-viewer-avatar]')?.previousElementSibling?.className,
      avatar: header.querySelector('[data-viewer-avatar]')?.className,
      // The avatar hint's dot on the opener: drawn the same in both headers.
      dot: header.querySelector('[data-viewer-avatar] [data-avatar-hint-dot]')?.className ?? null,
    };
  };

  it.each([facilitator, alice])('draws the same controls with the same classes for %s', (user) => {
    const expected = shape(retroHeader(user));
    cleanup();
    renderSession(createSession(), user);
    // The retrospective's header above is drawn with its panel collapsed,
    // which draws the participants' count; a facilitator's health check
    // opens with its panel expanded.
    const collapse = screen.queryByRole('button', { name: 'Collapse panel' });
    if (collapse) fireEvent.click(collapse);
    const actual = shape(document.querySelector('header') as HTMLElement);
    expect(actual).toEqual(expected);
    // Compared, not absent from both: the hint shows here, and marks the opener.
    expect(actual.dot).not.toBeNull();
    expect(actual.activeState).toBe('step');
    expect(actual.sync).toBeDefined();
    expect(actual.chip).toBeDefined();
  });

  it("shows the viewer's avatar at every width for a participant, from 360px for a facilitator", () => {
    renderSession(createSession(), facilitator);
    expect(document.querySelector('[data-viewer-avatar]')?.className).toContain('hidden min-[360px]:flex');
    cleanup();
    renderSession(createSession(), alice);
    const avatar = document.querySelector('[data-viewer-avatar]') as HTMLElement;
    expect(avatar.className.split(/\s+/)).not.toContain('hidden');
    // The picker's opener, named by the person (AGENTS.md, *Avatars*).
    expect(avatar.tagName).toBe('BUTTON');
    expect(avatar.getAttribute('aria-label')).toBe('AL, Alice, choose my avatar');
  });

  it('reads every phase label and hides the icons from assistive technology', () => {
    renderSession(createSession({ phase: 'DISCUSS' }));
    const header = document.querySelector('header') as HTMLElement;
    for (const button of header.querySelectorAll('.phase-nav-btn')) measured(button.querySelector('span') as Element);
    for (const icon of header.querySelectorAll('button > .material-symbols-outlined')) {
      expect(icon.getAttribute('aria-hidden'), icon.textContent ?? '').toBe('true');
    }
    // The dictionary's capitals stay the accessible name.
    expect(screen.getByRole('button', { name: 'DISCUSS' }).className).toContain('active');
  });
});

describe('the survey', () => {
  it('marks the chosen rating as pressed and reads every score button', () => {
    renderSession(createSession());
    const card = screen.getByRole('heading', { name: 'Fun' }).parentElement as HTMLElement;
    const buttons = within(card).getAllByRole('button').filter((button) => /^[1-5]$/.test(button.textContent ?? ''));
    expect(buttons).toHaveLength(5);
    for (const button of buttons) {
      expect(button.getAttribute('aria-pressed')).toBe(button.textContent === '5' ? 'true' : 'false');
      measured(button);
      // An unchosen score is a control on white: its edge must be seen.
      if (button.getAttribute('aria-pressed') === 'false') restingEdge(button);
    }
  });

  it('reads the scale, the descriptions, the notice and the saved mark', () => {
    renderSession(createSession());
    const card = screen.getByRole('heading', { name: 'Fun' }).parentElement as HTMLElement;
    for (const text of ['Strongly Disagree', 'Neutral', 'Strongly Agree', 'Bad:', 'Good:', 'We enjoy it', 'Boring', 'SAVED']) {
      const node = within(card).getByText(text);
      measured(node);
      expect(node.className, text).not.toMatch(/text-\[(9|10|11)px\]/);
    }
    measured(screen.getByText('Your ratings are visible to the team'));
  });

  it('reads the anonymous notice', () => {
    renderSession(createSession({ settings: { isAnonymous: true, revealRoti: false, showParticipantVotes: false } }));
    measured(screen.getByText('Your ratings are anonymous'));
  });

  it('gives the comment field an edge of 3:1 and a visible focus', () => {
    renderSession(createSession());
    for (const field of screen.getAllByPlaceholderText('Additional comments (optional)...')) {
      restingEdge(field);
      expect(field.className).toContain('focus:ring-4');
      expect(field.className).not.toContain('focus:outline-hidden focus:border');
    }
  });

  it('reads the progress line and the primary button', () => {
    renderSession(createSession());
    measured(screen.getByText(/participants finished/));
    measured(screen.getByRole('button', { name: 'Next: Discuss' }));
  });
});

describe('Discuss', () => {
  const discuss = (overrides: Partial<HealthCheckSessionType> = {}, user: User = facilitator) =>
    renderSession(createSession({ phase: 'DISCUSS', ...overrides }), user);

  // The same bar as the retrospective's Discuss: no rule before "Show votes",
  // which opened the label's own line once the bar wrapped on a phone.
  it('spaces its bar with gaps, never a rule before "Show votes", and lets it wrap', () => {
    discuss();
    const label = screen.getByLabelText('Show votes').closest('label') as HTMLElement;
    expect(label.className).not.toMatch(/(^|\s)border-l(-|\s|$)/);
    expect(label.className).not.toMatch(/(^|\s)pl-/);
    for (const box of [label.parentElement!, label.parentElement!.parentElement!]) {
      expect(box).toHaveClass('flex-wrap');
      expect(box.className).toMatch(/(^|\s)gap-x-/);
    }
  });

  it('reads the score of every range on its tile', () => {
    discuss();
    for (const name of ['Fun', 'Speed', 'Process']) {
      const card = document.querySelector(`[data-dimension-id="d-${name === 'Fun' ? 'good' : name === 'Speed' ? 'mid' : 'poor'}"]`) as HTMLElement;
      expect(card, name).toBeTruthy();
      const score = within(card).getAllByText(/^\d\.\d$/)[0];
      measured(score);
      measured(within(card).getByText(/rating/));
    }
  });

  it('gives each dimension a thin edge and the one in focus a ring that moves nothing', () => {
    discuss();
    const focused = document.querySelector('[data-dimension-id="d-good"]') as HTMLElement;
    const other = document.querySelector('[data-dimension-id="d-mid"]') as HTMLElement;
    expect(focused.className).toContain('border-indigo-600');
    expect(focused.className).toContain('ring-4');
    expect(other.className).toContain('border-slate-200');
    for (const card of [focused, other]) expect(card.className.split(/\s+/)).not.toContain('border-2');
  });

  it('shows the details toggle and the chevron at 3:1', () => {
    discuss();
    const card = document.querySelector('[data-dimension-id="d-mid"]') as HTMLElement;
    const toggle = within(card).getByRole('button', { name: 'Toggle dimension details' });
    measured(toggle.querySelector('.material-symbols-outlined') as Element, NON_TEXT);
    const chevron = within(card).getByText('expand_more');
    measured(chevron, NON_TEXT);
    expect(chevron.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    measured(toggle.querySelector('.material-symbols-outlined') as Element, NON_TEXT);
    measured(within(card).getByText('Slow'));
  });

  it('reads the distribution, its badges and the voters tooltip', () => {
    discuss();
    const card = document.querySelector('[data-dimension-id="d-good"]') as HTMLElement;
    measured(within(card).getByText('Vote Distribution'));
    const columns = [...card.querySelectorAll('.group')];
    expect(columns).toHaveLength(5);
    for (const column of columns) {
      const [count, badge] = [column.firstElementChild as Element, column.lastElementChild as Element];
      measured(count);
      measured(badge);
      // An empty bar is drawn in a neutral token, never faded with opacity.
      for (const bar of column.querySelectorAll('[style]')) expect(bar.className).not.toMatch(/\bopacity-/);
    }
    // The tooltip appears on hover only, so no audit ever sees it.
    const tooltip = card.querySelector('.bg-slate-800.text-white') as HTMLElement;
    expect(tooltip).toBeTruthy();
    measured(within(tooltip).getAllByText(/Claire|Alice/)[0]);
  });

  it('reads the comments, the empty line on its grey surface and a disabled submit', () => {
    discuss();
    const card = document.querySelector('[data-dimension-id="d-good"]') as HTMLElement;
    measured(within(card).getByText('Comments'));
    measured(within(card).getByText('Great'));
    measured(within(card).getByText(/Claire/, { selector: 'span' }));
    cleanup();
    discuss({ ratings: { a: { 'd-good': { rating: 4 } } } }, alice);
    const bare = document.querySelector('[data-dimension-id="d-good"]') as HTMLElement;
    measured(within(bare).getByText(/No comments/));
    const submit = within(bare).getByRole('button', { name: 'Comment' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    measured(submit);
    const field = within(bare).getByPlaceholderText('Add a comment...');
    restingEdge(field);
  });

  it('reads an accepted action and shows its delete control at 3:1', () => {
    discuss({
      actions: [{ id: 'act-1', text: 'Plan a team lunch', assigneeId: null, done: false, type: 'new', linkedTicketId: 'd-good', proposalVotes: {} }]
    });
    const row = document.querySelector('[data-proposal-state="accepted"]') as HTMLElement;
    measured(within(row).getByText('Accepted:'));
    const field = within(row).getByDisplayValue('Plan a team lunch');
    measured(field);
    expect(field.className).toContain('focus:ring-4');
    const remove = within(row).getByRole('button', { name: 'Delete action' });
    measured(remove.querySelector('.material-symbols-outlined') as Element, NON_TEXT);
    fireEvent.click(remove);
    measured(within(row).getByText('Confirm?'));
    measured(within(row).getByRole('button', { name: 'Yes' }));
    measured(within(row).getByRole('button', { name: 'No' }));
  });

  it('reads the propose field and its buttons', () => {
    discuss();
    const field = screen.getByPlaceholderText('Propose an action...');
    restingEdge(field);
    expect(field.className).toContain('focus:ring-4');
    measured(screen.getByRole('button', { name: 'Propose' }));
    const direct = screen.getByRole('button', { name: 'Directly accept action' });
    measured(direct.querySelector('.material-symbols-outlined') as Element, NON_TEXT);
  });

  it('draws the radar with the theme, never a stored hex', () => {
    discuss();
    const radar = document.querySelector('svg[viewBox="0 0 400 400"]') as SVGElement;
    for (const node of radar.querySelectorAll('*')) {
      for (const attribute of ['fill', 'stroke']) {
        const value = node.getAttribute(attribute);
        if (value) expect(value, `${node.tagName} ${attribute}`).toBe('none');
      }
    }
  });
});

describe('Review', () => {
  const review = (user: User = facilitator) => renderSession(createSession({
    phase: 'REVIEW',
    actions: [
      { id: 'act-1', text: 'Plan a team lunch', assigneeId: null, done: false, type: 'new', linkedTicketId: 'd-good', proposalVotes: {} },
      { id: 'act-2', text: 'Cut the meetings', assigneeId: null, done: true, type: 'new', linkedTicketId: 'd-good', proposalVotes: {} }
    ]
  }), user);

  it('reads an open and a done action, the group label and the controls', () => {
    review();
    measured(screen.getByText('Plan a team lunch'));
    // Done is crossed out, not faded: a fade cannot be measured, and failed.
    const done = screen.getByText('Cut the meetings');
    expect(done.closest('.line-through')).toBeTruthy();
    measured(done);
    measured(screen.getByText('Fun'));
    measured(screen.getByRole('button', { name: 'Mark action as done' }).querySelector('.material-symbols-outlined') as Element, NON_TEXT);
    measured(screen.getByRole('button', { name: 'Mark action as not done' }).querySelector('.material-symbols-outlined') as Element, NON_TEXT);
    for (const select of screen.getAllByRole('combobox')) {
      restingEdge(select);
      measured(select);
    }
  });

  it("reads a participant's disabled assignee", () => {
    review(alice);
    for (const select of screen.getAllByRole('combobox')) {
      expect((select as HTMLSelectElement).disabled).toBe(true);
      expect(select.className).toContain('disabled:text-slate-600');
      expect(select.className).toContain('disabled:bg-slate-50');
    }
  });

  it('reads the empty review', () => {
    renderSession(createSession({ phase: 'REVIEW' }));
    measured(screen.getByText(/No actions/));
  });
});

describe('Close (a dark screen)', () => {
  it('reads every line on slate-900 and slate-800 before the reveal', () => {
    renderSession(createSession({ phase: 'CLOSE', roti: { fac: 4 } }));
    measured(screen.getByRole('heading', { name: 'Health Check Complete' }));
    measured(screen.getByText(/Thank you/));
    measured(screen.getByText(/members have voted/));
    measured(screen.getByRole('button', { name: 'Reveal Results' }));
    const scores = screen.getAllByRole('button').filter((button) => /^[1-5]$/.test(button.textContent ?? ''));
    expect(scores).toHaveLength(5);
    for (const score of scores) {
      expect(score.getAttribute('aria-pressed')).toBe(score.textContent === '4' ? 'true' : 'false');
      measured(score);
    }
    measured(screen.getByRole('button', { name: 'Return to Dashboard' }));
  });

  it('reads the revealed results', () => {
    renderSession(createSession({
      phase: 'CLOSE',
      roti: { fac: 4, a: 2 },
      settings: { isAnonymous: false, revealRoti: true, showParticipantVotes: false }
    }));
    measured(screen.getByText(/\/ 5$/));
    const axis = screen.getAllByText(/^[1-5]$/).filter((node) => node.tagName === 'DIV');
    expect(axis).toHaveLength(5);
    for (const label of axis) measured(label);
    // An empty column is drawn in a token, never faded with an inline opacity.
    for (const bar of document.querySelectorAll('[style*="height"]')) {
      expect((bar as HTMLElement).style.opacity).toBe('');
    }
  });
});

describe('the source', () => {
  // The old brand token and fades the colour engine cannot measure, and text
  // below 12px, are gone from these two files.
  it.each(['components/HealthCheckSession.tsx', 'components/session/HealthCheckCommentsSection.tsx'])('%s', (file) => {
    const source = readFileSync(join(__dirname, '..', file), 'utf8');
    expect(source).not.toMatch(/retro-primary/);
    expect(source).not.toMatch(/(?<![\w-])(?:disabled:)?opacity-\d+/);
    expect(source).not.toMatch(/text-\[(9|10|11)px\]/);
    expect(source).not.toMatch(/border-slate-(200|300) rounded-(sm|lg) p-[123]? ?[^"]*focus:/);
  });
});

describe("the participants' count in the header", () => {
  // As in the retrospective's header (sessionHeaderLook.test.tsx): a status,
  // never a control. The panel's rail expands the panel with its own button.
  const chip = () =>
    [...document.querySelectorAll('header span.material-symbols-outlined')].find((icon) => icon.textContent === 'groups')!
      .parentElement as HTMLElement;
  const atWidth = (width: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  const initialWidth = window.innerWidth;
  afterEach(() => atWidth(initialWidth));

  it.each([800, 1280])('is a plain count at %ipx, and a click on it expands nothing', (width) => {
    atWidth(width);
    // A participant's panel starts collapsed: the count shows at every width.
    renderSession(createSession(), alice);
    const count = chip();
    expect(count.tagName).toBe('DIV');
    expect(count).not.toHaveAttribute('role');
    expect(count).not.toHaveAttribute('tabindex');
    expect(count).not.toHaveAttribute('title');
    expect(count.className.split(/\s+/).filter((token) => token === 'cursor-pointer' || token.startsWith('hover:'))).toEqual([]);
    fireEvent.click(count);
    expect(screen.getByRole('button', { name: 'Expand panel' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Collapse panel' })).toBeNull();
  });
});
