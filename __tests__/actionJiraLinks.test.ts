import { describe, expect, it } from 'vitest';
import {
  carryJiraLinks,
  mergeActionImpactState,
  reconcileStoredActions as reconcileUntyped,
  withoutUnstoredJiraLinks as withoutUntyped,
  withRecordedJiraLink
} from '../utils/actionImpact.js';

/**
 * An action's Jira link (`jira: { key, createdAt }`, or `{ uncertainSince }`
 * when a creation's answer was lost) is written by the Jira route alone, on
 * the team record. Every other write path carries whatever its caller holds,
 * and two failures follow from that unless the guards below hold:
 *
 *  - a stale whole-session or whole-action write drops the link, and the next
 *    click creates the same issue in Jira a second time;
 *  - a participant's session write plants a link (`actions` is not a protected
 *    session field), and the action's "Create in Jira" button disappears.
 *
 * So the stored link wins everywhere, the server drops a link the store does
 * not have, and the two restores carry the current links onto an archive taken
 * before them.
 */

type Json = Record<string, any>;

const LINK = { key: 'RETRO-12', createdAt: '2026-10-20T09:00:00.000Z' };
const OTHER_LINK = { key: 'RETRO-99', createdAt: '2026-10-20T10:00:00.000Z' };
const UNCERTAIN = { uncertainSince: '2026-10-20T09:30:00.000Z' };

type ActionList = { actions: Json[]; changed: boolean };
// The module types its lists as `unknown[]`; these tests read them as actions.
const reconcileStoredActions = (stored: unknown, incoming: unknown) =>
  reconcileUntyped(stored as unknown[], incoming as unknown[]) as ActionList;
const withoutUnstoredJiraLinks = (stored: unknown, incoming: unknown) =>
  withoutUntyped(stored as unknown[], incoming as unknown[]) as ActionList;

const action = (id: string, extra: Json = {}): Json => ({
  id,
  text: `Action ${id}`,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...extra
});

describe('reconcileStoredActions keeps the stored Jira link', () => {
  it('puts back a link the incoming blob omits', () => {
    const { actions, changed } = reconcileStoredActions([action('a', { jira: LINK })], [action('a')]);

    expect(changed).toBe(true);
    expect(actions[0].jira).toEqual(LINK);
  });

  it('lets the stored link win over another one, an uncertain marker included', () => {
    expect(reconcileStoredActions([action('a', { jira: LINK })], [action('a', { jira: OTHER_LINK })]).actions[0].jira)
      .toEqual(LINK);
    expect(reconcileStoredActions([action('a', { jira: UNCERTAIN })], [action('a', { jira: LINK })]).actions[0].jira)
      .toEqual(UNCERTAIN);
  });

  // A part of the stored link is not the stored link: kept as "the same", an
  // empty object would make the action read as unlinked and the next click
  // would create its issue a second time.
  it('lets the stored link win over a part of it, an empty object included', () => {
    expect(reconcileStoredActions([action('a', { jira: LINK })], [action('a', { jira: {} })]))
      .toMatchObject({ changed: true, actions: [{ jira: LINK }] });
    expect(reconcileStoredActions([action('a', { jira: LINK })], [action('a', { jira: { key: LINK.key } })]))
      .toMatchObject({ changed: true, actions: [{ jira: LINK }] });
  });

  // The closed-action guards leave proposals alone, but the link is not one of
  // them: a blob that turns a linked action back into a proposal must neither
  // drop the link nor bring its own.
  it('keeps the stored link when the blob turns the action back into a proposal, with a link of its own or none', () => {
    const stored = [action('a', { jira: LINK })];

    expect(reconcileStoredActions(stored, [action('a', { type: 'proposal', jira: OTHER_LINK })]))
      .toMatchObject({ changed: true, actions: [{ type: 'proposal', jira: LINK }] });
    expect(reconcileStoredActions(stored, [action('a', { type: 'proposal' })]))
      .toMatchObject({ changed: true, actions: [{ type: 'proposal', jira: LINK }] });
    expect(reconcileStoredActions([action('a', { type: 'proposal', jira: LINK })], [action('a')]).actions[0].jira)
      .toEqual(LINK);
  });

  it('still leaves a proposal\'s closed-action fields to the blob', () => {
    const stored = [action('a', { done: true, closedAt: '2026-10-01T00:00:00.000Z', impactRatings: { u1: 3 } })];
    const incoming = [action('a', { type: 'proposal' })];
    const { actions, changed } = reconcileStoredActions(stored, incoming);

    expect(changed).toBe(false);
    expect(actions).toBe(incoming);
  });

  // The client reconcilers run this against a cache that may simply be older
  // than the link: leaving the incoming one is what lets a link the server
  // sent survive there. The server drops it separately (withoutUnstoredJiraLinks).
  it('leaves an incoming link alone when the store has none, and reports no change for it', () => {
    const incoming = [action('a', { jira: LINK })];
    const { actions, changed } = reconcileStoredActions([action('a')], incoming);

    expect(changed).toBe(false);
    expect(actions).toBe(incoming);
  });

  it('reports no change when both sides already hold the same link, whatever its key order', () => {
    const incoming = [action('a', { jira: { createdAt: LINK.createdAt, key: LINK.key } })];
    const { actions, changed } = reconcileStoredActions([action('a', { jira: LINK })], incoming);

    expect(changed).toBe(false);
    expect(actions).toBe(incoming);
  });

  it('copies the stored link rather than sharing it, and mutates neither side', () => {
    const stored = [action('a', { jira: { ...LINK } })];
    const incoming = [action('a')];
    const { actions } = reconcileStoredActions(stored, incoming);

    expect(actions[0].jira).not.toBe(stored[0].jira);
    expect(incoming[0]).not.toHaveProperty('jira');
    expect(stored[0].jira).toEqual(LINK);
  });
});

