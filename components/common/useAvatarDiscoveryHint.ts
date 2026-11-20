import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { hasSeenUser, rememberSeenUser } from './seenOnce';

/**
 * Where each browser remembers who has had the avatar hint: a JSON array of
 * member ids, through the one-time notes' shared seen list
 * (`components/common/seenOnce.ts`: the fifty most recent, and a storage that
 * fails shows the hint).
 */
export const AVATAR_HINT_STORAGE_KEY = 'retro-avatar-hint-seen';

export interface AvatarHintConditions {
  /** The viewer's member id: the hint is decided, and remembered, per member. */
  userId: string;
  /** The viewer has a stored choice, a cleared one included: they have found the picker. */
  hasChoice: boolean;
  /** The session draws no picture: the hint would promise one nobody sees. */
  anonymous: boolean;
  /** The credential was revoked or the join refused: the picker cannot save. */
  blocked: boolean;
  /** The picker is open, from the hint or from the avatar itself. */
  pickerOpen: boolean;
  openPicker: () => void;
}

export interface AvatarHint {
  /** True while the band shows; the screen marks the opener then. */
  shown: boolean;
  /** The opener: the screen hands it to `ViewerAvatarButton`. */
  openerRef: RefObject<HTMLButtonElement | null>;
  /** "Choose my avatar": remembered, the opener focused, then the picker opened. */
  choose: () => void;
  /** "Got it": remembered, and gone. */
  dismiss: () => void;
}

interface Decision {
  userId: string;
  shown: boolean;
}

/**
 * The one-time avatar hint's rule (AGENTS.md, *Avatars*), for the screen that
 * draws the opener and the band: the dashboard's top bar and both session
 * screens.
 *
 * - **Decided with the screen.** It shows when, at the first render, the
 *   viewer has no choice, the session is not anonymous, the credential is not
 *   blocked, the picker is closed and this member is not on the hint's seen
 *   list. Another member in the same mount is decided afresh, as at a first
 *   render.
 * - **Once gone, gone for the mount.** A choice arriving, the session turning
 *   anonymous, a blocked credential, the picker opening, or "Got it": the band
 *   leaves and nothing brings it back while the screen lasts. Its going moves
 *   what is under it up once, and three of those reasons can come from
 *   outside the screen while people work (a choice made in another browser,
 *   the session made anonymous, a revoked credential); the latch keeps it to
 *   once.
 * - **Remembered** (the member id on the seen list) by its two buttons and
 *   whenever the picker opens, from anywhere. A choice needs no write: it is
 *   the server's, and stops the hint in every browser.
 */
export function useAvatarDiscoveryHint({
  userId,
  hasChoice,
  anonymous,
  blocked,
  pickerOpen,
  openPicker,
}: AvatarHintConditions): AvatarHint {
  const eligible = !hasChoice && !anonymous && !blocked && !pickerOpen;
  const decide = (): Decision => ({ userId, shown: eligible && !hasSeenUser(AVATAR_HINT_STORAGE_KEY, userId) });
  const [decision, setDecision] = useState<Decision>(decide);

  // Adjusted during the render that brings the change (React's pattern for
  // state that follows a prop), so the band never paints for a frame after
  // its reason to show has gone.
  let current = decision;
  if (current.userId !== userId) current = decide();
  if (current.shown && !eligible) current = { userId, shown: false };
  if (current !== decision) setDecision(current);

  // The picker opened, from the band or from the avatar itself: the person
  // has found it.
  useEffect(() => {
    if (pickerOpen) rememberSeenUser(AVATAR_HINT_STORAGE_KEY, userId);
  }, [pickerOpen, userId]);

  const openerRef = useRef<HTMLButtonElement | null>(null);

  const dismiss = useCallback(() => {
    rememberSeenUser(AVATAR_HINT_STORAGE_KEY, userId);
    setDecision({ userId, shown: false });
  }, [userId]);

  const choose = useCallback(() => {
    dismiss();
    // Focused first: the picker gives the focus back to what had it when it
    // opened, and the band's button is gone by the time it closes.
    openerRef.current?.focus();
    openPicker();
  }, [dismiss, openPicker]);

  return { shown: current.shown, openerRef, choose, dismiss };
}
