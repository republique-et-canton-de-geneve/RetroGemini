import React from 'react';
import type { User } from '../../types';
import Avatar from '../common/Avatar';
import { avatarColorClasses } from '../../utils/participantColors';
import { toAvatarId } from '../../utils/avatars.js';
import { useTranslation } from '../../i18n/I18nContext';
import { viewerInitials } from './sessionAvatars';

interface Props {
  user: User;
  /** What the screen resolved for the viewer: `sessionAvatarOf` in a session, `memberAvatarId` outside. */
  avatarId: string | null;
  onClick: () => void;
  /** Where the button shows (the headers hide it on narrow screens for a facilitator). */
  visibilityClass?: string;
  /** True while the one-time avatar hint shows under the header: the button carries a dot. */
  marked?: boolean;
  /** The button, for the hint to focus it before it opens the picker (the picker gives the focus back to it). */
  ref?: React.Ref<HTMLButtonElement>;
}

/**
 * The viewer's own avatar, as the button that opens the avatar picker
 * (AGENTS.md, *Avatars*), in both session headers and the dashboard's top bar. The
 * avatar inside is decoration: the button is named "<name>, choose my
 * avatar", led by the initials while they are what it shows, since a name
 * must hold the words a voice-control user can see (WCAG 2.5.3).
 * `data-viewer-avatar` is what the header-fit e2e measures.
 *
 * While the one-time avatar hint shows (`AvatarDiscoveryHint`), a still dot
 * of the brand sits on its corner: drawn out of the flow (the button is
 * `relative` in every state, so marking it moves nothing) and hidden from
 * assistive technology, since the band itself is read and the button's name
 * does not change.
 */
const ViewerAvatarButton: React.FC<Props> = ({ user, avatarId, onClick, visibilityClass = 'flex', marked = false, ref }) => {
  const { t } = useTranslation();
  const initials = viewerInitials(user);
  const label = toAvatarId(avatarId)
    ? t('avatars.picker.open', { name: user.name })
    : t('avatars.picker.openWithInitials', { initials, name: user.name });
  return (
    <button
      ref={ref}
      type="button"
      data-viewer-avatar
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      className={`${visibilityClass} relative shrink-0 items-center justify-center rounded-full transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600`}
    >
      <Avatar colorClasses={avatarColorClasses(user.color)} initials={initials} size={32} avatarId={avatarId} />
      {marked && (
        <span
          aria-hidden="true"
          data-avatar-hint-dot
          className="absolute -top-0.5 -right-0.5 size-2.5 rounded-full bg-indigo-600 ring-2 ring-white"
        />
      )}
    </button>
  );
};

export default ViewerAvatarButton;
