import React from 'react';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SuperAdmin from '../components/SuperAdmin';
import type { ActiveSession, BackupEntry, ServerLogEntry, Team, TeamFeedback } from '../types';
import { classColor, effectivePair, tokenContrast } from './helpers/tailwindTheme';

/**
 * The administration console in the dashboard's vocabulary (Clarté), as rules
 * that stay true whatever the classes become: no colour per verb on a row, the
 * brand colour for a switch that is on, the dashboard's tabs, and every chip,
 * button and muted line measured against the surface it lands on — the pairs
 * the console's axe audit never walks included (a disabled button, a switch
 * that cannot be used yet).
 */

const TEXT = 4.5;
const EDGE = 3;
const ROOT = join(__dirname, '..');
/** A negative margin class, with or without a variant: `-mb-px`, `sm:-mx-1`, `mt-[-2px]`. */
const NEGATIVE_MARGIN = /(^|:)(-m[trblxyse]?-|m[trblxyse]?-\[-)/;

const team = (id: string, name: string): Team => ({
  id,
  name,
  passwordHash: 'hash',
  facilitatorEmail: `${id}@example.com`,
  members: [{ id: `${id}-u`, name: 'Alice', color: 'bg-indigo-500', role: 'facilitator' }],
  customTemplates: [],
  retrospectives: [],
  retrospectiveCount: 2,
  globalActions: [],
  lastConnectionDate: '2026-11-01T10:00:00.000Z'
});

const feedback = (id: string, type: TeamFeedback['type'], status: TeamFeedback['status'], isRead: boolean): TeamFeedback => ({
  id,
  teamId: 'team-a',
  teamName: 'Alpha',
  type,
  title: `Feedback ${id}`,
  description: 'Something to say.',
  submittedBy: 'team-a-u',
  submittedByName: 'Alice',
  submittedAt: '2026-11-01T10:00:00.000Z',
  isRead,
  status,
  comments: [
    { id: `${id}-c1`, authorId: 'x', authorName: 'Alice', teamId: 'team-a', teamName: 'Alpha', content: 'From the team', createdAt: '2026-11-02T10:00:00.000Z', isAdmin: false },
    { id: `${id}-c2`, authorId: 'admin', authorName: 'Admin', teamId: '', teamName: '', content: 'From the admin', createdAt: '2026-11-03T10:00:00.000Z', isAdmin: true }
  ] as TeamFeedback['comments']
});

const FEEDBACKS: TeamFeedback[] = [
  feedback('f1', 'bug', 'pending', false),
  feedback('f2', 'feature', 'in_progress', true),
  feedback('f3', 'bug', 'resolved', true),
  feedback('f4', 'feature', 'rejected', true)
];

const LOGS: ServerLogEntry[] = (['error', 'warn', 'info'] as const).flatMap((level, i) =>
  (['postgres', 'server', 'socket', 'email'] as const).map((source, j) => ({
    id: `log-${i}-${j}`,
    timestamp: '2026-11-01T10:00:00.000Z',
    level,
    source,
    message: `${level} from ${source}`
  }))
);

const SESSIONS: ActiveSession[] = [
  { sessionId: 's1', type: 'retrospective', teamId: 'team-a', teamName: 'Alpha', sessionName: 'Sprint 12', phase: 'BRAINSTORM', status: 'IN_PROGRESS', participants: [{ id: 'p1', name: 'Alice' }], connectedCount: 1 },
  { sessionId: 's2', type: 'healthcheck', teamId: 'team-b', teamName: 'Bravo', sessionName: 'Health', phase: 'SURVEY', status: 'IN_PROGRESS', participants: [{ id: 'p2', name: 'Bob' }], connectedCount: 1 }
];

const BACKUPS: BackupEntry[] = (['auto', 'manual', 'startup', 'imported'] as const).map((type, i) => ({
  id: `backup-${type}`,
  filename: `${type}.json.gz`,
  type,
  label: `${type} label`,
  createdAt: '2026-11-01T10:00:00.000Z',
  sizeBytes: 2048,
  teamCount: 2,
  protected: i % 2 === 0
}));

let replies: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  replies = {
    '/api/super-admin/teams': { teams: [team('team-a', 'Alpha'), team('team-b', 'Bravo')] },
    '/api/super-admin/feedbacks': { feedbacks: FEEDBACKS },
    '/api/super-admin/admin-email': { adminEmail: 'admin@example.com', notifyNewTeam: true },
    '/api/super-admin/ai-settings': { ai: { enabled: true, apiUrl: 'http://llm.local', allowSelfSignedCerts: false } },
    '/api/super-admin/logs': { logs: LOGS },
    '/api/super-admin/active-sessions': { sessions: SESSIONS },
    '/api/super-admin/backups/list': {
      backups: BACKUPS,
      config: { enabled: true, intervalHours: 24, maxCount: 7, onStartup: true }
    }
  };
  global.fetch = vi.fn((url: string) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(replies[url] ?? {}) })
  ) as unknown as typeof fetch;
});

