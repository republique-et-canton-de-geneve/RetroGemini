import { test, expect } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';
import { grainyPng } from './helpers/images';

/**
 * A feedback carries its images inline in one JSON body, and the server
 * refuses a JSON body over 1 MiB. One ordinary screenshot used to be enough:
 * the server answered 413, and the form, which had already cleared itself,
 * lost the feedback and what was typed. The browser now reduces each image
 * (canvas, WebP) before attaching it — which jsdom cannot run, so this is the
 * test that proves a large image really arrives.
 */

const TEAM_PASSWORD = 'feedbackimages123';

const openFeedbackForm = async (page: import('@playwright/test').Page, teamName: string) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByLabel('Team Name').fill(teamName);
  await page.getByLabel('Create Password').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByText(`${teamName} Dashboard`)).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
  await page.getByRole('button', { name: 'Feedback Hub' }).click();
  await page.getByRole('button', { name: /New Feedback/i }).click();
};

test('a feedback with a screenshot-sized image arrives, image included', async ({ page }) => {
  const teamName = `Feedback-Images-${Date.now()}`;
  await openFeedbackForm(page, teamName);

  const png = grainyPng(2400, 1500);
  // Larger than the whole JSON body the server accepts.
  expect(png.length).toBeGreaterThan(1024 * 1024);

  // The board lists every team's feedbacks, so a retry, or a local store kept
  // between runs, holds other cards with the same image: find this one by its
  // own title.
  const title = `Export button broken ${Date.now()}`;
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Description').fill('Screenshot attached.');
  await page.getByLabel(/^Images/).setInputFiles({ name: 'screenshot.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByRole('img', { name: 'Upload 1' })).toBeVisible({ timeout: 15_000 });

  const created = page.waitForResponse((response) => response.url().endsWith('/api/feedbacks/create'));
  await page.getByRole('button', { name: 'Submit' }).click();
  expect((await created).status()).toBe(200);

  const card = page.locator('[data-feedback-id]').filter({ hasText: title });
  await expect(card).toHaveCount(1, { timeout: 10_000 });
  const attached = card.getByRole('img', { name: 'Attached image 1' });
  await expect(attached).toBeVisible({ timeout: 10_000 });
  const src = await attached.getAttribute('src');
  expect(src).toMatch(/^data:image\/(webp|jpeg);base64,/);
  expect(src!.length).toBeLessThanOrEqual(300_000);
});

test('a feedback the server refuses keeps its draft and says why', async ({ page }) => {
  const teamName = `Feedback-Refused-${Date.now()}`;
  await openFeedbackForm(page, teamName);
  await page.route('**/api/feedbacks/create', (route) => route.fulfill({ status: 413, body: 'Payload Too Large' }));

  await page.getByLabel('Title').fill('Kept on refusal');
  await page.getByLabel('Description').fill('This text must survive.');
  await page.getByRole('button', { name: 'Submit' }).click();

  await expect(page.getByRole('alert')).toContainText('its images are too large');
  await expect(page.getByLabel('Title')).toHaveValue('Kept on refusal');
  await expect(page.getByLabel('Description')).toHaveValue('This text must survive.');
});
