/**
 * A participant's colour is **data**: a Tailwind class stored on `User.color`,
 * written by the team record and by each participant's own client into the
 * session blob. It reaches the screen only through this module — guarded by
 * `__tests__/avatarColorSource.test.ts` — for two reasons.
 *
 * - **Contrast.** White initials fail WCAG 1.4.3 on seven of the eight palette
 *   colours (lime at 1.96:1). The initials' colour is chosen per colour by
 *   measured contrast instead, and `__tests__/participantColors.test.ts`
 *   measures every pair from Tailwind's `theme.css` with axe-core's engine, so
 *   a Tailwind bump that moves a colour fails the build rather than the audit.
 * - **Containment.** A stored string is never interpolated into `className`.
 *   Any participant can write any participant's `color` into the session blob,
 *   and a value such as `fixed inset-0 z-50` used to land on every screen. A
 *   value this release does not know renders neutral.
 *
 * A colour an earlier release stored and this palette does not hold (or a
 * later release's new colour, seen by this one during a rolling update) also
 * renders neutral: readable, and grey. Nothing is migrated.
 */

export const PARTICIPANT_PALETTE = [
  'bg-indigo-500',
  'bg-emerald-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-lime-500',
  'bg-pink-500',
] as const;

export type ParticipantColorClass = (typeof PARTICIPANT_PALETTE)[number];

/**
 * The initials' colour on each palette colour: white where white clears 4.5:1,
 * black otherwise. White is kept where it passes because black then gains at
 * most a few hundredths (a background light enough for black to clear 4.5:1
 * is too light for white, and the reverse), and it keeps the facilitator's
 * indigo as it has always looked. Ratios as axe measures them on Tailwind 4.3.3.
 */
const INITIALS_TEXT: Readonly<Record<ParticipantColorClass, 'text-white' | 'text-black'>> = {
  'bg-indigo-500': 'text-white', // 4.58 (black 4.59)
  'bg-emerald-500': 'text-black', // 8.52 (white 2.46)
  'bg-amber-500': 'text-black', // 9.79 (white 2.15)
  'bg-rose-500': 'text-black', // 5.59 (white 3.76)
  'bg-cyan-500': 'text-black', // 8.88 (white 2.36)
  'bg-fuchsia-500': 'text-black', // 5.94 (white 3.53)
  'bg-lime-500': 'text-black', // 10.74 (white 1.96)
  'bg-pink-500': 'text-black', // 5.86 (white 3.58)
};

/** A colour this release does not know, or none: neutral, white initials (7.56:1). */
export const UNKNOWN_PARTICIPANT_COLOR = 'bg-slate-600';
const UNKNOWN_INITIALS_TEXT = 'text-white';

/**
 * A participant the facilitator marked as departed: neutral grey, never faded
 * (8.40:1). The row's "Left the session" chip says why; fading the avatar put
 * its initials below the floor on every colour.
 */
export const DEPARTED_AVATAR_CLASSES = 'bg-slate-200 text-slate-700';

export const isParticipantColor = (value: unknown): value is ParticipantColorClass =>
  typeof value === 'string' && (PARTICIPANT_PALETTE as readonly string[]).includes(value);

/** The background class for a stored colour, for non-text marks (dots): a palette class as is, anything else neutral. */
export const participantColorClass = (color: string | null | undefined): string =>
  isParticipantColor(color) ? color : UNKNOWN_PARTICIPANT_COLOR;

/**
 * `bg-… text-…` for an avatar's initials. The call site adds no other text
 * colour, opacity or filter: Tailwind's stylesheet order, not class order,
 * decides which text colour wins, and neither opacity nor a filter is measured.
 */
export const avatarColorClasses = (color: string | null | undefined): string =>
  isParticipantColor(color)
    ? `${color} ${INITIALS_TEXT[color]}`
    : `${UNKNOWN_PARTICIPANT_COLOR} ${UNKNOWN_INITIALS_TEXT}`;
