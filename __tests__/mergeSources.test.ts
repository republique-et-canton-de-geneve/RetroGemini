import { describe, expect, it } from 'vitest';
import { createTokenService } from '../server/services/sessionTokens.js';
import { loadEffectiveTeam, mergeAncestors } from '../server/services/mergeSources.js';

/**
 * Reading a team as the merge sees it (`server/services/mergeSources.js`), and
 * the merge provenance the deletion trusts (`sessionTokens.js`).
 */

const entry = { id: 'r1', teamId: 't1', name: 'R', tickets: [] as { id: string }[], actions: [], _rev: 3 };
const team = { id: 't1', name: 'Team', retrospectives: [entry] };

describe('loadEffectiveTeam', () => {
  const dataStore = {
    loadSessionState: async () => ({ ...entry, _rev: 4, tickets: [{ id: 'stored' }] })
  };

  it('takes this pod\'s cached session when it is ahead of the stored row, and only then', async () => {
    // A write in flight, or degraded mode keeping a room going through a
    // database outage: the cache holds what the database does not yet.
    const ahead = { get: () => ({ ...entry, _rev: 5, tickets: [{ id: 'stored' }, { id: 'cache-only' }] }) };
    const fromCache = await loadEffectiveTeam({ dataStore, sessionCache: ahead }, team);
    expect(fromCache.team.retrospectives[0].tickets.map((t: { id: string }) => t.id)).toEqual(['stored', 'cache-only']);

    const behind = { get: () => ({ ...entry, _rev: 4, tickets: [] }) };
    const fromStore = await loadEffectiveTeam({ dataStore, sessionCache: behind }, team);
    expect(fromStore.team.retrospectives[0].tickets).toEqual([{ id: 'stored' }]);
  });

  it('refuses rather than read an unreadable row as no row', async () => {
    const failing = { loadSessionState: async () => { throw new Error('connection reset'); } };
    await expect(loadEffectiveTeam({ dataStore: failing }, team)).rejects.toMatchObject({ name: 'SessionReadError' });
  });
});

describe('merge provenance', () => {
  const tokens = createTokenService({ secureCompare: (a: string, b: string) => a === b, superAdminPassword: 'admin', tokenSecret: 'provenance-test-secret' });
  const fields = {
    teamId: 'source',
    name: 'Source',
    role: 'primary',
    mergedAt: '2026-10-13T12:00:00.000Z',
    fingerprint: 'f',
    recordFingerprint: 'r',
    parts: { backlog: 'b', 'retro:r1': 'x' },
    counts: { retrospectives: 1 }
  };
  const signed = { ...fields, signature: tokens.signMergeProvenance('merged', fields) };

  it('verifies the entry the merge wrote, whatever order the store gives its keys back in', () => {
    // PostgreSQL's jsonb hands keys back sorted, not in the order written.
    const reordered = Object.fromEntries(Object.entries(signed).reverse());
    expect(tokens.verifyMergeProvenance('merged', reordered)).toBe(true);
  });

  it('refuses an entry copied onto another team, or with any field edited', () => {
    expect(tokens.verifyMergeProvenance('another-team', signed)).toBe(false);
    for (const edited of [
      { ...signed, recordFingerprint: 'matches-now' },
      { ...signed, parts: { ...signed.parts, 'retro:r1': 'y' } },
      { ...signed, mergedAt: '2026-10-14T00:00:00.000Z' },
      { ...signed, signature: undefined }
    ]) {
      expect(tokens.verifyMergeProvenance('merged', edited)).toBe(false);
    }
  });
});

describe('mergeAncestors', () => {
  const tokens = createTokenService({ secureCompare: (a: string, b: string) => a === b, superAdminPassword: 'admin', tokenSecret: 'ancestors-test-secret' });
  const verify = tokens.verifyMergeProvenance;
  const sourceEntry = (mergedTeamId: string, teamId: string, ancestorIds: string[] = []) => {
    const fields = { teamId, name: teamId, mergedAt: '2026-10-13T12:00:00.000Z', fingerprint: 'f', ancestorIds };
    return { ...fields, signature: tokens.signMergeProvenance(mergedTeamId, fields) };
  };

  it('follows signed provenance at any depth, and through a team that is gone', () => {
    // M = A + B, then N = M + C, then M is deleted: N still descends from A.
    const summaries = [
      { id: 'A' }, { id: 'B' }, { id: 'C' },
      { id: 'N', mergedFrom: [sourceEntry('N', 'M', ['A', 'B']), sourceEntry('N', 'C')] }
    ];
    expect([...mergeAncestors(summaries, 'N', verify)].sort()).toEqual(['A', 'B', 'C', 'M']);
    expect(mergeAncestors(summaries, 'A', verify).size).toBe(0);
  });

  it('ignores provenance the merge did not sign', () => {
    const summaries = [{ id: 'X', mergedFrom: [{ teamId: 'victim', name: 'Victim', fingerprint: 'forged' }] }];
    expect(mergeAncestors(summaries, 'X', verify).size).toBe(0);
  });
});
