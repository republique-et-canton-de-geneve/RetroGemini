import { defineConfig, devices } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export default defineConfig({
  testDir: './e2e-prod',
  outputDir: 'test-results/dual-url-smoke',
  testMatch: 'dual-url.spec.ts',
  workers: 1,
  timeout: 90_000,
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://127.0.0.1:34100',
    locale: 'en-US',
    ...(process.env.PW_CHROMIUM_PATH
      ? { launchOptions: { executablePath: process.env.PW_CHROMIUM_PATH } }
      : {}),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: 'node server.js',
      url: 'http://127.0.0.1:34100/health',
      reuseExistingServer: process.env.DUAL_URL_USE_RUNNING_SERVER === '1',
      env: {
        PORT: '34100',
        DATA_STORE_PATH: join(mkdtempSync(join(tmpdir(), 'retrogemini-dual-')), 'data.sqlite'),
        PROXY_BASE_URL: 'http://127.0.0.1:34101/retrogemini/',
        SESSION_TOKEN_SECRET: 'dual-url-test-fixture-session-secret-2026',
        BACKUP_ENABLED: 'false',
        BACKUP_ON_STARTUP: 'false',
      },
    },
    {
      command: 'node e2e-prod/prefix-proxy.mjs',
      url: 'http://127.0.0.1:34101/retrogemini/health',
      reuseExistingServer: false,
    },
  ],
});
