import React from 'react';

/**
 * The one component that draws a person: a disc in their tone with their
 * initials. Every screen that shows a person goes through it, so a person
 * looks the same everywhere and the rules below hold in one place.
 *
 * - The colours come in as `colorClasses`, the string
 *   `utils/participantColors.ts` returned (`avatarColorClasses(user.color)` or
 *   `DEPARTED_AVATAR_CLASSES`). The call site calls the module, so
 *   `__tests__/avatarColorSource.test.ts` still sees every read of `.color`.
 * - There is no free `className`: an added text colour, opacity or filter is
 *   exactly what the contrast tests cannot measure. Position, margins, rings
 *   and responsive visibility belong to a wrapper at the call site.
 * - Without a `label` the avatar is decoration (a name is written beside it);
 *   with one it is an image named by it, for where it is the only sign of who
 *   it is.
 *
 * A chosen avatar picture will be drawn here too, from an id prop beside
 * `initials`; nothing else changes for the call sites.
 */

/** The sizes the screens use, in CSS pixels: a closed list, so a new one is a decision here. */
export type AvatarSize = 20 | 24 | 28 | 32 | 36 | 40;

/**
 * Box and initials per size. Each keeps the text size the screens already
 * drew at that size (nothing shrinks), and 12px at least from 28 up. Written
 * out whole so that Tailwind's scanner generates every class.
 */
const SIZE_CLASSES: Readonly<Record<AvatarSize, string>> = {
  20: 'w-5 h-5 text-[9px]',
  24: 'w-6 h-6 text-[10px]',
  28: 'w-7 h-7 text-xs',
  32: 'w-8 h-8 text-xs',
  36: 'w-9 h-9 text-sm',
  40: 'w-10 h-10 text-base',
};

interface AvatarProps {
  /** What `avatarColorClasses` or `DEPARTED_AVATAR_CLASSES` returned. */
  colorClasses: string;
  initials: string;
  size: AvatarSize;
  /** The accessible name; without it the avatar is hidden from assistive technology. */
  label?: string;
}

const Avatar: React.FC<AvatarProps> = ({ colorClasses, initials, size, label }) => (
  <span
    className={`${SIZE_CLASSES[size]} shrink-0 rounded-full flex items-center justify-center font-bold uppercase ${colorClasses}`}
    {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
  >
    {initials}
  </span>
);

export default Avatar;
