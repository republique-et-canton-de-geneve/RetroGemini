import { test, expect } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from '../e2e/helpers/announcements';
import { watchForViolations } from './helpers';

const native = 'http://127.0.0.1:34100';
const proxied = 'http://127.0.0.1:34101/retrogemini';

for (const base of [native, proxied]) {
  test(`assets, API, fonts and deep reload at ${base}`, async ({ page }) => {
    const errors: string[] = [];
    const fontPaths: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('response', (res) => {
      if (['script', 'stylesheet', 'font'].includes(res.request().resourceType()) && res.status() >= 400) errors.push(res.url());
      if (res.request().resourceType() === 'font') fontPaths.push(new URL(res.url()).pathname);
    });
    const violations = watchForViolations(page);
    await page.goto(base + '/');
    await expect(page.getByRole('button', { name: '+ New Team' })).toBeVisible();
    const assetPaths = await page.locator('script[src],link[rel="stylesheet"]').evaluateAll((nodes) => nodes.map((node) => node.getAttribute('src') ?? node.getAttribute('href')));
    expect(assetPaths.length).toBeGreaterThan(1);
    for (const path of assetPaths) expect(path).toMatch(base === proxied ? /^\/retrogemini\// : /^\//);
    const api = await page.evaluate(async () => {
      const basePath = document.querySelector<HTMLMetaElement>('meta[name="app-base-path"]')!.content;
      return (await fetch(basePath + 'api/team/list')).status;
    });
    expect(api).toBe(200);
    await page.goto(base + '/session/missing-session');
    await expect(page.getByRole('button', { name: '+ New Team' })).toBeVisible();
    await page.reload();
    await expect(page.locator('#root')).not.toBeEmpty();
    const styles = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        sheets: document.styleSheets.length,
        fonts: Array.from(document.fonts).filter((font) => font.status === 'loaded').map((font) => font.family.replace(/["']/g, '')),
      };
    });
    expect(styles.sheets).toBeGreaterThan(0);
    // Each family by name, as on the root mount (production-csp.spec.ts): the
    // stylesheet names its fonts by an absolute path, which the build must
    // carry under the public prefix. "Some font loaded" was true with one.
    expect(styles.fonts, 'the icon font did not load at this mount').toContain('Material Symbols Rounded');
    expect(styles.fonts, 'the text font did not load at this mount').toContain('Geist');
    expect(fontPaths.length).toBeGreaterThan(0);
    for (const path of fontPaths) expect(path).toMatch(base === proxied ? /^\/retrogemini\/fonts\// : /^\/fonts\//);
    expect(errors).toEqual([]);
    expect(await violations()).toEqual([]);
  });
}

test('a native facilitator and proxy participant share a live retrospective', async ({ browser }) => {
  const facilitatorContext = await browser.newContext({ locale: 'en-US' });
  const participantContext = await browser.newContext({ locale: 'en-US' });
  try {
    const facilitator = await facilitatorContext.newPage();
    const participant = await participantContext.newPage();
    const team = `Dual URL ${Date.now()}`;
    await facilitator.goto(native + '/');
    await facilitator.getByRole('button', { name: '+ New Team' }).click();
    await facilitator.getByPlaceholder('e.g. Design Team').fill(team);
    await facilitator.locator('input[type="password"]').fill('dual-url-fixture-password');
    await facilitator.getByLabel('Recovery Email').fill('fixture@example.com');
    await facilitator.getByRole('button', { name: 'Create & Join' }).click();
    await expect(facilitator.getByText(`${team} Dashboard`)).toBeVisible();
    await dismissAnnouncementsIfPresent(facilitator);
    await facilitator.getByRole('button', { name: 'New Retrospective' }).click();
    await facilitator.getByText('Start, Stop, Continue', { exact: true }).first().click();
    await expect(facilitator.getByRole('heading', { name: 'Icebreaker' })).toBeVisible();
    await facilitator.locator('button[title="Invite / Join"]').click();
    await facilitator.getByRole('button', { name: 'CODE & LINK' }).click();
    const invitation = facilitator.locator('code').first();
    await expect(invitation).toContainText('?join=');
    const url = new URL((await invitation.textContent())!);
    await facilitator.getByRole('button', { name: 'Done' }).click();
    await participant.goto(proxied + '/' + url.search);
    await expect(participant.getByText(`Join ${team}`, { exact: false }).first()).toBeVisible();
    await participant.getByPlaceholder('e.g. John Doe').fill('Proxy Participant');
    await participant.getByRole('button', { name: 'Join Retrospective' }).click();
    await expect(participant.getByRole('heading', { name: 'Icebreaker' })).toBeVisible();
    await expect(participant).toHaveURL(/\/retrogemini\/session\//);
    await expect(facilitator.getByText('Proxy Participant', { exact: true }).first()).toBeVisible();
    const question = `Both public URLs ${Date.now()}`;
    await facilitator.getByPlaceholder('Type or generate a question...').fill(question);
    await expect(participant.getByText(question, { exact: true })).toBeVisible();
    await participant.reload();
    await expect(participant.getByRole('heading', { name: 'Icebreaker' })).toBeVisible();
    await expect(participant).toHaveURL(/\/retrogemini\/session\//);
    await expect(participant.getByText(question, { exact: true })).toBeVisible();
  } finally {
    await facilitatorContext.close();
    await participantContext.close();
  }
});
