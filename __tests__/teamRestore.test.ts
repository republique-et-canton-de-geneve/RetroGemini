// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  KEPT_FROM_CURRENT,
  TeamRestoreError,
  listRestorableTeams,
  planTeamRestore,
  restoredSessionEntry,
  sessionIdsOf
} from '../server/services/teamRestore.js';

/**
 * The record a single-team restore writes (`server/services/teamRestore.js`).
 * Each test names the rule it guards and the way it would break.
 */

type Json = Record<string, any>;

const archivedTeam = (): Json => ({
  id: 'team-a',
  name: 'Alpha',
  passwordHash: 'scrypt$archived',
  inviteEpoch: 1,
  facilitatorEmail: 'old@example.com',
  lastConnectionDate: '2026-01-01T00:00:00.000Z',
  members: [{ id: 'm1', name: 'Facilitator', role: 'facilitator' }, { id: 'm2', name: 'Jean', role: 'participant' }],
  archivedMembers: [],
  customTemplates: [{ name: 'Mine', cols: [{ id: 'c1', title: 'Good' }] }],
  retrospectives: [
    { id: 'r1', teamId: 'team-a', name: 'Sprint 1', tickets: [{ id: 't1', text: 'lost card' }], _rev: 4 },
    { id: 'r2', teamId: 'team-a', name: 'Sprint 2', tickets: [], _rev: 2 }
  ],
  healthChecks: [{ id: 'h1', teamId: 'team-a', name: 'Q1', ratings: {}, _rev: 3 }],
  globalActions: [{ id: 'a1', text: 'Pair more', done: false }],
  teamFeedbacks: [{ id: 'f-archived', teamId: 'team-a', title: 'From the archive', comments: [] }],
  _rev: 40,
  _updatedAt: '2026-01-01T00:00:00.000Z'
});

const currentTeam = (): Json => ({
  id: 'team-a',
  name: 'Alpha (renamed)',
  passwordHash: 'scrypt$current',
  inviteEpoch: 5,
  facilitatorEmail: 'now@example.com',
  lastConnectionDate: '2026-10-18T00:00:00.000Z',
  mergedFrom: [{ teamId: 'x' }],
  members: [{ id: 'm1', name: 'Facilitator', role: 'facilitator' }],
  retrospectives: [{ id: 'r1', teamId: 'team-a', name: 'Sprint 1', tickets: [], _rev: 9 }],
  healthChecks: [],
  globalActions: [],
  teamFeedbacks: [{ id: 'f-now', teamId: 'team-a', title: 'Posted since', comments: [{ id: 'c1' }] }]
});

const plan = (overrides: Partial<Parameters<typeof planTeamRestore>[0]> = {}) =>
  planTeamRestore({
    archived: archivedTeam(),
    current: currentTeam(),
    orphanedFeedbacks: [],
    sessionRevs: new Map(),
    ...overrides
  } as Parameters<typeof planTeamRestore>[0]);

