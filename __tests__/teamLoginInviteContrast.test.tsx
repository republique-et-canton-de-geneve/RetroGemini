import React from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import type { Team } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The hints a member-email invite link shows, measured against Tailwind's theme.
 *
 * InviteModal can invite a person by address (`createMemberInvite`), and the
 * link then carries `memberEmail`. TeamLogin lists the participants with no
 * email on file and shows two hints only that link produces: "No email on file"
 * under each name (on the selected row's `bg-indigo-50`) and "Joining as …"
 * (on `bg-slate-100`). In `text-slate-500` they measured 4.26:1 and 4.35:1. The
 * e2e audit opens the join screen through the plain team link, which shows
 * neither, so this is the only test that sees them.
 */

const FLOOR = 4.5;

const fullTeam = {
  id: 'team-1',
  name: 'Alpha Team',
  passwordHash: 'hash',
  members: [
    { id: 'u1', name: 'Alice', color: 'bg-indigo-500', role: 'facilitator' },
    // Listed for a member-email link only because neither has an email.
    { id: 'u2', name: 'Bob', color: 'bg-emerald-500', role: 'participant' },
    { id: 'u3', name: 'Chloé', color: 'bg-amber-500', role: 'participant' },
  ],
  customTemplates: [],
  retrospectives: [],
  healthChecks: [],
  globalActions: [],
} as unknown as Team;

const inviteData = { teamId: 'team-1', teamName: 'Alpha Team', memberEmail: 'new@example.com' } as never;

vi.mock('../services/dataService', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('../services/dataService');
  return {
    ...actual,
    dataService: {
      listTeams: vi.fn(async () => []),
      importTeam: vi.fn(async () => ({ ...fullTeam })),
      autoJoinFromInvite: vi.fn(() => {
        throw new (actual.InviteAutoJoinError as new (m: string, c: string) => Error)('not verified', 'INVITE_NOT_VERIFIED');
      }),
    },
  };
});

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, '', '/');
  global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({ infoMessage: '' }) })) as unknown as typeof fetch;
});

const renderInvite = () => render(<TeamLogin onLogin={vi.fn()} onJoin={vi.fn()} inviteData={inviteData} />);

const pickerRow = async (name: string) => {
  const picker = await screen.findByRole('group', { name: 'Select a member without an email' });
  const row = within(picker).getByText(name).closest('button');
  if (!row) throw new Error(`no picker row for ${name}`);
  return row;
};

const expectReadable = (element: Element, background: string) => {
  const pair = effectivePair(element);
  expect(pair.bg).toBe(background);
  expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
};

describe('member-email invite hints', () => {
  it('"No email on file" clears 4.5:1 on the selected row', async () => {
    renderInvite();
    fireEvent.click(await pickerRow('Bob'));
    expectReadable(within(await pickerRow('Bob')).getByText('No email on file'), 'indigo-50');
  });

  it('"Joining as …" clears 4.5:1 under the member picker', async () => {
    renderInvite();
    await pickerRow('Bob');
    expectReadable(screen.getByText(/Joining as/), 'slate-100');
  });

  it('"Joining as …" clears 4.5:1 under the name field', async () => {
    renderInvite();
    await pickerRow('Bob');
    fireEvent.click(screen.getByText(/I'm not in the list/));
    await screen.findByLabelText('Your Name');
    expectReadable(screen.getByText(/Joining as/), 'slate-100');
  });
});
