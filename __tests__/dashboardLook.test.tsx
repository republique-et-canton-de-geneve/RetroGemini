import React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Dashboard from '../components/Dashboard';
import TeamFeedback from '../components/TeamFeedback';
import { ColorPicker } from '../components/ColorPicker';
import * as look from '../components/dashboard/dashboardLook';
import type { HealthCheckSession, RetroSession, Team, User } from '../types';
import { effectivePair, tokenContrast } from './helpers/tailwindTheme';

/**
 * The Clarté look of the Dashboard and the Feedback Hub, as rules that must
 * stay true whatever the classes become. Every colour pair is measured (text
 * 4.5:1, the edge of a field or a switch 3:1), the pairs the e2e audit never
 * walks included: disabled states, empty states, the notices of the forms, the
 * chips of every status, text on a grey or tinted surface.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getHealthCheckTemplates: vi.fn(() => []),
    deleteCustomTemplate: vi.fn(),
    renameTeam: vi.fn(),
    getAuthenticatedPassword: vi.fn(() => 'pw'),
    getSessionToken: vi.fn(() => 'token')
  }
}));

// The icon picker is another package's; here it only has to hand back a name
// that no cut of the font draws, as a column stored before 45.0 may hold.
vi.mock('../components/IconPicker', () => ({
  IconPicker: ({ onChange }: { onChange: (icon: string) => void }) => (
    <button type="button" onClick={() => onChange('clarity')}>Pick the stored icon</button>
  )
}));

const TEXT = 4.5;
const EDGE = 3;
/** A negative margin class, with or without a variant: `-mb-px`, `sm:-mx-1`, `mt-[-2px]`. */
const NEGATIVE_MARGIN = /(^|:)(-m[trblxyse]?-|m[trblxyse]?-\[-)/;

/** The one colour token a recipe sets with this prefix (`text-`, `disabled:bg-`…), variants excluded. */
const tokenOf = (classes: string, prefix: string): string => {
  const found = classes
    .split(/\s+/)
    .filter((token) => token.startsWith(prefix) && !token.slice(prefix.length).includes(':'))
    .map((token) => token.slice(prefix.length))
    .filter((name) => /^(white|black|[a-z]+-\d{2,3})$/.test(name));
  expect(found, `${prefix} in "${classes}"`).toHaveLength(1);
  return found[0];
};

const textPair = (classes: string, variant = '') =>
  tokenContrast(tokenOf(classes, `${variant}text-`), tokenOf(classes, `${variant}bg-`));

describe('the recipes, measured', () => {
  it.each([
    ['PRIMARY_BUTTON', look.PRIMARY_BUTTON],
    ['SECONDARY_BUTTON', look.SECONDARY_BUTTON],
    ['DANGER_SECONDARY_BUTTON', look.DANGER_SECONDARY_BUTTON],
    ['DANGER_BUTTON', look.DANGER_BUTTON]
  ])('%s reads at 4.5:1', (_name, classes) => {
    expect(textPair(classes)).toBeGreaterThanOrEqual(TEXT);
  });

  // Drawn in colours of their own, never faded with opacity: what is faded
  // cannot be measured, and a disabled button still has to be read.
  it.each([
    ['PRIMARY_BUTTON', look.PRIMARY_BUTTON],
    ['SECONDARY_BUTTON', look.SECONDARY_BUTTON],
    ['DANGER_BUTTON', look.DANGER_BUTTON]
  ])('%s disabled still reads at 4.5:1', (_name, classes) => {
    expect(textPair(classes, 'disabled:')).toBeGreaterThanOrEqual(TEXT);
  });

  it('draws the quiet controls in an ink that reads on white, on the page and on their hover', () => {
    for (const classes of [look.GHOST_BUTTON, look.ICON_BUTTON, look.DANGER_ICON_BUTTON]) {
      const ink = tokenOf(classes, 'text-');
      for (const surface of ['white', 'slate-50', tokenOf(classes, 'hover:bg-')]) {
        expect(tokenContrast(ink, surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(TEXT);
      }
      expect(tokenContrast(tokenOf(classes, 'hover:text-'), tokenOf(classes, 'hover:bg-'))).toBeGreaterThanOrEqual(TEXT);
    }
    expect(tokenContrast(tokenOf(look.LINK_BUTTON, 'text-'), 'white')).toBeGreaterThanOrEqual(TEXT);
  });

  it('gives a field an edge of 3:1 and a placeholder of 4.5:1', () => {
    expect(tokenContrast(tokenOf(look.FIELD_BOX, 'border-'), 'white')).toBeGreaterThanOrEqual(EDGE);
    expect(tokenContrast(tokenOf(look.FIELD_BOX, 'placeholder:text-'), 'white')).toBeGreaterThanOrEqual(TEXT);
    expect(tokenContrast(tokenOf(look.COLUMN_ICON_BUTTON, 'border-'), 'white')).toBeGreaterThanOrEqual(EDGE);
    expect(tokenContrast(tokenOf(look.SEGMENTED, 'border-'), 'white')).toBeGreaterThanOrEqual(EDGE);
  });

  describe('the fill of a field made read-only', () => {
    // Every background the recipe gives a field in a state of its own, as the
    // selector it is drawn under: `read-only:` is `:read-only`, an arbitrary
    // variant `[&…]` is its own selector. Hover and focus are what a pointer
    // and the keyboard do to a field, not a state of it.
    const stateFills = look.FIELD_BOX.split(/\s+/).flatMap((token) => {
      const match = /^(.+):bg-([a-z]+-\d{2,3}|white)$/.exec(token);
      if (!match) return [];
      const [, variant, colour] = match;
      if (variant === 'hover' || variant === 'focus') return [];
      const arbitrary = /^\[(.+)\]$/.exec(variant);
      if (arbitrary) return [{ selector: arbitrary[1].replace(/&/g, ''), colour }];
      if (variant === 'read-only') return [{ selector: ':read-only', colour }];
      throw new Error(`FIELD_BOX fills a field under "${variant}": say here which fields that is`);
    });

    it('is drawn on a text field or a textarea made read-only, never on a select, a file input or a disabled field', () => {
      // `:read-only` is not "made read-only": it matches every element that
      // cannot be typed in, every select and every file input among them,
      // disabled or not, and a disabled text field or textarea (jsdom and
      // Chromium agree; e2e/dashboard-actions-tab.spec.ts measures what
      // Chromium paints on the Actions tab's select). Given so, the fill drew
      // the selects and the feedback image field of these screens at rest as
      // the Feedback Hub draws a draft locked while it is sent. The locked
      // draft keeps its fill. The recipe has no disabled look: a disabled
      // field takes its own `disabled:` colours, measured where it is drawn.
      expect(stateFills.length).toBeGreaterThan(0);
      document.body.innerHTML = `
        <input data-case="a text field made read-only" type="text" readonly>
        <textarea data-case="a textarea made read-only" readonly></textarea>
        <input data-case="a text field" type="text">
        <textarea data-case="a textarea"></textarea>
        <input data-case="a disabled text field" type="text" disabled>
        <textarea data-case="a disabled textarea" disabled></textarea>
        <select data-case="a select"><option>One</option></select>
        <select data-case="a disabled select" disabled><option>One</option></select>
        <input data-case="a file input" type="file">
        <input data-case="a disabled file input" type="file" disabled>`;
      const filled = [...document.querySelectorAll('[data-case]')]
        .filter((field) => stateFills.some(({ selector }) => field.matches(selector)))
        .map((field) => field.getAttribute('data-case'));
      document.body.innerHTML = '';
      expect(filled).toEqual(['a text field made read-only', 'a textarea made read-only']);
    });

    it('keeps the field’s text at 4.5:1', () => {
      for (const { colour } of stateFills) {
        expect(tokenContrast(tokenOf(look.FIELD_BOX, 'text-'), colour), colour).toBeGreaterThanOrEqual(TEXT);
      }
    });
  });

  it('draws a switch whose track shows on white in both states, and whose knob shows on the track', () => {
    for (const state of [look.SWITCH_ON, look.SWITCH_OFF]) {
      const track = tokenOf(state, 'bg-');
      expect(tokenContrast(track, 'white'), `${track} on white`).toBeGreaterThanOrEqual(EDGE);
      expect(tokenContrast(tokenOf(look.SWITCH_KNOB, 'bg-'), track), `knob on ${track}`).toBeGreaterThanOrEqual(EDGE);
    }
  });

  it('reads both states of a filter pill and of a segment', () => {
    expect(textPair(look.FILTER_PILL_ON)).toBeGreaterThanOrEqual(TEXT);
    expect(textPair(look.FILTER_PILL_OFF)).toBeGreaterThanOrEqual(TEXT);
    // The chosen pill differs from the others by its border too, not by colour alone.
    expect(tokenContrast(tokenOf(look.FILTER_PILL_ON, 'border-'), 'white')).toBeGreaterThanOrEqual(EDGE);
    expect(textPair(look.SEGMENT_ON)).toBeGreaterThanOrEqual(TEXT);
    expect(tokenContrast(tokenOf(look.SEGMENT_OFF, 'text-'), 'white')).toBeGreaterThanOrEqual(TEXT);
  });

  it('reads every status and type chip', () => {
    for (const status of ['IN_PROGRESS', 'OPEN_BOARD', 'CLOSED']) {
      expect(textPair(look.sessionStatusChip(status)), status).toBeGreaterThanOrEqual(TEXT);
    }
    for (const status of ['pending', 'in_progress', 'resolved', 'rejected'] as const) {
      expect(textPair(look.feedbackStatusChip(status)), status).toBeGreaterThanOrEqual(TEXT);
    }
    for (const type of ['bug', 'feature'] as const) {
      expect(textPair(look.feedbackTypeChip(type)), type).toBeGreaterThanOrEqual(TEXT);
    }
  });

  it('reads the notices and the muted text where they land', () => {
    expect(textPair(look.ERROR_NOTICE)).toBeGreaterThanOrEqual(TEXT);
    for (const notice of [look.ERROR_TEXT, look.SUCCESS_TEXT]) {
      expect(tokenContrast(tokenOf(notice, 'text-'), 'white')).toBeGreaterThanOrEqual(TEXT);
    }
    expect(textPair(look.EMPTY_STATE)).toBeGreaterThanOrEqual(TEXT);
    // A section label and a setting's title sit on white cards and dialogs.
    expect(tokenContrast(tokenOf(look.SECTION_LABEL, 'text-'), 'white')).toBeGreaterThanOrEqual(TEXT);
    // The muted text of these screens is slate-600 where it lies on the
    // page's grey (slate-50): a step darker than it needs, since slate-500
    // reads there too (lookTokens.test.ts).
    expect(tokenContrast('slate-600', 'slate-50')).toBeGreaterThanOrEqual(TEXT);
  });
});

describe('the files of these screens', () => {
  const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8');
  const files = [
    'components/Dashboard.tsx',
    'components/TeamFeedback.tsx',
    'components/ColorPicker.tsx',
    'components/dashboard/DashboardActionsTab.tsx',
    'components/dashboard/DashboardTabs.tsx',
    'components/dashboard/RecoveryEmailSetting.tsx',
    'components/dashboard/ReleaseAnalysisModal.tsx',
    'components/dashboard/DashboardRevokedBanner.tsx',
    'components/dashboard/dashboardLook.ts'
  ];

  it.each(files)('%s fades no control and blurs no backdrop', (path) => {
    const source = read(path);
    expect(source).not.toMatch(/disabled:opacity-/);
    expect(source).not.toMatch(/backdrop-blur/);
  });

  it('draws the colour picker in the look’s neutrals, not in another grey', () => {
    expect(read('components/ColorPicker.tsx')).not.toMatch(/\b(?:text|bg|border|ring)-gray-/);
  });

  it('keeps the seventeen colours the picker offers', () => {
    const colours = [...read('components/ColorPicker.tsx').matchAll(/^\s*'(#[0-9a-f]{6})', \/\//gm)].map((m) => m[1]);
    expect(colours).toEqual([
      '#dc2626', '#e11d48', '#db2777', '#c026d3', '#9333ea', '#7c3aed', '#4f46e5', '#2563eb', '#0284c7',
      '#0891b2', '#0d9488', '#059669', '#16a34a', '#65a30d', '#ca8a04', '#ea580c', '#475569'
    ]);
  });
});

const facilitator: User = { id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator', email: 'fac@example.com' };
const participant: User = { id: 'mem-1', name: 'Alice', color: 'bg-emerald-500', role: 'participant' };

const retro = (overrides: Partial<RetroSession>): RetroSession => ({
  id: 'r1',
  teamId: 'team-1',
  name: 'Sprint 12',
  date: '6/1/2026',
  status: 'CLOSED',
  phase: 'CLOSE',
  icebreakerQuestion: '',
  columns: [],
  templateLanguage: 'en',
  settings: {
    isAnonymous: false,
    maxVotes: 5,
    oneVotePerTicket: false,
    revealBrainstorm: true,
    revealHappiness: false,
    revealRoti: false,
    timerSeconds: 0,
    timerRunning: false,
    timerInitial: 0
  },
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  ...overrides
});

const healthCheck = (overrides: Partial<HealthCheckSession>): HealthCheckSession => ({
  id: 'hc-1',
  teamId: 'team-1',
  name: 'Q4 health',
  date: '6/1/2026',
  status: 'CLOSED',
  phase: 'CLOSE',
  templateId: 'team_health_en',
  templateName: 'Team health',
  dimensions: [],
  settings: { isAnonymous: false, revealRoti: false },
  ratings: {},
  actions: [],
  roti: {},
  finishedUsers: [],
  ...overrides
});

const buildTeam = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-1',
  name: 'Coffee Team',
  passwordHash: 'hash',
  members: [facilitator, participant],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...overrides
});

const renderDashboard = (team: Team, initialTab: 'RETROS' | 'HEALTH_CHECKS' | 'MEMBERS' | 'SETTINGS') =>
  render(
    <Dashboard
      team={team}
      currentUser={facilitator}
      onOpenSession={vi.fn()}
      onOpenHealthCheck={vi.fn()}
      onRefresh={vi.fn()}
      initialTab={initialTab}
    />
  );

const measured = (element: Element, floor = TEXT) => {
  const pair = effectivePair(element);
  expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(floor);
};

describe('the Dashboard’s screens, measured', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) }) as never;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lays its tabs on a strip that scrolls sideways, with no negative margin to scroll it vertically', () => {
    renderDashboard(buildTeam(), 'RETROS');
    const tabs = [...document.querySelectorAll('.dash-tab')];
    expect(tabs).toHaveLength(6);
    // The strip scrolls sideways on a phone, so it clips at its padding box
    // and scrolls vertically too: the `-mb-px` each tab carried gave it a
    // scrollbar for one pixel at every width (e2e/no-stray-scrollbars.spec.ts).
    expect(tabs[0].parentElement).toHaveClass('overflow-x-auto');
    for (const tab of tabs) {
      const negative = (tab.getAttribute('class') ?? '').split(/\s+/).filter((token) => NEGATIVE_MARGIN.test(token));
      expect(negative, tab.textContent ?? '').toEqual([]);
    }
  });

  it('reads a closed retrospective’s status and date', () => {
    renderDashboard(buildTeam({ retrospectives: [retro({})] }), 'RETROS');
    measured(screen.getByText('CLOSED'));
    measured(screen.getByText('6/1/2026'));
    measured(screen.getByRole('button', { name: 'View Summary' }));
  });

  it('reads a closed health check’s status and the line beside it', () => {
    renderDashboard(buildTeam({ healthChecks: [healthCheck({})] }), 'HEALTH_CHECKS');
    measured(screen.getByText('CLOSED'));
    measured(screen.getByText('Team health', { selector: 'span' }));
  });

  it('reads the empty lists', () => {
    renderDashboard(buildTeam(), 'RETROS');
    measured(screen.getByText('No retrospectives yet. Start one!'));
  });

  it('reads the empty health check list', () => {
    renderDashboard(buildTeam(), 'HEALTH_CHECKS');
    measured(screen.getByText(/No health checks yet/));
  });

  it('reads each member’s role and email, and the controls of a row', () => {
    renderDashboard(buildTeam(), 'MEMBERS');
    measured(screen.getByText('fac@example.com'));
    for (const button of screen.getAllByRole('button', { name: 'Edit member' })) measured(button, EDGE);
    measured(screen.getByRole('button', { name: 'Remove member' }), EDGE);
  });

  it('draws each member with the picture they chose, outside any session', () => {
    renderDashboard(buildTeam({ memberAvatars: { 'mem-1': { id: 'bee', at: 1 }, 'fac-1': { id: 'not-an-avatar', at: 1 } } }), 'MEMBERS');
    expect([...document.querySelectorAll('[data-avatar-art]')].map((element) => element.getAttribute('data-avatar-art'))).toEqual(['bee']);
  });

  it('reads the settings’ descriptions, the empty template lists and a refused rename', async () => {
    renderDashboard(buildTeam(), 'SETTINGS');
    measured(screen.getByText('No custom retrospective templates yet.'));
    measured(screen.getByText(/No email configured/));
    // Disabled until a name is typed: its disabled colours, measured.
    const rename = screen.getByRole('button', { name: 'Rename Team' }) as HTMLButtonElement;
    expect(rename.disabled).toBe(true);
    expect(rename.className).toContain('disabled:bg-');
    fireEvent.change(screen.getByPlaceholderText('Enter new team name'), { target: { value: 'Coffee Team' } });
    fireEvent.click(rename);
    measured(await screen.findByText('New name is the same as current name'));
  });

  it('draws a stored column icon the font cannot draw as the one it reads as', () => {
    renderDashboard(buildTeam(), 'SETTINGS');
    fireEvent.click(screen.getByRole('button', { name: 'Create Retro Template' }));
    const dialog = screen.getByRole('dialog');
    const iconButton = within(dialog).getByRole('button', { name: 'Pick icon for column 1' });
    fireEvent.click(iconButton);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Pick the stored icon' }));
    expect(within(dialog).getByRole('button', { name: 'Pick icon for column 1' }).textContent).toBe('light_mode');
  });
});

