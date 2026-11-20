import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TeamLogin from '../components/TeamLogin';
import LanguageProvider from '../i18n/LanguageProvider';
import { InviteAutoJoinError } from '../services/dataService';
import type { Team, TeamSummary } from '../types';

/**
 * The layout of the team picker, read from its classes: jsdom lays out
 * nothing, so what a browser makes of them is measured by
 * `e2e/login-team-picker.spec.ts`. These pin which views and which lists carry
 * the wide classes, which never do, and how the meta line is built.
 *
 * From `lg`, a list of six teams or more (the search field's threshold) takes
 * the Dashboard's width and shows its teams as tiles, two per row. Every form
 * keeps the narrow column, and so do a short, loading, empty or failed list.
 */

const mocks = vi.hoisted(() => ({
  listTeams: vi.fn(),
  importTeam: vi.fn(),
  verifyResetToken: vi.fn(),
  autoJoinFromInvite: vi.fn(),
}));

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return { ...actual, dataService: { ...mocks } };
});

const teamsOf = (count: number): TeamSummary[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `team-${i}`,
    name: `Team ${String.fromCharCode(65 + i)}`,
    memberCount: 7,
    lastConnectionDate: new Date().toISOString(),
  }));

const fullTeam = {
  id: 'team-0',
  name: 'Team A',
  passwordHash: 'hash',
  members: [
    { id: 'u1', name: 'Alice', color: 'bg-indigo-500', role: 'facilitator' },
    { id: 'u2', name: 'Bob', color: 'bg-emerald-500', role: 'participant' },
  ],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [],
  globalActions: [],
} as unknown as Team;

// The classes only the wide list carries, one per element of the chain.
const WIDE_ONLY = ['lg:max-w-6xl', 'lg:min-h-0', 'lg:max-h-none', 'lg:grid-cols-2', 'lg:border', 'lg:line-clamp-2'];

const classTokens = (): Set<string> =>
  new Set(
    Array.from(document.body.querySelectorAll('[class]')).flatMap((element) =>
      (element.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)
    )
  );

const expectNarrow = () => {
  const tokens = classTokens();
  for (const token of WIDE_ONLY) expect(tokens.has(token), token).toBe(false);
  // The column the brand and the card share keeps the forms' width.
  expect(columnOf().className.split(/\s+/)).toContain('max-w-md');
};

/** The column that holds the brand and the one card of the view. */
const columnOf = () => screen.getByRole('heading', { level: 1, name: 'RetroGemini' }).parentElement!.parentElement!;

/** The team rows: buttons that open a team, named by it. */
const teamButton = (name: string) => screen.getByText(name, { selector: 'span' }).closest('button')!;

/** A team's tile: its button and its favourite star, side by side. */
const tileOf = (name: string) => teamButton(name).parentElement!;

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState({}, '', '/');
  mocks.listTeams.mockResolvedValue(teamsOf(8));
  mocks.verifyResetToken.mockResolvedValue({ valid: true });
  mocks.importTeam.mockResolvedValue({ ...fullTeam });
  mocks.autoJoinFromInvite.mockImplementation(() => {
    throw new InviteAutoJoinError('not verified');
  });
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ infoMessage: '' }) })) as unknown as typeof fetch;
});

