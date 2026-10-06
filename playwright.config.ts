import { defineConfig, devices } from '@playwright/test';

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
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1280, height: 900 },
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
