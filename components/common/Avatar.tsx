import React from 'react';
import AvatarArt from './avatars/AvatarArt';
import type { AvatarArtId } from './avatars/avatarArt';
import { toAvatarId } from '../../utils/avatars.js';

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
 * - A chosen picture (`avatarId`) is drawn in place of the initials when it
 *   names one this release draws (`toAvatarId`); anything else draws the
 *   initials. The picture brings its own outline, so the disc's background
 *   goes and only the `tone-*` class stays, for the picture's colours. Which
 *   id a session shows is `components/session/sessionAvatars.ts`'s decision.
 */

/** The sizes the screens use, in CSS pixels: a closed list, so a new one is a decision here. */
export type AvatarSize = 20 | 24 | 28 | 32 | 36 | 40 | 64;

/**
 * Box and initials per size. Each keeps the text size the screens already
 * drew at that size (nothing shrinks), and 12px at least from 28 up. Written
 * out whole so that Tailwind's scanner generates every class.
 */
const BOX_CLASSES: Readonly<Record<AvatarSize, string>> = {
  20: 'w-5 h-5',
  24: 'w-6 h-6',
  28: 'w-7 h-7',
  32: 'w-8 h-8',
  36: 'w-9 h-9',
  40: 'w-10 h-10',
  // The picker's own avatar, at the top of the dialog.
  64: 'w-16 h-16',
};
const TEXT_CLASSES: Readonly<Record<AvatarSize, string>> = {
  20: 'text-[9px]',
  24: 'text-[10px]',
  28: 'text-xs',
  32: 'text-xs',
  36: 'text-sm',
  40: 'text-base',
  64: 'text-2xl',
};

/** The tone class among `colorClasses`: what a picture reads its colours from. */
const toneOf = (colorClasses: string): string =>
  colorClasses.split(/\s+/).find((token) => /^tone-[a-z]+$/.test(token)) ?? 'tone-neutral';

interface AvatarProps {
  /** What `avatarColorClasses` or `DEPARTED_AVATAR_CLASSES` returned. */
  colorClasses: string;
  initials: string;
  size: AvatarSize;
  /** The accessible name; without it the avatar is hidden from assistive technology. */
  label?: string;
  /** The picture the person chose, as `sessionAvatarOf` or `memberAvatarId` gave it; data, checked here again. */
  avatarId?: string | null;
}

const Avatar: React.FC<AvatarProps> = ({ colorClasses, initials, size, label, avatarId }) => {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true };
  const picture = toAvatarId(avatarId);
  if (picture) {
    return (
      <span className={`${BOX_CLASSES[size]} shrink-0 flex ${toneOf(colorClasses)}`} data-avatar-art={picture} {...a11y}>
        <AvatarArt id={picture as AvatarArtId} />
      </span>
    );
  }
  return (
    <span
      className={`${BOX_CLASSES[size]} ${TEXT_CLASSES[size]} shrink-0 rounded-full flex items-center justify-center font-bold uppercase ${colorClasses}`}
      {...a11y}
    >
      {initials}
    </span>
  );
};

export default Avatar;
