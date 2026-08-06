import { test, expect, type Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from '../e2e/helpers/announcements';

/**
 * The CSP gate (audit H36, decision D14 — enforcing).
 *
 * A CSP fails *silently*: the browser blocks a resource, logs to the console and
 * renders nothing. No request errors, no exception, no failing assertion in any
 * test that was not looking. That is why this file exists at all, and why it
 * asserts on violations directly rather than on "the page looks fine".
 *
 * Everything here loads from `server.js` serving the built `dist/`, which is
 * what production does — see `playwright.prod.config.ts` for why the ordinary
 * e2e suite cannot do this job.
 */

/** Collects CSP violations the browser reports, from both channels. */
const watchForViolations = (page: Page) => {
  const violations: string[] = [];

  // The DOM event fires for every blocked resource, with the directive.
  page.addInitScript(() => {
    (window as unknown as { __cspViolations: string[] }).__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      (window as unknown as { __cspViolations: string[] }).__cspViolations.push(
        `${event.violatedDirective} blocked ${event.blockedURI || '(inline)'}`,
      );
    });
  });

  // Console errors catch anything reported before the listener attaches.
  page.on('console', (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|connect|execute|apply)/i.test(text)) {
      violations.push(text);
    }
  });

  return async () => {
    const fromDom = await page.evaluate(
      () => (window as unknown as { __cspViolations?: string[] }).__cspViolations ?? [],
    );
    return [...violations, ...fromDom];
  };
};

test('the served app carries the enforcing policy', async ({ page }) => {
  const response = await page.goto('/');
  const csp = response?.headers()['content-security-policy'];

  expect(csp, 'server.js served the app with no CSP at all').toBeTruthy();
  // Report-only would be a silent downgrade: the header is present, the tests
  // pass, and nothing is actually enforced. D14 chose enforcing.
  expect(response?.headers()['content-security-policy-report-only']).toBeUndefined();
  expect(csp).toContain("default-src 'self'");
});

test('the app boots and renders under the policy, with no violations', async ({ page }) => {
  const violations = watchForViolations(page);

  await page.goto('/');
  // A blocked script bundle leaves an empty <div id="root"> and no error, so
  // assert on rendered content rather than on navigation succeeding.
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('button').first()).toBeVisible();

  expect(await violations()).toEqual([]);
});

test('styles survive style-src, so the app is not unstyled text', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();

  // Tailwind injects at runtime; if style-src blocked it the page would render
  // as unstyled HTML, which no "is visible" assertion would catch.
  const hasStyles = await page.evaluate(() => {
    const sheets = Array.from(document.styleSheets);
    return sheets.some((sheet) => {
      try {
        return (sheet.cssRules?.length ?? 0) > 0;
      } catch {
        // Cross-origin sheet: not ours, and not what we are checking.
        return false;
      }
    });
  });
  expect(hasStyles, 'no CSS rules applied — style-src is blocking the stylesheet').toBe(true);
});

test('the icon font loads, so the UI is not full of ligature text', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();

  // Material Symbols ships from public/fonts. If font-src blocked it, every
  // icon renders as its raw ligature name and the app stays "working".
  const fontLoaded = await page.evaluate(async () => {
    await document.fonts.ready;
    return Array.from(document.fonts).some((font) => font.status === 'loaded');
  });
  expect(fontLoaded, 'no font loaded — font-src is blocking the icon font').toBe(true);
});

test('Socket.IO connects, so connect-src does not break real-time sync', async ({ page }) => {
  const violations = watchForViolations(page);
  await page.goto('/');
  await expect(page.locator('#root')).not.toBeEmpty();

  // The zero-downtime guarantee rides entirely on this channel: a CSP that
  // blocks the WebSocket upgrade leaves an app that loads and never syncs,
  // which is the worst possible way for this policy to be wrong.
  const connected = await page.evaluate(
    () =>
      new Promise<boolean>((resolve) => {
        const socket = new WebSocket(
          `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/socket.io/?EIO=4&transport=websocket`,
        );
        const done = (value: boolean) => {
          socket.close();
          resolve(value);
        };
        socket.onopen = () => done(true);
        socket.onerror = () => done(false);
        setTimeout(() => done(false), 8000);
      }),
  );

  expect(connected, 'the WebSocket never opened — connect-src is blocking Socket.IO').toBe(true);
  expect(await violations()).toEqual([]);
});

test('the invite QR code renders, so img-src does not break the offline workflow', async ({ page }) => {
  const violations = watchForViolations(page);

  // This is the case Codex caught on PR #417: `QRCode.toDataURL` produces a
  // `data:` URI, `default-src 'self'` rejects it, and the whole ordinary e2e
  // suite stays green because it opens this modal but reads only the *link*.
  // Nobody would have noticed until a room full of people could not scan the
  // code — which is exactly the air-gapped workflow H36 exists to protect.
  const teamName = `CSP QR ${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill('csp-gate-password');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 15_000 });

  await dismissAnnouncementsIfPresent(page);

  // Reach the invite modal the way a facilitator does: from inside a session.
  await page.getByRole('button', { name: 'Health Checks' }).click();
  await page.getByText('START HEALTH CHECK').click();
  await page.getByRole('button', { name: 'Start Health Check', exact: true }).click();
  await expect(page.getByText('Rate each health dimension')).toBeVisible({ timeout: 15_000 });

  await page.locator('button[title="Invite / Join"]').click();
  await expect(page.getByText('Invite teammates')).toBeVisible();
  await page.getByRole('button', { name: 'CODE & LINK' }).click();

  const qr = page.getByAltText('QR Code');
  await expect(qr).toBeVisible({ timeout: 15_000 });

  // Visible is not enough: a blocked image is still a laid-out <img> element
  // with the alt text. `naturalWidth` is 0 unless the bitmap actually decoded.
  await expect
    .poll(async () => qr.evaluate((img: HTMLImageElement) => img.naturalWidth), {
      timeout: 10_000,
      message: 'the QR image never decoded — img-src is blocking the data: URI',
    })
    .toBeGreaterThan(0);

  expect(await violations()).toEqual([]);
});