describe('mergeActionImpactState keeps the stored Jira link', () => {
  it('puts back a link a whole-action write omits', () => {
    expect(mergeActionImpactState(action('a', { jira: LINK }), action('a', { text: 'Edited' })).jira).toEqual(LINK);
  });

  it('lets the stored link win over the caller\'s', () => {
    expect(mergeActionImpactState(action('a', { jira: LINK }), action('a', { jira: OTHER_LINK })).jira).toEqual(LINK);
  });

  // `dataService.updateGlobalAction` folds a cached action through this, and
  // the cache may hold a link its own copy of the store predates.
  it('leaves the caller\'s link alone when the store has none, a new action included', () => {
    expect(mergeActionImpactState(action('a'), action('a', { jira: LINK })).jira).toEqual(LINK);
    expect(mergeActionImpactState(undefined, action('a', { jira: LINK })).jira).toEqual(LINK);
    expect(mergeActionImpactState(action('a'), action('a'))).not.toHaveProperty('jira');
  });
});

describe('withoutUnstoredJiraLinks (server only)', () => {
  it('drops a link the stored copy of the action does not have', () => {
    const { actions, changed } = withoutUnstoredJiraLinks([action('a'), action('b', { jira: LINK })], [
      action('a', { jira: OTHER_LINK }),
      action('b', { jira: LINK })
    ]);

    expect(changed).toBe(true);
    expect(actions[0]).not.toHaveProperty('jira');
    expect(actions[1].jira).toEqual(LINK);
  });

  // A participant's client can create an action and give it a link in the
  // same write: there is no stored copy to compare with, and nothing but the
  // Jira route may write one.
  it('drops a link on an action the store does not hold yet, and on every action of a session it does not hold', () => {
    expect(withoutUnstoredJiraLinks([action('a')], [action('new', { jira: LINK })]).actions[0]).not.toHaveProperty('jira');
    expect(withoutUnstoredJiraLinks(undefined, [action('new', { jira: UNCERTAIN })]).actions[0]).not.toHaveProperty('jira');
    expect(withoutUnstoredJiraLinks([], [action('p', { type: 'proposal', jira: LINK })]).actions[0]).not.toHaveProperty('jira');
  });

  // `reconcileStoredActions` puts a stored link back on most actions, but this
  // is the server's last word on what reaches the team record: whatever the
  // blob says about the action, its link is the stored one or nothing.
  it('puts the stored value back, whatever the blob carries and whatever either side\'s type', () => {
    const stored = [action('a', { jira: LINK }), action('m', { jira: UNCERTAIN }), action('p', { type: 'proposal', jira: LINK })];
    const { actions, changed } = withoutUnstoredJiraLinks(stored, [
      action('a', { type: 'proposal', jira: OTHER_LINK }),
      action('m', { type: 'proposal' }),
      action('p', { jira: {} })
    ]);

    expect(changed).toBe(true);
    expect(actions.map((a: Json) => [a.type, a.jira])).toEqual([['proposal', LINK], ['proposal', UNCERTAIN], ['new', LINK]]);
    expect(actions[0].jira).not.toBe(stored[0].jira);
    expect(withoutUnstoredJiraLinks(stored, [action('a', { jira: { key: LINK.key } })]).actions[0].jira).toEqual(LINK);
    expect(withoutUnstoredJiraLinks(stored, [action('a', { jira: null })]).actions[0].jira).toEqual(LINK);
  });

  it('leaves the list itself when there is nothing to drop', () => {
    const incoming = [action('a'), action('b', { jira: LINK })];
    const { actions, changed } = withoutUnstoredJiraLinks([action('b', { jira: LINK })], incoming);

    expect(changed).toBe(false);
    expect(actions).toBe(incoming);
    expect(withoutUnstoredJiraLinks([], undefined)).toEqual({ actions: undefined, changed: false });
  });

  it('mutates neither side', () => {
    const incoming = [action('a', { jira: LINK })];
    withoutUnstoredJiraLinks([action('a')], incoming);

    expect(incoming[0].jira).toEqual(LINK);
  });

  // An uncertain marker is the store's record that an issue may already
  // exist. Dropping it because it is "not a link" would let the next click
  // create the issue again without the "May already be in Jira" check.
  it('keeps a stored uncertain marker, exactly as it keeps a stored link', () => {
    const { actions, changed } = withoutUnstoredJiraLinks([action('a', { jira: UNCERTAIN })], [action('a', { jira: UNCERTAIN })]);

    expect(changed).toBe(false);
    expect(actions[0].jira).toEqual(UNCERTAIN);
  });

  it('after reconcileStoredActions, leaves exactly the stored links and markers', () => {
    const stored = [action('linked', { jira: LINK }), action('maybe', { jira: UNCERTAIN }), action('plain')];
    const incoming = [
      action('linked'),
      action('maybe'),
      action('plain', { jira: OTHER_LINK }),
      action('new', { jira: UNCERTAIN })
    ];
    const reconciled = reconcileStoredActions(stored, incoming).actions;
    const { actions } = withoutUnstoredJiraLinks(stored, reconciled);

    expect(actions.map((a: Json) => a.jira)).toEqual([LINK, UNCERTAIN, undefined, undefined]);
  });
});

