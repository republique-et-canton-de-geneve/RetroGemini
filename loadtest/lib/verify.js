// Final integrity audit: compare the authoritative session state read back
// from the server after the run against the ledger of every action the
// simulated users performed. Any discrepancy is a lost or corrupted user
// action — exactly what the load test exists to detect.
//
// Pure and side-effect free so it can be unit-tested directly.

const countVotes = (votes, userId) =>
  Array.isArray(votes) ? votes.filter(v => v === userId).length : 0;

/**
 * @param finalSession the session blob read back from the server (or null)
 * @param expected     the ledger built while driving the scenario:
 *   { sessionId, teamId, phase, status, participantIds, happiness, tickets,
 *     groups, votes, proposals, proposalVotes, roti, reviewSummary }
 * @returns { ok, problems: string[], stats }
 */
const auditSession = (finalSession, expected) => {
  const problems = [];
  const stats = {
    expectedTickets: expected.tickets.length,
    missingTickets: 0,
    unexpectedTickets: 0,
    expectedVotes: 0,
    missingVotes: 0,
    extraVotes: 0,
    expectedProposals: expected.proposals.length,
    missingProposals: 0,
    expectedProposalVotes: 0,
    missingProposalVotes: 0,
    missingHappiness: 0,
    missingRoti: 0
  };

  if (!finalSession || typeof finalSession !== 'object') {
    problems.push('final session state is missing entirely');
    return { ok: false, problems, stats };
  }

  if (finalSession.id !== expected.sessionId) {
    problems.push(`session id mismatch: got ${finalSession.id}, expected ${expected.sessionId}`);
  }
  if (expected.teamId && finalSession.teamId !== expected.teamId) {
    problems.push(`teamId mismatch: got ${finalSession.teamId}, expected ${expected.teamId}`);
  }
  if (finalSession.phase !== expected.phase) {
    problems.push(`phase mismatch: got ${finalSession.phase}, expected ${expected.phase}`);
  }
  if (finalSession.status !== expected.status) {
    problems.push(`status mismatch: got ${finalSession.status}, expected ${expected.status}`);
  }

  // Participants roster
  const participantIds = new Set((finalSession.participants ?? []).map(p => p.id));
  for (const id of expected.participantIds) {
    if (!participantIds.has(id)) {
      problems.push(`participant ${id} missing from session roster`);
    }
  }

  // Happiness / ROTI (one entry per user, silent loss otherwise)
  for (const [userId, score] of Object.entries(expected.happiness)) {
    if (finalSession.happiness?.[userId] !== score) {
      stats.missingHappiness++;
      problems.push(`happiness vote of ${userId} lost or wrong (got ${finalSession.happiness?.[userId]}, expected ${score})`);
    }
  }
  for (const [userId, score] of Object.entries(expected.roti)) {
    if (finalSession.roti?.[userId] !== score) {
      stats.missingRoti++;
      problems.push(`ROTI vote of ${userId} lost or wrong (got ${finalSession.roti?.[userId]}, expected ${score})`);
    }
  }

  // Tickets: every submitted ticket must exist exactly once with its content
  const actualTickets = new Map();
  for (const ticket of finalSession.tickets ?? []) {
    if (actualTickets.has(ticket.id)) {
      problems.push(`ticket ${ticket.id} is duplicated in the final state`);
    }
    actualTickets.set(ticket.id, ticket);
  }
  const expectedTicketIds = new Set(expected.tickets.map(t => t.id));
  for (const expectedTicket of expected.tickets) {
    const actual = actualTickets.get(expectedTicket.id);
    if (!actual) {
      stats.missingTickets++;
      problems.push(`ticket ${expectedTicket.id} (author ${expectedTicket.authorId}) was lost`);
      continue;
    }
    if (actual.text !== expectedTicket.text) {
      problems.push(`ticket ${expectedTicket.id} text corrupted (got "${actual.text}")`);
    }
    if (actual.authorId !== expectedTicket.authorId) {
      problems.push(`ticket ${expectedTicket.id} author corrupted (got ${actual.authorId})`);
    }
    if (actual.colId !== expectedTicket.colId) {
      problems.push(`ticket ${expectedTicket.id} column corrupted (got ${actual.colId})`);
    }
    if ((actual.groupId ?? null) !== (expectedTicket.groupId ?? null)) {
      problems.push(`ticket ${expectedTicket.id} grouping lost (got ${actual.groupId ?? null}, expected ${expectedTicket.groupId ?? null})`);
    }
  }
  for (const id of actualTickets.keys()) {
    if (!expectedTicketIds.has(id)) {
      stats.unexpectedTickets++;
      problems.push(`unexpected ticket ${id} present in final state`);
    }
  }

  // Groups
  const actualGroups = new Map((finalSession.groups ?? []).map(g => [g.id, g]));
  for (const expectedGroup of expected.groups) {
    const actual = actualGroups.get(expectedGroup.id);
    if (!actual) {
      problems.push(`group ${expectedGroup.id} was lost`);
      continue;
    }
    for (const ticketId of expectedGroup.ticketIds) {
      const ticket = actualTickets.get(ticketId);
      if (ticket && ticket.groupId !== expectedGroup.id) {
        problems.push(`ticket ${ticketId} lost its membership of group ${expectedGroup.id}`);
      }
    }
  }

  // Votes on tickets and groups: exact per-user multiplicity per target
  const findVoteTarget = (targetId) =>
    actualGroups.get(targetId) ?? actualTickets.get(targetId);
  for (const [targetId, perUser] of Object.entries(expected.votes)) {
    const target = findVoteTarget(targetId);
    const expectedTotal = Object.values(perUser).reduce((a, b) => a + b, 0);
    stats.expectedVotes += expectedTotal;
    if (!target) {
      stats.missingVotes += expectedTotal;
      problems.push(`vote target ${targetId} missing (loses ${expectedTotal} votes)`);
      continue;
    }
    for (const [userId, expectedCount] of Object.entries(perUser)) {
      const actualCount = countVotes(target.votes, userId);
      if (actualCount < expectedCount) {
        stats.missingVotes += expectedCount - actualCount;
        problems.push(`${expectedCount - actualCount} vote(s) by ${userId} on ${targetId} lost (got ${actualCount}, expected ${expectedCount})`);
      } else if (actualCount > expectedCount) {
        stats.extraVotes += actualCount - expectedCount;
        problems.push(`${actualCount - expectedCount} extra vote(s) by ${userId} on ${targetId} (got ${actualCount}, expected ${expectedCount})`);
      }
    }
    const expectedVoters = new Set(Object.keys(perUser));
    for (const voter of new Set(target.votes ?? [])) {
      if (!expectedVoters.has(voter)) {
        stats.extraVotes += countVotes(target.votes, voter);
        problems.push(`unexpected vote(s) by ${voter} on ${targetId}`);
      }
    }
  }

  // Action proposals and votes on them
  const actualActions = new Map((finalSession.actions ?? []).map(a => [a.id, a]));
  for (const expectedProposal of expected.proposals) {
    const actual = actualActions.get(expectedProposal.id);
    if (!actual) {
      stats.missingProposals++;
      problems.push(`action proposal ${expectedProposal.id} (author ${expectedProposal.authorId}) was lost`);
      continue;
    }
    if (actual.text !== expectedProposal.text) {
      problems.push(`proposal ${expectedProposal.id} text corrupted`);
    }
    if (actual.type !== expectedProposal.expectType) {
      problems.push(`proposal ${expectedProposal.id} decision lost: type is ${actual.type}, expected ${expectedProposal.expectType}`);
    }
    if (Boolean(actual.rejected) !== Boolean(expectedProposal.expectRejected)) {
      problems.push(`proposal ${expectedProposal.id} rejected flag wrong: got ${Boolean(actual.rejected)}, expected ${Boolean(expectedProposal.expectRejected)}`);
    }
  }
  for (const [proposalId, perUser] of Object.entries(expected.proposalVotes)) {
    const actual = actualActions.get(proposalId);
    for (const [userId, value] of Object.entries(perUser)) {
      stats.expectedProposalVotes++;
      if (!actual || actual.proposalVotes?.[userId] !== value) {
        stats.missingProposalVotes++;
        problems.push(`proposal vote by ${userId} on ${proposalId} lost or wrong (got ${actual?.proposalVotes?.[userId]}, expected ${value})`);
      }
    }
  }

  if (expected.reviewSummary !== undefined && finalSession.reviewSummary !== expected.reviewSummary) {
    problems.push('review summary lost or corrupted');
  }

  return { ok: problems.length === 0, problems, stats };
};

export { auditSession };
