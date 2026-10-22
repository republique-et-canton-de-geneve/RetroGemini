import { describe, expect, it } from 'vitest';
import { carryJiraParents } from '../utils/actionImpact.js';

/**
 * The parent issue of each retrospective, health check and of the team
 * dashboard (`team.jiraParents`, `sessionParent` mode), carried across both
 * restores (`carryJiraParents`).
 *
 * A restore puts back an archive taken before some parents were created. The
 * parents exist in Jira and the team's token stays, so without the carry a
 * session's next send would create a second parent beside the first. Unlike an
 * action's link, where the archived key wins, a parent is a routing decision:
 * "Also use … for their later actions" can re-point a session, and rolling
 * that back would send its next actions under the parent it was moved away
 * from. So, per scope: the current key, else the archived key, else the
 * current mark, else the archived mark.
 */

const key = (value: string, createdAt = '2026-10-01T00:00:00.000Z') => ({ key: value, createdAt });
const mark = (since: string) => ({ uncertainSince: since });
type TeamLike = Record<string, any> & { jiraParents?: Record<string, any> };
const teamWith = (jiraParents?: Record<string, unknown>, extra: Record<string, unknown> = {}): TeamLike => ({
  id: 'team-1',
  name: 'Team',
  ...extra,
  ...(jiraParents === undefined ? {} : { jiraParents })
});

describe('carryJiraParents', () => {
  it.each([
    ['the current key over the archived key', key('NEW-1'), key('OLD-1'), key('NEW-1')],
    ['the current key over an archived mark', key('NEW-1'), mark('2026-10-01T00:00:00.000Z'), key('NEW-1')],
    ['the archived key over a current mark', mark('2026-10-20T00:00:00.000Z'), key('OLD-1'), key('OLD-1')],
    ['the current mark over an archived mark', mark('2026-10-20T00:00:00.000Z'), mark('2026-10-01T00:00:00.000Z'), mark('2026-10-20T00:00:00.000Z')],
    ['the current key where the archive has none', key('NEW-1'), undefined, key('NEW-1')],
    ['the current mark where the archive has none', mark('2026-10-20T00:00:00.000Z'), undefined, mark('2026-10-20T00:00:00.000Z')],
    ['the archived key where the current record has none', undefined, key('OLD-1'), key('OLD-1')],
    ['the archived mark where the current record has none', undefined, mark('2026-10-01T00:00:00.000Z'), mark('2026-10-01T00:00:00.000Z')],
    ['the archived key over a current value that is neither', { key: 'not a key' }, key('OLD-1'), key('OLD-1')],
    ['the archived mark over a current value that is neither', 'PROJ-1', mark('2026-10-01T00:00:00.000Z'), mark('2026-10-01T00:00:00.000Z')]
  ])('keeps %s', (_label, current, archived, expected) => {
    const result = carryJiraParents(
      teamWith(archived === undefined ? {} : { 'retro:r1': archived }),
      teamWith(current === undefined ? {} : { 'retro:r1': current })
    );
    expect(result.jiraParents).toEqual({ 'retro:r1': expected });
  });

  it('keeps the sub-task type a key was recorded with', () => {
    const recorded = { key: 'OPS-5', createdAt: '2026-10-20T00:00:00.000Z', subtaskTypeId: '10006' };
    expect(carryJiraParents(teamWith({ 'retro:r1': key('OLD-1') }), teamWith({ 'retro:r1': recorded })).jiraParents)
      .toEqual({ 'retro:r1': recorded });
  });

  it('carries every scope either side holds, each by its own rule', () => {
    const result = carryJiraParents(
      teamWith({ 'retro:r1': key('OLD-1'), 'healthcheck:h1': mark('2026-10-01T00:00:00.000Z'), backlog: key('OLD-9') }),
      teamWith({ 'retro:r2': key('NEW-2'), 'healthcheck:h1': key('NEW-3'), backlog: mark('2026-10-20T00:00:00.000Z') })
    );
    expect(result.jiraParents).toEqual({
      'retro:r1': key('OLD-1'),
      'healthcheck:h1': key('NEW-3'),
      backlog: key('OLD-9'),
      'retro:r2': key('NEW-2')
    });
  });

  it('never carries a current value that is neither a key nor a mark', () => {
    const result = carryJiraParents(teamWith(), teamWith({ 'retro:r1': { key: 'https://evil.example/browse/X-1' }, backlog: 7 }));
    expect(result).not.toHaveProperty('jiraParents');
  });

  it('keeps an archived value that is neither, when nothing replaces it', () => {
    // The archive's own data, put back as it was: the batch reads it as no
    // parent, as it would have before the restore.
    expect(carryJiraParents(teamWith({ 'retro:r1': { odd: true } }), teamWith()).jiraParents).toEqual({ 'retro:r1': { odd: true } });
  });

  it('leaves a team with no parents on either side as it was', () => {
    const archived = teamWith(undefined, { retrospectives: [] });
    const result = carryJiraParents(archived, teamWith());
    expect(result).toEqual(archived);
    expect(result).not.toHaveProperty('jiraParents');
    expect(carryJiraParents(archived, null)).toEqual(archived);
    expect(carryJiraParents(archived, undefined)).toEqual(archived);
  });

  it('reads a map that is not a plain object as none, on either side', () => {
    expect(carryJiraParents(teamWith(['x'] as never), teamWith({ backlog: key('NEW-1') })).jiraParents).toEqual({ backlog: key('NEW-1') });
    expect(carryJiraParents(teamWith({ backlog: key('OLD-1') }), teamWith('x' as never)).jiraParents).toEqual({ backlog: key('OLD-1') });
  });

  it('keeps a scope named like a prototype key as an ordinary key', () => {
    const current = JSON.parse('{"id":"team-1","jiraParents":{"__proto__":{"key":"NEW-1","createdAt":"2026-10-20T00:00:00.000Z"}}}');
    const result = carryJiraParents(teamWith(), current);
    expect(Object.keys(result.jiraParents)).toEqual(['__proto__']);
    expect(Object.getPrototypeOf(result.jiraParents)).toBe(Object.prototype);
  });

  it('is pure: neither argument is mutated, and nothing is shared with them', () => {
    const archived = teamWith({ 'retro:r1': key('OLD-1') }, { retrospectives: [{ id: 'r1' }] });
    const current = teamWith({ 'retro:r1': key('NEW-1') });
    const before = structuredClone({ archived, current });
    const result = carryJiraParents(archived, current);
    expect({ archived, current }).toEqual(before);
    expect(result.jiraParents['retro:r1']).not.toBe(current.jiraParents!['retro:r1']);
    result.jiraParents['retro:r1'].key = 'CHANGED-1';
    expect(current.jiraParents!['retro:r1']).toEqual(key('NEW-1'));
    // Everything else is the archive's.
    expect(result.retrospectives).toBe(archived.retrospectives);
  });
});
