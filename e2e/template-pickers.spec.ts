import { test, expect, Page } from '@playwright/test';
import { dismissAnnouncementsIfPresent } from './helpers/announcements';

/**
 * The column icon and colour pickers of the two template editors (New
 * Retrospective → Create Custom Template, and Settings → Create Retro
 * Template) fit a phone. The icon picker was a fixed 600px popover beside its
 * button: in a dialog about 310px wide on a 390px phone it ran past the
 * dialog, which scrolled sideways, and its close button was out of view
 * (WCAG 1.4.10). Each picker now takes at most the width of its column's row,
 * and the icon grid lays out as many columns as fit, ten on a computer.
 *
 * jsdom lays nothing out, so only a browser can hold this.
 */

const TEAM_PASSWORD = 'templatepickers123';

const createTeam = async (page: Page) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.getByRole('button', { name: '+ New Team' }).click();
  await page.getByPlaceholder('e.g. Design Team').fill(`Template-Pickers-${Date.now()}`);
  await page.locator('input[type="password"]').fill(TEAM_PASSWORD);
  await page.getByLabel('Recovery Email').fill('facilitator@example.com');
  await page.getByRole('button', { name: 'Create & Join' }).click();
  await expect(page.getByRole('heading', { name: /Dashboard$/ })).toBeVisible({ timeout: 10_000 });
  await dismissAnnouncementsIfPresent(page);
};

/** Where an open picker lies, found by its close button, against its dialog and the screen. */
const measure = (page: Page, closeName: string) =>
  page.evaluate((closeName) => {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const close = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.getAttribute('aria-label') === closeName)!;
    const picker = close.closest<HTMLElement>('.absolute')!;
    const box = (element: Element) => element.getBoundingClientRect();
    const d = box(dialog);
    const p = box(picker);
    const c = box(close);
    // The icon tiles and the colour swatches: the buttons that say whether they are chosen.
    const options = [...picker.querySelectorAll<HTMLElement>('button[aria-pressed]')];
    const firstTop = options.length ? box(options[0]).top : 0;
    return {
      dialogOverflow: dialog.scrollWidth - dialog.clientWidth,
      pageOverflow: document.documentElement.scrollWidth - width,
      pickerInDialog: p.left >= d.left - 0.5 && p.right <= d.right + 0.5,
      closeInView: c.width > 0 && c.left >= Math.max(0, d.left) - 0.5 && c.right <= Math.min(width, d.right) + 0.5 && c.top >= 0 && c.bottom <= height + 0.5,
      options: options.length,
      perRow: options.filter((option) => Math.abs(box(option).top - firstTop) < 1).length,
      optionsInPicker: options.every((option) => {
        const r = box(option);
        return r.left >= p.left - 0.5 && r.right <= p.right + 0.5;
      }),
    };
  }, closeName);

const assertPickersFit = async (page: Page, where: string, width: number) => {
  const dialog = page.getByRole('dialog');

  await dialog.getByRole('button', { name: 'Pick icon for column 1' }).click();
  await expect(dialog.getByRole('button', { name: 'Close the icon picker' })).toBeVisible();
  const icons = await measure(page, 'Close the icon picker');
  const at = `${where} at ${width}px`;
  expect(icons.options, `icon tiles drawn, ${at}`).toBeGreaterThan(100);
  expect(icons.dialogOverflow, `dialog overflow with the icon picker open, ${at}`).toBe(0);
  expect(icons.pageOverflow, `page overflow with the icon picker open, ${at}`).toBeLessThanOrEqual(0);
  expect(icons.pickerInDialog, `icon picker inside its dialog, ${at}`).toBe(true);
  expect(icons.closeInView, `icon picker's close button in view, ${at}`).toBe(true);
  expect(icons.optionsInPicker, `icon tiles inside the picker, ${at}`).toBe(true);
  if (width < 640) expect(icons.perRow, `fewer icon columns on a phone, ${at}`).toBeLessThan(10);
  else expect(icons.perRow, `ten icon columns on a computer, ${at}`).toBe(10);
  await dialog.getByRole('button', { name: 'Close the icon picker' }).click();
  await expect(dialog.getByRole('button', { name: 'Close the icon picker' })).toHaveCount(0);

  await dialog.getByRole('button', { name: 'Pick colour for column 1' }).click();
  await expect(dialog.getByRole('button', { name: 'Close the colour picker' })).toBeVisible();
  const colours = await measure(page, 'Close the colour picker');
  expect(colours.options, `colour swatches drawn, ${at}`).toBe(17);
  expect(colours.dialogOverflow, `dialog overflow with the colour picker open, ${at}`).toBe(0);
  expect(colours.pageOverflow, `page overflow with the colour picker open, ${at}`).toBeLessThanOrEqual(0);
  expect(colours.pickerInDialog, `colour picker inside its dialog, ${at}`).toBe(true);
  expect(colours.closeInView, `colour picker's close button in view, ${at}`).toBe(true);
  expect(colours.optionsInPicker, `colour swatches inside the picker, ${at}`).toBe(true);
  await dialog.getByRole('button', { name: 'Close the colour picker' }).click();
  await expect(dialog.getByRole('button', { name: 'Close the colour picker' })).toHaveCount(0);
};

// Pure CSS: neither editor reads the window's width when it renders, so each
// is opened once and measured at every width.
const WIDTHS = [320, 390, 1280];

test('the template editors\' column pickers fit a phone and keep ten icon columns on a computer', async ({ page }) => {
  await createTeam(page);

  await page.getByRole('button', { name: 'New Retrospective' }).click();
  await page.getByRole('button', { name: 'Create Custom Template' }).click();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await assertPickersFit(page, 'Create Custom Template', width);
  }
  await page.getByRole('button', { name: 'Close new retrospective dialog' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);

  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Create Retro Template' }).click();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 844 });
    await assertPickersFit(page, 'Create Retro Template', width);
  }
});