const renderConsole = async () => {
  render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);
  await screen.findByText('Alpha');
};

const openTab = async (name: RegExp) => {
  fireEvent.click(screen.getByRole('button', { name }));
};

const measured = (element: Element, floor = TEXT) => {
  const pair = effectivePair(element);
  expect(pair.ratio, `${element.textContent?.trim()}: ${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(floor);
};

/** The colour a state variant (`disabled:`, `aria-disabled:`) paints, measured as a pair. */
const variantPair = (element: Element, variant: string): number => {
  const tokens = (element.getAttribute('class') ?? '').split(/\s+/);
  const pick = (kind: 'text' | 'bg') => {
    const found = tokens
      .filter((token) => token.startsWith(`${variant}${kind}-`))
      .map((token) => token.slice(variant.length + kind.length + 1))
      .filter((name) => /^(white|black|[a-z]+-\d{2,3})$/.test(name));
    expect(found, `${variant}${kind}- on "${element.getAttribute('class')}"`).toHaveLength(1);
    return found[0];
  };
  return tokenContrast(pick('text'), pick('bg'));
};

// Every file of the console, its recipe module (`adminLook.ts`) included: a
// gradient or a fade written there reaches every screen that names the recipe.
const sources = (): Array<{ file: string; text: string }> => {
  const files = ['components/SuperAdmin.tsx', ...readdirSync(join(ROOT, 'components/admin'))
    .filter((name) => /\.tsx?$/.test(name))
    .map((name) => `components/admin/${name}`)];
  return files.map((file) => ({ file, text: readFileSync(join(ROOT, file), 'utf8') }));
};

describe('the console in the dashboard vocabulary', () => {
  // A gradient cannot be measured, and a control faded by opacity cannot
  // either: its colour is a blend no contrast check reads. Disabled states are
  // drawn in colours of their own, as the dashboard's recipes do.
  it.each(sources().map(({ file, text }) => [file, text]))('paints no gradient and fades nothing in %s', (_file, text) => {
    expect(text).not.toMatch(/\bbg-(linear|radial|conic)-/);
    expect(text).not.toMatch(/(^|[\s"'`:])opacity-\d/m);
  });

  it('titles the teams in a white card with its one action, and no band', async () => {
    await renderConsole();
    const heading = screen.getByRole('heading', { name: 'Teams (2)' });
    measured(heading);
    const merge = screen.getByRole('button', { name: /Merge two teams/ });
    measured(merge);
    expect(classColor(merge.getAttribute('class') ?? '', 'bg')).toBe('white');
  });

  it('gives the row actions one neutral ink and the deletion the danger ink', async () => {
    await renderConsole();
    const row = screen.getByRole('row', { name: /Alpha/ });
    const neutral = ['Rename', 'Change Password', 'Edit Email'].map((name) => within(row).getByRole('button', { name }));
    const inks = neutral.map((button) => classColor(button.getAttribute('class') ?? '', 'text'));
    expect(new Set(inks).size, `one ink for every verb: ${inks.join(', ')}`).toBe(1);
    expect(inks[0]).toMatch(/^slate-/);
    neutral.forEach((button) => measured(button));
    const remove = within(row).getByRole('button', { name: 'Delete Alpha' });
    expect(classColor(remove.getAttribute('class') ?? '', 'text')).toMatch(/^rose-/);
    measured(remove);
  });

  it('keeps the inline editor of a row on the recipes', async () => {
    await renderConsole();
    const row = screen.getByRole('row', { name: /Alpha/ });
    fireEvent.click(within(row).getByRole('button', { name: 'Rename' }));
    const field = screen.getByPlaceholderText('Team name');
    expect(field.getAttribute('class')).toContain('border-slate-400');
    expect(field.getAttribute('class')).toContain('focus:ring-indigo-600/15');
    measured(within(row).getByRole('button', { name: 'Save' }));
    measured(within(row).getByRole('button', { name: 'Cancel' }));
  });

  it('draws the switches in the brand colour when on, slate-400 off, and states a disabled one', async () => {
    await renderConsole();
    const aiSwitch = await screen.findByRole('button', { name: 'Disable AI features' });
    expect(classColor(aiSwitch.getAttribute('class') ?? '', 'bg')).toBe('indigo-600');
    const selfSigned = screen.getByRole('button', { name: 'Allow self-signed certificates' });
    expect(classColor(selfSigned.getAttribute('class') ?? '', 'bg')).toBe('slate-400');
    expect(tokenContrast('slate-400', 'white')).toBeGreaterThanOrEqual(EDGE);
    const notify = await screen.findByRole('button', { name: 'Disable new team notifications' });
    expect(classColor(notify.getAttribute('class') ?? '', 'bg')).toBe('indigo-600');

    // No admin email yet: the switch cannot be used, and says so in a colour
    // of its own rather than a faded copy of the live one.
    replies['/api/super-admin/admin-email'] = { adminEmail: '', notifyNewTeam: false };
    document.body.innerHTML = '';
    await renderConsole();
    const locked = await screen.findByRole('button', { name: /Set an admin email first/ });
    expect(locked).toBeDisabled();
    const tokens = (locked.getAttribute('class') ?? '').split(/\s+/);
    expect(tokens).toContain('disabled:bg-slate-300');
    expect(tokens.some((token) => /^(disabled:)?opacity-/.test(token))).toBe(false);
  });

  it('draws the tabs as the dashboard does', async () => {
    await renderConsole();
    const tabs = [/^Teams \(2\)/, /^Feedback \(4\)/, /^Live Sessions/, /^Server Logs/, /^Backups/]
      .map((name) => screen.getByRole('button', { name }));
    tabs.forEach((tab) => expect(tab).toHaveClass('dash-tab'));
    // Their strip scrolls sideways on a phone, so it clips at its padding box
    // and scrolls vertically too: the `-mb-px` each tab carried gave it a
    // scrollbar for one pixel at every width (e2e/no-stray-scrollbars.spec.ts).
    expect(tabs[0].parentElement).toHaveClass('overflow-x-auto');
    tabs.forEach((tab) => {
      const negative = (tab.getAttribute('class') ?? '').split(/\s+/).filter((token) => NEGATIVE_MARGIN.test(token));
      expect(negative, tab.textContent ?? '').toEqual([]);
    });
    expect(tabs[0]).toHaveClass('active');
    tabs.slice(1).forEach((tab) => {
      expect(tab).not.toHaveClass('active');
      measured(tab);
    });
    measured(within(tabs[1]).getByText('1'));
  });

  it('measures the settings cards: muted text on white, buttons and fields on the recipes', async () => {
    await renderConsole();
    measured(screen.getByText(/Display an important announcement/));
    measured(screen.getByText('Leave empty to disable email notifications for new feedback.'));
    for (const name of [/Save Message/, /Save Email/, /Test Connection/, /Save Settings/, /Download Backup/]) {
      measured(await screen.findByRole('button', { name }));
    }
    const restore = screen.getByRole('button', { name: /Upload & Restore/ });
    expect(restore).toBeDisabled();
    expect(variantPair(restore, 'disabled:')).toBeGreaterThanOrEqual(TEXT);
  });

  it('measures every chip and button of a feedback', async () => {
    await renderConsole();
    await openTab(/^Feedback \(4\)/);
    const card = (await screen.findByRole('heading', { name: 'Feedback f1' })).parentElement!;
    measured(within(card).getByText('New'));
    for (const id of ['f1', 'f2', 'f3', 'f4']) {
      const each = screen.getByRole('heading', { name: `Feedback ${id}` }).parentElement!;
      within(each).getAllByText((_, el) => !!el && el.tagName === 'SPAN' && /rounded-full/.test(el.className))
        .forEach((chip) => measured(chip));
      measured(within(each).getByText('From the admin'));
      measured(within(each).getByText('From the team'));
    }
    for (const name of ['Mark as Read', 'Add Comment', 'Delete']) measured(within(card).getByRole('button', { name }));
    expect(classColor(within(card).getByRole('button', { name: 'Delete' }).getAttribute('class') ?? '', 'text')).toMatch(/^rose-/);
    // The type pills and the status pills, on and off.
    for (const name of ['All (4)', 'Unread (1)', 'Bugs (2)', 'Features (2)', 'Pending (1)', 'Resolved (1)']) {
      screen.getAllByRole('button', { name }).forEach((pill) => measured(pill));
    }
  });

  // As on the Feedback Hub: the "New" chip says it in words, and no left
  // stripe draws it a second time on the card's curved edge.
  it('marks an unread feedback with its chip alone, no stripe', async () => {
    await renderConsole();
    await openTab(/^Feedback \(4\)/);
    const unread = (await screen.findByRole('heading', { name: 'Feedback f1' })).parentElement!;
    expect(within(unread).getByText('New')).toBeInTheDocument();
    for (const id of ['f1', 'f2', 'f3', 'f4']) {
      const card = screen.getByRole('heading', { name: `Feedback ${id}` }).parentElement!;
      expect(card.className.split(/\s+/).filter((token) => /^border-l-/.test(token)), id).toEqual([]);
    }
  });

  it('measures the live sessions', async () => {
    await renderConsole();
    await openTab(/^Live Sessions/);
    await screen.findByText('Sprint 12');
    measured(screen.getByRole('button', { name: /Refresh/ }));
    for (const text of ['Retrospective', 'Health Check']) measured(screen.getByText(text));
    measured(screen.getAllByText('LIVE')[0]);
    measured(screen.getByText('Team: Alpha'));
  });

  // Still, as the session header's "Live" chip is: the word says the state,
  // and a dot that pulses forever, one per session on a tab watched for
  // minutes, would be the one thing moving at rest, for every reader.
  it('draws the dot beside each live session still', async () => {
    await renderConsole();
    await openTab(/^Live Sessions/);
    await screen.findByText('Sprint 12');
    const labels = screen.getAllByText('LIVE');
    expect(labels).toHaveLength(SESSIONS.length);
    for (const label of labels) {
      const dot = label.previousElementSibling!;
      expect(dot.getAttribute('aria-hidden')).toBe('true');
      expect((dot.getAttribute('class') ?? '').split(/\s+/).filter((token) => /(^|:)animate-/.test(token))).toEqual([]);
    }
  });

  it('measures the level and source chips of the logs', async () => {
    await renderConsole();
    await openTab(/^Server Logs/);
    const table = await screen.findByRole('table');
    const chips = within(table).getAllByText((_, el) => !!el && el.tagName === 'SPAN' && /rounded/.test(el.className));
    expect(chips.length).toBe(LOGS.length * 2);
    chips.forEach((chip) => measured(chip));
    // An error or a warning tints its row: the plain text on it still reads.
    for (const level of ['error', 'warn']) {
      const row = within(table).getByRole('row', { name: new RegExp(`${level} from server`) });
      row.querySelectorAll('td').forEach((cell) => measured(cell.querySelector('span') ?? cell));
    }
    expect(classColor(screen.getByRole('button', { name: /Clear Logs/ }).getAttribute('class') ?? '', 'text')).toMatch(/^rose-/);
    measured(screen.getByRole('button', { name: /Clear Logs/ }));
  });

  it('measures the backup list: type chips, the protection toggle and the row icons', async () => {
    await renderConsole();
    await openTab(/^Backups/);
    const table = await screen.findByRole('table');
    for (const backup of BACKUPS) {
      const row = within(table).getByRole('row', { name: new RegExp(`${backup.type} label`) });
      const chip = row.querySelector('td span')!;
      measured(chip);
      measured(within(row).getByTitle(/protect/i));
    }
    const icons = within(table).getAllByRole('button', { name: /Download|Restore|Delete/ });
    icons.forEach((icon) => measured(icon, EDGE));
    measured(screen.getByRole('button', { name: /Create Checkpoint/ }));
  });
});
