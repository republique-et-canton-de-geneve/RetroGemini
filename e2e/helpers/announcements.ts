import { expect, type Locator, type Page } from '@playwright/test';

/**
 * Dismiss the "What's New" modal if this page shows one.
 *
 * Every spec used to carry its own copy of this, and five of the six copies were
 * subtly broken: they asked `announcementHeading.isVisible({ timeout })` and
 * returned early when it answered `false`. `isVisible()` does **not** wait — the
 * timeout it accepts changes nothing — so on a cold start, where the modal only
 * appears once `/api/version` resolves, the helper returned before the modal was
 * there. The modal then rendered its full-screen backdrop over the dashboard and
 * swallowed every subsequent click until the 6-minute test timeout, with a
 * failure that pointed at whatever button was clicked next rather than at the
 * modal. That is what made `retro-full-flow` fail intermittently.
 *
 * The fix is to wait for the version check to *settle* instead of guessing.
 * `App.tsx` renders both the modal and the header "What's New" button under the
 * same `versionInfo` condition, so whichever appears first proves the fetch came
 * back: if it is the modal, dismiss it; if it is only the header button, there was
 * nothing unread.
 *
 * "Got it!" is the deliberate choice over "Later" and the close cross: it marks
 * the announcements as read, so the modal does not come back after a reload (a
 * spec such as `team-favorites` reloads the page mid-test).
 *
 * `timeout` bounds only the wait for the version check to settle, so there is
 * little reason to shorten it: on a facilitator dashboard the header button is
 * always there once the fetch returns, which means the "nothing unread" path
 * already costs about two seconds rather than the full budget. Two call sites
 * used to pass `2_000` for exactly that speed-up and were, on a cold start,
 * capable of giving up before the version fetch had even answered.
 */
export const dismissAnnouncementsIfPresent = async (page: Page, timeout = 20_000) => {
  const gotIt = page.getByRole('button', { name: 'Got it!' });
  const versionLoaded = page.getByRole('button', { name: "What's New" });

  const appeared = (locator: Locator, ms: number) =>
    locator.waitFor({ state: 'visible', timeout: ms }).then(() => true, () => false);

  const settled = await Promise.race([
    appeared(gotIt, timeout),
    appeared(versionLoaded, timeout),
  ]);

  // No version data at all, or a participant view — the header button and the
  // auto-opened modal are both facilitator-only.
  if (!settled) return;

  // The modal opens from an effect, so it can land a commit behind the header
  // button; a short bounded wait covers that gap without reintroducing a guess.
  if (!(await appeared(gotIt, 2_000))) return;

  await gotIt.click();
  await expect(gotIt).toHaveCount(0);
};
