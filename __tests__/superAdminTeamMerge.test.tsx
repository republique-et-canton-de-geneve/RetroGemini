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
      sharedEmails: [{ email: 'luc@etat.ge.ch', names: ['Facilitator', 'Luc'] }],
      malformed: 1
    },
    actions: { reminted: 0 },
    templates: { renamed: [], deduplicated: 0, reminted: 0 },
    sessions: { inProgress: [{ source: 'secondary', name: 'Sprint 9' }], freshened: [], ambiguousRetroIds: ['r9'] },
    unknownKeys: { carried: ['customFlag'], conflicting: ['customFlag'] },
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
    expect(within(dialog).getByText(/share the address luc@etat\.ge\.ch: Facilitator, Luc/)).toBeTruthy();
    // What the plan could not carry as it is, said rather than left in the report.
    expect(within(dialog).getByText(/could not be read are copied as they are: 1/)).toBeTruthy();
    expect(within(dialog).getByText(/appears twice under one identifier/)).toBeTruthy();
    expect(within(dialog).getByText(/the main team's value is kept: customFlag/)).toBeTruthy();
    // Focus follows the step, so a screen reader hears where it now is. Waited
    // for, not read at once: the move happens in a passive effect after the
    // heading renders, and under CI load the waitFor above can return between
    // the two (2 runs in 8 failed locally under coverage and contention).
    await waitFor(() => expect(document.activeElement?.textContent).toBe('What the new team will hold'));
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

  it('explains why a team cannot be merged with one built from it', async () => {
    await renderConsole();
    reply('/api/super-admin/merge-teams/preview', { status: 409, body: { error: 'related_teams' } });
    fireEvent.click(screen.getByRole('button', { name: 'Merge two teams' }));
    const dialog = screen.getByRole('dialog', { name: 'Merge two teams' });
    fireEvent.change(within(dialog).getByLabelText('Main team'), { target: { value: 'a' } });
    fireEvent.change(within(dialog).getByLabelText('Team to add to it'), { target: { value: 'b' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Preview the merge' }));
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toMatch(/built from the other/));
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
          { teamId: 'a', name: 'Produit', mergedAt: '2026-10-13T10:00:00.000Z', verified: true },
          { teamId: 'b', name: 'Produit bis', mergedAt: '2026-10-13T10:00:00.000Z', verified: true }
        ]
      })
    ];
    await renderConsole();
    expect(screen.getByText('Merged from Produit, Produit bis')).toBeTruthy();
    expect(screen.getAllByText('Merged into Produit (fusion)')).toHaveLength(2);
  });

  it('marks provenance the merge did not sign', async () => {
    // A team could write `mergedFrom` into its own record before this release.
    teams = [
      team('a', 'Produit'),
      team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit', verified: false }] })
    ];
    await renderConsole();
    expect(screen.getByText('Merged from Produit (not verified)')).toBeTruthy();
    expect(screen.getByText('Merged into Produit (fusion) (not verified)')).toBeTruthy();
  });
});