describe('the team picker of six teams or more', () => {
  it('takes the Dashboard width from lg, and the column, card, list and list box form one chain', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');

    const column = columnOf().className.split(/\s+/);
    // Narrow below lg, wide from lg, capped at what the viewport leaves.
    expect(column).toEqual(expect.arrayContaining(['w-full', 'max-w-md', 'lg:max-w-6xl', 'lg:flex', 'lg:flex-col']));
    expect(column.some((token) => token.startsWith('lg:max-h-['))).toBe(true);

    const heading = screen.getByRole('heading', { name: 'Your Teams' });
    const listRoot = heading.parentElement!.parentElement!;
    const card = listRoot.parentElement!;
    expect(card.className.split(/\s+/)).toEqual(expect.arrayContaining(['lg:flex', 'lg:flex-col', 'lg:min-h-0']));
    expect(listRoot.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-col', 'lg:min-h-0']));

    // The one item of the chain that scrolls, and the one that shrinks.
    const listBox = screen.getByText('Team A').closest('.overflow-y-auto')!;
    expect(listBox.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['overflow-y-auto', 'max-h-[min(26rem,52vh)]', 'lg:max-h-none'])
    );
  });

  it('shows its teams as tiles in two columns from lg, in DOM order, their names on two lines', async () => {
    localStorage.setItem('retro-favorite-teams', JSON.stringify(['team-3']));
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');

    const listBox = screen.getByText('Team A').closest('.overflow-y-auto')!;
    const frames = Array.from(listBox.querySelectorAll('.divide-y'));
    // The favourites' frame and the other teams'.
    expect(frames).toHaveLength(2);
    for (const frame of frames) {
      expect(frame.className.split(/\s+/)).toEqual(
        expect.arrayContaining(['lg:grid', 'lg:grid-cols-2', 'lg:gap-2', 'lg:border-0', 'lg:divide-y-0'])
      );
    }

    const tile = tileOf('Team A');
    expect(tile.className.split(/\s+/)).toEqual(expect.arrayContaining(['lg:rounded-xl', 'lg:border', 'lg:border-slate-200']));
    const name = within(tile).getByText('Team A');
    // Cut on one line below lg, as before; whole on up to two lines from lg.
    expect(name.className.split(/\s+/)).toEqual(
      expect.arrayContaining(['truncate', 'lg:whitespace-normal', 'lg:line-clamp-2', 'lg:break-words'])
    );

    // Reading order is the DOM order: nothing reorders a tile.
    const tokens = [...classTokens()];
    expect(tokens.filter((token) => /(^|:)(grid-flow-(row-|col-)?dense|-?order-)/.test(token))).toEqual([]);
  });

  it('caps the search field at the narrow width', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    const search = await screen.findByPlaceholderText('Search teams...');
    expect(search.parentElement!.className.split(/\s+/)).toContain('lg:max-w-md');
  });

  it('stays wide while a search narrows the list, since the width follows the teams, not the matches', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    fireEvent.change(await screen.findByPlaceholderText('Search teams...'), { target: { value: 'Team A' } });
    expect(screen.queryByText('Team B')).toBeNull();
    expect(columnOf().className.split(/\s+/)).toContain('lg:max-w-6xl');
  });
});

describe('every other state of the screen keeps the narrow card', () => {
  it('keeps five teams or fewer in one frame, in the narrow column', async () => {
    mocks.listTeams.mockResolvedValue(teamsOf(5));
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team E');
    expectNarrow();
  });

  it('keeps the loading, the empty and the failed list narrow', async () => {
    let answer: (teams: TeamSummary[] | null) => void = () => {};
    mocks.listTeams.mockReturnValueOnce(new Promise((resolve) => { answer = resolve; }));
    const { unmount } = render(<TeamLogin onLogin={vi.fn()} />);
    expect(screen.getByRole('status').textContent).toContain('Loading teams');
    expectNarrow();
    answer(null);
    await screen.findByRole('alert');
    expectNarrow();
    unmount();

    mocks.listTeams.mockResolvedValueOnce([]);
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText(/No teams found/);
    expectNarrow();
  });

  it('never widens a form, though the list behind it was wide', async () => {
    render(<TeamLogin onLogin={vi.fn()} onSuperAdminLogin={vi.fn()} />);
    await screen.findByText('Team A');
    expect(columnOf().className.split(/\s+/)).toContain('lg:max-w-6xl');

    // Signing in to a team, then the reset request it offers.
    fireEvent.click(screen.getByText('Team A'));
    await screen.findByLabelText('Password');
    expectNarrow();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    await screen.findByLabelText('Recovery Email');
    expectNarrow();

    // Back to the list, which is wide again.
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Your Teams' });
    expect(columnOf().className.split(/\s+/)).toContain('lg:max-w-6xl');

    // Creating a team.
    fireEvent.click(screen.getByRole('button', { name: '+ New Team' }));
    await screen.findByRole('heading', { name: 'Create New Team' });
    expectNarrow();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await screen.findByRole('heading', { name: 'Your Teams' });

    // The super administrator's sign-in.
    fireEvent.click(screen.getByRole('button', { name: 'Super Admin Access' }));
    await screen.findByRole('heading', { name: 'Super Admin Login' });
    expectNarrow();
  });

  it('keeps the reset form narrow', async () => {
    window.history.replaceState({}, '', `/?reset=${'a'.repeat(64)}`);
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByLabelText('New Password');
    expectNarrow();
  });

  it('keeps both join screens of an invite link narrow', async () => {
    const invite = { id: 'team-0', name: 'Team A', inviteCredential: 'cred' } as never;
    const { unmount } = render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    await screen.findByRole('group', { name: 'Select Your Name' });
    expectNarrow();
    unmount();

    mocks.importTeam.mockRejectedValueOnce(new Error('The server could not be reached. Check your connection, then try again.'));
    render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={invite} />);
    await screen.findByText(/could not be reached/);
    expectNarrow();
  });
});