describe('planTeamRestore — a team that still exists', () => {
  it('brings the work back as the backup holds it', () => {
    // Guards: restoring only part of the record (a lost retro stays lost).
    const { team } = plan();
    expect(team.retrospectives.map((r: Json) => r.id)).toEqual(['r1', 'r2']);
    expect(team.retrospectives[0].tickets).toEqual([{ id: 't1', text: 'lost card' }]);
    expect(team.healthChecks.map((h: Json) => h.id)).toEqual(['h1']);
    expect(team.globalActions).toEqual([{ id: 'a1', text: 'Pair more', done: false }]);
    expect(team.members.map((m: Json) => m.id)).toEqual(['m1', 'm2']);
    expect(team.customTemplates).toHaveLength(1);
  });

  it('keeps how people get in, the name, the feedbacks and the merge provenance as they are now', () => {
    // Guards: a restore that rolls the password back locks out everyone who
    // knows the current one; one that rolls the invite epoch back revives
    // revoked invite links.
    const { team } = plan();
    expect(team.name).toBe('Alpha (renamed)');
    expect(team.passwordHash).toBe('scrypt$current');
    expect(team.inviteEpoch).toBe(5);
    expect(team.facilitatorEmail).toBe('now@example.com');
    expect(team.lastConnectionDate).toBe('2026-10-18T00:00:00.000Z');
    expect(team.mergedFrom).toEqual([{ teamId: 'x' }]);
    expect(team.teamFeedbacks.map((f: Json) => f.id)).toEqual(['f-now']);
    expect(KEPT_FROM_CURRENT).toEqual(expect.arrayContaining(['passwordHash', 'inviteEpoch', 'facilitatorEmail', 'teamFeedbacks']));
  });

  it('drops a kept field the current record does not have, rather than reviving the archived one', () => {
    const current = currentTeam();
    delete current.facilitatorEmail;
    delete current.mergedFrom;
    const { team } = plan({ current });
    expect('facilitatorEmail' in team).toBe(false);
    expect('mergedFrom' in team).toBe(false);
  });

  it('lifts every restored session above the stored entry and the live row', () => {
    // Guards: a full-blob persist is dropped only when strictly older, so a
    // restored entry at its archived revision (4) would be overwritten by the
    // next persist of the live copy (9) — the restore would undo itself.
    const { team, targets } = plan({ sessionRevs: new Map([['r1', 12], ['h1', 1]]) });
    expect(team.retrospectives[0]._rev).toBe(13); // live row 12 is the highest
    expect(team.retrospectives[1]._rev).toBe(3); // archived 2, nothing newer
    expect(team.healthChecks[0]._rev).toBe(4); // archived 3 beats the row at 1
    expect([...targets.entries()]).toEqual([['r1', 13], ['r2', 3], ['h1', 4]]);
  });

  it('never carries the archive record revision into the team record', () => {
    const { team } = plan();
    expect('_rev' in team).toBe(false);
    expect('_updatedAt' in team).toBe(false);
  });

  it('does not alias the inputs', () => {
    const archived = archivedTeam();
    const { team } = plan({ archived });
    team.retrospectives[0].tickets.push({ id: 'x' });
    expect(archived.retrospectives[0].tickets).toHaveLength(1);
    expect(archived.retrospectives[0]._rev).toBe(4);
  });

  // Guards: a backup taken before the issues were created. The team's token
  // is not rolled back (it is not on the record), so actions restored without
  // their links would be created in Jira a second time on the next click.
  it('keeps the Jira links created since the backup on the restored actions, and never overwrites an archived one', () => {
    const link = { key: 'RETRO-4', createdAt: '2026-10-19T00:00:00.000Z' };
    const archivedLink = { key: 'RETRO-1', createdAt: '2026-01-01T00:00:00.000Z' };
    const archived = archivedTeam();
    archived.globalActions = [{ id: 'a1', text: 'Pair more', done: false }, { id: 'a0', text: 'Old', jira: archivedLink }];
    archived.retrospectives[0].actions = [{ id: 'a1', text: 'Pair more', done: false }];
    const current = currentTeam();
    current.globalActions = [
      { id: 'a1', text: 'Pair more', done: false, jira: link },
      { id: 'a0', text: 'Old', jira: { key: 'RETRO-77', createdAt: '2026-10-19T00:00:00.000Z' } }
    ];

    const { team } = plan({ archived, current });

    expect(team.globalActions[0].jira).toEqual(link);
    expect(team.retrospectives[0].actions[0].jira).toEqual(link);
    expect(team.globalActions[1].jira).toEqual(archivedLink);
    expect(current.globalActions[0].jira).not.toBe(team.globalActions[0].jira);
  });

  // Guards: the backup was taken while the action was in doubt, and the
  // facilitator has created it since ("Create anyway"). The archived marker
  // would offer "Create anyway" again, and a second issue with it.
  it('replaces an archived uncertain marker with the key the team holds now', () => {
    const link = { key: 'RETRO-5', createdAt: '2026-10-19T00:00:00.000Z' };
    const marker = { uncertainSince: '2026-10-18T00:00:00.000Z' };
    const archived = archivedTeam();
    archived.globalActions = [{ id: 'a1', text: 'Pair more', done: false, jira: marker }];
    archived.retrospectives[0].actions = [{ id: 'a1', text: 'Pair more', done: false, jira: marker }];
    const current = currentTeam();
    current.globalActions = [{ id: 'a1', text: 'Pair more', done: false, jira: link }];

    const { team } = plan({ archived, current });

    expect(team.globalActions[0].jira).toEqual(link);
    expect(team.retrospectives[0].actions[0].jira).toEqual(link);
  });

  // Guards: the target goes with the token (a restored target could name a
  // project the current token cannot reach), and rolled-back claims would let
  // an issue being created right now be created again.
  it('keeps the Jira target and claims as they are now, or drops them when the team has none now', () => {
    const archived = { ...archivedTeam(), jiraTarget: { mode: 'project', projectKey: 'OLD', issueTypeId: '1', labels: [] }, jiraClaims: { a1: { at: 'then' } } };
    const current = { ...currentTeam(), jiraTarget: { mode: 'parent', parentKey: 'NOW-1', issueTypeId: '5', labels: ['retro'] }, jiraClaims: { a9: { at: 'now' } } };

    const kept = plan({ archived, current }).team;
    expect(kept.jiraTarget).toEqual(current.jiraTarget);
    expect(kept.jiraClaims).toEqual(current.jiraClaims);

    const dropped = plan({ archived, current: currentTeam() }).team;
    expect('jiraTarget' in dropped).toBe(false);
    expect('jiraClaims' in dropped).toBe(false);
    expect(KEPT_FROM_CURRENT).toEqual(expect.arrayContaining(['jiraTarget', 'jiraClaims']));
  });
});

