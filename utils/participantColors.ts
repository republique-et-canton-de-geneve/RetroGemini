/**
 * A participant's colour is **data**: a Tailwind class stored on `User.color`,
 * written by the team record and by each participant's own client into the
 * session blob. The stored class never changes (older clients and pods read
 * it, and the server keeps its own copy of the palette); what it is drawn in
 * does. Since 45.0 each stored class names a *tone* of the same hue — a pastel
 * body, a dark ink, a brighter accent — defined as `person-*` tokens in
 * `index.css`, and this module is the only way from one to the other. As a
 * class it reaches the screen only through here — guarded by
 * `__tests__/avatarColorSource.test.ts` — for two reasons.
 *
 * - **Contrast.** The initials are the ink on the body of one tone, and the
 *   dots are the ink alone. `__tests__/participantColors.test.ts` measures
 *   every pair from the tokens the build paints (Tailwind's `theme.css`, then
 *   `index.css`) with axe-core's engine — the initials at 4.5:1, the dots at
 *   3:1 on white and on the reader's own row — so a token that moves fails the
 *   build rather than the audit.
 * - **Containment.** A stored string is never interpolated into `className`.
 *   Any participant can write any participant's `color` into the session blob,
 *   and a value such as `fixed inset-0 z-50` used to land on every screen. A
 *   value this release does not know renders in the neutral tone.
 *
 * One other reader, on purpose (design A6): `Session.tsx`'s
 * `TAILWIND_COLOR_MAP` also reads it, as a lookup key for the colour-by-author
 * card background, painted as a hex `style`. An unknown key gives the default
 * card. `participantToneHex` hands the same tones out as hex for that card.
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

/** The hue of each stored class, which names its tone in `index.css`. */
const HUE: Readonly<Record<ParticipantColorClass, string>> = {
  'bg-indigo-500': 'indigo',
  'bg-emerald-500': 'emerald',
  'bg-amber-500': 'amber',
  'bg-rose-500': 'rose',
  'bg-cyan-500': 'cyan',
  'bg-fuchsia-500': 'fuchsia',
  'bg-lime-500': 'lime',
  // Drawn as peach so that it is not taken for rose (see index.css).
  'bg-pink-500': 'pink',
};

const NEUTRAL_HUE = 'neutral';

export interface ParticipantTone {
  /** The pastel body: an avatar's background, a colour-by-author card. */
  bg: string;
  /** The dark ink of the same hue: initials, dots, outlines. */
  ink: string;
  /** The brighter accent of an avatar picture. */
  pop: string;
}

/**
 * The `person-*` tokens of `index.css`, as hex, for what is painted with a
 * `style` rather than a class. The test reads index.css and compares every
 * value, so the two cannot drift.
 */
const TONE_HEX: Readonly<Record<string, ParticipantTone>> = {
  indigo: { bg: '#cfcaff', ink: '#3a2fc0', pop: '#8b7dfa' },
  emerald: { bg: '#b4ebd0', ink: '#0b6444', pop: '#34c38f' },
  amber: { bg: '#ffdb94', ink: '#864600', pop: '#ffa928' },
  rose: { bg: '#ffc4ce', ink: '#a31936', pop: '#ff6b86' },
  cyan: { bg: '#aee6f2', ink: '#0a5c74', pop: '#2fb9d6' },
  fuchsia: { bg: '#ddc6ff', ink: '#6526bf', pop: '#a974f8' },
  lime: { bg: '#cfe99a', ink: '#445f09', pop: '#8fc42b' },
  pink: { bg: '#ffcbad', ink: '#953a05', pop: '#ff8b4f' },
  neutral: { bg: '#dde0ea', ink: '#3c415a', pop: '#858aa2' },
};

export const isParticipantColor = (value: unknown): value is ParticipantColorClass =>
  typeof value === 'string' && (PARTICIPANT_PALETTE as readonly string[]).includes(value);

const hueOf = (color: string | null | undefined): string => (isParticipantColor(color) ? HUE[color] : NEUTRAL_HUE);

/**
 * The three classes of an avatar: the tone (`--av-bg`, `--av-ink`, `--av-pop`
 * for a picture), then the body and the ink, which are what the contrast
 * helper measures. Every literal is written out whole so that Tailwind's
 * scanner generates it.
 */
const AVATAR_CLASSES: Readonly<Record<string, string>> = {
  indigo: 'tone-indigo bg-person-indigo text-person-indigo-ink',
  emerald: 'tone-emerald bg-person-emerald text-person-emerald-ink',
  amber: 'tone-amber bg-person-amber text-person-amber-ink',
  rose: 'tone-rose bg-person-rose text-person-rose-ink',
  cyan: 'tone-cyan bg-person-cyan text-person-cyan-ink',
  fuchsia: 'tone-fuchsia bg-person-fuchsia text-person-fuchsia-ink',
  lime: 'tone-lime bg-person-lime text-person-lime-ink',
  pink: 'tone-pink bg-person-pink text-person-pink-ink',
  neutral: 'tone-neutral bg-person-neutral text-person-neutral-ink',
};

/** The ink alone, for the non-text dots: the one colour of a tone that reaches 3:1 on white and on the reader's row. */
const DOT_CLASSES: Readonly<Record<string, string>> = {
  indigo: 'bg-person-indigo-ink',
  emerald: 'bg-person-emerald-ink',
  amber: 'bg-person-amber-ink',
  rose: 'bg-person-rose-ink',
  cyan: 'bg-person-cyan-ink',
  fuchsia: 'bg-person-fuchsia-ink',
  lime: 'bg-person-lime-ink',
  pink: 'bg-person-pink-ink',
  neutral: 'bg-person-neutral-ink',
};

/** A colour this release does not know, or none: the neutral tone. */
export const NEUTRAL_AVATAR_CLASSES = AVATAR_CLASSES[NEUTRAL_HUE];

/**
 * A participant the facilitator marked as departed: the neutral tone, never
 * faded. The row's "Left the session" chip says why; fading the avatar put its
 * initials below the floor on every colour.
 */
export const DEPARTED_AVATAR_CLASSES = NEUTRAL_AVATAR_CLASSES;

/** The background class for a stored colour, for non-text marks (dots): the tone's ink, neutral for anything unknown. */
export const participantColorClass = (color: string | null | undefined): string => DOT_CLASSES[hueOf(color)];

/**
 * The classes of an avatar's disc and initials, handed to `<Avatar>`. Nothing
 * adds another text colour, opacity or filter: Tailwind's stylesheet order,
 * not class order, decides which text colour wins, and neither opacity nor a
 * filter is measured.
 */
export const avatarColorClasses = (color: string | null | undefined): string => AVATAR_CLASSES[hueOf(color)];

/** A stored colour's tone as hex (the neutral tone for anything unknown), for a surface painted with a `style`. */
export const participantToneHex = (color: string | null | undefined): ParticipantTone => ({ ...TONE_HEX[hueOf(color)] });
