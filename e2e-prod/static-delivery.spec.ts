import { test, expect, type Request } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from '../e2e/helpers/announcements';
import { watchForViolations } from './helpers';

/**
 * What the built app costs on the wire (synthesis items 8 and 9).
 *
 * The unit suites pin each rule on a synthetic `dist/` (`staticRoutes.test.ts`,
 * `jsonCompression.test.ts`); this drives the real build, served by
 * `server.js`, in a real browser — the only place that can show the bundle
 * still runs under the CSP once it arrives gzipped and cached for a year.
 */

const TEAM_PASSWORD = 'static-delivery-password';

test('the page is revalidated, and the bundle arrives gzipped and immutable, under the policy', async ({ page }) => {
  const violations = watchForViolations(page);
  const script = page.waitForResponse((res) => /\/assets\/index-[^/]+\.js$/.test(res.url()));
  const style = page.waitForResponse((res) => /\/assets\/index-[^/]+\.css$/.test(res.url()));

  const html = await page.goto('/');
  expect(html?.headers()['cache-control']).toBe('no-cache');
  expect(html?.headers()['content-security-policy']).toContain("default-src 'self'");

  for (const res of [await script, await style]) {
    const headers = await res.allHeaders();
    expect(headers['content-encoding'], res.url()).toBe('gzip');
    expect(headers['cache-control'], res.url()).toContain('immutable');
    expect(headers['content-security-policy'], res.url()).toContain("default-src 'self'");
  }

  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.getByRole('button').first()).toBeVisible();
  expect(await violations()).toEqual([]);
});

test('a missing hashed asset is a no-store 404, never the page', async ({ request }) => {
  const res = await request.get('/assets/index-00000000.js');

  expect(res.status()).toBe(404);
  expect(res.headers()['content-type']).not.toMatch(/text\/html/);
  expect(res.headers()['cache-control']).toBe('no-store');
  expect(res.headers()['content-security-policy']).toContain("default-src 'self'");
});

test('a JSON answer over 1 KiB arrives gzipped, with the policy, and parses', async ({ page }) => {
  // The app asks for the changelog on load: well over the threshold.
  const version = page.waitForResponse((res) => new URL(res.url()).pathname === '/api/version');
  await page.goto('/');
  const res = await version;

  const headers = await res.allHeaders();
  expect(headers['content-encoding']).toBe('gzip');
  expect(headers.vary).toMatch(/Accept-Encoding/i);
  expect(headers['content-security-policy']).toContain("default-src 'self'");
  const body = await res.json();
  expect(typeof body.current).toBe('string');
  expect(Array.isArray(body.announcements)).toBe(true);
});

test('the Dashboard does not download the team again right after creating it', async ({ page }) => {
  const teamName = `Static Delivery ${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');

  // Armed before the click: the refresh, when there was one, went out right
  // as the Dashboard mounted.
  const teamReads: string[] = [];
  page.on('request', (req: Request) => {
    if (req.method() === 'POST' && /\/api\/team\/[0-9a-f]{10}$/.test(new URL(req.url()).pathname)) {
      teamReads.push(req.url());
    }
  });
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(1500);

  expect(teamReads).toEqual([]);
});

test('an invite link logs in once, however often App re-renders', async ({ page, browser }) => {
  const teamName = `Static Invite ${Date.now()}`;
  await page.goto('/');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(teamName);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 15_000 });
  await dismissAnnouncementsIfPresent(page);

  await page.getByRole('button', { name: 'New Retrospective' }).click();
  await page.locator('text=Start, Stop, Continue').first().click();
  await expect(page.getByRole('heading', { name: 'Icebreaker' })).toBeVisible({ timeout: 15_000 });
  await page.locator('button[title="Invite / Join"]').click();
  await expect(page.getByText('Invite teammates')).toBeVisible();
  await page.getByRole('button', { name: 'CODE & LINK' }).click();
  const linkElement = page.locator('code').first();
  await expect(linkElement).toContainText('?join=', { timeout: 10_000 });
  const inviteUrl = (await linkElement.textContent()) ?? '';

  const guestContext = await browser.newContext();
  try {
    const guest = await guestContext.newPage();
    const logins: string[] = [];
    guest.on('request', (req: Request) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname === '/api/team/login') logins.push(req.url());
    });
    await guest.goto(inviteUrl);
    await expect(guest.getByLabel('Your Name')).toBeVisible({ timeout: 15_000 });
    // The version banner and any other App render have had time to land.
    await guest.waitForTimeout(1500);

    expect(logins).toHaveLength(1);
  } finally {
    await guestContext.close();
  }
});
