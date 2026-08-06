import { defineConfig, devices } from '@playwright/test';

/**
 * Production-mode Playwright config — the CSP gate (audit H36 / decision D14).
 *
 * The default `playwright.config.ts` points `baseURL` at Vite on :5173 and only
 * proxies `/api` and Socket.IO to `server.js`. That is right for the feature
 * suite and useless for a Content-Security-Policy: the header is set by Express,
 * so a policy that blocks the real bundle would never be seen by those tests —
 * the whole suite stays green while the production app renders blank (Codex,
 * PR #417).
 *
 * This config closes that gap by doing what production does: build the frontend,
 * then serve everything — HTML, JS, CSS, fonts — from `server.js`, and drive it
 * in a real browser so the CSP is actually enforced by the engine rather than
 * compared as a string.
 *
 * Run it with `npm run test:e2e:prod`. It is deliberately a separate config, not
 * a second project in the default one: the feature suite must keep running
 * against Vite for fast iteration.
 */
export default defineConfig({
  testDir: './e2e-prod',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['list']] : [['list']],
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: 'http://localhost:3100',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 900 } },
    },
  ],
  webServer: [
    {
      // `npm run build` first: server.js serves `dist/`, so without it this
      // would test the previous build, or 404. Port 3100 rather than 3000 keeps
      // it clear of the default config's server if both ever run.
      command: 'npm run build && node server.js',
      url: 'http://localhost:3100/health',
      reuseExistingServer: false,
      timeout: 180_000,
      env: {
        PORT: '3100',
        AUTH_RATE_LIMIT_MAX: '50',
      },
    },
  ],
});