describe('planTeamRestore — a team deleted since the backup', () => {
  it('comes back with the archived credentials, under its old name or the one given', () => {
    // Guards: a recreated team nobody can open.
    const kept = plan({ current: null });
    expect(kept.team.name).toBe('Alpha');
    expect(kept.team.passwordHash).toBe('scrypt$archived');
    expect(kept.team.facilitatorEmail).toBe('old@example.com');
    expect(plan({ current: null, name: '  Alpha restored ' }).team.name).toBe('Alpha restored');
  });

  it('takes its feedbacks back from orphanedFeedbacks, never from the archive', () => {
    // Guards: the archive's copy predates every reply since, and may since have
    // moved into a merged team — restoring it would show it twice.
    const orphan = { id: 'f-archived', teamId: 'team-a', title: 'From the archive', comments: [{ id: 'reply-after-deletion' }] };
    const otherTeams = { id: 'f-other', teamId: 'team-b', title: 'Not ours' };
    const { team, unorphanedFeedbacks, counts } = plan({ current: null, orphanedFeedbacks: [orphan, otherTeams] });
    expect(team.teamFeedbacks).toEqual([{ ...orphan, teamName: 'Alpha' }]);
    expect(unorphanedFeedbacks).toEqual([orphan]);
    expect(counts.feedbacksRecovered).toBe(1);

    const none = plan({ current: null, orphanedFeedbacks: [otherTeams] });
    expect(none.team.teamFeedbacks).toEqual([]);
  });

  it('shows its recovered feedbacks under the name it comes back with', () => {
    // Guards: the board prefers a feedback's own `teamName`, and the old name
    // may now be another team's.
    const orphan = { id: 'f1', teamId: 'team-a', teamName: 'Alpha', title: 'Bug' };
    const { team } = plan({ current: null, orphanedFeedbacks: [orphan], name: 'Alpha (restored)' });
    expect(team.teamFeedbacks[0].teamName).toBe('Alpha (restored)');
    expect(orphan.teamName).toBe('Alpha');
  });
});

describe('planTeamRestore — feedbacks of a team that exists', () => {
  it('adds an orphan of the team it does not hold, and takes every one of its orphans off the shared list', () => {
    const orphans = [
      { id: 'f-now', teamId: 'team-a', title: 'Duplicate of the live one' },
      { id: 'f-lost', teamId: 'team-a', title: 'Left over from a failed restore' }
    ];
    const { team, unorphanedFeedbacks } = plan({ orphanedFeedbacks: orphans });
    expect(team.teamFeedbacks.map((f: Json) => f.id)).toEqual(['f-now', 'f-lost']);
    expect(team.teamFeedbacks[0].title).toBe('Posted since'); // the live copy wins
    expect(unorphanedFeedbacks.map((f: Json) => f.id)).toEqual(['f-now', 'f-lost']);
  });
});

describe('planTeamRestore — refusals', () => {
  it('refuses a list that is not a list, naming it', () => {
    const archived = archivedTeam();
    archived.retrospectives = { broken: true };
    expect(() => plan({ archived })).toThrow(TeamRestoreError);
    try {
      plan({ archived });
    } catch (err) {
      expect((err as TeamRestoreError).code).toBe('archived_team_malformed');
      expect((err as TeamRestoreError).status).toBe(422);
      expect((err as TeamRestoreError).details).toEqual({ fields: ['retrospectives'] });
    }
  });
});

describe('listRestorableTeams', () => {
  const archive = {
    teams: [
      { id: 't-gone', name: 'Zulu', retrospectives: [{ id: 'r' }], members: [] },
      { id: 't-here', name: 'Bravo', retrospectives: [], healthChecks: [{ id: 'h' }], globalActions: [{}, {}], members: [{}] },
      { id: 't-renamed', name: 'Charlie' },
      { id: 't-taken', name: 'Delta' },
      { id: 42, name: 'not a team' },
      null
    ]
  };
  const summaries = [
    { id: 't-here', name: 'Bravo' },
    { id: 't-renamed', name: 'Charlie 2' },
    { id: 't-new', name: 'delta ' }
  ];

  it('says what became of each team since the backup, sorted by name', () => {
    const teams = listRestorableTeams(archive, summaries);
    expect(teams.map((team) => [team.id, team.status, team.currentName, team.nameTaken])).toEqual([
      ['t-here', 'present', 'Bravo', false],
      ['t-renamed', 'renamed', 'Charlie 2', false],
      ['t-taken', 'deleted', null, true],
      ['t-gone', 'deleted', null, false]
    ]);
    expect(teams[0].counts).toEqual({ retrospectives: 0, healthChecks: 1, globalActions: 2, members: 1 });
  });

  it('reads an archive with no teams as an empty list', () => {
    expect(listRestorableTeams({}, summaries)).toEqual([]);
    expect(listRestorableTeams(null, [])).toEqual([]);
  });
});

describe('helpers', () => {
  it('lists the session ids of a team and finds a restored entry by id', () => {
    const { team } = plan();
    expect(sessionIdsOf(archivedTeam())).toEqual(['r1', 'r2', 'h1']);
    expect(restoredSessionEntry(team, 'h1')?.name).toBe('Q1');
    expect(restoredSessionEntry(team, 'nope')).toBeNull();
  });
});
