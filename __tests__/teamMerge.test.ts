import { describe, expect, it } from 'vitest';
import {
  applyFresherSessionRows,
  contentDigest,
  describeContentChanges,
  fingerprintTeamContent,
  planTeamMerge,
  sessionIdsOf,
  zipperNewestFirst
} from '../server/services/teamMerge.js';

/**
 * The pure half of the super-admin team merge (`server/services/teamMerge.js`).
 * The promises under test: the sources are never written, nothing is lost,
 * nothing is overwritten — and a person's history reads as one person.
 */

const idGenerator = () => {
  let n = 0;
  return () => `gen${String(++n).padStart(6, '0')}`;
};

const member = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id,
  name,
  color: 'bg-slate-500',
  role: 'participant',
  ...extra
});

const action = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  text: `Action ${id}`,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...extra
});

const retro = (id: string, teamId: string, extra: Record<string, unknown> = {}) => ({
  id,
  teamId,
  name: `Retro ${id}`,
  date: '1/1/2026',
  status: 'CLOSED',
  phase: 'CLOSE',
  participants: [],
  icebreakerQuestion: '',
  columns: [{ id: '1', title: 'Went well' }],
  settings: {},
  tickets: [],
  groups: [],
  actions: [],
  happiness: {},
  roti: {},
  finishedUsers: [],
  _rev: 4,
  ...extra
});

const healthCheck = (id: string, teamId: string, extra: Record<string, unknown> = {}) => ({
  id,
  teamId,
  name: `Health ${id}`,
  date: '1/1/2026',
  status: 'CLOSED',
  phase: 'CLOSE',
  templateId: 'team_health_en',
  templateName: 'Team Health',
  dimensions: [{ id: 'autonomy', name: 'Autonomy' }],
  participants: [],
  settings: { isAnonymous: false, revealRoti: false },
  ratings: {},
  actions: [],
  roti: {},
  finishedUsers: [],
  _rev: 2,
  ...extra
});

/** The primary team: the one that keeps its ids. */
const primaryTeam = () => ({
  id: 'teamA',
  name: 'Pratique analyse produit',
  passwordHash: 'scrypt$hashA',
  facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch',
  inviteEpoch: 3,
  members: [
    member('admin-aaa111', 'Facilitator', { role: 'facilitator', color: 'bg-indigo-500' }),
    member('a-jean', 'Jean'),
    member('a-marie', 'Marie', { email: 'marie@etat.ge.ch' }),
    member('a-paul', 'Paul')
  ],
  archivedMembers: [member('a-old', 'Ancien')],
  customTemplates: [{ name: 'Classique', cols: [{ id: 'c1', title: 'Bien' }] }],
  customHealthCheckTemplates: [{ id: 'custom_shared', name: 'Santé', dimensions: [{ id: 'd1', name: 'D1' }] }],
  retrospectives: [
    retro('ra2', 'teamA', { _updatedAt: '2026-09-20T10:00:00.000Z' }),
    retro('ra1', 'teamA', {
      _updatedAt: '2026-06-01T10:00:00.000Z',
      actions: [action('act-a1', { assigneeId: 'a-jean', done: true, closedAt: '2026-06-02', impactDeferredBy: 'ra2' })]
    })
  ],
  healthChecks: [healthCheck('ha1', 'teamA', { _updatedAt: '2026-08-01T10:00:00.000Z' })],
  globalActions: [action('act-shared', { assigneeId: 'a-marie' })],
  teamFeedbacks: [{ id: 'feedback_a', teamId: 'teamA', teamName: 'Pratique analyse produit', title: 'Bug' }],
  lastConnectionDate: '2026-09-20T10:00:00.000Z',
  actionImpactNoticeDismissedAt: '2026-05-01T00:00:00.000Z'
});

/**
 * The secondary team: a duplicate of the same people, created when the
 * facilitator could not recover the password. It exercises every field that
 * holds a member id, so a field the merge forgets to rewrite shows up as a
 * stale secondary id below.
 */
