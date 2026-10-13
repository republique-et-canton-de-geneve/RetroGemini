import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SuperAdmin from '../components/SuperAdmin';
import LanguageProvider from '../i18n/LanguageProvider';
import type { Team } from '../types';

/**
 * The console side of merging two teams and deleting one
 * (`components/admin/TeamMergeDialog.tsx`, `TeamDeleteDialog.tsx`). The server
 * side is `superAdminTeamMergeRoutes.test.ts`; here, what the admin sees and
 * what the console sends.
 */

const team = (id: string, name: string, extra: Partial<Team> = {}): Team => ({
  id,
  name,
  passwordHash: '',
  members: [{ id: `${id}-f`, name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...extra
});

let teams: Team[] = [];

const counts = (n: number) => ({
  members: n, archivedMembers: 0, retrospectives: n, healthChecks: 0, globalActions: 0,
  customTemplates: 0, customHealthCheckTemplates: 0, feedbacks: 1
});

const preview = {
  report: {
    sources: [
      { role: 'primary', id: 'a', name: 'Produit', counts: counts(2) },
      { role: 'secondary', id: 'b', name: 'Produit bis', counts: counts(3) }
    ],
    merged: { ...counts(4), retrospectives: 5, feedbacks: 0 },
    members: {
      unified: [
        { fromId: 'b-f', fromName: 'Facilitator', intoId: 'a-f', intoName: 'Facilitator', reason: 'facilitator' },
        { fromId: 'b-jean', fromName: 'Jean', intoId: 'a-jean', intoName: 'Jean', reason: 'name' }
      ],
      keptSameName: [{ name: 'Marie', secondaryId: 'b-marie', reason: 'email_conflict' }],
      reminted: [],
      mintedFacilitator: false,
      sharedEmails: [{ email: 'luc@etat.ge.ch', names: ['Facilitator', 'Luc'] }]
    },
    actions: { reminted: 0 },
    templates: { renamed: [], deduplicated: 0, reminted: 0 },
    sessions: { inProgress: [{ source: 'secondary', name: 'Sprint 9' }], freshened: [] },
    feedbacksToMoveOnDelete: { primary: 1, secondary: 1 },
    settings: { actionImpactRatingEnabled: true, actionImpactNoticeDismissed: false },
    conflicts: []
  },
  liveSessions: [{ source: 'primary', id: 'r1', name: 'Sprint 10' }],
  fingerprints: { primary: 'fp-a', secondary: 'fp-b' },
  defaults: {
    name: 'Produit + Produit bis',
    emails: { primary: 'elisabeth.trolliet@etat.ge.ch', secondary: 'elisabeth.trolliet@etat.ge.ch' },
    passwordSources: { primary: true, secondary: true }
  }
};

type Reply = { status: number; body: unknown };
let replies: Record<string, Reply[]> = {};
let requests: { url: string; body: Record<string, unknown> }[] = [];

const reply = (url: string, ...answers: Reply[]) => {
  replies[url] = answers;
};

const mockFetch = () => {
  global.fetch = vi.fn((url: string, init?: Parameters<typeof fetch>[1]) => {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    requests.push({ url, body });
    const queue = replies[url];
    const answer = url === '/api/super-admin/teams'
      ? { status: 200, body: { teams } }
      : (queue && queue.length > 1 ? queue.shift()! : queue?.[0]) ?? { status: 200, body: {} };
    return Promise.resolve({
      ok: answer.status >= 200 && answer.status < 300,
      status: answer.status,
      json: () => Promise.resolve(answer.body)
    });
  }) as unknown as typeof fetch;
};

const renderConsole = async (language: 'en' | 'fr' = 'en') => {
  render(
    <LanguageProvider initialLanguage={language}>
      <SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />
    </LanguageProvider>
  );
  // The team list, not the header: the header is in the very first render.
  await waitFor(() => expect(screen.getAllByText(teams[0].name).length).toBeGreaterThan(0));
};

const sent = (url: string) => requests.filter((request) => request.url === url);

beforeEach(() => {
  teams = [team('a', 'Produit'), team('b', 'Produit bis'), team('c', 'Autre')];
  replies = {};
  requests = [];
  mockFetch();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('merging two teams from the console', () => {
  const openAndPreview = async () => {
    reply('/api/super-admin/merge-teams/preview', { status: 200, body: preview });
    fireEvent.click(screen.getByRole('button', { name: 'Merge two teams' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge two teams' });
    fireEvent.change(within(dialog).getByLabelText('Main team'), { target: { value: 'a' } });
    fireEvent.change(within(dialog).getByLabelText('Team to add to it'), { target: { value: 'b' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview the merge' }));
    await waitFor(() => expect(within(dialog).getByText('What the new team will hold')).toBeTruthy());
    return dialog;
  };

  it('shows the server’s plan before anything is created', async () => {
    await renderConsole();
    const dialog = await openAndPreview();

    expect(sent('/api/super-admin/merge-teams/preview')[0].body).toEqual({
      sessionToken: 'admin-token', primaryTeamId: 'a', secondaryTeamId: 'b'
    });
    const summary = within(dialog).getByTestId('team-merge-summary');
    const retroRow = within(summary).getByRole('row', { name: /Retrospectives/ });
    expect(within(retroRow).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '3', '5']);
    expect(within(summary).getByText('moved when an original team is deleted')).toBeTruthy();
    expect(within(dialog).getByText(/Jean \(Produit bis\) becomes Jean/)).toBeTruthy();
    expect(within(dialog).getByText('Marie: different email addresses')).toBeTruthy();
    expect(within(dialog).getByText(/Open right now: Sprint 10/)).toBeTruthy();
    expect(within(dialog).getByText(/Not closed: Sprint 9/)).toBeTruthy();
    expect(within(dialog).getByText(/share an email address: Facilitator, Luc \(luc@etat.ge.ch\)/)).toBeTruthy();
    expect((within(dialog).getByLabelText('Name of the new team') as HTMLInputElement).value).toBe('Produit + Produit bis');
    // The same cleaned address on both sides is offered once.
    expect(within(dialog).getAllByLabelText('elisabeth.trolliet@etat.ge.ch')).toHaveLength(1);
    expect(sent('/api/super-admin/merge-teams')).toHaveLength(0);
  });

  it('creates the merged team with the chosen settings and says what to do next', async () => {
    await renderConsole();
    const dialog = await openAndPreview();
    reply('/api/super-admin/merge-teams', { status: 201, body: { success: true, team: { id: 'm', name: 'Produit (fusion)' } } });

    fireEvent.change(within(dialog).getByLabelText('Name of the new team'), { target: { value: '  Produit (fusion) ' } });
    fireEvent.click(within(dialog).getByLabelText('Set a new password'));
    fireEvent.change(within(dialog).getByLabelText('New password'), { target: { value: 'long-enough-password' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create the merged team' }));

    await waitFor(() => expect(screen.getByText(/Team "Produit \(fusion\)" created/)).toBeTruthy());
    expect(sent('/api/super-admin/merge-teams')[0].body).toEqual({
      sessionToken: 'admin-token',
      primaryTeamId: 'a',
      secondaryTeamId: 'b',
      name: 'Produit (fusion)',
      passwordSource: 'new',
      newPassword: 'long-enough-password',
      facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch',
      // The plan the admin saw: the server refuses if a team changed since.
      expectedFingerprints: { primary: 'fp-a', secondary: 'fp-b' }
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    // The list is reloaded so the new team shows up.
    expect(sent('/api/super-admin/teams').length).toBeGreaterThan(1);
  });

  it('checks what it can before asking the server', async () => {
    await renderConsole();
    const dialog = await openAndPreview();

    fireEvent.click(within(dialog).getByLabelText('Another address'));
    fireEvent.change(within(dialog).getByLabelText('Recovery email address'), { target: { value: 'a@x.ch; b@y.ch' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create the merged team' }));
    expect(within(dialog).getByRole('alert').textContent).toBe('Enter one valid email address.');

    fireEvent.click(within(dialog).getByLabelText('Set a new password'));
    fireEvent.change(within(dialog).getByLabelText('Recovery email address'), { target: { value: 'ok@x.ch' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create the merged team' }));
    expect(within(dialog).getByRole('alert').textContent).toMatch(/at least 8 characters/i);

    expect(sent('/api/super-admin/merge-teams')).toHaveLength(0);
  });

  it('explains a refusal from the server', async () => {
    await renderConsole();
    const dialog = await openAndPreview();
    reply('/api/super-admin/merge-teams', { status: 409, body: { error: 'team_name_exists' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create the merged team' }));

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toMatch(/already/i));
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('refreshes the plan when a team changed after the preview, keeping what the admin chose', async () => {
    await renderConsole();
    const dialog = await openAndPreview();
    fireEvent.change(within(dialog).getByLabelText('Name of the new team'), { target: { value: 'Mon nom' } });
    reply('/api/super-admin/merge-teams', { status: 409, body: { error: 'sources_changed_since_preview' } });
    reply('/api/super-admin/merge-teams/preview', {
      status: 200,
      body: { ...preview, report: { ...preview.report, merged: { ...preview.report.merged, retrospectives: 6 } } }
    });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create the merged team' }));

    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toMatch(/changed since the preview/));
    const retroRow = within(within(dialog).getByTestId('team-merge-summary')).getByRole('row', { name: /Retrospectives/ });
    expect(within(retroRow).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['2', '3', '6']);
    expect((within(dialog).getByLabelText('Name of the new team') as HTMLInputElement).value).toBe('Mon nom');
  });

  it('cannot be opened with fewer than two teams', async () => {
    teams = [team('a', 'Produit')];
    await renderConsole();
    expect((screen.getByRole('button', { name: 'Merge two teams' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('speaks French to a French reader', async () => {
    await renderConsole('fr');
    fireEvent.click(screen.getByRole('button', { name: 'Fusionner deux équipes' }));
    const dialog = screen.getByRole('dialog', { name: 'Fusionner deux équipes' });
    expect(within(dialog).getByLabelText('Équipe principale')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Prévisualiser la fusion' })).toBeTruthy();
  });
});

describe('the merge shows in the team list', () => {
  it('names the sources of a merged team, and the merged team of each source', async () => {
    teams = [
      team('a', 'Produit'),
      team('b', 'Produit bis'),
      team('m', 'Produit (fusion)', {
        mergedFrom: [
          { teamId: 'a', name: 'Produit', mergedAt: '2026-10-13T10:00:00.000Z' },
          { teamId: 'b', name: 'Produit bis', mergedAt: '2026-10-13T10:00:00.000Z' }
        ]
      })
    ];
    await renderConsole();
    expect(screen.getByText('Merged from Produit, Produit bis')).toBeTruthy();
    expect(screen.getAllByText('Merged into Produit (fusion)')).toHaveLength(2);
  });
});

describe('deleting a team from the console', () => {
  const openDelete = (name: string) => {
    const row = screen.getAllByRole('row').find((candidate) => within(candidate).queryByText(name, { selector: 'div' }));
    fireEvent.click(within(row!).getByRole('button', { name: 'Delete' }));
    return screen.getByRole('dialog', { name: `Delete ${name}` });
  };

  it('needs the name typed back, then deletes and reloads the list', async () => {
    teams = [
      team('a', 'Produit'),
      team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit' }] })
    ];
    await renderConsole();
    const dialog = openDelete('Produit');
    expect(within(dialog).getByText(/merged into Produit \(fusion\): its feedbacks will move there/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Delete the team' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    reply('/api/super-admin/delete-team', { status: 200, body: { success: true, movedFeedbacks: 1, orphanedFeedbacks: 0, mergedInto: 'm' } });
    fireEvent.change(within(dialog).getByLabelText(/To confirm, type the team name/), { target: { value: 'Produit' } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByText('Team "Produit" deleted.')).toBeTruthy());
    expect(sent('/api/super-admin/delete-team')[0].body).toEqual({ sessionToken: 'admin-token', teamId: 'a', confirmName: 'Produit' });
  });

  it('explains why a changed merge source was not deleted, and deletes it only when asked again', async () => {
    teams = [
      team('a', 'Produit'),
      team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit' }] })
    ];
    await renderConsole();
    const dialog = openDelete('Produit');
    reply(
      '/api/super-admin/delete-team',
      { status: 409, body: { error: 'source_changed_since_merge', mergedInto: { id: 'm', name: 'Produit (fusion)' } } },
      { status: 200, body: { success: true, movedFeedbacks: 0, orphanedFeedbacks: 0, mergedInto: 'm' } }
    );
    fireEvent.change(within(dialog).getByLabelText(/To confirm, type the team name/), { target: { value: 'Produit' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));

    await waitFor(() => expect(within(dialog).getByText(/changed after it was merged into Produit \(fusion\)/)).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete anyway' }));

    await waitFor(() => expect(screen.getByText('Team "Produit" deleted.')).toBeTruthy());
    expect(sent('/api/super-admin/delete-team').map((request) => request.body.force)).toEqual([undefined, true]);
  });

  it('warns that deleting a merged team whose sources are gone deletes their only copy', async () => {
    teams = [team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit' }] }), team('c', 'Autre')];
    await renderConsole();
    const dialog = openDelete('Produit (fusion)');
    reply('/api/super-admin/delete-team', { status: 409, body: { error: 'merge_sources_deleted', sources: ['Produit'] } });
    fireEvent.change(within(dialog).getByLabelText(/To confirm, type the team name/), { target: { value: 'Produit (fusion)' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    await waitFor(() => expect(within(dialog).getByText(/merge of Produit, which no longer exist/)).toBeTruthy());
    expect(within(dialog).getByRole('button', { name: 'Delete anyway' })).toBeTruthy();
  });

  it('says who is in a session of the team', async () => {
    await renderConsole();
    const dialog = openDelete('Autre');
    reply('/api/super-admin/delete-team', { status: 409, body: { error: 'team_in_use', sessions: ['Sprint 3'] } });
    fireEvent.change(within(dialog).getByLabelText(/To confirm, type the team name/), { target: { value: 'Autre' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    await waitFor(() => expect(within(dialog).getByText(/in a session of this team right now: Sprint 3/)).toBeTruthy());
    expect(within(dialog).getByText(/Its feedbacks are kept in the Feedbacks tab/)).toBeTruthy();
  });
});
