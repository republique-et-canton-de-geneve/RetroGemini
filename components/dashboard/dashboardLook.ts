/**
 * The Clarté recipes of the Dashboard and the Feedback Hub, written once so
 * that every tab, card and dialog of these screens draws a button, a field or
 * a chip the same way. Whole class strings, so Tailwind's scanner reads them
 * here; a call site adds its own size and spacing beside one.
 *
 * Each colour pair below is measured by `__tests__/dashboardLook.test.tsx`
 * (text 4.5:1, the edge of a field or a switch 3:1), the disabled states
 * included: they are drawn in colours of their own rather than faded with
 * `opacity`, which no contrast check can read.
 */

/** The main action of a tab or a dialog: one per screen area. */
export const PRIMARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 btn-brand-glow enabled:active:bg-indigo-800 transition disabled:bg-slate-200 disabled:text-slate-600 disabled:shadow-none disabled:cursor-not-allowed';

/** A second action beside the primary one. */
export const SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-slate-700 font-semibold hover:border-slate-300 hover:bg-slate-50 transition disabled:bg-slate-100 disabled:text-slate-600 disabled:cursor-not-allowed';

/** The secondary button of a destructive action (Delete Team, beside the primary of the page). */
export const DANGER_SECONDARY_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white text-rose-700 font-semibold hover:border-rose-200 hover:bg-rose-50 transition';

/** A destructive action that is the point of its dialog (delete, archive). */
export const DANGER_BUTTON =
  'inline-flex items-center justify-center gap-2 rounded-lg bg-rose-700 text-white font-semibold hover:bg-rose-800 enabled:active:bg-rose-900 transition disabled:bg-slate-200 disabled:text-slate-600 disabled:cursor-not-allowed';

/** A quiet text button (Back, Cancel beside a primary). */
export const GHOST_BUTTON =
  'inline-flex items-center justify-center gap-1.5 rounded-lg text-slate-600 font-semibold hover:bg-slate-100 hover:text-slate-900 transition';

/** An icon-only control in a row: rename, delete, expand. 36px, so it is easy to hit. */
export const ICON_BUTTON =
  'inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition';

/** The same, for a control that removes something. */
export const DANGER_ICON_BUTTON =
  'inline-flex items-center justify-center w-9 h-9 shrink-0 rounded-lg text-slate-600 hover:bg-rose-50 hover:text-rose-700 transition';

/** A text link drawn as a button ("Add Column", "Create Custom Template"). */
export const LINK_BUTTON =
  'inline-flex items-center gap-1 rounded-md text-sm font-semibold text-indigo-700 hover:text-indigo-800 hover:underline';

/**
 * A field: a text field, a textarea, a select. Its border is slate-400, not
 * the lighter hairline of a card: the border is the only thing that shows
 * where the field is, so it clears 3:1 on white (WCAG 1.4.11). The focus ring
 * is the brand's.
 *
 * A field made read-only (its `readonly` attribute: the Feedback Hub's draft
 * while it is sent) takes the page's grey. Never with `read-only:`, which is
 * `:read-only`: it matches every element that cannot be typed in, so every
 * select and every file input drawn with this recipe took the grey at rest.
 */
export const FIELD_BOX =
  'rounded-lg border border-slate-400 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-500 outline-hidden hover:border-slate-500 focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15 transition [&[readonly]]:bg-slate-50';
/** The same, filling its line. */
export const FIELD = `w-full ${FIELD_BOX}`;

/** A template editor's column icon and colour buttons, the same size side by side. */
export const COLUMN_ICON_BUTTON =
  'w-10 h-10 shrink-0 rounded-lg border border-slate-400 bg-white flex items-center justify-center hover:border-indigo-600 hover:bg-indigo-50 transition';
export const COLUMN_COLOR_BUTTON =
  'w-10 h-10 shrink-0 rounded-lg border border-slate-400 shadow-xs hover:shadow-md transition-shadow';

/** A label above a field (the call site gives its margin). */
export const FIELD_LABEL = 'block text-sm font-semibold text-slate-700';

/** A card or panel on the page background. */
export const CARD = 'bg-white border border-slate-200 rounded-xl shadow-xs';

