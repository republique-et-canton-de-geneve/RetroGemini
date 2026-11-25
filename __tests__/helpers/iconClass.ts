/**
 * Whether an element draws the icon font, read from its `className` as the
 * source writes it: the font's class written out, or one of the look's icon
 * recipes, which are all named `…ICON…` (`TAB_ICON`, `SETTING_ICON`,
 * `ADMIN_SUBTITLE_ICON`, `CHIP_ICON_CLASS`, `BANNER_ICON_CLASS`).
 *
 * Two guards read icons from the source with this one rule:
 * `__tests__/iconButtonNames.test.tsx` (a ligature is not a button's name) and
 * `e2e-prod/icon-ligatures.spec.ts` (every name drawn is a glyph of the font).
 * The spec once looked for the class written out only, and never measured
 * the names the recipes draw.
 */
export const ICON_FONT_CLASS = 'material-symbols-outlined';

const ICON_RECIPE = /\b[A-Z0-9_]*ICON[A-Z0-9_]*\b/;

export const drawsIconFont = (classNameSource: string): boolean =>
  classNameSource.includes(ICON_FONT_CLASS) || ICON_RECIPE.test(classNameSource);
