/**
 * Reports the cross-pod Socket.IO adapter without ever letting it gate traffic
 * (audit H50).
 *
 * Three rules are encoded here, and each one is a decision:
 *  - **The status code never moves.** Failing readiness when the adapter is
 *    missing is H50's option (b); with both pods failing at once it empties the
 *    Service and turns degraded collaboration into a total outage. /health
 *    informs, /ready gates, and the adapter is not allowed near /ready.
 *  - **`expected` is what makes the answer meaningful.** An in-memory adapter
 *    is the correct configuration for a single-pod deployment and a silent
 *    split-brain at `replicas: 2`; only the deployment's own configuration
 *    separates the two.
 *  - **The upstream error text is not returned.** It names the deployment's
 *    internal host, port and grant, and /health is reachable by anyone who can
 *    reach the pod — the same reasoning that keeps `detail` off the
 *    `/api/ai/*` responses. It goes to the pod log and the super-admin log
 *    ring instead.
 */
const describeSocketAdapter = (serverRuntime) => {
  const status = serverRuntime?.socketAdapter;

  // Routes are registered before `startServer` resolves the adapter, so a probe
  // in that window must read as a plain single-pod deployment, never degraded.
  if (!status) {
    return { strategy: 'memory', expected: false, active: false, attempts: 0, gaveUp: false };
  }

  return {
    strategy: status.strategy,
    expected: status.expected === true,
    active: status.active === true,
    attempts: status.attempts ?? 0,
    gaveUp: status.gaveUp === true
  };
};

const registerCoreRoutes = ({ app, versionService, serverRuntime }) => {
  app.get('/health', (_req, res) => {
    const socketAdapter = describeSocketAdapter(serverRuntime);
    const degraded = socketAdapter.expected && !socketAdapter.active;

    res.status(200).json({
      status: degraded ? 'degraded' : 'ok',
      socketAdapter
    });
  });

  // Unconditional by design — see the note above before adding a condition.
  app.get('/ready', (_req, res) => res.status(200).send('READY'));

  app.get('/api/version', (_req, res) => {
    res.json(versionService.getVersionInfo());
  });
};

export { registerCoreRoutes };