describe('withRecordedJiraLink (the whole-action route, server only)', () => {
  // `mergeActionImpactState` leaves the caller's link when the stored copy has
  // none, because the client folds its cache through it. On the server that
  // would let any team session plant a link straight onto the team record —
  // where "already linked" is decided — so the route takes the link from the
  // record instead.
  const team = (extra: Json = {}): Json => ({ id: 't1', globalActions: [], retrospectives: [], healthChecks: [], ...extra });

  it('drops the caller\'s link on a stored copy that has none, and on a new action', () => {
    const stored = action('a');
    const record = team({ globalActions: [stored] });

    expect(withRecordedJiraLink(record, stored, mergeActionImpactState(stored, action('a', { jira: LINK }))))
      .not.toHaveProperty('jira');
    expect(withRecordedJiraLink(record, undefined, mergeActionImpactState(undefined, action('new', { jira: UNCERTAIN }))))
      .not.toHaveProperty('jira');
  });

  it('keeps the stored copy\'s value, whatever its shape, over the caller\'s', () => {
    const malformed = { key: 'legacy' };
    const linked = action('a', { jira: LINK });
    const odd = action('b', { jira: malformed });
    const record = team({ globalActions: [linked, odd] });

    expect(withRecordedJiraLink(record, linked, action('a', { jira: OTHER_LINK })).jira).toEqual(LINK);
    expect(withRecordedJiraLink(record, odd, action('b')).jira).toEqual(malformed);
  });

  // `/action` without a retroId creates a backlog copy of an action that only
  // a retrospective held so far; that action may legitimately be in Jira.
  it('gives a new copy the link or marker another home of the same id holds, a key over a marker', () => {
    const record = team({
      globalActions: [action('a', { jira: UNCERTAIN })],
      retrospectives: [{ id: 'r1', actions: [action('a', { jira: LINK }), action('b', { jira: UNCERTAIN })] }],
      healthChecks: [{ id: 'h1', actions: [action('c', { jira: { url: 'https://evil.example.org' } })] }]
    });

    expect(withRecordedJiraLink(record, undefined, action('b')).jira).toEqual(UNCERTAIN);
    expect(withRecordedJiraLink(record, undefined, action('a', { jira: OTHER_LINK })).jira).toEqual(LINK);
    expect(withRecordedJiraLink(record, undefined, action('c', { jira: OTHER_LINK }))).not.toHaveProperty('jira');
  });

  it('is pure, and never shares the record\'s link object', () => {
    const stored = action('a', { jira: { ...LINK } });
    const record = team({ globalActions: [stored] });
    const merged = action('a', { jira: OTHER_LINK });

    const result = withRecordedJiraLink(record, stored, merged);

    expect(result).not.toBe(merged);
    expect(result.jira).not.toBe(stored.jira);
    expect(merged.jira).toEqual(OTHER_LINK);
    expect(stored.jira).toEqual(LINK);
  });
});

