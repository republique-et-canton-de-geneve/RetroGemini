import { describe, it, expect } from 'vitest';
import { auditSession } from '../loadtest/lib/verify.js';
import {
  buildInitialSession,
  ensureParticipant,
  setHappiness,
  addTicket,
  createGroup,
  setOwnVotes,
  addProposal,
  setProposalVote,
  decideProposal,
  setReviewSummary,
  setRoti,
  setPhase,
  closeSession
} from '../loadtest/lib/sessionOps.js';

// Build a small "perfect run" fixture: the final session exactly matches the
// ledger of every action the simulated users performed.
const buildFixture = () => {
  const session = buildInitialSession({ sessionId: 's1', teamId: 't1', name: 'Retro', maxVotes: 2 });
  const colId = session.columns[0].id;
  const users = ['u1', 'u2'];

  users.forEach((id, i) =>
    ensureParticipant(session, { id, name: `User ${i}`, color: 'bg-sky-500', role: 'participant' })
  );
  users.forEach((id, i) => setHappiness(session, id, i + 3));
  addTicket(session, { id: 'tk1', colId, text: 'ticket one', authorId: 'u1' });
  addTicket(session, { id: 'tk2', colId, text: 'ticket two', authorId: 'u2' });
  addTicket(session, { id: 'tk3', colId, text: 'ticket three', authorId: 'u2' });
  createGroup(session, { id: 'g1', title: 'Group 1', colId, ticketIds: ['tk1', 'tk2'] });
  setOwnVotes(session, 'g1', 'u1', 2);
  setOwnVotes(session, 'tk3', 'u2', 1);
  setOwnVotes(session, 'g1', 'u2', 1);
  addProposal(session, { id: 'p1', text: 'proposal one', authorId: 'u1' });
  setProposalVote(session, 'p1', 'u1', 'up');
  setProposalVote(session, 'p1', 'u2', 'down');
  decideProposal(session, 'p1', 'accept');
  setReviewSummary(session, 'went fine');
  users.forEach(id => setRoti(session, id, 4));
  setPhase(session, 'CLOSE');
  closeSession(session);

  const expected = {
    sessionId: 's1',
    teamId: 't1',
    phase: 'CLOSE',
    status: 'CLOSED',
    participantIds: users,
    happiness: { u1: 3, u2: 4 },
    tickets: [
      { id: 'tk1', colId, text: 'ticket one', authorId: 'u1', groupId: 'g1' },
      { id: 'tk2', colId, text: 'ticket two', authorId: 'u2', groupId: 'g1' },
      { id: 'tk3', colId, text: 'ticket three', authorId: 'u2', groupId: null }
    ],
    groups: [{ id: 'g1', colId, ticketIds: ['tk1', 'tk2'] }],
    votes: { g1: { u1: 2, u2: 1 }, tk3: { u2: 1 } },
    proposals: [{ id: 'p1', authorId: 'u1', text: 'proposal one', expectType: 'new', expectRejected: false }],
    proposalVotes: { p1: { u1: 'up', u2: 'down' } },
    roti: { u1: 4, u2: 4 },
    reviewSummary: 'went fine'
  };

  return { session, expected };
};

describe('loadtest auditSession', () => {
  it('passes a complete, lossless session', () => {
    const { session, expected } = buildFixture();
    const result = auditSession(session, expected);
    expect(result.problems).toEqual([]);
    expect(result.ok).toBe(true);
    expect(result.stats.missingTickets).toBe(0);
    expect(result.stats.missingVotes).toBe(0);
    expect(result.stats.missingProposalVotes).toBe(0);
  });

  it('detects a lost ticket', () => {
    const { session, expected } = buildFixture();
    session.tickets = session.tickets.filter(t => t.id !== 'tk3');
    const result = auditSession(session, expected);
    expect(result.ok).toBe(false);
    expect(result.stats.missingTickets).toBe(1);
    expect(result.problems.some(p => p.includes('tk3'))).toBe(true);
  });

  it('detects an unexpected (duplicated) ticket', () => {
    const { session, expected } = buildFixture();
    session.tickets.push({ ...session.tickets[0], id: 'tk1-dup' });
    const result = auditSession(session, expected);
    expect(result.ok).toBe(false);
    expect(result.problems.some(p => p.includes('tk1-dup'))).toBe(true);
  });

  it('detects a lost vote on a group', () => {
    const { session, expected } = buildFixture();
    const group = session.groups.find(g => g.id === 'g1');
    group.votes = group.votes.filter(v => v !== 'u2');
    const result = auditSession(session, expected);
    expect(result.ok).toBe(false);
    expect(result.stats.missingVotes).toBe(1);
    expect(result.problems.some(p => p.includes('g1') && p.includes('u2'))).toBe(true);
  });

  it('detects an extra vote that nobody cast', () => {
    const { session, expected } = buildFixture();
    session.tickets.find(t => t.id === 'tk3').votes.push('u1');
    const result = auditSession(session, expected);
    expect(result.ok).toBe(false);
    expect(result.problems.some(p => p.includes('tk3'))).toBe(true);
  });

  it('detects a lost proposal vote', () => {
    const { session, expected } = buildFixture();
    delete session.actions.find(a => a.id === 'p1').proposalVotes.u2;
    const result = auditSession(session, expected);
    expect(result.ok).toBe(false);
    expect(result.stats.missingProposalVotes).toBe(1);
  });

  it('detects a missing proposal and a wrong decision', () => {
    const { session, expected } = buildFixture();
    session.actions.find(a => a.id === 'p1').type = 'proposal';
    const wrongDecision = auditSession(session, expected);
    expect(wrongDecision.ok).toBe(false);

    session.actions = [];
    const missing = auditSession(session, expected);
    expect(missing.ok).toBe(false);
    expect(missing.stats.missingProposals).toBe(1);
  });

  it('detects lost happiness and roti entries', () => {
    const { session, expected } = buildFixture();
    delete session.happiness.u2;
    delete session.roti.u1;
    const result = auditSession(session, expected);
    expect(result.ok).toBe(false);
    expect(result.stats.missingHappiness).toBe(1);
    expect(result.stats.missingRoti).toBe(1);
  });

  it('detects wrong final phase/status and missing participants', () => {
    const { session, expected } = buildFixture();
    session.status = 'IN_PROGRESS';
    session.phase = 'DISCUSS';
    session.participants = session.participants.filter(p => p.id !== 'u2');
    const result = auditSession(session, expected);
    expect(result.ok).toBe(false);
    expect(result.problems.some(p => p.includes('status'))).toBe(true);
    expect(result.problems.some(p => p.includes('phase'))).toBe(true);
    expect(result.problems.some(p => p.includes('u2'))).toBe(true);
  });

  it('detects a group whose membership was lost', () => {
    const { session, expected } = buildFixture();
    session.tickets.find(t => t.id === 'tk2').groupId = null;
    const result = auditSession(session, expected);
    expect(result.ok).toBe(false);
    expect(result.problems.some(p => p.includes('tk2'))).toBe(true);
  });

  it('fails cleanly when the final session is missing entirely', () => {
    const { expected } = buildFixture();
    const result = auditSession(null, expected);
    expect(result.ok).toBe(false);
    expect(result.problems.length).toBeGreaterThan(0);
  });
});
