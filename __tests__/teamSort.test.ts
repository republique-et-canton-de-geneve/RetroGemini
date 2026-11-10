import { describe, it, expect } from 'vitest';
import { ariaSortOf, retrospectiveCountOf, sortIconOf, sortTeams } from '../components/admin/teamSort';
import type { Team } from '../types';

/**
 * The super-admin console's Teams tab sorts its rows in the browser
 * (`components/admin/teamSort.ts`). Two columns hold values a team may not
 * have: a team that never connected has no last activity, and a pod of an
 * earlier release, answering the console during a rolling update, sends no
 * retrospective count. Both kinds stay last whichever the direction, so
 * sorting never puts the teams the console knows nothing about first.
 *
 * The count is read from what the server sent and nothing else: the console's
 * team list never carries the history, so `retrospectives` is absent there in
 * production whatever the `Team` type says.
 */

const teamOf = (id: string, extra: Partial<Team> = {}): Team => ({
  id,
  name: id,
  passwordHash: '',
  members: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...extra
});

const ids = (teams: Team[]) => teams.map((team) => team.id);

describe('sorting the Teams tab', () => {
  it('keeps the order the server sent until a column is chosen', () => {
    const teams = [teamOf('b'), teamOf('a')];
    expect(sortTeams(teams, null, 'asc')).toBe(teams);
    expect(sortTeams(teams, null, 'desc')).toBe(teams);
  });

  it('sorts by retrospective count, the teams sent without one last in both directions', () => {
    const teams = [
      teamOf('five', { retrospectiveCount: 5 }),
      teamOf('unknown-1'),
      teamOf('zero', { retrospectiveCount: 0 }),
      teamOf('twelve', { retrospectiveCount: 12 }),
      teamOf('unknown-2'),
      teamOf('one', { retrospectiveCount: 1 })
    ];

    expect(ids(sortTeams(teams, 'retrospectives', 'asc'))).toEqual(['zero', 'one', 'five', 'twelve', 'unknown-1', 'unknown-2']);
    expect(ids(sortTeams(teams, 'retrospectives', 'desc'))).toEqual(['twelve', 'five', 'one', 'zero', 'unknown-1', 'unknown-2']);
    // A copy: the rows the console holds keep the server's order.
    expect(ids(teams)).toEqual(['five', 'unknown-1', 'zero', 'twelve', 'unknown-2', 'one']);
  });

  it('reads the count the server sent, never the history beside it', () => {
    const counted = teamOf('counted', { retrospectiveCount: 1, retrospectives: [] });
    const historyOnly = teamOf('history-only', { retrospectives: [{ id: 'r1' }, { id: 'r2' }] as Team['retrospectives'] });
    const text = teamOf('text', { retrospectiveCount: '3' as unknown as number });

    expect(retrospectiveCountOf(counted)).toBe(1);
    expect(retrospectiveCountOf(historyOnly)).toBeNull();
    expect(retrospectiveCountOf(text)).toBeNull();
    expect(ids(sortTeams([historyOnly, text, counted], 'retrospectives', 'asc'))).toEqual(['counted', 'history-only', 'text']);
  });

  it('keeps the teams that never connected last in both directions, as it always has', () => {
    const teams = [
      teamOf('march', { lastConnectionDate: '2026-03-10T10:00:00.000Z' }),
      teamOf('never-1'),
      teamOf('april', { lastConnectionDate: '2026-04-01T10:00:00.000Z' }),
      teamOf('never-2'),
      teamOf('january', { lastConnectionDate: '2026-01-05T10:00:00.000Z' })
    ];

    expect(ids(sortTeams(teams, 'lastActive', 'asc'))).toEqual(['january', 'march', 'april', 'never-1', 'never-2']);
    expect(ids(sortTeams(teams, 'lastActive', 'desc'))).toEqual(['april', 'march', 'january', 'never-1', 'never-2']);
  });

  it('sorts by name whatever the case, and by member count', () => {
    const member = { id: 'm', name: 'M', color: 'bg-indigo-500', role: 'participant' as const };
    const teams = [
      teamOf('t1', { name: 'charlie', members: [member, member, member] }),
      teamOf('t2', { name: 'Alpha', members: [member] }),
      teamOf('t3', { name: 'bravo', members: [member, member] })
    ];

    expect(sortTeams(teams, 'name', 'asc').map((team) => team.name)).toEqual(['Alpha', 'bravo', 'charlie']);
    expect(sortTeams(teams, 'name', 'desc').map((team) => team.name)).toEqual(['charlie', 'bravo', 'Alpha']);
    expect(ids(sortTeams(teams, 'members', 'asc'))).toEqual(['t2', 't3', 't1']);
    expect(ids(sortTeams(teams, 'members', 'desc'))).toEqual(['t1', 't3', 't2']);
  });

  it('says how the sorted column is ordered, and nothing on the others', () => {
    expect(ariaSortOf('retrospectives', 'retrospectives', 'asc')).toBe('ascending');
    expect(ariaSortOf('retrospectives', 'retrospectives', 'desc')).toBe('descending');
    expect(ariaSortOf('members', 'retrospectives', 'asc')).toBeUndefined();
    expect(ariaSortOf('name', null, 'asc')).toBeUndefined();

    expect(sortIconOf('retrospectives', 'retrospectives', 'asc')).toBe('arrow_upward');
    expect(sortIconOf('retrospectives', 'retrospectives', 'desc')).toBe('arrow_downward');
    expect(sortIconOf('lastActive', 'retrospectives', 'desc')).toBe('unfold_more');
    expect(sortIconOf('name', null, 'asc')).toBe('unfold_more');
  });
});
