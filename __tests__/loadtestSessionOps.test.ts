import { describe, it, expect } from 'vitest';
import {
  buildInitialSession,
  ensureParticipant,
  setHappiness,
  addTicket,
  markFinished,
  createGroup,
  setOwnVotes,
  countOwnVotes,
  addProposal,
  setProposalVote,
  decideProposal,
  setReviewSummary,
  setRoti,
  setPhase,
  closeSession
} from '../loadtest/lib/sessionOps.js';

const makeSession = () =>
  buildInitialSession({ sessionId: 's1', teamId: 't1', name: 'Load Retro', maxVotes: 3 });

describe('loadtest sessionOps', () => {
  it('builds an initial session with the app session shape', () => {
    const s = makeSession();
    expect(s.id).toBe('s1');
    expect(s.teamId).toBe('t1');
    expect(s.status).toBe('IN_PROGRESS');
    expect(s.phase).toBe('ICEBREAKER');
    expect(s.columns.length).toBeGreaterThanOrEqual(2);
    expect(s.settings.maxVotes).toBe(3);
    expect(s.tickets).toEqual([]);
    expect(s.groups).toEqual([]);
    expect(s.actions).toEqual([]);
    expect(s.happiness).toEqual({});
    expect(s.roti).toEqual({});
    expect(s.finishedUsers).toEqual([]);
  });

  it('adds tickets idempotently by id', () => {
    const s = makeSession();
    const ticket = { id: 'tk1', colId: s.columns[0].id, text: 'hello', authorId: 'u1' };
    addTicket(s, ticket);
    addTicket(s, ticket);
    expect(s.tickets).toHaveLength(1);
    expect(s.tickets[0]).toMatchObject({ id: 'tk1', text: 'hello', authorId: 'u1', groupId: null, votes: [] });
  });

  it('ensures participants idempotently', () => {
    const s = makeSession();
    const user = { id: 'u1', name: 'User 1', color: 'bg-sky-500', role: 'participant' };
    ensureParticipant(s, user);
    ensureParticipant(s, user);
    expect(s.participants).toHaveLength(1);
  });

  it('records happiness and roti per user', () => {
    const s = makeSession();
    setHappiness(s, 'u1', 4);
    setRoti(s, 'u1', 5);
    expect(s.happiness.u1).toBe(4);
    expect(s.roti.u1).toBe(5);
  });

  it('marks users finished idempotently', () => {
    const s = makeSession();
    markFinished(s, 'u1');
    markFinished(s, 'u1');
    expect(s.finishedUsers).toEqual(['u1']);
  });

  it('creates groups idempotently and assigns member tickets', () => {
    const s = makeSession();
    const colId = s.columns[0].id;
    addTicket(s, { id: 'tk1', colId, text: 'a', authorId: 'u1' });
    addTicket(s, { id: 'tk2', colId, text: 'b', authorId: 'u2' });
    createGroup(s, { id: 'g1', title: 'Theme', colId, ticketIds: ['tk1', 'tk2'] });
    createGroup(s, { id: 'g1', title: 'Theme', colId, ticketIds: ['tk1', 'tk2'] });
    expect(s.groups).toHaveLength(1);
    expect(s.tickets.find(t => t.id === 'tk1')?.groupId).toBe('g1');
    expect(s.tickets.find(t => t.id === 'tk2')?.groupId).toBe('g1');
  });

  it('sets the exact own vote count on a target without touching other votes', () => {
    const s = makeSession();
    const colId = s.columns[0].id;
    addTicket(s, { id: 'tk1', colId, text: 'a', authorId: 'u1' });
    s.tickets[0].votes.push('other', 'other');

    setOwnVotes(s, 'tk1', 'u1', 2);
    setOwnVotes(s, 'tk1', 'u1', 2); // idempotent
    expect(countOwnVotes(s, 'tk1', 'u1')).toBe(2);
    expect(s.tickets[0].votes.filter(v => v === 'other')).toHaveLength(2);

    setOwnVotes(s, 'tk1', 'u1', 1); // reducing works too
    expect(countOwnVotes(s, 'tk1', 'u1')).toBe(1);

    createGroup(s, { id: 'g1', title: 'g', colId, ticketIds: ['tk1'] });
    setOwnVotes(s, 'g1', 'u1', 3);
    expect(countOwnVotes(s, 'g1', 'u1')).toBe(3);
  });

  it('handles action proposals: add, vote, accept, reject', () => {
    const s = makeSession();
    addProposal(s, { id: 'p1', text: 'do X', authorId: 'u1' });
    addProposal(s, { id: 'p1', text: 'do X', authorId: 'u1' });
    addProposal(s, { id: 'p2', text: 'do Y', authorId: 'u2' });
    expect(s.actions).toHaveLength(2);
    expect(s.actions[0].type).toBe('proposal');

    setProposalVote(s, 'p1', 'u2', 'up');
    setProposalVote(s, 'p1', 'u2', 'up');
    expect(s.actions.find(a => a.id === 'p1')?.proposalVotes).toEqual({ u2: 'up' });

    decideProposal(s, 'p1', 'accept');
    expect(s.actions.find(a => a.id === 'p1')?.type).toBe('new');
    decideProposal(s, 'p2', 'reject');
    expect(s.actions.find(a => a.id === 'p2')?.rejected).toBe(true);
    expect(s.actions.find(a => a.id === 'p2')?.type).toBe('proposal');
  });

  it('setPhase resets finished users and timer runtime like the real client', () => {
    const s = makeSession();
    markFinished(s, 'u1');
    s.settings.timerRunning = true;
    s.settings.timerStartedAt = 123;
    setPhase(s, 'BRAINSTORM');
    expect(s.phase).toBe('BRAINSTORM');
    expect(s.finishedUsers).toEqual([]);
    expect(s.autoFinishedUsers).toEqual([]);
    expect(s.settings.timerRunning).toBe(false);
    expect(s.settings.timerStartedAt).toBeUndefined();
  });

  it('closes the session', () => {
    const s = makeSession();
    setReviewSummary(s, 'summary');
    closeSession(s);
    expect(s.reviewSummary).toBe('summary');
    expect(s.status).toBe('CLOSED');
  });
});