describe('deleting a team from the console', () => {
  const openDelete = (name: string) => {
    const row = screen.getAllByRole('row').find((candidate) => within(candidate).queryByText(name, { selector: 'div' }));
    fireEvent.click(within(row!).getByRole('button', { name: `Delete ${name}` }));
    return screen.getByRole('dialog', { name: `Delete ${name}` });
  };
  const typeName = (dialog: HTMLElement, name: string) =>
    fireEvent.change(within(dialog).getByLabelText(/To confirm, type the team name/), { target: { value: name } });

  it('needs the name typed back, then moves the feedbacks into the one signed merged team', async () => {
    teams = [
      team('a', 'Produit'),
      team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit', verified: true }] })
    ];
    await renderConsole();
    const dialog = openDelete('Produit');
    expect(within(dialog).getByText(/merged into Produit \(fusion\): its feedbacks will move there/)).toBeTruthy();
    const confirm = within(dialog).getByRole('button', { name: 'Delete the team' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    reply('/api/super-admin/delete-team', { status: 200, body: { success: true, movedFeedbacks: 1, orphanedFeedbacks: 0, mergedInto: 'm' } });
    typeName(dialog, 'Produit');
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);

    await waitFor(() => expect(screen.getByText('Team "Produit" deleted.')).toBeTruthy());
    expect(sent('/api/super-admin/delete-team')[0].body).toEqual({
      sessionToken: 'admin-token',
      teamId: 'a',
      confirmName: 'Produit',
      mergedInto: 'm'
    });
  });

  it('never names a merged team the merge did not sign, so the feedbacks stay in the Feedbacks tab', async () => {
    teams = [
      team('a', 'Produit'),
      team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit', verified: false }] })
    ];
    await renderConsole();
    const dialog = openDelete('Produit');
    expect(within(dialog).getByText(/listed as merged into Produit \(fusion\), but that record could not be verified/)).toBeTruthy();

    reply('/api/super-admin/delete-team', { status: 200, body: { success: true, movedFeedbacks: 0, orphanedFeedbacks: 1, mergedInto: null } });
    typeName(dialog, 'Produit');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));

    await waitFor(() => expect(screen.getByText('Team "Produit" deleted.')).toBeTruthy());
    expect(sent('/api/super-admin/delete-team')[0].body).not.toHaveProperty('mergedInto');
  });

  it('keeps the feedbacks in the Feedbacks tab when the team was merged twice', async () => {
    teams = [
      team('a', 'Produit'),
      team('m', 'Fusion 1', { mergedFrom: [{ teamId: 'a', name: 'Produit', verified: true }] }),
      team('n', 'Fusion 2', { mergedFrom: [{ teamId: 'a', name: 'Produit', verified: true }] })
    ];
    await renderConsole();
    const dialog = openDelete('Produit');
    expect(within(dialog).getByText(/merged into several teams \(Fusion 1, Fusion 2\)/)).toBeTruthy();
  });

  it('names what changed since the merge, and deletes only once that reason is acknowledged', async () => {
    teams = [
      team('a', 'Produit'),
      team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit', verified: true }] })
    ];
    await renderConsole();
    const dialog = openDelete('Produit');
    reply(
      '/api/super-admin/delete-team',
      {
        status: 409,
        body: {
          error: 'confirmation_required',
          reasons: ['source_changed'],
          confirmation: 'facts-1',
          mergedInto: ['Produit (fusion)'],
          changes: [
            { kind: 'retrospective', name: 'Sprint 12', added: true },
            { kind: 'backlog', added: false }
          ]
        }
      },
      { status: 200, body: { success: true, movedFeedbacks: 0, orphanedFeedbacks: 0, mergedInto: 'm' } }
    );
    typeName(dialog, 'Produit');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));

    await waitFor(() => expect(
      within(dialog).getByText('This team changed after it was merged into Produit (fusion): new retrospective "Sprint 12", the backlog. That is not in the merged team. To keep it, merge the original teams again into a new team; otherwise delete this one anyway.')
    ).toBeTruthy());
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete anyway' }));

    await waitFor(() => expect(screen.getByText('Team "Produit" deleted.')).toBeTruthy());
    // The acknowledgement goes back with the digest of the facts it read.
    expect(sent('/api/super-admin/delete-team').map((request) => [request.body.acknowledge, request.body.confirmation]))
      .toEqual([[undefined, undefined], [['source_changed'], 'facts-1']]);
  });

  it('asks again from the start when the name is edited after a confirmation', async () => {
    await renderConsole();
    const dialog = openDelete('Autre');
    reply('/api/super-admin/delete-team', { status: 409, body: { error: 'confirmation_required', reasons: ['sessions_unknown'], confirmation: 'f' } });
    typeName(dialog, 'Autre');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    await waitFor(() => expect(within(dialog).getByText(/Open sessions could not be checked/)).toBeTruthy());

    typeName(dialog, 'Autr');
    expect(within(dialog).queryByText(/Open sessions could not be checked/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Delete the team' })).toBeTruthy();
  });

  it('warns that deleting a merged team whose sources are gone deletes their only copy', async () => {
    teams = [team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit', verified: true }] }), team('c', 'Autre')];
    await renderConsole();
    const dialog = openDelete('Produit (fusion)');
    reply('/api/super-admin/delete-team', {
      status: 409,
      body: { error: 'confirmation_required', reasons: ['sources_deleted', 'sessions_open'], sources: ['Produit'], sessions: ['Sprint 3'], confirmation: 'f' }
    });
    typeName(dialog, 'Produit (fusion)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    await waitFor(() => expect(within(dialog).getByText(/merge of Produit, which no longer exist/)).toBeTruthy());
    // Every reason is named, and acknowledged together.
    expect(within(dialog).getByText(/in a session of this team right now: Sprint 3/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Delete anyway' })).toBeTruthy();
  });

  it('says who is in a session of the team', async () => {
    await renderConsole();
    const dialog = openDelete('Autre');
    reply('/api/super-admin/delete-team', { status: 409, body: { error: 'confirmation_required', reasons: ['sessions_open'], sessions: ['Sprint 3'], confirmation: 'f' } });
    typeName(dialog, 'Autre');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    await waitFor(() => expect(within(dialog).getByText(/in a session of this team right now: Sprint 3/)).toBeTruthy());
    expect(within(dialog).getByText(/Its feedbacks are kept in the Feedbacks tab/)).toBeTruthy();
  });

  it('shows a failed snapshot as an error, never as a reason to acknowledge', async () => {
    await renderConsole();
    const dialog = openDelete('Autre');
    reply('/api/super-admin/delete-team', { status: 503, body: { error: 'pre_delete_snapshot_failed' } });
    typeName(dialog, 'Autre');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    await waitFor(() => expect(within(dialog).getByRole('alert')).toBeTruthy());
    expect(within(dialog).queryByRole('button', { name: 'Delete anyway' })).toBeNull();
  });
  it('names a merge it cannot verify, and a merged team used since its merge', async () => {
    teams = [
      team('a', 'Produit'),
      team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit', verified: true }, { teamId: 'z', name: 'Autre', verified: true }] })
    ];
    await renderConsole();
    const dialog = openDelete('Produit (fusion)');
    reply('/api/super-admin/delete-team', {
      status: 409,
      body: {
        error: 'confirmation_required',
        reasons: ['merge_unverified', 'merged_team_changed'],
        mergedInto: ['Fusion X'],
        mergedChanges: [{ kind: 'retrospective', name: 'Sprint 7', added: true }],
        confirmation: 'f'
      }
    });
    typeName(dialog, 'Produit (fusion)');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    await waitFor(() => expect(within(dialog).getByText(/listed as merged into Fusion X, but that merge could not be verified/)).toBeTruthy());
    expect(within(dialog).getByText(/used after the merge: new retrospective "Sprint 7"/)).toBeTruthy();
  });

  it('says so when what the admin acknowledged changed before the deletion went through', async () => {
    await renderConsole();
    const dialog = openDelete('Autre');
    reply(
      '/api/super-admin/delete-team',
      { status: 409, body: { error: 'confirmation_required', reasons: ['sessions_open'], sessions: ['Sprint 3'], confirmation: 'f1' } },
      { status: 409, body: { error: 'confirmation_required', reasons: ['sessions_open'], sessions: ['Sprint 3', 'Sprint 4'], confirmation: 'f2' } }
    );
    typeName(dialog, 'Autre');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Delete anyway' }));

    await waitFor(() => expect(within(dialog).getByText(/changed after you read these reasons/)).toBeTruthy());
    expect(within(dialog).getByText(/Sprint 3, Sprint 4/)).toBeTruthy();
  });

  it('starts again from what is true now when the team changed while it was being deleted', async () => {
    await renderConsole();
    const dialog = openDelete('Autre');
    reply(
      '/api/super-admin/delete-team',
      { status: 409, body: { error: 'confirmation_required', reasons: ['sessions_open'], sessions: ['Sprint 3'], confirmation: 'f' } },
      { status: 409, body: { error: 'team_changed' } }
    );
    typeName(dialog, 'Autre');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Delete anyway' }));

    await waitFor(() => expect(within(dialog).getByText(/changed while it was being deleted/)).toBeTruthy());
    // The reasons acknowledged no longer describe the team: asked again.
    expect(within(dialog).queryByText(/in a session of this team right now/)).toBeNull();
    expect(within(dialog).getByRole('button', { name: 'Delete the team' })).toBeTruthy();
  });

  it('says so when the feedbacks it announced would move were kept in the Feedbacks tab', async () => {
    teams = [
      team('a', 'Produit'),
      team('m', 'Produit (fusion)', { mergedFrom: [{ teamId: 'a', name: 'Produit', verified: true }] })
    ];
    await renderConsole();
    const dialog = openDelete('Produit');
    reply('/api/super-admin/delete-team', { status: 200, body: { success: true, movedFeedbacks: 0, orphanedFeedbacks: 2, mergedInto: null } });
    typeName(dialog, 'Produit');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete the team' }));
    await waitFor(() => expect(screen.getByText(/could not be moved to Produit \(fusion\): they are kept in the Feedbacks tab/)).toBeTruthy());
  });
});
