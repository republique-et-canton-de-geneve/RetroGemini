import { defineConfig } from '@playwright/test';
import dualUrl from './playwright.dual-url.config';

export default defineConfig({
  ...dualUrl,
  testDir: './e2e',
  outputDir: 'test-results/dual-url-flows',
  // File names. Playwright says nothing of one that matches no file (it fails
  // only a run that finds no test), so a spec renamed without its entry would
  // drop out of the native and the proxy runs silently:
  // __tests__/playwrightDualUrlFlows.test.ts checks that each is a spec of e2e/.
  testMatch: ['retro-full-flow.spec.ts', 'healthcheck-full-flow.spec.ts'],
  timeout: 360_000,
  expect: { timeout: 10_000 },
  // Stated here rather than only inherited: these are the full-flow specs,
  // which measure participant rows right after a card appears, and the
  // animations of the look would be measured half-way (see playwright.config.ts).
  use: { ...dualUrl.use, reducedMotion: 'reduce' },
  projects: [
    { name: 'native', use: { baseURL: 'http://127.0.0.1:34100/' } },
    { name: 'proxy', use: { baseURL: 'http://127.0.0.1:34101/retrogemini/' } },
  ],
});
