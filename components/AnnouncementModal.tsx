import React from 'react';
import { VersionAnnouncement, AnnouncementItem, AnnouncementType } from '../types';

interface Props {
  announcements: VersionAnnouncement[];
  currentVersion: string;
  onDismiss: () => void;
  onMarkAsRead: () => void;
  showLaterButton?: boolean;
}

const typeConfig: Record<AnnouncementType, { icon: string; label: string; color: string }> = {
  feature: { icon: 'add_circle', label: 'New Feature', color: 'text-emerald-600' },
  improvement: { icon: 'upgrade', label: 'Improvement', color: 'text-blue-600' },
  fix: { icon: 'build', label: 'Bug Fix', color: 'text-amber-600' },
  security: { icon: 'security', label: 'Security Update', color: 'text-rose-600' },
  removed: { icon: 'remove_circle', label: 'Removed', color: 'text-slate-500' },
};

const AnnouncementItemRow: React.FC<{ item: AnnouncementItem }> = ({ item }) => {
  const config = typeConfig[item.type] || typeConfig.improvement;

  return (
    <div className="flex items-start gap-3 py-2">
      <span className={`material-symbols-outlined text-xl ${config.color}`}>
        {config.icon}
      </span>
      <div className="flex-1">
        <span className={`text-xs font-medium uppercase tracking-wide ${config.color}`}>
          {config.label}
        </span>
        <p className="text-sm text-slate-700 mt-0.5">{item.description}</p>
      </div>
    </div>
  );
};

const VersionSection: React.FC<{ announcement: VersionAnnouncement }> = ({ announcement }) => {
  const formattedDate = new Date(announcement.date).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <div className="mb-6 last:mb-0">
      <div className="flex items-center gap-2 mb-3 pb-2 border-b border-slate-200">
        <span className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white text-sm font-bold px-2.5 py-0.5 rounded-full">
          v{announcement.version}
        </span>
        <span className="text-sm text-slate-500">{formattedDate}</span>
      </div>
      <div className="space-y-1">
        {announcement.items.map((item, index) => (
          <AnnouncementItemRow key={index} item={item} />
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
  const hasAnnouncements = announcements.length > 0 && announcements.some(a => a.items.length > 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-lg w-full mx-4 relative max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-indigo-500 to-purple-600 w-10 h-10 rounded-xl flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-2xl">auto_awesome</span>
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-800">What's New</h2>
              <p className="text-sm text-slate-500">Version {currentVersion}</p>
            </div>
          </div>
          <button
            onClick={onDismiss}
            className="text-slate-400 hover:text-slate-600 transition-colors p-1"
            aria-label="Close"
          >
            <span className="material-symbols-outlined text-2xl">close</span>
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
              <span className="material-symbols-outlined text-5xl text-slate-300 mb-2">celebration</span>
              <p className="text-slate-600">You're all caught up!</p>
              <p className="text-sm text-slate-400 mt-1">No new updates since your last visit.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="mt-4 pt-4 border-t border-slate-200 flex gap-3">
          {showLaterButton && (
            <button
              onClick={onDismiss}
              className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 px-4 rounded-xl transition-all duration-200"
            >
              Later
            </button>
          )}
          <button
            onClick={onMarkAsRead}
            className={`${showLaterButton ? 'flex-1' : 'w-full'} bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white font-medium py-2.5 px-4 rounded-xl transition-all duration-200 shadow-lg shadow-indigo-500/25`}
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementModal;