const secondaryTeam = () => ({
  id: 'teamB',
  name: 'Pratique analyse produit 2',
  passwordHash: 'scrypt$hashB',
  facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch;',
  inviteEpoch: 0,
  members: [
    member('admin-bbb222', 'Elisabeth', { role: 'facilitator', color: 'bg-indigo-500' }),
    member('b-jean', ' jean ', { inviteToken: 'tokB', joinedBefore: true }),
    member('b-marie', 'Marie Dupont', { email: 'MARIE@etat.ge.ch;' }),
    member('b-luc', 'Luc'),
    // Same id as a primary member, but a different person.
    member('a-paul', 'Sophie')
  ],
  archivedMembers: [],
  customTemplates: [
    { name: 'Classique', cols: [{ id: 'c1', title: 'Bien' }] },
    { name: 'classique ', cols: [{ id: 'c9', title: 'Autre' }] }
  ],
  customHealthCheckTemplates: [{ id: 'custom_shared', name: 'Climat', dimensions: [{ id: 'd2', name: 'D2' }] }],
  retrospectives: [
    retro('rb1', 'teamB', {
      _updatedAt: '2026-07-15T10:00:00.000Z',
      status: 'IN_PROGRESS',
      phase: 'DISCUSS',
      participants: [member('admin-bbb222', 'Elisabeth', { role: 'facilitator' }), member('b-jean', 'Jean'), member('b-luc', 'Luc')],
      leftUsers: ['b-luc'],
      invitedUsers: [{ id: 'b-marie', name: 'Marie Dupont', email: 'marie@etat.ge.ch' }],
      discussionNextTopicVotes: { t1: ['b-jean', 'b-luc'] },
      tickets: [
        {
          id: 't1',
          colId: '1',
          text: 'Slow builds',
          authorId: 'b-jean',
          groupId: null,
          votes: ['b-jean', 'b-jean', 'a-paul'],
          reactions: { '👍': ['b-luc'] },
          comments: [{ id: 'cm1', authorId: 'b-marie', authorName: 'Marie', text: 'yes', createdAt: '2026-07-15' }]
        }
      ],
      groups: [{ id: 'g1', title: 'CI', colId: '1', votes: ['b-luc', 'b-luc'] }],
      actions: [
        action('act-b1', {
          assigneeId: 'b-luc',
          proposalVotes: { 'b-jean': 'up', 'a-paul': 'down' },
          impactRatings: { 'b-marie': 3 },
          impactDeferredBy: 'rb0'
        }),
        // Same id as a primary backlog action.
        action('act-shared', { assigneeId: 'b-jean' })
      ],
      openActionsSnapshot: [action('act-b0', { assigneeId: 'admin-bbb222' })],
      historyActionsSnapshot: [action('act-shared', { assigneeId: 'b-jean' })],
      closedActionsSnapshot: [action('act-b0', { impactRatings: { 'b-jean': 2 }, impactDeferredBy: 'rb0' })],
      actionImpactVotes: { 'act-shared': { 'b-jean': 1 }, 'act-b0': { 'b-luc': 'abstain' } },
      happiness: { 'b-jean': 4, 'a-paul': 2 },
      roti: { 'b-luc': 5 },
      finishedUsers: ['b-jean', 'admin-bbb222'],
      autoFinishedUsers: ['b-luc']
    }),
    retro('rb0', 'teamB', { _updatedAt: '2026-05-01T10:00:00.000Z' })
  ],
  healthChecks: [
    healthCheck('hb1', 'teamB', {
      _updatedAt: '2026-09-01T10:00:00.000Z',
      templateId: 'custom_shared',
      templateName: 'Climat',
      participants: [member('b-marie', 'Marie Dupont')],
      leftUsers: ['b-luc'],
      invitedUsers: [{ id: 'b-jean', name: 'Jean' }],
      ratings: { 'b-marie': { d2: { rating: 4 } }, 'a-paul': { d2: { rating: 2 } } },
      actions: [action('act-hb1', { assigneeId: 'b-marie', proposalVotes: { 'b-luc': 'neutral' }, linkedTicketId: 'd2' })],
      roti: { 'b-marie': 3 },
      finishedUsers: ['b-marie']
    })
  ],
  globalActions: [action('act-b-backlog', { assigneeId: 'b-marie', impactRatings: { 'b-luc': 2 }, impactDeferredBy: 'rb1' })],
  teamFeedbacks: [
    { id: 'feedback_b1', teamId: 'teamB', title: 'Bug' },
    { id: 'feedback_b2', teamId: 'teamB', title: 'Idea' }
  ],
  lastConnectionDate: '2026-10-01T10:00:00.000Z',
  actionImpactRatingEnabled: false,
  actionImpactNoticeDismissedAt: '2026-04-01T00:00:00.000Z',
  favoriteColor: 'teal'
});

const merge = (overrides: Record<string, unknown> = {}) => {
  const primary = primaryTeam();
  const secondary = secondaryTeam();
  const result = planTeamMerge({
    primary,
    secondary,
    newTeamId: 'teamM',
    name: 'Pratique analyse produit (fusion)',
    passwordHash: 'scrypt$hashA',
    facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch',
    mergedAt: '2026-10-13T12:00:00.000Z',
    generateId: idGenerator(),
    ...overrides
  });
  return { primary, secondary, ...result };
};

/** Every string anywhere in a value, for "no stale id survives" checks. */
const allStrings = (value: unknown, out: string[] = []): string[] => {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((item) => allStrings(item, out));
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      allStrings(item, out);
    }
  }
  return out;
};

type Named = { id: string; name: string };
const byName = (team: { members: Named[]; archivedMembers: Named[] }, name: string): (Named & Record<string, unknown>) | undefined =>
  [...team.members, ...team.archivedMembers].find((m) => m.name === name);

