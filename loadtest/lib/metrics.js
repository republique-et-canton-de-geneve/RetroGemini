// Metrics collection for a load-test run: write outcomes, contention retries,
// latency percentiles per phase, and phase-change propagation times.

const percentile = (sorted, p) => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
};

const createMetrics = () => {
  const ops = []; // { phase, label, attempts, latencyMs, outcome }
  const propagation = []; // { phase, ms }
  let reconnects = 0;
  let socketErrors = 0;

  const recordOp = (entry) => ops.push(entry);
  const recordPropagation = (phase, ms) => propagation.push({ phase, ms });
  const recordReconnect = () => reconnects++;
  const recordSocketError = () => socketErrors++;

  const summarize = () => {
    const byPhase = new Map();
    for (const op of ops) {
      if (!byPhase.has(op.phase)) byPhase.set(op.phase, []);
      byPhase.get(op.phase).push(op);
    }

    const phases = [];
    for (const [phase, phaseOps] of byPhase.entries()) {
      const okOps = phaseOps.filter(o => o.outcome === 'ok');
      const latencies = okOps.map(o => o.latencyMs).sort((a, b) => a - b);
      phases.push({
        phase,
        ops: phaseOps.length,
        ok: okOps.length,
        lost: phaseOps.filter(o => o.outcome === 'lost').length,
        firstTry: phaseOps.filter(o => o.outcome === 'ok' && o.attempts === 1).length,
        retried: phaseOps.filter(o => o.outcome === 'ok' && o.attempts > 1).length,
        maxAttempts: Math.max(0, ...phaseOps.map(o => o.attempts)),
        p50: percentile(latencies, 50),
        p95: percentile(latencies, 95),
        p99: percentile(latencies, 99),
        max: latencies.length ? latencies[latencies.length - 1] : 0
      });
    }

    const propByPhase = new Map();
    for (const sample of propagation) {
      if (!propByPhase.has(sample.phase)) propByPhase.set(sample.phase, []);
      propByPhase.get(sample.phase).push(sample.ms);
    }
    const phasePropagation = [...propByPhase.entries()].map(([phase, samples]) => {
      const sorted = [...samples].sort((a, b) => a - b);
      return {
        phase,
        clients: sorted.length,
        p50: percentile(sorted, 50),
        p95: percentile(sorted, 95),
        max: sorted[sorted.length - 1] ?? 0
      };
    });

    const totalOps = ops.length;
    const okOps = ops.filter(o => o.outcome === 'ok');
    const contested = ops.filter(o => o.attempts > 1).length;
    return {
      totalOps,
      okOps: okOps.length,
      lostOps: ops.filter(o => o.outcome === 'lost').length,
      firstTryRate: totalOps === 0 ? 1 : ops.filter(o => o.outcome === 'ok' && o.attempts === 1).length / totalOps,
      contestedOps: contested,
      reconnects,
      socketErrors,
      phases,
      phasePropagation
    };
  };

  return { recordOp, recordPropagation, recordReconnect, recordSocketError, summarize };
};

const formatSummary = (summary) => {
  const lines = [];
  const pct = (x) => `${(x * 100).toFixed(2)}%`;
  lines.push(`Writes: ${summary.totalOps} total, ${summary.okOps} durable, ${summary.lostOps} lost`);
  lines.push(`First-attempt success: ${pct(summary.firstTryRate)} (${summary.contestedOps} writes needed a retry after losing the optimistic-concurrency race)`);
  lines.push(`Client reconnects: ${summary.reconnects}, socket errors: ${summary.socketErrors}`);
  lines.push('');
  lines.push('Write latency per phase (ms, from send to durable ack):');
  lines.push('  phase          ops     ok   lost  1st-try retried  p50   p95   p99   max');
  for (const p of summary.phases) {
    lines.push(
      `  ${p.phase.padEnd(13)}${String(p.ops).padStart(6)}${String(p.ok).padStart(7)}${String(p.lost).padStart(7)}` +
      `${String(p.firstTry).padStart(9)}${String(p.retried).padStart(8)}${String(p.p50).padStart(6)}${String(p.p95).padStart(6)}` +
      `${String(p.p99).padStart(6)}${String(p.max).padStart(6)}`
    );
  }
  if (summary.phasePropagation.length > 0) {
    lines.push('');
    lines.push('Phase-change propagation (ms until every client saw the new phase):');
    lines.push('  phase          clients   p50   p95   max');
    for (const p of summary.phasePropagation) {
      lines.push(
        `  ${p.phase.padEnd(13)}${String(p.clients).padStart(8)}${String(p.p50).padStart(6)}${String(p.p95).padStart(6)}${String(p.max).padStart(6)}`
      );
    }
  }
  return lines.join('\n');
};

export { createMetrics, formatSummary, percentile };