describe("a team's meta line", () => {
  it('keeps each part whole: the count, and the last activity with its value', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');
    const row = teamButton('Team A');

    // The count never breaks inside ("7 / members").
    const count = within(row).getByText('7 members');
    expect(count.className.split(/\s+/)).toContain('whitespace-nowrap');

    // From sm the last activity is one unit beside the count, and wraps whole.
    const lastActive = within(row).getByText(/Last active/);
    expect(lastActive.className.split(/\s+/)).toContain('sm:whitespace-nowrap');
    const meta = count.parentElement!;
    expect(meta).toBe(lastActive.parentElement);
    expect(meta.className.split(/\s+/)).toEqual(expect.arrayContaining(['block', 'sm:flex', 'sm:flex-wrap']));

    // On a phone the line breaks between the label and its value, never inside
    // the value — except at 320px, where it may, rather than overflow.
    const value = within(lastActive).getByText('Today');
    expect(value).not.toBe(lastActive);
    expect(value.className.split(/\s+/)).toContain('min-[22.5rem]:whitespace-nowrap');
  });

  it('carries its separator with the part it introduces, so a wrapped line never ends on it', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');
    const row = teamButton('Team A');
    const lastActive = within(row).getByText(/Last active/);
    const separator = within(row).getByText('·');
    expect(separator.getAttribute('aria-hidden')).toBe('true');
    // Inside the last activity, at its start: a part that wraps to the start of
    // a line carries it into the clipped margin before the line.
    expect(separator.parentElement).toBe(lastActive);
    expect(lastActive.firstElementChild).toBe(separator);
    expect(lastActive.parentElement!.className.split(/\s+/)).toContain('sm:overflow-hidden');
  });

  it('reads the same way in French', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <TeamLogin onLogin={vi.fn()} />
      </LanguageProvider>
    );
    await screen.findByText('Team A');
    const row = teamButton('Team A');
    expect(within(row).getByText('7 membres').className.split(/\s+/)).toContain('whitespace-nowrap');
    const lastActive = within(row).getByText(/Dernière activité/);
    expect(lastActive.className.split(/\s+/)).toContain('sm:whitespace-nowrap');
    expect(within(lastActive).getByText('aujourd’hui').className.split(/\s+/)).toContain('min-[22.5rem]:whitespace-nowrap');
  });
});

