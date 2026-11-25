import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import ModalDialog from './ModalDialog';
import Avatar from './Avatar';
import { EFFECT_LENGTH_MS, motionAllowed } from './motion/effects';
import {
  AVATAR_FAMILIES,
  AVATAR_FAMILY_LABEL_KEYS,
  AVATAR_FAMILY_PITCH_KEYS,
  AVATAR_NAME_KEYS,
  type AvatarArtId,
  type AvatarFamilyId,
} from './avatars/avatarArt';
import { toAvatarId } from '../../utils/avatars.js';
import { useTranslation } from '../../i18n/I18nContext';
import { noticeFromError, noticeText, type Notice } from '../../i18n/notice';

/**
 * The viewer's own avatar picker: six families as tabs, twenty pictures each
 * and "My initials". It writes through `onPick` and nothing else, so it knows
 * no route and no session; the opener decides where the choice goes.
 *
 * - One write per choice. While one runs the grid is busy and a pick made
 *   meanwhile waits for it (the latest one, if several): two writes racing
 *   could land in either order.
 * - A choice is shown as made only once `onPick` resolved. A failure stays on
 *   screen in words until the next attempt, and the stored choice is the one
 *   selected: the previous one, or the one the opener reported meanwhile. The
 *   failure is kept as what to say (`Notice`) and worded at each render, so
 *   it follows a change of language made while it shows (from another tab:
 *   the dialog is modal). A write that lands while the opener reported
 *   another choice selects the opener's word once the answer is drawn.
 * - The dialog stays open after a choice, so the person can change their mind;
 *   "Done" closes it. ModalDialog gives the focus back to the opener.
 */

export interface AvatarPickerProps {
  open: boolean;
  onClose: () => void;
  /** What `avatarColorClasses` returned for the viewer. */
  colorClasses: string;
  initials: string;
  /** The viewer's name, shown beside the big avatar. */
  name: string;
  /** The stored choice as it is (an id or null); an id this release does not draw reads as initials. */
  currentAvatarId: string | null;
  /** Store a choice (`null` for initials); rejects when it was not stored. */
  onPick: (avatarId: string | null) => Promise<unknown>;
  /** True while a choice cannot be stored (the session reconnects, the credential was revoked). */
  disabled?: boolean;
}

/** One choice: a picture id, or null for initials. */
type Choice = string | null;

const familyOf = (choice: Choice): AvatarFamilyId => {
  const id = toAvatarId(choice);
  return AVATAR_FAMILIES.find((family) => id !== null && (family.avatars as readonly string[]).includes(id))?.id ?? AVATAR_FAMILIES[0].id;
};

// A solid outline, as the phase bar's: a translucent ring measured 1.6:1, and
// forced colours drop a box-shadow but keep an outline.
const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-600';
const TILE_BASE = `grid place-items-center aspect-square min-h-11 p-1.5 rounded-xl border transition-shadow ${FOCUS_RING}`;
const TILE_OFF = 'bg-white border-slate-200 hover:border-slate-300 hover:shadow-md';
const TILE_ON = 'border-indigo-600 bg-indigo-50 ring-2 ring-indigo-600/20';

// The big avatar's swap (index.css, .fx-swap: its length is EFFECT_LENGTH_MS's,
// which motionEffects.test.ts holds to the stylesheet) and a margin; this takes
// the class off should no animationend come. A reader who asked for less motion
// is never given the class (motionAllowed, the rule of every effect).
const SWAP_FALLBACK_MS = EFFECT_LENGTH_MS['fx-swap'] + 200;