describe('planTeamMerge — nothing is lost', () => {
  it('keeps every retro, health check and action of both teams', () => {
    const { team, primary, secondary } = merge();
    expect(team.retrospectives).toHaveLength(primary.retrospectives.length + secondary.retrospectives.length);
    expect(team.healthChecks).toHaveLength(primary.healthChecks.length + secondary.healthChecks.length);
    expect(team.globalActions).toHaveLength(primary.globalActions.length + secondary.globalActions.length);
    expect(team.retrospectives.map((r: { name: string }) => r.name).sort()).toEqual(
      ['Retro ra1', 'Retro ra2', 'Retro rb0', 'Retro rb1'].sort()
    );
  });

  it('keeps both templates when the same name holds different columns, and drops only exact duplicates', () => {
    const { team, report } = merge();
    expect(team.customTemplates).toEqual([
      { name: 'Classique', cols: [{ id: 'c1', title: 'Bien' }] },
      { name: 'classique  (Pratique analyse produit 2)', cols: [{ id: 'c9', title: 'Autre' }] }
    ]);
    expect(report.templates.deduplicated).toBe(1);
  });

  it('gives a colliding health-check template a new id and moves the secondary health checks with it', () => {
    const { team, report } = merge();
    const [kept, moved] = team.customHealthCheckTemplates;
    expect(kept).toEqual({ id: 'custom_shared', name: 'Santé', dimensions: [{ id: 'd1', name: 'D1' }] });
    expect(moved.id).not.toBe('custom_shared');
    expect(moved.id).toMatch(/^custom_/);
    expect(moved.dimensions).toEqual([{ id: 'd2', name: 'D2' }]);
    const climate = team.healthChecks.find((h: { name: string }) => h.name === 'Health hb1');
    expect(climate.templateId).toBe(moved.id);
    const primaryCheck = team.healthChecks.find((h: { name: string }) => h.name === 'Health ha1');
    expect(primaryCheck.templateId).toBe('team_health_en');
    expect(report.templates.reminted).toBe(1);
  });

  it('carries top-level fields it does not know about', () => {
    const { team, report } = merge();
    expect(team.favoriteColor).toBe('teal');
    expect(report.unknownKeys.carried).toEqual(['favoriteColor']);
  });

  it('keeps the main team\'s value of a field both teams hold differently, and reports it', () => {
    const { team, report } = merge({
      primary: { ...primaryTeam(), customFlag: 'a' },
      secondary: { ...secondaryTeam(), customFlag: 'b' }
    });
    expect(team.customFlag).toBe('a');
    expect(report.unknownKeys.conflicting).toEqual(['customFlag']);
  });

  it('does not copy feedbacks — they move when a source is deleted — and says how many will', () => {
    const { team, report } = merge();
    expect(team.teamFeedbacks).toEqual([]);
    expect(report.feedbacksToMoveOnDelete).toEqual({ primary: 1, secondary: 2 });
  });

  // The target is a team setting like any other: the main team's wins. The
  // claims are a source's record of issues being created for *its* actions
  // right now; on the merged team, which starts with no Jira token, they
  // would only block those actions.
  it('takes the main team\'s Jira target, never either team\'s Jira claims, and keeps every action\'s link', () => {
    const link = { key: 'RETRO-3', createdAt: '2026-10-01T00:00:00.000Z' };
    const primary = primaryTeam() as Record<string, any>;
    primary.jiraTarget = { mode: 'project', projectKey: 'AAA', issueTypeId: '1', labels: [] };
    primary.jiraClaims = { 'act-shared': { at: '2026-10-13T11:59:00.000Z', requestId: 'r1' } };
    primary.globalActions[0].jira = link;
    const secondary = secondaryTeam() as Record<string, any>;
    secondary.jiraTarget = { mode: 'parent', parentKey: 'BBB-1', issueTypeId: '2', labels: [] };
    secondary.jiraClaims = { 'act-b1': { at: '2026-10-13T11:59:00.000Z', requestId: 'r2' } };

    const { team, report } = merge({ primary, secondary });

    expect(team.jiraTarget).toEqual(primary.jiraTarget);
    expect(report.unknownKeys.conflicting).toContain('jiraTarget');
    expect(team).not.toHaveProperty('jiraClaims');
    expect(report.unknownKeys.carried).not.toContain('jiraClaims');
    expect(team.globalActions.find((a: Record<string, any>) => a.id === 'act-shared').jira).toEqual(link);
  });
});