describe('the Feedback Hub, measured', () => {
  const feedback = (overrides: Record<string, unknown>) => ({
    teamId: 'team-1',
    teamName: 'Team One',
    type: 'bug',
    description: 'What happened',
    submittedBy: 'user-1',
    submittedByName: 'User One',
    submittedAt: '2026-08-01T10:00:00.000Z',
    isRead: false,
    status: 'pending',
    comments: [],
    ...overrides
  });
  const feedbacks = [
    feedback({ id: 'f1', title: 'Pending bug', status: 'pending' }),
    feedback({ id: 'f2', title: 'Started feature', type: 'feature', status: 'in_progress', teamId: 'team-2', teamName: 'Team Two' }),
    feedback({ id: 'f3', title: 'Resolved bug', status: 'resolved' }),
    feedback({
      id: 'f4',
      title: 'Rejected bug',
      status: 'rejected',
      comments: [
        { id: 'c1', teamId: 'team-2', teamName: 'Team Two', authorName: 'Bob', content: 'Seen it too', createdAt: '2026-08-02T10:00:00.000Z' },
        { id: 'c2', isAdmin: true, authorName: 'Admin', content: 'Not a bug', createdAt: '2026-08-03T10:00:00.000Z' }
      ]
    })
  ];

  beforeEach(() => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ feedbacks }) })) as never;
  });

  const renderHub = (onSubmitFeedback = vi.fn()) =>
    render(
      <TeamFeedback
        teamId="team-1"
        teamName="Team One"
        teamPassword="pw"
        sessionToken="token"
        currentUserId="user-1"
        currentUserName="User One"
        onSubmitFeedback={onSubmitFeedback}
        onRefresh={vi.fn()}
      />
    );

  it('reads every status, type and team chip of the list', async () => {
    renderHub();
    await screen.findByText('Pending bug');
    for (const label of ['Pending', 'In Progress', 'Resolved', 'Rejected']) {
      for (const chip of screen.getAllByText(label, { selector: 'span' })) measured(chip);
    }
    for (const chip of screen.getAllByText('My Team', { selector: 'span' })) measured(chip);
  });

  // The chip says it in words. The left stripe beside it was decoration: it
  // curved at both corners of the look's card and pushed that card's content
  // right of its neighbours'.
  it("marks the viewer's own team's feedback with its chip alone, no stripe", async () => {
    renderHub();
    const card = async (title: string) => (await screen.findByText(title)).closest('[data-feedback-id]') as HTMLElement;
    const own = await card('Pending bug');
    expect(within(own).getByText('My Team', { selector: 'span' })).toBeInTheDocument();
    for (const each of [own, await card('Started feature')]) {
      expect(each.className.split(/\s+/).filter((token) => /^border-l-/.test(token))).toEqual([]);
    }
  });

  it('reads a comment on its grey and an administrator’s on its amber', async () => {
    renderHub();
    const card = (await screen.findByText('Rejected bug')).closest('div[class*="bg-white"]') as HTMLElement;
    fireEvent.click(within(card).getByRole('button', { name: /Comments/ }));
    measured(within(card).getByText('Seen it too'));
    measured(within(card).getByText('Team Two'));
    measured(within(card).getByText('Not a bug'));
  });

  it('reads the notice of a feedback that was not saved', async () => {
    renderHub(vi.fn(async () => 'not_saved'));
    await screen.findByText('Pending bug');
    fireEvent.click(screen.getByRole('button', { name: 'New Feedback' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'A title' } });
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'A description' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit' }));
    const notice = await screen.findByText('Your feedback could not be saved. Try again in a moment.');
    await waitFor(() => measured(notice));
  });

  it('reads the empty list', async () => {
    globalThis.fetch = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ feedbacks: [] }) })) as never;
    renderHub();
    measured(await screen.findByText('No feedback matches the current filter'));
  });
});

describe('the colour picker, measured', () => {
  it('reads its title, its label and the chosen colour’s code', () => {
    render(<ColorPicker initialColor="#4f46e5" onChange={vi.fn()} onClose={vi.fn()} />);
    measured(screen.getByText('Selected'));
    measured(screen.getByText('#4F46E5'));
    measured(screen.getByRole('button', { name: 'Close the colour picker' }), EDGE);
  });
});
