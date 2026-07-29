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

const buildApp = (versionInfo: unknown = { current: '1.0', announcements: [] }) => {
  const app = express();
  const versionService = { getVersionInfo: vi.fn(() => versionInfo) };
  registerCoreRoutes({ app, versionService });
  return { app, versionService };
};

describe('core routes', () => {
  it.each([
    ['/health', 'OK'],
    ['/ready', 'READY']
  ])('answers the %s probe with 200', async (path, body) => {
    const { app } = buildApp();

    const response = await request(app, path);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(body);
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
