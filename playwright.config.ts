import { defineConfig, devices } from '@playwright/test';

/**
 * The specs that also run with motion on, in the "motion" project. Every
 * animation of the look is declared under `prefers-reduced-motion:
 * no-preference`, so the default project (reduced motion) sees none of them;
 * these are the specs whose touch timings, box measurements and axe audits an
 * animation can actually change, plus the spec that proves the animations run.
 * A name that matches no file is no error: `session-motion.spec.ts` joins the
 * project the day it is written.
 */
const MOTION_SPECS = [
  'retro-touch-card-controls.spec.ts',
  'retro-full-flow.spec.ts',
  'retro-wide-board.spec.ts',
  'accessibility-audit.spec.ts',
  'session-motion.spec.ts',
];

/** Written to opt into motion: it means nothing with motion reduced. */
const MOTION_ONLY_SPECS = ['session-motion.spec.ts'];

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never', outputFolder: 'playwright-report' }]]
    : [['html', { open: 'never', outputFolder: 'playwright-report' }]],
  timeout: 360_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL: 'http://localhost:5173',
    // The interface language is detected from the browser. Pin it, so the suite
    // reads English whatever locale the CI runner or a developer's machine has;
    // e2e/i18n.spec.ts opts into French explicitly.
    locale: 'en-US',
    // Pinned for the same reason: an animation follows the operating system's
    // setting, and 22 specs measure a box or audit contrast right after an
    // element appears, so a card still rising or a row still fading would be
    // measured half-way. The "motion" project below turns it back on.
    reducedMotion: 'reduce',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: process.env.CI ? 'on' : 'on-first-retry',
    // Sandboxed/offline environments can point at a pre-installed Chromium
    // instead of downloading the exact pinned browser build.
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: MOTION_ONLY_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
      },
    },
    {
      // The product as most people see it, animations on, for the specs an
      // animation can break (AGENTS.md, *Test runs emulate reduced motion*).
      name: 'motion',
      testMatch: MOTION_SPECS,
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
        reducedMotion: 'no-preference',
      },
    },
  ],
  webServer: [
    {
      command: 'node server.js',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: '3000',
        // Lift the team-creation rate limit so the full e2e suite can run
        // through every spec without tripping the production safeguard.
        AUTH_RATE_LIMIT_MAX: '50',
        // Lets e2e/i18n.spec.ts open the administration console and measure its
        // header like the others. A test-only value for a throwaway server.
        SUPER_ADMIN_PASSWORD: 'e2e-super-admin-password',
        // e2e/jira.spec.ts saves a team's Jira token, and the token store
        // refuses to seal one without a stable secret (`503
        // jira_secret_unavailable`): a key derived from the per-process
        // fallback would die with the process. A test-only value for a
        // throwaway server, like the password above.
        SESSION_TOKEN_SECRET: 'e2e-session-token-secret-not-for-production',
      },
    },
    {
      command: 'npx vite --port 5173',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
});