describe('carryJiraLinks (both restores)', () => {
  const team = (extra: Json = {}): Json => ({
    id: 't1',
    name: 'Team',
    globalActions: [],
    retrospectives: [],
    healthChecks: [],
    ...extra
  });

  // A backup taken before the issues were created would otherwise bring the
  // actions back unlinked while the issues exist in Jira, and the next click
  // would create every one of them again.
  it('carries every current link onto the archived copies of the same action, in every home', () => {
    const current = team({
      globalActions: [action('a', { jira: LINK })],
      retrospectives: [{ id: 'r1', actions: [action('b', { jira: UNCERTAIN })] }],
      healthChecks: [{ id: 'h1', actions: [action('c', { jira: OTHER_LINK })] }]
    });
    const archived = team({
      globalActions: [action('a'), action('c')],
      retrospectives: [{ id: 'r1', actions: [action('a'), action('b')] }],
      healthChecks: [{ id: 'h1', actions: [action('c')] }, { id: 'h2', actions: [action('b')] }]
    });

    const carried = carryJiraLinks(archived, current);

    expect(carried.globalActions.map((a: Json) => a.jira)).toEqual([LINK, OTHER_LINK]);
    expect(carried.retrospectives[0].actions.map((a: Json) => a.jira)).toEqual([LINK, UNCERTAIN]);
    expect(carried.healthChecks.map((h: Json) => h.actions[0].jira)).toEqual([OTHER_LINK, UNCERTAIN]);
  });

  it('never overwrites a link the archive already holds', () => {
    const current = team({ globalActions: [action('a', { jira: OTHER_LINK })] });
    const archived = team({ globalActions: [action('a', { jira: LINK })] });

    expect(carryJiraLinks(archived, current).globalActions[0].jira).toEqual(LINK);
  });

  // The archive was taken while the action was in doubt; the facilitator has
  // since checked Jira and created it ("Create anyway"). Kept, the marker would
  // offer "Create anyway" again after the restore, and a second issue with it.
  it('replaces an archived uncertain marker with the key the current record holds, in every home', () => {
    const current = team({
      globalActions: [action('a', { jira: LINK })],
      retrospectives: [{ id: 'r1', actions: [action('a', { jira: LINK })] }]
    });
    const archived = team({
      globalActions: [action('a', { jira: UNCERTAIN })],
      retrospectives: [{ id: 'r1', actions: [action('a', { jira: UNCERTAIN })] }],
      healthChecks: [{ id: 'h1', actions: [action('a', { jira: { uncertainSince: 'x', key: 'not-a-key' } })] }]
    });

    const carried = carryJiraLinks(archived, current);

    expect(carried.globalActions[0].jira).toEqual(LINK);
    expect(carried.retrospectives[0].actions[0].jira).toEqual(LINK);
    // A marker beside a malformed key still reads as a marker.
    expect(carried.healthChecks[0].actions[0].jira).toEqual(LINK);
  });

  it('keeps an archived uncertain marker when the current record has no key for it', () => {
    const OTHER_MARK = { uncertainSince: '2026-10-21T00:00:00.000Z' };
    const current = team({ globalActions: [action('a', { jira: OTHER_MARK }), action('b')] });
    const archived = team({ globalActions: [action('a', { jira: UNCERTAIN }), action('b', { jira: UNCERTAIN })] });

    const carried = carryJiraLinks(archived, current);

    expect(carried.globalActions.map((a: Json) => a.jira)).toEqual([UNCERTAIN, UNCERTAIN]);
  });

  it('never replaces an archived value that is neither a key nor a marker', () => {
    const odd = { url: 'https://jira.example.org/browse/RETRO-1' };
    const current = team({ globalActions: [action('a', { jira: LINK })] });
    const archived = team({ globalActions: [action('a', { jira: odd })] });

    expect(carryJiraLinks(archived, current).globalActions[0].jira).toEqual(odd);
  });

  // Only what the Jira route writes is carried: a planted value (a URL, a
  // malformed key) is not a link, and carrying it would spread it.
  it('carries only real links and uncertain markers', () => {
    const current = team({
      globalActions: [
        action('a', { jira: { key: 'not-a-key', createdAt: 'x' } }),
        action('b', { jira: { url: 'https://evil.example.org' } }),
        action('c', { jira: 'RETRO-1' })
      ]
    });
    const archived = team({ globalActions: [action('a'), action('b'), action('c')] });

    expect(carryJiraLinks(archived, current).globalActions.every((a: Json) => a.jira === undefined)).toBe(true);
  });

  it('prefers a key over an uncertain marker when the current copies disagree', () => {
    const current = team({
      globalActions: [action('a', { jira: UNCERTAIN })],
      retrospectives: [{ id: 'r1', actions: [action('a', { jira: LINK })] }]
    });

    expect(carryJiraLinks(team({ globalActions: [action('a')] }), current).globalActions[0].jira).toEqual(LINK);
  });

  it('is pure, and returns a new team even with nothing to carry', () => {
    const current = team({ globalActions: [action('a', { jira: LINK })] });
    const archived = team({ globalActions: [action('a')], retrospectives: [{ id: 'r1', actions: [action('a')] }] });
    const before = structuredClone(archived);
    const currentBefore = structuredClone(current);

    const carried = carryJiraLinks(archived, current);
    carried.globalActions[0].jira.key = 'CHANGED-1';

    expect(archived).toEqual(before);
    expect(current).toEqual(currentBefore);
    expect(carryJiraLinks(archived, null)).not.toBe(archived);
    expect(carryJiraLinks(archived, null)).toEqual(archived);
    expect(carryJiraLinks(archived, team())).toEqual(archived);
  });

  it('tolerates the shapes a legacy record may hold', () => {
    const current = team({ globalActions: [null, action('a', { jira: LINK })], retrospectives: [null, { id: 'r1' }] });
    const archived = { id: 't1', name: 'Team', globalActions: [null, action('a')], retrospectives: 'broken' };

    const carried = carryJiraLinks(archived, current);

    expect(carried.globalActions[1].jira).toEqual(LINK);
    expect(carried.retrospectives).toBe('broken');
  });
});
