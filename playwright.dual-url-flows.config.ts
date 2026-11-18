import { defineConfig } from '@playwright/test';
import dualUrl from './playwright.dual-url.config';

export default defineConfig({
  ...dualUrl,
  testDir: './e2e',
  outputDir: 'test-results/dual-url-flows',
  testMatch: ['retro-full-flow.spec.ts', 'healthcheck-full-flow.spec.ts'],
  timeout: 360_000,
  expect: { timeout: 10_000 },
  projects: [
    { name: 'native', use: { baseURL: 'http://127.0.0.1:34100/' } },
    { name: 'proxy', use: { baseURL: 'http://127.0.0.1:34101/retrogemini/' } },
  ],
});
