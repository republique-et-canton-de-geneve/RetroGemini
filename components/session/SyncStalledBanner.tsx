import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { useSyncHealth } from './useSyncHealth';

/**
 * "Your changes are not being saved" — shared by the retrospective and the
 * health check, rendered under the header next to `SessionConnectionBanner`.
 *
 * Incident ISS (2026-10-12): the server refused every write of one participant
 * for a whole retrospective, and nothing on that participant's screen said so.
 * The board looked live, the sync chip was green, and the cards they wrote sat
 * on their own screen until they vanished. `syncService` reports the health as
 * `stalled` once the user's own data keeps needing re-sends that never land
 * (see `onSyncHealth` there), and this is where the client admits it is not
 * being heard. The header chip says the same in a word ("Not saving").
 *
 * The way out is a reload, deliberately: it rejoins with a fresh snapshot and
 * fresh local state, which clears every cause of a refusal streak a client can
 * be stuck in. Nothing the user still sees as theirs is dropped before they
 * act — the session holds unconfirmed work for as long as the stall lasts (see
 * `useHoldOwnStateWhileStalled`).
 *
 * The banner reads the service itself (`useSyncHealth`, shared with the chip),
 * so neither session screen can show it on a different rule.
 */
const SyncStalledBanner: React.FC = () => {
  const { t } = useTranslation();
  const health = useSyncHealth();

  if (health !== 'stalled') return null;

  return (
    <div
      role="alert"
      className="bg-rose-100 border-b border-rose-300 text-rose-900 text-sm px-6 py-2 flex flex-wrap items-center justify-center gap-2"
    >
      <span className="material-symbols-outlined text-base" aria-hidden="true">error</span>
      <span>{t('phases.sync.notSaved')}</span>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="font-bold underline underline-offset-2 hover:text-rose-700"
      >
        {t('phases.sync.reloadPage')}
      </button>
    </div>
  );
};

export default SyncStalledBanner;
