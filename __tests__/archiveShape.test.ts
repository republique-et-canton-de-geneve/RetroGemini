import { describe, expect, it } from 'vitest';
import { archiveShapeProblem, ArchiveShapeError, isTeamShape } from '../server/services/archiveShape.js';
import { listRestorableTeams } from '../server/services/teamRestore.js';

/**
 * The one rule every restore path and the backup import apply to a parsed
 * archive before anything is written (`server/services/archiveShape.js`).
 *
 * Why it exists: `normalizePersistedData` turns a `teams` that is not an array
 * into `[]`, and a whole-store restore of `[]` deletes every team; a team with
 * no string name crashes the replace at `team.name.toLowerCase()` once the
 * earlier teams are already written; and two entries with one id give the
 * team-restore dialog two radios with one value.
 */

const team = (id: unknown, name: unknown = `Team ${String(id)}`) => ({ id, name, members: [] });

describe('archiveShapeProblem', () => {
  it('accepts a well-formed archive, an explicit empty one and extra top-level keys', () => {
    expect(archiveShapeProblem({ teams: [team('a'), team('b')], resetTokens: [], orphanedFeedbacks: [] })).toBeNull();
    expect(archiveShapeProblem({ teams: [] })).toBeNull();
    expect(archiveShapeProblem({
      teams: [team('a')],
      meta: { revision: 3 },
      globalSettings: { adminEmail: 'x@example.org' },
      jiraSettings: { enabled: true },
      somethingNew: 42
    })).toBeNull();
  });

  it.each([
    ['null', null],
    ['a number', 42],
    ['a string', 'teams'],
    ['an array', [team('a')]]
  ])('refuses %s at the top as not_an_object', (_label, data) => {
    expect(archiveShapeProblem(data)).toEqual({ reason: 'not_an_object' });
  });

  it.each([
    ['absent', {}],
    ['an object', { teams: {} }],
    ['a string', { teams: 'a,b' }],
    ['null', { teams: null }]
  ])('refuses a teams list that is %s', (_label, data) => {
    expect(archiveShapeProblem(data)).toEqual({ reason: 'teams_missing' });
  });

  it('names how many entries are not teams and where the first ten are', () => {
    const teams = [
      team('ok-1'),
      null,
      42,
      { name: 'No id' },
      team(''),
      team(42),
      team('no-name', null),
      team('ok-2')
    ];
    expect(archiveShapeProblem({ teams })).toEqual({ reason: 'team_malformed', count: 6, positions: [1, 2, 3, 4, 5, 6] });

    const many = Array.from({ length: 15 }, (_, index) => (index % 2 === 0 ? null : team(`t${index}`)));
    const problem = archiveShapeProblem({ teams: many });
    expect(problem).toMatchObject({ reason: 'team_malformed', count: 8 });
    expect(problem?.positions).toEqual([0, 2, 4, 6, 8, 10, 12, 14]);

    const twelve = Array.from({ length: 12 }, () => null);
    expect(archiveShapeProblem({ teams: twelve })?.positions).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('refuses two entries with one id, naming at most five ids cut to 64 characters', () => {
    expect(archiveShapeProblem({ teams: [team('a'), team('b'), team('a')] }))
      .toEqual({ reason: 'team_id_duplicated', ids: ['a'] });

    const long = 'x'.repeat(100);
    const ids = ['1', '2', '3', '4', '5', '6', long];
    const teams = [...ids, ...ids].map((id) => team(id));
    const problem = archiveShapeProblem({ teams });
    expect(problem?.reason).toBe('team_id_duplicated');
    expect(problem?.ids).toEqual(['1', '2', '3', '4', '5']);

    const onlyLong = archiveShapeProblem({ teams: [team(long), team(long)] });
    expect(onlyLong?.ids).toEqual(['x'.repeat(64)]);
  });

  it('compares ids exactly: two ids that differ only in case are two teams', () => {
    expect(archiveShapeProblem({ teams: [team('Abc'), team('abc')] })).toBeNull();
  });

  it('accepts two teams whose names differ only in case, or are equal (a genuine store can hold them)', () => {
    expect(archiveShapeProblem({ teams: [team('a', 'Platform'), team('b', 'platform')] })).toBeNull();
    expect(archiveShapeProblem({ teams: [team('a', 'Platform'), team('b', 'Platform')] })).toBeNull();
  });

  it.each(['resetTokens', 'orphanedFeedbacks'])('refuses %s present but not a list, and accepts it absent', (field) => {
    expect(archiveShapeProblem({ teams: [], [field]: {} })).toEqual({ reason: 'list_malformed', field });
    expect(archiveShapeProblem({ teams: [], [field]: 'none' })).toEqual({ reason: 'list_malformed', field });
    expect(archiveShapeProblem({ teams: [] })).toBeNull();
  });

  it('reports the teams before the side lists', () => {
    expect(archiveShapeProblem({ teams: [null], resetTokens: {} })).toMatchObject({ reason: 'team_malformed' });
  });
});

describe('ArchiveShapeError', () => {
  it('carries the code the routes map and the details they answer with', () => {
    const problem = archiveShapeProblem({ teams: [team('a'), team('a')] });
    const err = new ArchiveShapeError(problem!.reason, problem!);
    expect(err).toBeInstanceOf(Error);
    expect(err.code).toBe('INVALID_BACKUP_DATA');
    expect(err.reason).toBe('team_id_duplicated');
    expect(err.details).toEqual({ reason: 'team_id_duplicated', ids: ['a'] });
  });
});

describe('isTeamShape', () => {
  it('is the rule the single-team restore lists teams by', () => {
    const entries = [team('ok'), null, team(''), team(7), { id: 'nameless', members: [] }, team('kept', '')];
    const kept = entries.filter(isTeamShape).map((entry) => (entry as { id: string }).id);
    expect(kept).toEqual(['ok', 'kept']);
    // The listing filters with the very same rule (and sorts by name).
    expect(listRestorableTeams({ teams: entries }, []).map((entry: { id: string }) => entry.id).sort()).toEqual([...kept].sort());
  });
});
