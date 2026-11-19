/**
 * What the administration console draws beyond the dashboard's recipes
 * (`components/dashboard/dashboardLook.ts`, which the console imports for
 * every button, field, chip and card): the title of a settings card, and its
 * two-state switches. Whole class strings, so Tailwind's scanner reads them.
 * The pairs are measured by `__tests__/superAdminConsoleLook.test.tsx`.
 */
import { SWITCH_OFF, SWITCH_ON } from '../dashboard/dashboardLook';

/** The title of a settings card above the tabs, and of a tab's own card. */
export const ADMIN_CARD_TITLE = 'text-lg font-bold tracking-tight text-slate-900 flex items-center gap-2';

/** The title of one setting inside a card (a switch's line), and its icon. */
export const ADMIN_SETTING_TITLE = 'text-sm font-semibold text-slate-900 flex items-center gap-2';
export const ADMIN_SUBTITLE_ICON = 'material-symbols-outlined text-slate-500 text-lg! leading-none';

/** A header cell of a console table, on the table's slate-50 head. */
export const TEAM_HEADER_CELL = 'px-4 py-3 text-sm font-semibold text-slate-700 whitespace-nowrap';

/** The size of a button in a table row, beside a recipe (the console stays dense). */
export const ROW_BUTTON_SIZE = 'px-2.5 py-1 text-sm';

/** A tab's icon, and the count a tab carries (the colours are the call site's, a solid 700 with white or a 200 tint with the 700 ink). */
export const TAB_ICON = 'material-symbols-outlined text-xl! leading-none';
export const TAB_COUNT = 'rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums';

/**
 * A switch drawn as a button. On, the brand colour; off, slate-400, which
 * clears 3:1 on white since the track is the control. A switch that cannot be
 * used yet (no admin email) is drawn lighter in colours of its own, never
 * faded with opacity, which no contrast check can read.
 */
export const adminSwitchTrack = (on: boolean): string =>
  `relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:cursor-not-allowed focus:outline-hidden focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2 ${
    on ? `${SWITCH_ON} disabled:bg-indigo-300` : `${SWITCH_OFF} disabled:bg-slate-300`
  }`;

export const adminSwitchKnob = (on: boolean): string =>
  `inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${on ? 'translate-x-6' : 'translate-x-1'}`;
