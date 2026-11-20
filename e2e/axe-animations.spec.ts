import { expect, test } from '@playwright/test';
import { waitForFiniteAnimations } from './helpers/axe';

/**
 * `audit()` waits for the page's finite animations before axe reads a colour:
 * axe measures text under CSS opacity at its blended colour, so a fade caught
 * half-way is a `color-contrast` finding on a screen capped at zero. These
 * tests hold the wait itself, on a page of its own, so they need no session.
 */
test.describe('the audit waits for animations', () => {
  // The rule is about animations that run: with motion reduced there is
  // nothing to wait for, in this project or any other.
  test.use({ reducedMotion: 'no-preference' });

  const page = (body: string) => `<!doctype html><style>
    @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
    @keyframes spin { to { transform: rotate(360deg) } }
  </style><body>${body}</body>`;

  test('a fade is over before the audit reads the page', async ({ page: p }) => {
    await p.setContent(page('<p id="t" style="animation: fade 800ms linear">Text</p>'));
    await waitForFiniteAnimations(p);
    expect(await p.evaluate(() => getComputedStyle(document.getElementById('t')!).opacity)).toBe('1');
  });

  test('an animation that repeats for ever is not waited for', async ({ page: p }) => {
    await p.setContent(page('<span style="animation: spin 1s linear infinite">.</span>'));
    const started = Date.now();
    await waitForFiniteAnimations(p);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  test('an animation that does not end in time fails loudly, naming it', async ({ page: p }) => {
    await p.setContent(page('<p id="slow" style="animation: fade 60s linear">Text</p>'));
    await expect(waitForFiniteAnimations(p, { timeoutMs: 500 })).rejects.toThrow(/fade.*#slow/);
  });
});