describe('planTeamMerge — the sources are never written', () => {
  it('leaves both inputs exactly as they were', () => {
    const primary = primaryTeam();
    const secondary = secondaryTeam();
    const before = JSON.stringify([primary, secondary]);
    planTeamMerge({
      primary,
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    expect(JSON.stringify([primary, secondary])).toBe(before);
  });

  it('shares no object with its inputs, so a later edit of the merged team cannot reach a source', () => {
    const { team, primary } = merge();
    team.retrospectives.find((r: { name: string }) => r.name === 'Retro ra1').actions[0].text = 'changed';
    expect(primary.retrospectives[1].actions[0].text).toBe('Action act-a1');
  });

  it('refuses to merge a team with itself', () => {
    const team = primaryTeam();
    expect(() => planTeamMerge({
      primary: team,
      secondary: primaryTeam(),
      newTeamId: 'x',
      name: 'x',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    })).toThrow(/itself/);
  });
});

describe('planTeamMerge — retros and health checks get new ids bound to the merged team', () => {
  it('re-ids every entry and points it at the merged team, so no live session row of a source can claim it', () => {
    const { team } = merge();
    const sourceIds = ['ra1', 'ra2', 'rb0', 'rb1', 'ha1', 'hb1'];
    for (const entry of [...team.retrospectives, ...team.healthChecks]) {
      expect(sourceIds).not.toContain(entry.id);
      expect(entry.teamId).toBe('teamM');
      // The persist route's rev guard needs a numeric revision to keep refusing
      // revision-less placeholder overwrites.
      expect(typeof entry._rev).toBe('number');
    }
  });

  it('rewrites "rate later" so it still names the right retro', () => {
    const { team } = merge();
    const idOf = (name: string) => team.retrospectives.find((r: { name: string }) => r.name === name).id;
    const ra1 = team.retrospectives.find((r: { name: string }) => r.name === 'Retro ra1');
    expect(ra1.actions[0].impactDeferredBy).toBe(idOf('Retro ra2'));
    const rb1 = team.retrospectives.find((r: { name: string }) => r.name === 'Retro rb1');
    expect(rb1.actions[0].impactDeferredBy).toBe(idOf('Retro rb0'));
    expect(rb1.closedActionsSnapshot[0].impactDeferredBy).toBe(idOf('Retro rb0'));
    const backlog = team.globalActions.find((a: { text: string }) => a.text === 'Action act-b-backlog');
    expect(backlog.impactDeferredBy).toBe(idOf('Retro rb1'));
  });

  it('interleaves the two histories newest first without reordering either one', () => {
    const { team } = merge();
    expect(team.retrospectives.map((r: { name: string }) => r.name)).toEqual([
      'Retro ra2', 'Retro rb1', 'Retro ra1', 'Retro rb0'
    ]);
    expect(team.healthChecks.map((h: { name: string }) => h.name)).toEqual(['Health hb1', 'Health ha1']);
  });

  it('keeps two entries that a legacy record stored under the same id apart', () => {
    const secondary = secondaryTeam();
    secondary.retrospectives = [retro('dup', 'teamB', { name: 'First' }), retro('dup', 'teamB', { name: 'Second' })];
    const { team, report } = planTeamMerge({
      primary: primaryTeam(),
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    const ids = team.retrospectives.filter((r: { name: string }) => ['First', 'Second'].includes(r.name)).map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(2);
    expect(report.sessions.ambiguousRetroIds).toEqual(['dup']);
  });
});

describe('planTeamMerge — one person, one member', () => {
  it('keeps the primary facilitator first and folds the secondary facilitator into it', () => {
    const { team, report } = merge();
    expect(team.members[0]).toMatchObject({ id: 'admin-aaa111', role: 'facilitator', name: 'Facilitator' });
    expect(team.members.filter((m: { role: string }) => m.role === 'facilitator')).toHaveLength(1);
    expect(report.members.unified).toContainEqual(
      expect.objectContaining({ fromId: 'admin-bbb222', intoId: 'admin-aaa111', reason: 'facilitator' })
    );
  });

  it('unifies the same email once cleaned, and the same name when it is unique on both sides', () => {
    const { team, report } = merge();
    const reasons = Object.fromEntries(report.members.unified.map((u: { fromId: string; reason: string }) => [u.fromId, u.reason]));
    expect(reasons['b-marie']).toBe('email');
    expect(reasons['b-jean']).toBe('name');
    // The unified person keeps the primary identity and gains what only the
    // other side knew.
    expect(byName(team, 'Jean')).toMatchObject({ id: 'a-jean', inviteToken: 'tokB', joinedBefore: true });
    expect(byName(team, 'Marie')).toMatchObject({ id: 'a-marie', email: 'marie@etat.ge.ch' });
  });

  it('keeps a different person who happens to share an id, under a new id', () => {
    const { team, report } = merge();
    const sophie = byName(team, 'Sophie');
    expect(sophie?.id).not.toBe('a-paul');
    expect(byName(team, 'Paul')?.id).toBe('a-paul');
    expect(report.members.reminted).toEqual([{ name: 'Sophie', fromId: 'a-paul', toId: sophie?.id }]);
  });

  it('adds the members only the secondary team had, and keeps the archived ones', () => {
    const { team } = merge();
    expect(team.members.map((m: { name: string }) => m.name)).toEqual(['Facilitator', 'Jean', 'Marie', 'Paul', 'Luc', 'Sophie']);
    expect(team.archivedMembers.map((m: { name: string }) => m.name)).toEqual(['Ancien']);
  });

  it('rewrites every field that holds a secondary member id, and none of the old ids survives', () => {
    const { team } = merge();
    const sophieId = byName(team, 'Sophie')!.id;
    const rb1 = team.retrospectives.find((r: { name: string }) => r.name === 'Retro rb1');
    expect(rb1.participants.map((p: { id: string }) => p.id)).toEqual(['admin-aaa111', 'a-jean', 'b-luc']);
    expect(rb1.leftUsers).toEqual(['b-luc']);
    expect(rb1.invitedUsers[0].id).toBe('a-marie');
    expect(rb1.discussionNextTopicVotes).toEqual({ t1: ['a-jean', 'b-luc'] });
    expect(rb1.tickets[0]).toMatchObject({
      authorId: 'a-jean',
      // A multiset: two votes from one person stay two votes.
      votes: ['a-jean', 'a-jean', sophieId],
      reactions: { '👍': ['b-luc'] }
    });
    expect(rb1.tickets[0].comments[0].authorId).toBe('a-marie');
    expect(rb1.groups[0].votes).toEqual(['b-luc', 'b-luc']);
    expect(rb1.actions[0].proposalVotes).toEqual({ 'a-jean': 'up', [sophieId]: 'down' });
    expect(rb1.actions[0].impactRatings).toEqual({ 'a-marie': 3 });
    expect(rb1.openActionsSnapshot[0].assigneeId).toBe('admin-aaa111');
    expect(rb1.closedActionsSnapshot[0].impactRatings).toEqual({ 'a-jean': 2 });
    expect(rb1.happiness).toEqual({ 'a-jean': 4, [sophieId]: 2 });
    expect(rb1.finishedUsers).toEqual(['a-jean', 'admin-aaa111']);
    expect(rb1.autoFinishedUsers).toEqual(['b-luc']);

    const hb1 = team.healthChecks.find((h: { name: string }) => h.name === 'Health hb1');
    expect(hb1.participants[0].id).toBe('a-marie');
    expect(hb1.invitedUsers[0].id).toBe('a-jean');
    expect(Object.keys(hb1.ratings).sort()).toEqual(['a-marie', sophieId].sort());
    expect(hb1.actions[0]).toMatchObject({ assigneeId: 'a-marie', proposalVotes: { 'b-luc': 'neutral' } });
    expect(hb1.roti).toEqual({ 'a-marie': 3 });
    expect(hb1.finishedUsers).toEqual(['a-marie']);

    const backlog = team.globalActions.find((a: { text: string }) => a.text === 'Action act-b-backlog');
    expect(backlog).toMatchObject({ assigneeId: 'a-marie', impactRatings: { 'b-luc': 2 } });

    const strings = allStrings([team.retrospectives, team.healthChecks, team.globalActions, team.members]);
    for (const stale of ['b-jean', 'b-marie', 'admin-bbb222']) {
      expect(strings).not.toContain(stale);
    }
  });

  it('never unifies two people of the same team, and reports a name it could not resolve', () => {
    const secondary = secondaryTeam();
    secondary.members.push(member('b-jean-2', 'JEAN'));
    const { team, report } = planTeamMerge({
      primary: primaryTeam(),
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    expect(report.members.unified.map((u: { fromId: string }) => u.fromId)).not.toContain('b-jean');
    expect(report.members.keptSameName).toEqual(
      expect.arrayContaining([expect.objectContaining({ secondaryId: 'b-jean', reason: 'ambiguous' })])
    );
    expect(team.members.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(['a-jean', 'b-jean', 'b-jean-2']));
  });

  it('keeps two same-named people apart when their emails say they are different', () => {
    const secondary = secondaryTeam();
    secondary.members[1] = member('b-jean', 'Jean', { email: 'jean.b@etat.ge.ch' });
    const primary = primaryTeam();
    primary.members[1] = member('a-jean', 'Jean', { email: 'jean.a@etat.ge.ch' });
    const { team, report } = planTeamMerge({
      primary,
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    expect(report.members.keptSameName).toContainEqual(expect.objectContaining({ secondaryId: 'b-jean', reason: 'email_conflict' }));
    expect(team.members.map((m: { id: string }) => m.id)).toEqual(expect.arrayContaining(['a-jean', 'b-jean']));
  });

  it('keeps a person active when only one side had archived them', () => {
    const primary = primaryTeam();
    primary.members = primary.members.filter((m) => m.id !== 'a-jean');
    primary.archivedMembers.push(member('a-jean', 'Jean'));
    const { team } = planTeamMerge({
      primary,
      secondary: secondaryTeam(),
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    expect(team.members.map((m: { id: string }) => m.id)).toContain('a-jean');
    expect(team.archivedMembers.map((m: { id: string }) => m.id)).not.toContain('a-jean');
  });

  it('gives a facilitator to a merged team whose sources had none, so password login reaches the Dashboard', () => {
    const primary = primaryTeam();
    const secondary = secondaryTeam();
    primary.members = primary.members.filter((m) => m.role !== 'facilitator');
    secondary.members = secondary.members.filter((m) => m.role !== 'facilitator');
    const { team, report } = planTeamMerge({
      primary,
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    expect(team.members[0]).toMatchObject({ role: 'facilitator', name: 'Facilitator' });
    expect(team.members[0].id).toMatch(/^admin-/);
    expect(report.members.mintedFacilitator).toBe(true);
  });

  it('uses the secondary facilitator when only the secondary team has one', () => {
    const primary = primaryTeam();
    primary.members = primary.members.filter((m) => m.role !== 'facilitator');
    const { team } = planTeamMerge({
      primary,
      secondary: secondaryTeam(),
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    expect(team.members[0]).toMatchObject({ id: 'admin-bbb222', role: 'facilitator' });
  });

  it('carries roster entries it cannot read exactly as they were, instead of dropping them', () => {
    const secondary = secondaryTeam() as Record<string, unknown>;
    (secondary.members as unknown[]).push(null, { name: 'no id' });
    const { team, report } = planTeamMerge({
      primary: primaryTeam(),
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    expect(team.members.slice(-2)).toEqual([null, { name: 'no id' }]);
    expect(report.members.malformed).toBe(2);
  });

  it('folds a member listed twice in one team into one person, keeping what each copy knew', () => {
    const secondary = secondaryTeam();
    secondary.archivedMembers = [member('b-luc', 'Luc', { email: 'luc@etat.ge.ch', inviteToken: 'tok-luc' })];
    const { team, report } = planTeamMerge({
      primary: primaryTeam(),
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    const lucs = [...team.members, ...team.archivedMembers].filter((m: { id: string }) => m.id === 'b-luc');
    expect(lucs).toEqual([expect.objectContaining({ name: 'Luc', email: 'luc@etat.ge.ch', inviteToken: 'tok-luc' })]);
    expect(team.members.map((m: { id: string }) => m.id)).toContain('b-luc');
    expect(report.members.folded).toBe(1);
  });

  it('refuses a team whose list is not a list, rather than drop what it holds', () => {
    const secondary = secondaryTeam() as Record<string, unknown>;
    secondary.archivedMembers = 'not a list';
    secondary.retrospectives = { broken: true };
    expect(() => planTeamMerge({
      primary: primaryTeam(),
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    })).toThrow(expect.objectContaining({
      name: 'MergeSourceError',
      anomalies: [
        { source: 'secondary', field: 'archivedMembers' },
        { source: 'secondary', field: 'retrospectives' }
      ]
    }));
  });

  it('reports two people kept apart who share an email, for the admin to sort out', () => {
    // The facilitator seat is never unified with a participant, so a
    // participant of the other team holding the seat's address stays apart.
    const secondary = secondaryTeam();
    secondary.members[3] = member('b-luc', 'Luc', { email: 'shared@etat.ge.ch' });
    const primary = primaryTeam();
    primary.members[0] = member('admin-aaa111', 'Facilitator', { role: 'facilitator', email: 'Shared@etat.ge.ch' });
    const { report } = planTeamMerge({
      primary,
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    expect(report.members.sharedEmails).toEqual([{ email: 'shared@etat.ge.ch', names: ['Facilitator', 'Luc'] }]);
  });
});

describe('planTeamMerge — nothing is overwritten', () => {
  it('gives a colliding secondary action a new id everywhere it appears', () => {
    const { team, report } = merge();
    expect(report.actions.reminted).toBe(1);
    const primaryBacklog = team.globalActions.find((a: { assigneeId: string; text: string }) => a.assigneeId === 'a-marie' && a.text === 'Action act-shared');
    expect(primaryBacklog.id).toBe('act-shared');
    const rb1 = team.retrospectives.find((r: { name: string }) => r.name === 'Retro rb1');
    const moved = rb1.actions[1];
    expect(moved.id).not.toBe('act-shared');
    expect(rb1.historyActionsSnapshot[0].id).toBe(moved.id);
    expect(Object.keys(rb1.actionImpactVotes)).toEqual([moved.id, 'act-b0']);
    expect(rb1.actionImpactVotes[moved.id]).toEqual({ 'a-jean': 1 });
  });

  it('keeps both values when a renamed vote key is already taken, and reports it', () => {
    const secondary = secondaryTeam();
    // A stray primary id inside a secondary record: renaming b-jean would land
    // on it. Both votes must survive.
    secondary.retrospectives[0].happiness = { 'b-jean': 4, 'a-jean': 1 };
    const { team, report } = planTeamMerge({
      primary: primaryTeam(),
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    const rb1 = team.retrospectives.find((r: { name: string }) => r.name === 'Retro rb1');
    expect(rb1.happiness).toEqual({ 'b-jean': 4, 'a-jean': 1 });
    expect(report.conflicts).toContainEqual(expect.objectContaining({ key: 'b-jean', target: 'a-jean' }));
  });

  it('keeps a stored __proto__ key as plain data instead of touching the prototype', () => {
    const secondary = secondaryTeam();
    secondary.retrospectives[0].roti = JSON.parse('{"__proto__": {"polluted": true}, "b-luc": 5}');
    const { team } = planTeamMerge({
      primary: primaryTeam(),
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    });
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    const rb1 = team.retrospectives.find((r: { name: string }) => r.name === 'Retro rb1');
    expect(Object.getPrototypeOf(rb1.roti)).toBe(Object.prototype);
  });

  it('never mints an id that either team already uses', () => {
    let calls = 0;
    // The first ids the generator offers are taken.
    const generator = () => (++calls <= 2 ? ['ra1', 'b-luc'][calls - 1] : `fresh${calls}`);
    const { team } = merge({ generateId: generator });
    const ids = [...team.retrospectives, ...team.healthChecks].map((e: { id: string }) => e.id);
    expect(ids).not.toContain('ra1');
    expect(ids).not.toContain('b-luc');
  });
});

describe('planTeamMerge — team-level fields', () => {
  it('takes the chosen name, password and email, and never an invite epoch', () => {
    const { team } = merge();
    expect(team).toMatchObject({
      id: 'teamM',
      name: 'Pratique analyse produit (fusion)',
      passwordHash: 'scrypt$hashA',
      facilitatorEmail: 'elisabeth.trolliet@etat.ge.ch'
    });
    expect(team).not.toHaveProperty('inviteEpoch');
    expect(team).not.toHaveProperty('_rev');
  });

  it('keeps the later connection date, respects an opt-out of impact rating, and shows the notice again unless both dismissed it', () => {
    const { team, report } = merge();
    expect(team.lastConnectionDate).toBe('2026-10-01T10:00:00.000Z');
    expect(team.actionImpactRatingEnabled).toBe(false);
    expect(team.actionImpactNoticeDismissedAt).toBe('2026-04-01T00:00:00.000Z');
    expect(report.settings).toEqual({ actionImpactRatingEnabled: false, actionImpactNoticeDismissed: true });

    const secondary = secondaryTeam() as Record<string, unknown>;
    delete secondary.actionImpactNoticeDismissedAt;
    delete secondary.actionImpactRatingEnabled;
    const other = planTeamMerge({
      primary: primaryTeam(),
      secondary,
      newTeamId: 'teamM',
      name: 'M',
      passwordHash: 'h',
      facilitatorEmail: undefined,
      mergedAt: '2026-10-13T12:00:00.000Z',
      generateId: idGenerator()
    }).team;
    expect(other).not.toHaveProperty('actionImpactNoticeDismissedAt');
    expect(other).not.toHaveProperty('actionImpactRatingEnabled');
    expect(other).not.toHaveProperty('facilitatorEmail');
  });

  it('records where the team came from, with the fingerprint deletion compares', () => {
    const { team, primary, secondary } = merge();
    expect(team.mergedFrom).toHaveLength(2);
    expect(team.mergedFrom[0]).toMatchObject({
      teamId: 'teamA',
      name: primary.name,
      role: 'primary',
      mergedAt: '2026-10-13T12:00:00.000Z',
      fingerprint: fingerprintTeamContent(primary)
    });
    expect(team.mergedFrom[1]).toMatchObject({ teamId: 'teamB', role: 'secondary', fingerprint: fingerprintTeamContent(secondary) });
    // One hash per part, so a later refusal can say what changed.
    expect(Object.keys(team.mergedFrom[1].parts)).toEqual(['retro:rb1', 'retro:rb0', 'hc:hb1', 'backlog', 'templates', 'hcTemplates']);
    // Without a record-only digest from the route, the effective one stands in.
    expect(team.mergedFrom[1].recordFingerprint).toBe(team.mergedFrom[1].fingerprint);
    // The summaries projection carries this on every read: no id maps in it.
    expect(team.mergedFrom[1]).not.toHaveProperty('memberIds');
    expect(team.mergedFrom[1]).not.toHaveProperty('retroIds');
  });

  it('reports the sessions still in progress, which will pull participants of the merged team in', () => {
    const { report } = merge();
    expect(report.sessions.inProgress).toEqual([{ source: 'secondary', name: 'Retro rb1' }]);
  });
});

describe('fingerprintTeamContent', () => {
  it('ignores revision stamps at any depth, so opening an old retro is not a change', () => {
    const team = primaryTeam();
    const reopened = primaryTeam();
    reopened.retrospectives[1]._rev = 99;
    (reopened.retrospectives[1] as Record<string, unknown>)._updatedAt = '2026-10-13T00:00:00.000Z';
    expect(fingerprintTeamContent(reopened)).toBe(fingerprintTeamContent(team));
  });

  it('ignores key order, feedbacks, the roster and the last connection date', () => {
    const team = primaryTeam();
    const other = { ...primaryTeam(), teamFeedbacks: [], lastConnectionDate: 'later' };
    other.globalActions = other.globalActions.map((a) => Object.fromEntries(Object.entries(a).reverse()) as typeof a);
    // Somebody joined the old team after the merge: they join the merged one too.
    other.members = [...other.members, member('late', 'Late joiner')];
    expect(fingerprintTeamContent(other)).toBe(fingerprintTeamContent(team));
  });

  it('ignores what merely opening or browsing a retro writes', () => {
    const team = primaryTeam();
    const browsed = primaryTeam();
    Object.assign(browsed.retrospectives[0], {
      participants: [member('a-jean', 'Jean')],
      leftUsers: ['a-paul'],
      // "View Summary" and one click back: the phase moves, the stored
      // CLOSED does not (nothing reopens a closed session).
      phase: 'REVIEW',
      settings: { timerRunning: true, timerStartedAt: '2026-10-14T09:00:00.000Z' },
      name: 'Renamed on the Dashboard',
      finishedUsers: ['a-jean']
    });
    expect(fingerprintTeamContent(browsed)).toBe(fingerprintTeamContent(team));
  });

  it('counts reaching Close as a change, but not the phase bar', () => {
    const open = primaryTeam();
    Object.assign(open.retrospectives[0], { status: 'IN_PROGRESS', phase: 'DISCUSS' });
    const browsed = primaryTeam();
    Object.assign(browsed.retrospectives[0], { status: 'IN_PROGRESS', phase: 'REVIEW' });
    expect(fingerprintTeamContent(browsed)).toBe(fingerprintTeamContent(open));
    // A session merged while in progress and closed in the source afterwards
    // would otherwise stay IN PROGRESS for good in the merged team.
    const closed = primaryTeam();
    Object.assign(closed.retrospectives[0], { status: 'CLOSED', phase: 'CLOSE' });
    expect(fingerprintTeamContent(closed)).not.toBe(fingerprintTeamContent(open));
  });

  it('changes when content changes, and says where', () => {
    const team = primaryTeam();
    const recorded = contentDigest(team).parts;
    const edited = primaryTeam();
    edited.globalActions[0].text = 'Edited after the merge';
    (edited.retrospectives[1].tickets as unknown[]).push({ id: 'late', colId: '1', text: 'A card', authorId: 'a-jean', groupId: null, votes: [] });
    edited.retrospectives.unshift(retro('ra3', 'teamA', { name: 'Run on an old invite link' }));
    expect(fingerprintTeamContent(edited)).not.toBe(fingerprintTeamContent(team));
    expect(describeContentChanges(edited, recorded)).toEqual([
      { kind: 'retrospective', name: 'Run on an old invite link', added: true },
      { kind: 'retrospective', name: 'Retro ra1', added: false },
      { kind: 'backlog', added: false }
    ]);
  });
});

describe('applyFresherSessionRows', () => {
  it('uses a live session row that is ahead of the team record, with the record keeping its name and closed actions', () => {
    const team = primaryTeam();
    const row = {
      ...team.retrospectives[1],
      _rev: 9,
      name: 'Stale title',
      tickets: [{ id: 'late', colId: '1', text: 'Written after the last persist', authorId: 'a-jean', groupId: null, votes: [] }],
      actions: [action('act-a1', { assigneeId: 'a-jean', done: false })]
    };
    const { team: effective, freshened } = applyFresherSessionRows(team, new Map([['ra1', row]]));
    const ra1 = effective.retrospectives[1];
    expect(ra1.tickets).toHaveLength(1);
    expect(ra1.name).toBe('Retro ra1');
    // Closing goes through the granular route, which never advances the
    // session revision: the record is right about it.
    expect(ra1.actions[0]).toMatchObject({ done: true, closedAt: '2026-06-02' });
    expect(freshened).toEqual([{ kind: 'retrospective', id: 'ra1', name: 'Retro ra1' }]);
    expect(team.retrospectives[1].tickets).toEqual([]);
  });

  it('keeps the team record authoritative for actions, as the client does when it opens a session', () => {
    // The row is one revision ahead (a tab closed instead of Exit). Since then
    // the facilitator re-opened act-a1 and reworded and reassigned it on the
    // Dashboard, and deleted act-gone: those write the team record only.
    const team = primaryTeam();
    const entry = team.retrospectives[1] as Record<string, any>;
    entry.actions = [action('act-a1', { text: 'Reworded', assigneeId: 'a-marie', done: false })];
    team.globalActions = [action('act-shared', { assigneeId: 'a-paul', text: 'Backlog text' })];
    const row = {
      ...entry,
      _rev: entry._rev + 1,
      tickets: [{ id: 'late', colId: '1', text: 'A card the record never got', authorId: 'a-jean', groupId: null, votes: [] }],
      actions: [
        action('act-a1', { text: 'Old text', assigneeId: 'a-jean', done: true, closedAt: '2026-06-02', proposalVotes: { 'a-jean': 'up' } }),
        action('act-gone', { text: 'Deleted from the Dashboard since' })
      ],
      openActionsSnapshot: [action('act-shared', { assigneeId: 'a-jean', text: 'Stale backlog text' })]
    };
    const { team: effective, freshened } = applyFresherSessionRows(team, new Map([['ra1', row]]));
    const ra1 = effective.retrospectives[1] as Record<string, any>;
    expect(ra1.tickets.map((t: { id: string }) => t.id)).toEqual(['late']);
    expect(ra1.actions[0]).toMatchObject({ text: 'Reworded', assigneeId: 'a-marie', done: false, proposalVotes: { 'a-jean': 'up' } });
    expect(ra1.actions[0]).not.toHaveProperty('closedAt');
    // Only the row has it: kept — a deletion that comes back is the safe error.
    expect(ra1.actions[1].id).toBe('act-gone');
    expect(ra1.openActionsSnapshot[0]).toMatchObject({ text: 'Backlog text', assigneeId: 'a-paul' });
    expect(freshened).toHaveLength(1);
  });

  // The Jira route writes the link on the team record, so a row ahead of the
  // record may lack it — or carry one a participant's write planted.
  it('keeps the record\'s Jira link over a row that lacks it, and drops one the record\'s copy of the action lacks', () => {
    const link = { key: 'RETRO-5', createdAt: '2026-06-02T00:00:00.000Z' };
    const team = primaryTeam();
    const entry = team.retrospectives[1] as Record<string, any>;
    entry.actions = [action('act-a1', { jira: link }), action('act-a2')];
    const row = {
      ...entry,
      _rev: entry._rev + 1,
      tickets: [{ id: 'late', colId: '1', text: 'A card the record never got', authorId: 'a-jean', groupId: null, votes: [] }],
      actions: [action('act-a1'), action('act-a2', { jira: { key: 'EVIL-1', createdAt: 'x' } })]
    };

    const ra1 = applyFresherSessionRows(team, new Map([['ra1', row]])).team.retrospectives[1] as Record<string, any>;

    expect(ra1.tickets.map((t: { id: string }) => t.id)).toEqual(['late']);
    expect(ra1.actions[0].jira).toEqual(link);
    expect(ra1.actions[1]).not.toHaveProperty('jira');
  });

  // An action only the row holds (an unpersisted creation) has no record copy
  // to take its fields from, and the Jira route never links an action the
  // record lacks: a link on it was planted by a participant's write, and the
  // merged team would read it as "already in Jira" for good. The persist
  // handlers drop it for the same reason.
  it('drops a Jira link on an action only the row holds, and on one the row turned into a proposal keeps the record\'s', () => {
    const link = { key: 'RETRO-5', createdAt: '2026-06-02T00:00:00.000Z' };
    const team = primaryTeam();
    const entry = team.retrospectives[1] as Record<string, any>;
    entry.actions = [action('act-a1', { jira: link })];
    const row = {
      ...entry,
      _rev: entry._rev + 1,
      actions: [
        action('act-a1', { type: 'proposal', jira: { key: 'EVIL-2', createdAt: 'x' } }),
        action('act-row-only', { text: 'Created in the room', jira: { key: 'EVIL-1', createdAt: 'x' } }),
        action('act-row-maybe', { jira: { uncertainSince: 'x' } })
      ]
    };

    const { team: effective, freshened } = applyFresherSessionRows(team, new Map([['ra1', row]]));
    const ra1 = effective.retrospectives[1] as Record<string, any>;

    expect(freshened).toHaveLength(1);
    expect(ra1.actions.map((a: { id: string }) => a.id)).toEqual(['act-a1', 'act-row-only', 'act-row-maybe']);
    expect(ra1.actions[0].jira).toEqual(link);
    expect(ra1.actions[1]).toMatchObject({ text: 'Created in the room' });
    expect(ra1.actions[1]).not.toHaveProperty('jira');
    expect(ra1.actions[2]).not.toHaveProperty('jira');
  });

  it('lets a Dashboard edit made after the merge change the fingerprint, even when the row is ahead', () => {
    const team = primaryTeam();
    const entry = team.retrospectives[1] as Record<string, any>;
    const rows = new Map([['ra1', { ...entry, _rev: entry._rev + 1 }]]);
    const before = fingerprintTeamContent(applyFresherSessionRows(team, rows).team);
    entry.actions[0].text = 'Edited on the Dashboard after the merge';
    expect(fingerprintTeamContent(applyFresherSessionRows(team, rows).team)).not.toBe(before);
  });

  it('ignores a row that is not ahead, that belongs to another team, or that only differs by its revision', () => {
    const team = primaryTeam();
    const rows = new Map<string, unknown>([
      ['ra2', { ...team.retrospectives[0], _rev: 2, tickets: [{ id: 'old' }] }],
      ['ra1', { ...team.retrospectives[1], teamId: 'someone-else', _rev: 50, tickets: [{ id: 'foreign' }] }],
      ['ha1', { ...team.healthChecks[0], _rev: 3 }]
    ]);
    const { team: effective, freshened } = applyFresherSessionRows(team, rows);
    expect(effective.retrospectives).toEqual(team.retrospectives);
    expect(effective.healthChecks).toEqual(team.healthChecks);
    expect(freshened).toEqual([]);
  });

  it('uses a live health-check row that is ahead of the team record', () => {
    const team = primaryTeam();
    const check = team.healthChecks[0] as Record<string, any>;
    const row = { ...check, _rev: check._rev + 1, ratings: { 'a-jean': { autonomy: { rating: 4 } } } };
    const { team: effective, freshened } = applyFresherSessionRows(team, new Map([[check.id, row]]));
    expect((effective.healthChecks[0] as Record<string, any>).ratings).toEqual(row.ratings);
    expect(freshened).toEqual([{ kind: 'healthCheck', id: check.id, name: check.name }]);
    expect(fingerprintTeamContent(effective)).not.toBe(fingerprintTeamContent(team));
  });

  it('does not take a row that is ahead only in who looked at it', () => {
    // Every retro someone merely opened has one: receivers never persist.
    const team = primaryTeam();
    const entry = team.retrospectives[1] as Record<string, any>;
    const row = { ...entry, _rev: entry._rev + 3, participants: [member('a-jean', 'Jean')], phase: 'REVIEW', settings: { timerRunning: true } };
    const { team: effective, freshened } = applyFresherSessionRows(team, new Map([['ra1', row]]));
    expect(freshened).toEqual([]);
    expect(effective.retrospectives[1]).toBe(team.retrospectives[1]);
  });

  it('lists every retro and health-check id the route must read', () => {
    expect(sessionIdsOf(secondaryTeam())).toEqual(['rb1', 'rb0', 'hb1']);
    expect(sessionIdsOf({ retrospectives: 'broken' })).toEqual([]);
  });
});

describe('zipperNewestFirst', () => {
  it('takes the primary entry whenever either side has no timestamp', () => {
    expect(zipperNewestFirst(
      [{ id: 'a1' }, { id: 'a2', _updatedAt: '2026-01-01' }],
      [{ id: 'b1', _updatedAt: '2026-12-01' }]
    ).map((e: { id: string }) => e.id)).toEqual(['a1', 'b1', 'a2']);
  });
});
