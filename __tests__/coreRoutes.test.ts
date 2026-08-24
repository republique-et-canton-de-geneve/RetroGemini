import express from 'express';
import { describe, expect, it, vi } from 'vitest';
import { registerCoreRoutes } from '../server/routes/coreRoutes.js';
import { request } from './helpers/routeTestServer';

/**
 * `/health` and `/ready` are the Kubernetes probes that decide whether a pod
 * receives traffic during a rolling update, so a change that breaks them takes
 * the deployment down without any test failing. `/api/version` feeds the in-app
 * announcements.
 */

const buildApp = (
  versionInfo: unknown = { current: '1.0', announcements: [] },
  serverRuntime?: Record<string, unknown>,
) => {
  const app = express();
  const versionService = { getVersionInfo: vi.fn(() => versionInfo) };
  registerCoreRoutes({ app, versionService, serverRuntime });
  return { app, versionService };
};

describe('core routes', () => {
  it.each(['/health', '/ready'])('answers the %s probe with 200', async (path) => {
    const { app } = buildApp();

    const response = await request(app, path);

    expect(response.status).toBe(200);
  });

  it('keeps /ready an unconditional 200 (audit H50, option (b) refused)', async () => {
    // The one assertion in this file that exists to stop a *future* change.
    // H50's tempting fix is to fail readiness when the cross-pod adapter is
    // missing — which, when both pods fail at once, empties the Service and
    // turns degraded collaboration into a total outage. Readiness cannot
    // express "some pods are healthy", so it stays out of this decision: the
    // adapter state is reported on /health and nowhere gates traffic.
    const { app } = buildApp(undefined, {
      multiPodAdapter: false,
      socketAdapter: { strategy: 'postgres', expected: true, active: false, degraded: true, attempts: 12, gaveUp: true },
    });

    const response = await request(app, '/ready');

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('READY');
  });

  it('serves the version and announcements', async () => {
    const versionInfo = {
      current: '27.25',
      announcements: [{ version: '27.0', date: '2026-07-01', items: [{ type: 'feature', description: 'New' }] }]
    };
    const { app, versionService } = buildApp(versionInfo);

    const response = await request(app, '/api/version');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(versionInfo);
    expect(versionService.getVersionInfo).toHaveBeenCalledTimes(1);
  });

  it('does not require authentication for the probes', async () => {
    // The probes are called by the kubelet, which carries no credential.
    const { app } = buildApp();

    for (const path of ['/health', '/ready', '/api/version']) {
      expect((await request(app, path)).status).toBe(200);
    }
  });
});

/**
 * Audit H50 — /health is the signal that makes a lost cross-pod adapter
 * visible. The status code never moves (that would be option (b), refused);
 * the body is what carries the truth an operator and an alert can read.
 */
describe('/health reports the cross-pod adapter state (audit H50)', () => {
  it('reports ok for a single-pod deployment', async () => {
    const { app } = buildApp(undefined, {
      multiPodAdapter: false,
      socketAdapter: { strategy: 'memory', expected: false, active: false, degraded: false, attempts: 1, gaveUp: false },
    });

    const response = await request(app, '/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: 'ok',
      socketAdapter: { strategy: 'memory', expected: false, active: false, attempts: 1, gaveUp: false },
    });
  });

  it('reports degraded when a configured adapter is not active', async () => {
    const { app } = buildApp(undefined, {
      multiPodAdapter: false,
      socketAdapter: { strategy: 'redis', expected: true, active: false, degraded: true, attempts: 12, gaveUp: true },
    });

    const response = await request(app, '/health');

    // 200, always: this endpoint informs, it never gates.
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: 'degraded',
      socketAdapter: { strategy: 'redis', expected: true, active: false, gaveUp: true },
    });
  });

  it('never returns the upstream error text to an anonymous caller', async () => {
    // Same rule as the /api/ai/* routes: the message names the deployment's
    // internal host, and /health is reachable by anyone who can reach the pod.
    // The detail belongs in the pod log and the super-admin log ring.
    const { app } = buildApp(undefined, {
      multiPodAdapter: false,
      socketAdapter: {
        strategy: 'redis',
        expected: true,
        active: false,
        degraded: true,
        attempts: 3,
        gaveUp: false,
        error: 'connect ECONNREFUSED 10.42.0.7:6379',
      },
    });

    const body = await (await request(app, '/health')).text();

    expect(body).not.toContain('10.42.0.7');
    expect(body).not.toContain('ECONNREFUSED');
  });

  it('answers before the adapter has been initialised', async () => {
    // Routes are registered before startServer resolves the adapter. A probe
    // arriving in that window must not see `undefined` rendered as degraded.
    const { app } = buildApp(undefined, {});

    const response = await request(app, '/health');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });
});
