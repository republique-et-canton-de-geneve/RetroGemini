import React from 'react';
import { VersionAnnouncement, AnnouncementItem, AnnouncementType } from '../types';
import ModalDialog from './common/ModalDialog';
import { useTranslation } from '../i18n/I18nContext';
import type { MessageKey } from '../i18n/translate';
import type { Language } from '../i18n/languages';

interface Props {
  announcements: VersionAnnouncement[];
  currentVersion: string;
  onDismiss: () => void;
  onMarkAsRead: () => void;
  showLaterButton?: boolean;
}

// `labelKey` is translated at render time; the item's own description comes
// from the changelog (see `releaseNotesIn`) and is shown as written. `color` is
// the type's chip: a 50 tint with the deep ink of the same hue, measured at
// 4.5:1 in `__tests__/loginShellLook.test.tsx`.
const typeConfig: Record<AnnouncementType, { icon: string; labelKey: MessageKey; color: string }> = {
  feature: { icon: 'add_circle', labelKey: 'shared.announcement.type.feature', color: 'bg-emerald-50 text-emerald-800' },
  improvement: { icon: 'upgrade', labelKey: 'shared.announcement.type.improvement', color: 'bg-blue-50 text-blue-800' },
  fix: { icon: 'build', labelKey: 'shared.announcement.type.fix', color: 'bg-amber-50 text-amber-800' },
  security: { icon: 'security', labelKey: 'shared.announcement.type.security', color: 'bg-rose-50 text-rose-800' },
  removed: { icon: 'remove_circle', labelKey: 'shared.announcement.type.removed', color: 'bg-slate-100 text-slate-700' },
};

/**
 * The text of one release for this reader: the translation in the interface
 * language when the server sent one (CHANGELOG.fr.md for French), otherwise the
 * English original from CHANGELOG.md — with the language of what is actually
 * shown. The payload may come from another release during a rolling update, so
 * anything but a non-empty list falls back to English.
 */
const releaseNotesIn = (
  announcement: VersionAnnouncement,
  language: Language
): { items: AnnouncementItem[]; lang: Language } => {
  const translated = announcement.localized?.[language]?.items;
  if (Array.isArray(translated) && translated.length > 0) {
    return { items: translated, lang: language };
  }
  return { items: announcement.items, lang: 'en' };
};

const AnnouncementItemRow: React.FC<{ item: AnnouncementItem; lang: Language }> = ({ item, lang }) => {
  const { t } = useTranslation();
  const config = typeConfig[item.type] || typeConfig.improvement;

  return (
    <div className="py-2">
      <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${config.color}`}>
        <span className="material-symbols-outlined text-sm! leading-none" aria-hidden="true">
          {config.icon}
        </span>
        {t(config.labelKey)}
      </span>
      {/* Marked with the language of the text shown — French, or the English
          fallback for a release with no translation (WCAG 3.1.2). */}
      <p lang={lang} className="text-sm leading-relaxed text-slate-700 mt-1.5">{item.description}</p>
    </div>
  );
};

const VersionSection: React.FC<{ announcement: VersionAnnouncement }> = ({ announcement }) => {
  const { language, locale } = useTranslation();
  const { items, lang } = releaseNotesIn(announcement, language);
  const formattedDate = new Date(announcement.date).toLocaleDateString(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="mb-5 last:mb-0">
      <div className="flex items-center gap-2 mb-1 pb-2 border-b border-slate-200">
        <span className="bg-indigo-50 text-indigo-700 text-xs font-semibold font-mono tabular-nums px-2.5 py-0.5 rounded-full">
          v{announcement.version}
        </span>
        <span className="text-sm text-slate-500">{formattedDate}</span>
      </div>
      <div className="divide-y divide-slate-100">
        {items.map((item, index) => (
          <AnnouncementItemRow key={index} item={item} lang={lang} />
        ))}
      </div>
    </div>
  );
};

const AnnouncementModal: React.FC<Props> = ({
  announcements,
  currentVersion,
  onDismiss,
  onMarkAsRead,
  showLaterButton = true
}) => {
  const { t } = useTranslation();
  const hasAnnouncements = announcements.length > 0 && announcements.some(a => a.items.length > 0);

  return (
    <ModalDialog
      labelledBy="announcement-modal-title"
      onClose={onDismiss}
      overlayClassName="fixed inset-0 bg-slate-900/45 flex items-center justify-center z-100 p-4"
      panelClassName="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-lg w-full relative max-h-[80vh] flex flex-col"
    >
      <>
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-indigo-50 text-indigo-600 w-10 h-10 rounded-xl flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined" aria-hidden="true">auto_awesome</span>
            </div>
            <div>
              <h2 id="announcement-modal-title" className="text-lg font-semibold tracking-tight text-slate-900">{t('shared.announcement.title')}</h2>
              <p className="text-sm text-slate-500">{t('shared.announcement.version', { version: currentVersion })}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onDismiss}
            className="-mr-1.5 -mt-1 p-1.5 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            aria-label={t('common.close')}
          >
            <span className="material-symbols-outlined" aria-hidden="true">close</span>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto pr-2">
          {hasAnnouncements ? (
            announcements.map((announcement, index) => (
              <VersionSection key={index} announcement={announcement} />
            ))
          ) : (
            <div className="text-center py-8">
              <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-slate-100 text-slate-500 flex items-center justify-center">
                <span className="material-symbols-outlined" aria-hidden="true">celebration</span>
              </div>
              <p className="font-semibold text-slate-900">{t('shared.announcement.caughtUp')}</p>
              <p className="text-sm text-slate-500 mt-1">{t('shared.announcement.noUpdates')}</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-slate-200 flex gap-3">
          {showLaterButton && (
            <button
              type="button"
              onClick={onDismiss}
              className="flex-1 bg-white text-slate-700 font-semibold py-2.5 px-4 rounded-lg border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-colors"
            >
              {t('shared.announcement.later')}
            </button>
          )}
          <button
            type="button"
            onClick={onMarkAsRead}
            className={`${showLaterButton ? 'flex-1' : 'w-full'} bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-2.5 px-4 rounded-lg btn-brand-glow motion-safe:active:scale-[0.97] transition`}
          >
            {t('shared.announcement.gotIt')}
          </button>
        </div>
      </>
    </ModalDialog>
  );
};

export default AnnouncementModal;
