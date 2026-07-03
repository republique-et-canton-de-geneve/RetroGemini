// CLI argument parsing and presets for the load-test runner.

import { parseArgs } from 'node:util';

const PRESETS = {
  // Quick sanity check that the harness and the server are wired correctly.
  smoke: { retros: 1, users: 5, ticketsPerUser: 2, maxVotes: 3, proposalVoteFanout: 5, paceMs: 120, joinStaggerMs: 40 },
  // Today's real usage: a few small teams in parallel.
  team: { retros: 3, users: 8, ticketsPerUser: 3, maxVotes: 3, proposalVoteFanout: 8, paceMs: 250, joinStaggerMs: 80 },
  // The rollout target: several retros in parallel, 50 users each, everyone
  // votes on every action proposal. Pace is brisk-but-human (~1.5-3 s between
  // one user's actions); drop --pace-ms to compress time and find the ceiling.
  target: { retros: 5, users: 50, ticketsPerUser: 3, maxVotes: 3, proposalVoteFanout: 0, paceMs: 1500, joinStaggerMs: 120 },
  // Beyond the target: more retros AND inhumanly fast users, to find the
  // actual throughput ceiling rather than validate the rollout.
  stress: { retros: 10, users: 50, ticketsPerUser: 4, maxVotes: 4, proposalVoteFanout: 0, paceMs: 150, joinStaggerMs: 80 }
};

const HELP = `RetroGemini load test — drives full retrospectives over the real HTTP + Socket.IO API
and audits that no user action was lost.

Usage: node loadtest/run.js [options]

  --url <url>                  Server to test (default http://localhost:3000)
  --preset <name>              smoke | team | target | stress (default smoke)
  --retros <n>                 Parallel retrospectives (teams)
  --users <n>                  Participants per retro (excluding the facilitator)
  --tickets <n>                Brainstorm tickets per participant
  --max-votes <n>              Vote budget per participant
  --proposal-vote-fanout <n>   Proposals each participant votes on (0 = all)
  --pace-ms <n>                Average think time between a user's actions
  --join-stagger-ms <n>        Delay between participant joins
  --client-mode <mode>         resilient (retry until durable, default) |
                               faithful (single send, like the real front-end)
  --chaos <p>                  Probability (0..1) that a participant drops and
                               reconnects mid-phase (simulates rolling updates)
  --team-persist <mode>        off | phase (default) — persist the retro into the
                               team record over HTTP like the real client
  --seed <n>                   RNG seed for reproducible runs (default 42)
  --op-timeout-ms <n>          Wait per write before retrying (default 8000)
  --max-attempts <n>           Max sends per action in resilient mode (default 30)
  --barrier-timeout-ms <n>     Max wait for phase convergence (default 120000)
  --json <file>                Write the full machine-readable report to a file
  --keep-teams                 Do not delete the load-test teams afterwards
  --quiet                      Only print the final report
  --help                       Show this help

The server's team-creation rate limit must allow one team per retro:
start it with AUTH_RATE_LIMIT_MAX >= the --retros value.`;

const intOption = (raw, fallback) => {
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`invalid numeric option value: ${raw}`);
  }
  return parsed;
};

const parseConfig = (argv) => {
  const { values } = parseArgs({
    args: argv,
    options: {
      url: { type: 'string', default: 'http://localhost:3000' },
      preset: { type: 'string', default: 'smoke' },
      retros: { type: 'string' },
      users: { type: 'string' },
      tickets: { type: 'string' },
      'max-votes': { type: 'string' },
      'proposal-vote-fanout': { type: 'string' },
      'pace-ms': { type: 'string' },
      'join-stagger-ms': { type: 'string' },
      'client-mode': { type: 'string', default: 'resilient' },
      chaos: { type: 'string' },
      'team-persist': { type: 'string', default: 'phase' },
      seed: { type: 'string' },
      'op-timeout-ms': { type: 'string' },
      'max-attempts': { type: 'string' },
      'barrier-timeout-ms': { type: 'string' },
      json: { type: 'string' },
      'keep-teams': { type: 'boolean', default: false },
      quiet: { type: 'boolean', default: false },
      help: { type: 'boolean', default: false }
    }
  });

  if (values.help) {
    return { help: HELP };
  }

  const preset = PRESETS[values.preset];
  if (!preset) {
    throw new Error(`unknown preset '${values.preset}' (expected: ${Object.keys(PRESETS).join(', ')})`);
  }
  if (!['resilient', 'faithful'].includes(values['client-mode'])) {
    throw new Error(`invalid --client-mode '${values['client-mode']}' (expected: resilient, faithful)`);
  }
  if (!['off', 'phase'].includes(values['team-persist'])) {
    throw new Error(`invalid --team-persist '${values['team-persist']}' (expected: off, phase)`);
  }
  const chaos = values.chaos !== undefined ? Number(values.chaos) : 0;
  if (!Number.isFinite(chaos) || chaos < 0 || chaos > 1) {
    throw new Error(`invalid --chaos '${values.chaos}' (expected a probability between 0 and 1)`);
  }

  return {
    url: values.url.replace(/\/+$/, ''),
    presetName: values.preset,
    retros: intOption(values.retros, preset.retros),
    users: intOption(values.users, preset.users),
    ticketsPerUser: intOption(values.tickets, preset.ticketsPerUser),
    maxVotes: intOption(values['max-votes'], preset.maxVotes),
    proposalVoteFanout: intOption(values['proposal-vote-fanout'], preset.proposalVoteFanout),
    paceMs: intOption(values['pace-ms'], preset.paceMs),
    joinStaggerMs: intOption(values['join-stagger-ms'], preset.joinStaggerMs),
    clientMode: values['client-mode'],
    chaos,
    teamPersist: values['team-persist'],
    seed: intOption(values.seed, 42),
    opTimeoutMs: intOption(values['op-timeout-ms'], 8000),
    maxAttempts: intOption(values['max-attempts'], 30),
    barrierTimeoutMs: intOption(values['barrier-timeout-ms'], 120000),
    gracePeriodMs: 2000,
    jsonPath: values.json ?? null,
    keepTeams: values['keep-teams'],
    quiet: values.quiet
  };
};

export { parseConfig, PRESETS };
