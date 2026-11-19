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
}

/**
 * The viewer's own avatar, as the button that opens the avatar picker
 * (decision D10), in both session headers and the dashboard's top bar. The
 * avatar inside is decoration: the button is named "<name>, choose my
 * avatar", led by the initials while they are what it shows, since a name
 * must hold the words a voice-control user can see (WCAG 2.5.3).
 * `data-viewer-avatar` is what the header-fit e2e measures.
 */
const ViewerAvatarButton: React.FC<Props> = ({ user, avatarId, onClick, visibilityClass = 'flex' }) => {
  const { t } = useTranslation();
  const initials = viewerInitials(user);
  const label = toAvatarId(avatarId)
    ? t('avatars.picker.open', { name: user.name })
    : t('avatars.picker.openWithInitials', { initials, name: user.name });
  return (
    <button
      type="button"
      data-viewer-avatar
      onClick={onClick}
      aria-haspopup="dialog"
      aria-label={label}
      title={label}
      className={`${visibilityClass} shrink-0 items-center justify-center rounded-full transition-shadow hover:shadow-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600`}
    >
      <Avatar colorClasses={avatarColorClasses(user.color)} initials={initials} size={32} avatarId={avatarId} />
    </button>
  );
};

export default ViewerAvatarButton;
