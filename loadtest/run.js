#!/usr/bin/env node
// RetroGemini load-test runner.
//
// Drives R parallel retrospectives with N simulated users each over the real
// HTTP + Socket.IO API, records every intended user action in a ledger, then
// audits the authoritative server state: any ticket, vote, group, action
// proposal, proposal vote, happiness or ROTI entry that went missing is
// reported. See loadtest/README.md for the full validation strategy.

import { writeFileSync } from 'node:fs';
import { parseConfig } from './lib/cli.js';
import { createMetrics, formatSummary } from './lib/metrics.js';
import { runRetroScenario } from './lib/retroScenario.js';
import { auditSession } from './lib/verify.js';

const main = async () => {
  let config;
  try {
    config = parseConfig(process.argv.slice(2));
  } catch (err) {
    console.error(`Argument error: ${err.message}\nRun with --help for usage.`);
    process.exit(2);
  }
  if (config.help) {
    console.log(config.help);
    return;
  }

  const runId = Date.now().toString(36);
  const log = config.quiet ? () => {} : (msg) => console.log(`[loadtest] ${msg}`);
  const totalClients = config.retros * (config.users + 1);

  console.log('RetroGemini load test');
  console.log(`  target url     : ${config.url}`);
  console.log(`  preset         : ${config.presetName} (run id ${runId}, seed ${config.seed})`);
  console.log(`  scenario       : ${config.retros} parallel retro(s) x ${config.users} participants (${totalClients} sockets)`);
  console.log(`  workload       : ${config.ticketsPerUser} tickets/user, ${config.maxVotes} votes/user, proposal-vote fanout ${config.proposalVoteFanout === 0 ? 'all' : config.proposalVoteFanout}`);
  console.log(`  client mode    : ${config.clientMode}${config.chaos > 0 ? `, chaos reconnects p=${config.chaos}` : ''}`);
  console.log('');

  // Fail fast if the server is not reachable.
  try {
    const health = await fetch(`${config.url}/health`);
    if (!health.ok) throw new Error(`HTTP ${health.status}`);
  } catch (err) {
    console.error(`Server health check failed for ${config.url}: ${err.message}`);
    process.exit(2);
  }

  const metrics = createMetrics();
  const startedAt = Date.now();

  const results = await Promise.all(
    Array.from({ length: config.retros }, (_, i) =>
      runRetroScenario({
        url: config.url,
        runId,
        retroIndex: i + 1,
        config,
        metrics,
        log
      }).catch(err => ({
        retroIndex: i + 1,
        fatal: `scenario crashed: ${err.message}`,
        expected: null,
        finalState: null,
        problems: []
      }))
    )
  );

  const wallSeconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  const summary = metrics.summarize();

  console.log('');
  console.log(`Run finished in ${wallSeconds}s`);
  console.log('');
  console.log(formatSummary(summary));
  console.log('');

  // ---- Integrity audit per retro
  let failed = false;
  const audits = [];
  for (const result of results) {
    if (result.fatal) {
      failed = true;
      console.log(`Retro ${result.retroIndex}: FATAL — ${result.fatal}`);
      audits.push({ retroIndex: result.retroIndex, fatal: result.fatal });
      continue;
    }
    const audit = auditSession(result.finalState, result.expected);
    const allProblems = [...result.problems, ...audit.problems];
    audits.push({
      retroIndex: result.retroIndex,
      teamName: result.teamName,
      stats: audit.stats,
      problems: allProblems,
      teamRecord: result.teamRecord
    });

    const headline = `Retro ${result.retroIndex} (${result.teamName}): ` +
      `${audit.stats.expectedTickets} tickets, ${audit.stats.expectedVotes} votes, ` +
      `${audit.stats.expectedProposals} proposals, ${audit.stats.expectedProposalVotes} proposal votes`;

    if (allProblems.length === 0) {
      console.log(`${headline} -> OK, nothing lost`);
    } else {
      console.log(`${headline} -> ${allProblems.length} problem(s)`);
      const shown = allProblems.slice(0, 15);
      for (const problem of shown) console.log(`    - ${problem}`);
      if (allProblems.length > shown.length) {
        console.log(`    ... and ${allProblems.length - shown.length} more (see --json output)`);
      }
      if (config.clientMode === 'resilient') failed = true;
    }
  }

  if (summary.lostOps > 0 && config.clientMode === 'resilient') failed = true;

  console.log('');
  if (config.clientMode === 'faithful') {
    // Faithful mode quantifies what real users would lose; it reports rather
    // than fails. Losses here mean real users would see actions vanish.
    const totalProblems = audits.reduce((acc, a) => acc + (a.problems?.length ?? 0), 0);
    console.log(totalProblems === 0
      ? 'FAITHFUL MODE RESULT: no user action lost — the real client behaviour survives this load.'
      : `FAITHFUL MODE RESULT: ${totalProblems} user-visible loss(es)/anomalies. This is what real users would experience at this load — see details above.`);
  } else {
    console.log(failed
      ? 'RESULT: FAIL — user actions were lost or did not converge. Do NOT roll out at this load until this is fixed.'
      : 'RESULT: PASS — every ticket, vote, group, proposal and proposal vote is accounted for.');
  }

  if (config.jsonPath) {
    const report = {
      runId,
      config: { ...config, jsonPath: undefined },
      wallSeconds: Number(wallSeconds),
      metrics: summary,
      audits
    };
    writeFileSync(config.jsonPath, JSON.stringify(report, null, 2));
    console.log(`\nFull report written to ${config.jsonPath}`);
  }

  process.exit(failed ? 1 : 0);
};

main().catch(err => {
  console.error('Load test crashed:', err);
  process.exit(2);
});