describe('a search that matches nothing', () => {
  it('says so in a status that was in the list before the search', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    const search = await screen.findByPlaceholderText('Search teams...');
    // Empty, but present: a status region added when it has something to say
    // is not reliably announced.
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('No team matches "zzz".');
    expect(screen.queryByText('Team A')).toBeNull();

    fireEvent.change(search, { target: { value: 'Team' } });
    expect(status.textContent).toBe('');
    expect(screen.getByText('Team A')).toBeTruthy();
  });

  it('says so in French', async () => {
    render(
      <LanguageProvider initialLanguage="fr">
        <TeamLogin onLogin={vi.fn()} />
      </LanguageProvider>
    );
    fireEvent.change(await screen.findByPlaceholderText('Rechercher une équipe...'), { target: { value: 'zzz' } });
    expect(screen.getByRole('status').textContent).toBe('Aucune équipe ne correspond à «\u00a0zzz\u00a0».');
  });

  it('adds no status to a list too short to be searched', async () => {
    mocks.listTeams.mockResolvedValue(teamsOf(5));
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

/**
 * The star was a `span role="switch"` inside the team's button: no Tab reached
 * it (WCAG 2.1.1), and a control inside a button is no control to assistive
 * technology, so favourites were for the mouse alone. It is now a button of
 * its own, after its team's.
 */
describe('the favourite star', () => {
  it('is a button of its own beside the team button, never inside it', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');
    const team = teamButton('Team A');
    const star = screen.getByRole('switch', { name: 'Add Team A to favorites' });

    expect(star.tagName).toBe('BUTTON');
    expect(star.getAttribute('type')).toBe('button');
    expect(star.getAttribute('aria-checked')).toBe('false');
    expect(team.contains(star)).toBe(false);
    expect(star.parentElement).toBe(team.parentElement);
    // After its team in DOM order, so after it in the tab order.
    expect(team.compareDocumentPosition(star) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // The team's button is named by the team, and no longer swallows the
    // star's name ("…Last active: Today Add Team A to favorites").
    expect(screen.getAllByRole('button', { name: /Team A/ })).toEqual([team]);
    expect(screen.queryAllByRole('button', { name: /favorites/ })).toHaveLength(0);
  });

  it('is reached by Tab right after its team, then the next team', async () => {
    const user = userEvent.setup();
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');

    teamButton('Team A').focus();
    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('switch', { name: 'Add Team A to favorites' }));
    await user.tab();
    expect(document.activeElement).toBe(teamButton('Team B'));
  });

  it('toggles from the keyboard, the focus following its team to the other section', async () => {
    const user = userEvent.setup();
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');

    // Space makes Team B a favourite: it moves to the top of the list, and
    // React draws its star again there. The focus goes with it rather than
    // falling back to the page.
    screen.getByRole('switch', { name: 'Add Team B to favorites' }).focus();
    await user.keyboard(' ');
    const on = screen.getByRole('switch', { name: 'Remove Team B from favorites' });
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(JSON.parse(localStorage.getItem('retro-favorite-teams') ?? '[]')).toEqual(['team-1']);
    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(document.activeElement).toBe(on);

    // Enter takes it back out, and the focus follows again.
    await user.keyboard('{Enter}');
    const off = screen.getByRole('switch', { name: 'Add Team B to favorites' });
    expect(off.getAttribute('aria-checked')).toBe('false');
    expect(screen.queryByText('Favorites')).toBeNull();
    expect(document.activeElement).toBe(off);
  });

  it('leaves the focus to the pointer: a click does not send it after the moved star', async () => {
    // A pointer user starring teams down a long list: focused in its new
    // place, the star scrolled the list to the favourites at the top, away
    // from the next team to star (measured in Chromium: 906px to 0).
    const user = userEvent.setup();
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');

    await user.click(screen.getByRole('switch', { name: 'Add Team B to favorites' }));
    const on = screen.getByRole('switch', { name: 'Remove Team B from favorites' });
    expect(on.getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).not.toBe(on);
  });

  it('opens the team from the rest of its tile, and nothing from the star', async () => {
    render(<TeamLogin onLogin={vi.fn()} />);
    await screen.findByText('Team A');

    fireEvent.click(screen.getByRole('switch', { name: 'Add Team A to favorites' }));
    expect(screen.getByRole('heading', { name: 'Your Teams' })).toBeTruthy();

    fireEvent.click(within(teamButton('Team A')).getByText('7 members'));
    expect(await screen.findByRole('heading', { name: 'Login to Team A' })).toBeTruthy();
  });
});
