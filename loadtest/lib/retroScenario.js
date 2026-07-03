// Drives ONE full retrospective end to end with 1 facilitator + N simulated
// participants, building a ledger of every intended user action along the
// way. The caller audits the final server-side state against that ledger.
//
// Flow (mirrors the real app): create team + roster over HTTP, then over
// Socket.IO: ICEBREAKER (join + roster) -> WELCOME (happiness) ->
// OPEN_ACTIONS -> BRAINSTORM (tickets, finish) -> GROUP (facilitator groups)
// -> VOTE (vote budget per user) -> DISCUSS (action proposals + votes +
// facilitator decisions) -> REVIEW (summary) -> CLOSE (ROTI, close session).

import { createTeam, setTeamMembers, persistRetrospective, loadTeam, deleteTeam } from './api.js';
import { SimClient } from './simClient.js';
import { rngFor, randInt, pick } from './rand.js';
import {
  buildInitialSession,
  ensureParticipant,
  setHappiness,
  setRoti,
  addTicket,
  markFinished,
  createGroup,
  countOwnVotes,
  setOwnVotes,
  addProposal,
  setProposalVote,
  decideProposal,
  setDiscussionFocus,
  setReviewSummary,
  setPhase,
  closeSession
} from './sessionOps.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const runRetroScenario = async ({ url, runId, retroIndex, config, metrics, log }) => {
  const problems = [];
  const teamName = `LoadTest ${runId} R${retroIndex}`;
  const password = `loadtest-${runId}`;
  const sessionId = `retro-${runId}-r${retroIndex}`;

  // ---- Setup over HTTP: team + full roster, like the Dashboard would.
  const team = await createTeam(url, { name: teamName, password });
  const facilitatorMember = team.members[0];
  const facilitatorUser = {
    id: facilitatorMember.id,
    name: `R${retroIndex} Facilitator`,
    color: 'bg-indigo-500',
    role: 'facilitator'
  };
  const participants = Array.from({ length: config.users }, (_, i) => ({
    id: `lt-${runId}-r${retroIndex}-u${i + 1}`,
    name: `R${retroIndex} User ${i + 1}`,
    color: 'bg-sky-500',
    role: 'participant'
  }));
  await setTeamMembers(url, team.id, password, [
    { ...facilitatorMember, name: facilitatorUser.name },
    ...participants
  ]);

  const facilitator = new SimClient({ url, sessionId, user: facilitatorUser, config, metrics });
  const clients = participants.map(user => new SimClient({ url, sessionId, user, config, metrics }));
  const everyone = [facilitator, ...clients];

  const expected = {
    sessionId,
    teamId: team.id,
    phase: 'CLOSE',
    status: 'CLOSED',
    participantIds: [facilitatorUser.id, ...participants.map(u => u.id)],
    happiness: {},
    tickets: [],
    groups: [],
    votes: {},
    proposals: [],
    proposalVotes: {},
    roti: {},
    reviewSummary: `Load retro ${retroIndex}: review completed under load.`
  };

  const pace = async (rng) => sleep(config.paceMs * (0.5 + rng()));

  // In resilient mode a barrier waits until the facilitator's authoritative
  // snapshot contains every action of the phase (true convergence). In
  // faithful mode losses are expected, so we only wait a grace period for
  // in-flight broadcasts to settle.
  const barrier = async (label, predicate) => {
    if (config.clientMode === 'faithful') {
      await sleep(config.gracePeriodMs);
      return;
    }
    const ok = await facilitator.waitForState(predicate, config.barrierTimeoutMs);
    if (!ok) {
      problems.push(`barrier '${label}' timed out after ${config.barrierTimeoutMs}ms: some actions never became visible to the facilitator`);
    }
  };

  // Facilitator structural writes always retry, even in faithful mode: a real
  // facilitator whose "next phase" click visibly reverts clicks again.
  const advancePhase = async (phase) => {
    const t0 = Date.now();
    await facilitator.mutate(phase, 'set-phase', {
      apply: s => setPhase(s, phase),
      check: s => s.phase === phase,
      forceRetries: true
    });
    await Promise.all(clients.map(async client => {
      const ok = await client.waitForState(s => s.phase === phase, config.barrierTimeoutMs);
      if (ok) {
        metrics.recordPropagation(phase, Date.now() - t0);
      } else {
        problems.push(`${client.user.name} never saw phase ${phase}`);
      }
    }));
    if (config.teamPersist === 'phase') {
      // The real mutating client also persists the retro into the team record
      // (dataService.updateSession). Doing it once per phase keeps the DB
      // write path exercised without tripping per-IP rate limits.
      try {
        await persistRetrospective(url, team.id, password, facilitator.state);
      } catch (err) {
        problems.push(`team-record persist failed at ${phase}: ${err.message}`);
      }
    }
    log(`retro ${retroIndex}: phase ${phase}`);
  };

  const maybeChaos = async (client, rng) => {
    if (config.chaos > 0 && rng() < config.chaos) {
      await client.chaosReconnect(randInt(rng, 400, 1800));
    }
  };

  try {
    // ---- ICEBREAKER: facilitator creates the session, everyone joins.
    await facilitator.connect();
    await facilitator.join({ waitForInitialState: false });
    const seedBlob = buildInitialSession({
      sessionId,
      teamId: team.id,
      name: `Load Retro ${retroIndex}`,
      maxVotes: config.maxVotes
    });
    ensureParticipant(seedBlob, facilitatorUser);
    facilitator.seed(seedBlob);
    const created = await facilitator.mutate('SETUP', 'create-session', {
      apply: () => {},
      check: s => Number(s._rev ?? 0) >= 1,
      forceRetries: true
    });
    if (!created) throw new Error(`retro ${retroIndex}: could not create the session`);

    await Promise.all(clients.map(async (client, i) => {
      await sleep(i * config.joinStaggerMs);
      await client.connect();
      await client.join();
      await client.mutate('ICEBREAKER', 'join-roster', {
        apply: s => ensureParticipant(s, client.user),
        check: s => (s.participants ?? []).some(p => p.id === client.user.id)
      });
    }));
    await barrier('roster', s =>
      participants.every(u => (s.participants ?? []).some(p => p.id === u.id))
    );

    // ---- WELCOME: every participant records a happiness score.
    await advancePhase('WELCOME');
    await Promise.all(clients.map(async client => {
      const rng = rngFor(config.seed, `welcome-${client.user.id}`);
      await pace(rng);
      const score = randInt(rng, 1, 5);
      expected.happiness[client.user.id] = score;
      await client.mutate('WELCOME', 'happiness', {
        apply: s => setHappiness(s, client.user.id, score),
        check: s => s.happiness?.[client.user.id] === score,
        sticky: true
      });
    }));
    await barrier('happiness', s =>
      clients.every(c => s.happiness?.[c.user.id] !== undefined)
    );

    // ---- OPEN_ACTIONS: pass-through (no previous actions on a fresh team).
    await advancePhase('OPEN_ACTIONS');

    // ---- BRAINSTORM: every participant writes tickets, then marks finished.
    await advancePhase('BRAINSTORM');
    await Promise.all(clients.map(async client => {
      const rng = rngFor(config.seed, `brainstorm-${client.user.id}`);
      for (let t = 0; t < config.ticketsPerUser; t++) {
        await pace(rng);
        const colId = pick(rng, seedBlob.columns).id;
        const ticket = {
          id: `tk-${client.user.id}-${t}`,
          colId,
          text: `[${client.user.name}] observation ${t + 1}`,
          authorId: client.user.id
        };
        expected.tickets.push({ ...ticket, groupId: null });
        await client.mutate('BRAINSTORM', 'add-ticket', {
          apply: s => addTicket(s, ticket),
          check: s => s.tickets.some(x => x.id === ticket.id)
        });
        if (t === 0) await maybeChaos(client, rng);
      }
      await client.mutate('BRAINSTORM', 'mark-finished', {
        apply: s => markFinished(s, client.user.id),
        check: s => (s.finishedUsers ?? []).includes(client.user.id)
      });
    }));
    await barrier('tickets', s =>
      expected.tickets.every(t => s.tickets.some(x => x.id === t.id)) &&
      clients.every(c => (s.finishedUsers ?? []).includes(c.user.id))
    );

    // ---- GROUP: the facilitator clusters tickets per column (chunks of 3).
    await advancePhase('GROUP');
    const survivingTickets = facilitator.state.tickets;
    const ticketsByColumn = new Map();
    for (const ticket of survivingTickets) {
      if (!ticketsByColumn.has(ticket.colId)) ticketsByColumn.set(ticket.colId, []);
      ticketsByColumn.get(ticket.colId).push(ticket);
    }
    const groupPlans = [];
    for (const [colId, colTickets] of ticketsByColumn.entries()) {
      const sorted = [...colTickets].sort((a, b) => a.id.localeCompare(b.id));
      for (let i = 0; i + 1 < sorted.length; i += 3) {
        const chunk = sorted.slice(i, i + 3);
        if (chunk.length < 2) break;
        groupPlans.push({
          id: `g-${retroIndex}-${colId}-${i}`,
          title: `Theme ${colId} #${i / 3 + 1}`,
          colId,
          ticketIds: chunk.map(t => t.id)
        });
      }
    }
    for (const plan of groupPlans) {
      expected.groups.push({ id: plan.id, colId: plan.colId, ticketIds: plan.ticketIds });
      for (const ticketId of plan.ticketIds) {
        const ledgerTicket = expected.tickets.find(t => t.id === ticketId);
        if (ledgerTicket) ledgerTicket.groupId = plan.id;
      }
      await facilitator.mutate('GROUP', 'create-group', {
        apply: s => createGroup(s, plan),
        check: s =>
          s.groups.some(g => g.id === plan.id) &&
          plan.ticketIds.every(id => {
            const ticket = s.tickets.find(t => t.id === id);
            return !ticket || ticket.groupId === plan.id;
          }),
        forceRetries: true
      });
    }
    await Promise.all(clients.map(client =>
      client.waitForState(
        s => groupPlans.every(g => s.groups.some(x => x.id === g.id)),
        config.barrierTimeoutMs
      )
    ));

    // ---- VOTE: every participant spends their full vote budget.
    await advancePhase('VOTE');
    const groupedIds = new Set(groupPlans.flatMap(g => g.ticketIds));
    const voteTargets = [
      ...groupPlans.map(g => g.id),
      ...survivingTickets.filter(t => !groupedIds.has(t.id)).map(t => t.id)
    ];
    await Promise.all(clients.map(async client => {
      const rng = rngFor(config.seed, `vote-${client.user.id}`);
      // Plan the whole budget first so the ledger reflects intent exactly.
      const allocation = new Map();
      for (let v = 0; v < config.maxVotes; v++) {
        const target = pick(rng, voteTargets);
        allocation.set(target, (allocation.get(target) ?? 0) + 1);
      }
      for (const [target, count] of allocation.entries()) {
        if (!expected.votes[target]) expected.votes[target] = {};
        expected.votes[target][client.user.id] = count;
      }
      // Then click vote by vote, like a real user.
      for (const [target, count] of allocation.entries()) {
        for (let c = 1; c <= count; c++) {
          await pace(rng);
          const desired = c;
          await client.mutate('VOTE', 'cast-vote', {
            apply: s => setOwnVotes(s, target, client.user.id, desired),
            check: s => countOwnVotes(s, target, client.user.id) >= desired,
            sticky: true
          });
        }
      }
      await maybeChaos(client, rng);
      await client.mutate('VOTE', 'mark-finished', {
        apply: s => markFinished(s, client.user.id),
        check: s => (s.finishedUsers ?? []).includes(client.user.id)
      });
    }));
    await barrier('votes', s =>
      Object.entries(expected.votes).every(([target, perUser]) =>
        Object.entries(perUser).every(([userId, count]) => countOwnVotes(s, target, userId) === count)
      ) && clients.every(c => (s.finishedUsers ?? []).includes(c.user.id))
    );

    // ---- DISCUSS: focus, action proposals, votes on proposals, decisions.
    await advancePhase('DISCUSS');
    if (voteTargets.length > 0) {
      await facilitator.mutate('DISCUSS', 'set-focus', {
        apply: s => setDiscussionFocus(s, voteTargets[0]),
        check: s => s.discussionFocusId === voteTargets[0],
        forceRetries: true
      });
    }

    const proposalPlans = clients.map((client, i) => ({
      id: `p-${client.user.id}`,
      text: `[${client.user.name}] action proposal ${i + 1}`,
      authorId: client.user.id,
      decision: i % 3 === 2 ? 'reject' : 'accept'
    }));
    for (const plan of proposalPlans) {
      expected.proposals.push({
        id: plan.id,
        authorId: plan.authorId,
        text: plan.text,
        expectType: plan.decision === 'accept' ? 'new' : 'proposal',
        expectRejected: plan.decision === 'reject'
      });
    }
    await Promise.all(clients.map(async (client, i) => {
      const rng = rngFor(config.seed, `propose-${client.user.id}`);
      await pace(rng);
      const plan = proposalPlans[i];
      await client.mutate('DISCUSS', 'add-proposal', {
        apply: s => addProposal(s, plan),
        check: s => s.actions.some(a => a.id === plan.id)
      });
    }));
    await barrier('proposals', s =>
      proposalPlans.every(p => s.actions.some(a => a.id === p.id))
    );

    // Everyone votes on proposals (fanout 0 = vote on all of them).
    const fanout = config.proposalVoteFanout > 0
      ? Math.min(config.proposalVoteFanout, proposalPlans.length)
      : proposalPlans.length;
    await Promise.all(clients.map(async client => {
      const rng = rngFor(config.seed, `proposal-votes-${client.user.id}`);
      const shuffled = [...proposalPlans].sort(() => rng() - 0.5).slice(0, fanout);
      for (const plan of shuffled) {
        await pace(rng);
        const value = rng() < 0.7 ? 'up' : 'down';
        if (!expected.proposalVotes[plan.id]) expected.proposalVotes[plan.id] = {};
        expected.proposalVotes[plan.id][client.user.id] = value;
        await client.mutate('DISCUSS', 'vote-proposal', {
          apply: s => setProposalVote(s, plan.id, client.user.id, value),
          check: s => s.actions.find(a => a.id === plan.id)?.proposalVotes?.[client.user.id] === value,
          sticky: true
        });
      }
    }));
    await barrier('proposal-votes', s =>
      Object.entries(expected.proposalVotes).every(([proposalId, perUser]) =>
        Object.entries(perUser).every(([userId, value]) =>
          s.actions.find(a => a.id === proposalId)?.proposalVotes?.[userId] === value
        )
      )
    );

    for (const plan of proposalPlans) {
      await facilitator.mutate('DISCUSS', 'decide-proposal', {
        apply: s => decideProposal(s, plan.id, plan.decision),
        check: s => {
          const action = s.actions.find(a => a.id === plan.id);
          if (!action) return config.clientMode === 'faithful'; // lost proposal: nothing to decide
          return plan.decision === 'accept' ? action.type === 'new' : action.rejected === true;
        },
        forceRetries: true
      });
    }

    // ---- REVIEW: facilitator writes the summary.
    await advancePhase('REVIEW');
    await facilitator.mutate('REVIEW', 'review-summary', {
      apply: s => setReviewSummary(s, expected.reviewSummary),
      check: s => s.reviewSummary === expected.reviewSummary,
      forceRetries: true
    });

    // ---- CLOSE: ROTI votes, then the facilitator closes the session.
    await advancePhase('CLOSE');
    await Promise.all(clients.map(async client => {
      const rng = rngFor(config.seed, `roti-${client.user.id}`);
      await pace(rng);
      const score = randInt(rng, 1, 5);
      expected.roti[client.user.id] = score;
      await client.mutate('CLOSE', 'roti', {
        apply: s => setRoti(s, client.user.id, score),
        check: s => s.roti?.[client.user.id] === score,
        sticky: true
      });
    }));
    await barrier('roti', s => clients.every(c => s.roti?.[c.user.id] !== undefined));

    await facilitator.mutate('CLOSE', 'close-session', {
      apply: s => closeSession(s),
      check: s => s.status === 'CLOSED',
      forceRetries: true
    });
    if (config.teamPersist !== 'off') {
      try {
        await persistRetrospective(url, team.id, password, facilitator.state);
      } catch (err) {
        problems.push(`final team-record persist failed: ${err.message}`);
      }
    }

    // ---- Read back the authoritative state exactly like a late joiner would.
    const auditor = new SimClient({
      url,
      sessionId,
      user: { id: `auditor-${runId}-${retroIndex}`, name: 'Auditor', color: 'bg-slate-500', role: 'participant' },
      config,
      metrics
    });
    await auditor.connect();
    await auditor.join();
    const finalState = auditor.state;
    auditor.disconnect();

    let teamRecord = null;
    if (config.teamPersist !== 'off') {
      const teamAfter = await loadTeam(url, team.id, password);
      const persisted = (teamAfter.retrospectives ?? []).find(r => r.id === sessionId);
      teamRecord = { present: Boolean(persisted), status: persisted?.status ?? null };
      if (!persisted || persisted.status !== 'CLOSED') {
        problems.push('closed retro not found in the persisted team record');
      }
    }

    return { retroIndex, teamId: team.id, teamName, password, expected, finalState, problems, teamRecord };
  } finally {
    for (const client of everyone) client.disconnect();
    if (!config.keepTeams) {
      await deleteTeam(url, team.id, password).catch(err => {
        problems.push(`team cleanup failed: ${err.message}`);
      });
    }
  }
};

export { runRetroScenario };
