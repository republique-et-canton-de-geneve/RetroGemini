import { test, expect } from '@playwright/test';

/**
 * Audit H44 — the correlation id, checked against the real `server.js`.
 *
 * The unit suite (`__tests__/structuredLogging.test.ts`) proves the middleware
 * behaves; it cannot prove the middleware is *mounted*, and nothing else would.
 * The route suites build their own Express app, so an `app.use` deleted from
 * `server.js` would leave all 1 400 unit tests green while production went back
 * to log lines nothing can tie together — the exact shape of failure H36 taught
 * this repository to test for with a production-mode run.
 *
 * This config is the only place the real server is exercised end to end, which
 * is why the check lives here rather than in the feature suite pointed at Vite.
 */

const REQUEST_ID = /^[A-Za-z0-9._-]{8,64}$/;

test('every response carries a correlation id, including the health probe', async ({ request }) => {
  for (const path of ['/health', '/api/version', '/']) {
    const response = await request.get(path);
    const id = response.headers()['x-request-id'];

    expect(id, `${path} answered with no X-Request-Id, so its log lines name no request`).toBeTruthy();
    expect(id).toMatch(REQUEST_ID);
  }
});

test('two requests get two different ids', async ({ request }) => {
  const first = (await request.get('/health')).headers()['x-request-id'];
  const second = (await request.get('/health')).headers()['x-request-id'];

  expect(first).not.toBe(second);
});

test('a caller-supplied id is adopted, and a hostile one is not', async ({ request }) => {
  const adopted = await request.get('/health', { headers: { 'X-Request-Id': 'edge-trace-42' } });
  expect(adopted.headers()['x-request-id']).toBe('edge-trace-42');

  // Anyone who can reach the deployment sets this header. A 4 KB id would be
  // written to the platform's log store on every request.
  const hostile = 'x'.repeat(4096);
  const refused = await request.get('/health', { headers: { 'X-Request-Id': hostile } });
  expect(refused.headers()['x-request-id']).not.toBe(hostile);
  expect(refused.headers()['x-request-id']).toMatch(REQUEST_ID);
});