/** A row of a list (a retrospective, a health check): a card whose hover deepens its shadow, never lifts it. */
export const LIST_ROW = 'bg-white border border-slate-200 rounded-xl shadow-xs hover:shadow-md transition-shadow';

/** The veil and the panel of every dialog of these screens (no blur behind). */
export const DIALOG_OVERLAY = 'fixed inset-0 bg-slate-900/45 z-100 flex items-center justify-center p-4';
export const DIALOG_PANEL = 'bg-white rounded-2xl shadow-2xl border border-slate-200 w-full';

/** A dialog's title and its close cross. */
export const DIALOG_TITLE = 'text-xl font-bold text-slate-900 tracking-tight';

/** The title of one setting in the Settings card, and its decorative icon. */
export const SETTING_TITLE = 'font-semibold text-slate-900 mb-1.5 flex items-center gap-2';
export const SETTING_ICON = 'material-symbols-outlined text-slate-500';

/** A small label in capitals above a group of controls. */
export const SECTION_LABEL = 'text-xs font-semibold uppercase tracking-wide text-slate-600';

/** A chip: a status, a type, a score. The colours are the call site's (a 50 or 100 tint and the 700 or 800 ink of one hue). */
export const CHIP = 'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold';

/**
 * The colours of a session's status chip in the lists: in progress green, an
 * open board brand, closed neutral. The ink is the 700 of the tint, which
 * clears 4.5:1 at 12px.
 */
export const sessionStatusChip = (status: string): string =>
  status === 'IN_PROGRESS'
    ? 'bg-emerald-50 text-emerald-700'
    : status === 'OPEN_BOARD'
      ? 'bg-indigo-50 text-indigo-700'
      : 'bg-slate-100 text-slate-700';

/** The colours of a feedback's status chip on the Feedback Hub, each a 100 tint and the 800 of its hue. */
export const feedbackStatusChip = (status: 'pending' | 'in_progress' | 'resolved' | 'rejected'): string =>
  ({
    pending: 'bg-amber-100 text-amber-800',
    in_progress: 'bg-sky-100 text-sky-800',
    resolved: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800'
  })[status];

/** The colours of a feedback's type chip: a bug rose, a feature request violet. */
export const feedbackTypeChip = (type: 'bug' | 'feature'): string =>
  type === 'bug' ? 'bg-rose-50 text-rose-700' : 'bg-violet-50 text-violet-700';

/** A filter pill, and the colours of its two states. */
export const FILTER_PILL = 'rounded-full border px-3 py-1.5 text-sm font-semibold transition';
export const FILTER_PILL_ON = 'bg-indigo-50 border-indigo-600 text-indigo-700';
export const FILTER_PILL_OFF = 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 hover:text-slate-900';

/**
 * A two-state switch drawn as a button. Off, its track is slate-400, which
 * clears 3:1 on white: the track is the control. The white knob clears it on
 * both tracks.
 */
export const SWITCH_TRACK = 'w-11 h-6 shrink-0 rounded-full relative transition';
export const SWITCH_ON = 'bg-indigo-600';
export const SWITCH_OFF = 'bg-slate-400';
export const SWITCH_KNOB = 'absolute top-1 left-1 w-4 h-4 rounded-full bg-white shadow-sm transition';

/** A segmented choice (board type, template language): the frame, and its two states. */
export const SEGMENTED = 'inline-flex shrink-0 rounded-lg border border-slate-400 bg-white p-0.5 text-sm font-semibold';
export const SEGMENT_ON = 'rounded-md px-3 py-1 transition bg-indigo-600 text-white';
export const SEGMENT_OFF = 'rounded-md px-3 py-1 transition text-slate-600 hover:bg-slate-100 hover:text-slate-900';

/** An empty list: a dashed frame on the page background, words in slate-600. */
export const EMPTY_STATE = 'rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center text-slate-600';

/** A notice tied to a form: an error, a success. */
export const ERROR_NOTICE = 'rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800';
export const ERROR_TEXT = 'text-xs font-medium text-rose-700 flex items-center';
export const SUCCESS_TEXT = 'text-xs font-medium text-emerald-700 flex items-center';
