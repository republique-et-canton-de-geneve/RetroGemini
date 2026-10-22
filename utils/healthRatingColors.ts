/**
 * The 1-to-5 rating badges of the Dashboard's health-check score tooltip.
 *
 * The digits were white on every rating, which measured 1.94:1 on
 * emerald-400 and 3.65:1 on emerald-600. Each badge's text is now the better
 * of black and white on its background (`bestTextColorOn`'s rule), which is
 * black on all five. `__tests__/participantColors.test.ts` measures each pair
 * from Tailwind's `theme.css` with axe-core's engine, the way the e2e audit
 * measures it. Ratios as of Tailwind 4.3.3.
 *
 * A rating is not a person's colour, so it lives apart from
 * `participantColors.ts`.
 */

export type HealthRating = 1 | 2 | 3 | 4 | 5;

export const HEALTH_RATING_BADGE: Readonly<Record<HealthRating, { bg: string; text: 'text-black' | 'text-white' }>> = {
  5: { bg: 'bg-emerald-600', text: 'text-black' }, // 5.75 (white 3.65)
  4: { bg: 'bg-emerald-400', text: 'text-black' }, // 10.83 (white 1.94)
  3: { bg: 'bg-amber-500', text: 'text-black' }, // 9.79 (white 2.15)
  2: { bg: 'bg-orange-500', text: 'text-black' }, // 7.27 (white 2.89)
  1: { bg: 'bg-rose-600', text: 'text-black' }, // 4.66 (white 4.51)
};
