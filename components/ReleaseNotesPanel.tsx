import React from 'react';
import { ReleaseNote } from '../types';

interface ReleaseNotesPanelProps {
  notes: ReleaseNote[];
  currentVersion: string;
  onMarkAsRead: () => void;
  onDismiss: () => void;
}

const ReleaseNotesPanel: React.FC<ReleaseNotesPanelProps> = ({
  notes,
  currentVersion,
  onMarkAsRead,
  onDismiss
}) => {
  return (
    <div className="bg-white border border-indigo-100 shadow-sm rounded-lg p-6 mb-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 font-semibold text-sm uppercase">
            <span className="material-symbols-outlined text-base">new_releases</span>
            What&apos;s new in v{currentVersion}
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mt-2">New features since your last visit</h2>
          <p className="text-slate-500 text-sm mt-1">
            Review the latest improvements and mark them as read when you&apos;re done.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={onDismiss}
            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            Remind me later
          </button>
          <button
            onClick={onMarkAsRead}
            className="px-4 py-2 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700"
          >
            Mark as read
          </button>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        {notes.map(note => (
          <div key={note.version} className="border border-slate-100 rounded-lg p-4 bg-slate-50">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
              <div>
                <h3 className="text-lg font-semibold text-slate-800">v{note.version} · {note.title}</h3>
                <p className="text-xs text-slate-400">Released {note.date}</p>
              </div>
            </div>
            {note.highlights && note.highlights.length > 0 && (
              <ul className="mt-3 space-y-1 text-sm text-slate-700">
                {note.highlights.map((highlight, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="material-symbols-outlined text-indigo-500 text-base">auto_awesome</span>
                    <span>{highlight}</span>
                  </li>
                ))}
              </ul>
            )}
            {note.items && note.items.length > 0 && (
              <ul className="mt-3 list-disc list-inside text-sm text-slate-600">
                {note.items.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default ReleaseNotesPanel;
