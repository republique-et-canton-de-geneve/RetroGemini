import React from 'react';
import { Team, RetroSession } from '../types';

interface Props {
  team: Team;
  activeSession?: RetroSession;
  onClose: () => void;
  onLogout?: () => void;
}

const InviteModal: React.FC<Props> = ({ team, activeSession, onClose, onLogout }) => {
  // Encode essential team data for invitation (id, name, password)
  // Also include active session data if available
  const inviteData: {
    id: string;
    name: string;
    password: string;
    session?: RetroSession;
  } = {
    id: team.id,
    name: team.name,
    password: team.passwordHash
  };

  // Include the active session if provided
  if (activeSession) {
    inviteData.session = activeSession;
  }

  const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
  const link = `${window.location.origin}?join=${encodedData}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-sm w-full relative">
        <button 
            onClick={onClose}
            className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
        >
            <span className="material-symbols-outlined">close</span>
        </button>

        <h3 className="text-xl font-bold text-slate-800 mb-2 text-center">Join {team.name}</h3>
        <p className="text-slate-500 text-sm text-center mb-6">Scan to join this team instantly.</p>

        <div className="flex justify-center mb-6">
            <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-inner">
                <img src={qrUrl} alt="QR Code" className="w-48 h-48" />
            </div>
        </div>

        <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-center justify-between mb-4">
            <code className="text-xs text-slate-600 truncate mr-2">{link}</code>
            <button 
                onClick={() => navigator.clipboard.writeText(link)}
                className="text-retro-primary font-bold text-xs hover:underline"
            >
                COPY
            </button>
        </div>

        {onLogout && (
            <div className="mb-4 pt-4 border-t border-slate-100 text-center">
                <p className="text-xs text-slate-400 mb-2">Want to test as another user?</p>
                <button 
                    onClick={onLogout}
                    className="text-indigo-600 text-sm font-bold hover:underline"
                >
                    Logout & Create New User
                </button>
            </div>
        )}

        <button onClick={onClose} className="w-full bg-slate-800 text-white py-2 rounded-lg font-bold">Done</button>
      </div>
    </div>
  );
};

export default InviteModal;