const AvatarPicker: React.FC<AvatarPickerProps> = ({
  open,
  onClose,
  colorClasses,
  initials,
  name,
  currentAvatarId,
  onPick,
  disabled = false,
}) => {
  const { t } = useTranslation();
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const tabId = (family: AvatarFamilyId) => `${baseId}-tab-${family}`;
  const panelId = `${baseId}-panel`;
  const pitchId = `${baseId}-pitch`;

  const [chosen, setChosen] = useState<Choice>(currentAvatarId ?? null);
  const [family, setFamily] = useState<AvatarFamilyId>(() => familyOf(currentAvatarId ?? null));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<Notice>(null);
  const [saved, setSaved] = useState(false);
  const [swapping, setSwapping] = useState(false);
  const [swapCount, setSwapCount] = useState(0);

  const chosenRef = useRef<Choice>(chosen);
  chosenRef.current = chosen;
  const inFlight = useRef(false);
  const waiting = useRef<{ choice: Choice } | null>(null);
  // Whether the picker is still on screen. A sign-out unmounts every opener,
  // and `onPick` names no team: the write goes to the team signed in when it
  // runs. A pick that waited is not written once the picker is gone.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const tabRefs = useRef<Partial<Record<AvatarFamilyId, HTMLButtonElement | null>>>({});
  // The opener's latest word, also while a write runs: a failed write falls
  // back to it, not to what was selected when the write began.
  const storedRef = useRef<Choice>(currentAvatarId ?? null);
  storedRef.current = currentAvatarId ?? null;
  // Whether the opener reported a word while the write ran (a pick made in
  // another browser reached it meanwhile), and a count that runs the effect
  // below again once such a write has landed.
  const reportedDuringWrite = useRef(false);
  const [followOpener, setFollowOpener] = useState(0);

  // The opener's word for the stored choice, once no write of ours is pending;
  // and once more after a write during which it reported another word: drawn
  // with the answer, its word is then the newer of the two choices, which the
  // choice this write stored may not be.
  useEffect(() => {
    if (inFlight.current) {
      reportedDuringWrite.current = true;
      return;
    }
    setChosen(currentAvatarId ?? null);
  }, [currentAvatarId, followOpener]);

  // A new opening starts from the stored choice, with nothing said yet.
  useEffect(() => {
    if (!open) return;
    setFamily(familyOf(chosenRef.current));
    setError(null);
    setSaved(false);
    setSwapping(false);
    // Only when the dialog opens: the family is the person's to change after that.
  }, [open]);

  // The swap's class comes off when its own animation ends (a native listener:
  // React picks the event's name once from what the environment supports), or
  // after a while where no animation runs. A layout effect, so the listener is
  // there in the commit that puts the class on: a passive effect runs after it,
  // later still when React's scheduler yields, and an end sent in between was
  // lost, leaving the class on until the fallback.
  const swapRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!swapping) return;
    const element = swapRef.current;
    const settle = (event: Event) => {
      if (event.target === element) setSwapping(false);
    };
    element?.addEventListener('animationend', settle);
    const timer = window.setTimeout(() => setSwapping(false), SWAP_FALLBACK_MS);
    return () => {
      element?.removeEventListener('animationend', settle);
      window.clearTimeout(timer);
    };
  }, [swapping, swapCount]);

  const write = useCallback(async (choice: Choice) => {
    inFlight.current = true;
    reportedDuringWrite.current = false;
    setSaving(true);
    setError(null);
    setSaved(false);
    let stored = false;
    try {
      await onPickRef.current(choice);
      stored = true;
      chosenRef.current = choice;
      setChosen(choice);
      setSaved(true);
      if (motionAllowed()) {
        setSwapping(true);
        setSwapCount((count) => count + 1);
      }
    } catch (err) {
      setError(noticeFromError(err, { key: 'errors.unknown' }));
      chosenRef.current = storedRef.current;
      setChosen(storedRef.current);
    }
    // A pick that waited is dropped only when it is what this write just
    // stored (a double click). After a refusal nothing was stored, and the
    // mark is back on this browser's copy of the choice: the pick is written
    // whatever it is, the marked picture included. Unless the picker is gone:
    // its person signed out, or left the screen, while this write ran, and
    // another team may be signed in by now, which would take the pick under
    // the old member's id (the review of 45.3).
    const next = waiting.current;
    waiting.current = null;
    if (!mounted.current) {
      inFlight.current = false;
      return;
    }
    if (next && !(stored && next.choice === choice)) {
      void write(next.choice);
      return;
    }
    inFlight.current = false;
    setSaving(false);
    // The opener spoke while the write ran: once the answer is drawn, its
    // word is the stored choice (the other browser's pick when that one was
    // written after this one). With no word meanwhile, the mark stays on the
    // choice just stored, which the opener's next word follows as usual.
    if (stored && reportedDuringWrite.current) setFollowOpener((count) => count + 1);
  }, []);

  const pick = (choice: Choice) => {
    if (disabled) return;
    if (inFlight.current) {
      waiting.current = { choice };
      return;
    }
    // The picture already marked is written too: the mark is this browser's
    // copy of the choice, and can be older than what the server holds (a pick
    // made since in another browser). The server dates it again, like any
    // pick, so it also replaces a newer copy on the session's entry. Only a
    // pick that waited behind a write is dropped, when it is the choice that
    // write just stored (see `write`).
    void write(choice);
  };

  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = AVATAR_FAMILIES.length - 1;
    const target =
      event.key === 'ArrowRight' ? (index === last ? 0 : index + 1)
        : event.key === 'ArrowLeft' ? (index === 0 ? last : index - 1)
          : event.key === 'Home' ? 0
            : event.key === 'End' ? last
              : null;
    if (target === null) return;
    event.preventDefault();
    const next = AVATAR_FAMILIES[target].id;
    setFamily(next);
    tabRefs.current[next]?.focus();
  };

  if (!open) return null;

  const drawn = toAvatarId(chosen);
  const pictureName = drawn ? t(AVATAR_NAME_KEYS[drawn as AvatarArtId]) : t('avatars.picker.initials');
  const current = AVATAR_FAMILIES.find((entry) => entry.id === family) ?? AVATAR_FAMILIES[0];
  const tileClass = (on: boolean) => `${TILE_BASE} ${on ? TILE_ON : TILE_OFF} ${disabled ? 'cursor-not-allowed' : ''}`;
  const status = saving ? t('avatars.picker.saving') : saved ? t('avatars.picker.saved') : '';

  return (
    <ModalDialog
      labelledBy={titleId}
      onClose={onClose}
      overlayClassName="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/45 p-2 sm:p-6"
      panelClassName="flex flex-col gap-4 w-full max-w-2xl max-h-full overflow-y-auto bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-200 p-4 sm:p-5"
    >
      <div className="flex items-center gap-3">
        <h2 id={titleId} className="flex-1 text-lg font-semibold text-slate-900">{t('avatars.picker.title')}</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className={`grid place-items-center w-9 h-9 rounded-lg text-slate-600 hover:bg-slate-100 ${FOCUS_RING}`}
        >
          <span className="material-symbols-outlined text-xl! leading-none" aria-hidden="true">close</span>
        </button>
      </div>

      <div className="flex items-center gap-3.5 p-3 rounded-xl bg-slate-50">
        <span
          key={swapCount}
          ref={swapRef}
          className={`inline-flex ${swapping ? 'fx-swap' : ''}`}
        >
          <Avatar colorClasses={colorClasses} initials={initials} size={64} avatarId={chosen} />
        </span>
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="font-semibold text-slate-900 truncate">{name}</span>
          <span className="text-sm font-semibold text-indigo-700">{pictureName}</span>
          <span className="text-xs text-slate-600">{t('avatars.picker.hint')}</span>
        </div>
      </div>

      <div role="tablist" aria-label={t('avatars.picker.families')} className="flex gap-1.5 overflow-x-auto -mx-1 px-1 py-1">
        {AVATAR_FAMILIES.map((entry, index) => {
          const selected = entry.id === family;
          return (
            <button
              key={entry.id}
              ref={(node) => { tabRefs.current[entry.id] = node; }}
              type="button"
              role="tab"
              id={tabId(entry.id)}
              aria-selected={selected}
              aria-controls={panelId}
              tabIndex={selected ? 0 : -1}
              onClick={() => setFamily(entry.id)}
              onKeyDown={(event) => onTabKeyDown(event, index)}
              className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-semibold ${selected ? 'bg-indigo-50 text-indigo-700 underline decoration-2 underline-offset-4' : 'text-slate-600 hover:bg-slate-100'} ${FOCUS_RING}`}
            >
              {t(AVATAR_FAMILY_LABEL_KEYS[entry.id])}
            </button>
          );
        })}
      </div>

      <div role="tabpanel" id={panelId} aria-labelledby={tabId(current.id)} aria-describedby={pitchId}>
        <p id={pitchId} className="mb-2 text-sm text-slate-600">{t(AVATAR_FAMILY_PITCH_KEYS[current.id])}</p>
        <div
          data-avatar-grid
          aria-busy={saving || undefined}
          className="grid grid-cols-[repeat(auto-fill,minmax(3.5rem,1fr))] gap-1.5 sm:gap-2"
        >
          <button
            type="button"
            aria-pressed={drawn === null}
            aria-disabled={disabled || undefined}
            // The initials it shows lead its name: a name must hold the words
            // a voice-control user can see (WCAG 2.5.3).
            aria-label={t('avatars.picker.initialsTile', { initials })}
            onClick={() => pick(null)}
            className={tileClass(drawn === null)}
          >
            <Avatar colorClasses={colorClasses} initials={initials} size={40} />
          </button>
          {current.avatars.map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={drawn === id}
              aria-disabled={disabled || undefined}
              aria-label={t(AVATAR_NAME_KEYS[id])}
              onClick={() => pick(id)}
              className={tileClass(drawn === id)}
            >
              <Avatar colorClasses={colorClasses} initials={initials} size={40} avatarId={id} />
            </button>
          ))}
        </div>
      </div>

      {disabled && <p className="text-sm text-slate-600">{t('avatars.picker.unavailable')}</p>}
      {error && <p role="alert" className="text-sm font-medium text-rose-800 bg-rose-50 rounded-lg px-3 py-2">{noticeText(error, t)}</p>}

      <div className="flex items-center justify-between gap-3">
        <p role="status" className="text-sm text-slate-600">{status}</p>
        <button
          type="button"
          onClick={onClose}
          className={`shrink-0 px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 btn-brand-glow enabled:active:bg-indigo-800 ${FOCUS_RING}`}
        >
          {t('avatars.picker.done')}
        </button>
      </div>
    </ModalDialog>
  );
};

export default AvatarPicker;
