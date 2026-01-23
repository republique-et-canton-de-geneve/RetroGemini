import React, { useMemo, useState } from 'react';
import { Team, RetroSession, HealthCheckSession } from '../types';
import { dataService } from '../services/dataService';

const EMAIL_PATTERN_SOURCE = '[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}';

interface Props {
  team: Team;
  activeSession?: RetroSession;
  activeHealthCheck?: HealthCheckSession;
  onClose: () => void;
  onLogout?: () => void;
}

type StatusState = 'idle' | 'sending' | 'sent' | 'error';

const InviteModal: React.FC<Props> = ({ team, activeSession, activeHealthCheck, onClose, onLogout }) => {
  const [activeTab, setActiveTab] = useState<'email' | 'link'>('email');
  const [emailsInput, setEmailsInput] = useState('');
  const [status, setStatus] = useState<StatusState>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [generatedLinks, setGeneratedLinks] = useState<{ email: string; link: string }[]>([]);
  const membersWithEmail = useMemo(() => team.members.filter(m => !!m.email), [team.members]);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>(
    membersWithEmail.map(m => m.id)
  );

  React.useEffect(() => {
    setSelectedMemberIds(membersWithEmail.map(m => m.id));
  }, [membersWithEmail]);

  const inviteData: {
    id: string;
    name: string;
    password: string;
    sessionId?: string;
    healthCheckSessionId?: string;
  } = {
    id: team.id,
    name: team.name,
    password: team.passwordHash,
    sessionId: activeSession?.id,
    healthCheckSessionId: activeHealthCheck?.id,
  };

  const encodedData = btoa(unescape(encodeURIComponent(JSON.stringify(inviteData))));
  const link = `${window.location.origin}?join=${encodeURIComponent(encodedData)}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(link)}`;

  const manualInvites = useMemo(() => {
    const entries = emailsInput
      .split(/\n|,|;/)
      .map((entry) => entry.trim())
      .filter(Boolean);

    const seen = new Set<string>();
    const results: { email: string; nameHint?: string }[] = [];

    entries.forEach((entry) => {
      const matches = [...entry.matchAll(new RegExp(EMAIL_PATTERN_SOURCE, 'gi'))];
      if (matches.length === 0) return;

      matches.forEach((match) => {
        const email = match[0].trim();
        const normalized = email.toLowerCase();
        if (seen.has(normalized)) return;
        seen.add(normalized);

        const nameCandidate = entry
          .replace(match[0], '')
          .replace(/[<>]/g, '')
          .replace(/\s+/g, ' ')
          .trim();
        const nameHint = nameCandidate || undefined;

        results.push({ email, nameHint });
      });
    });

    return results;
  }, [emailsInput]);

  const manualInviteLookup = useMemo(() => {
    return new Map(manualInvites.map((entry) => [entry.email.toLowerCase(), entry.nameHint]));
  }, [manualInvites]);

  const emailsToInvite = useMemo(() => {
    const preselected = membersWithEmail
      .filter(m => selectedMemberIds.includes(m.id))
      .map(m => m.email!)
      .filter(Boolean);

    return Array.from(new Set([...preselected, ...manualInvites.map(entry => entry.email)]));
  }, [membersWithEmail, selectedMemberIds, manualInvites]);

  const handleEmailInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (emailsToInvite.length === 0) return;

    setStatus('sending');
    setStatusMessage('Sending invites…');

    const successes: { email: string; link: string }[] = [];
    const errors: string[] = [];

    for (const email of emailsToInvite) {
      try {
        const memberName = membersWithEmail.find(m => m.email === email)?.name
          || manualInviteLookup.get(email.toLowerCase());
        const { inviteLink } = dataService.createMemberInvite(
          team.id,
          email,
          activeSession?.id,
          memberName,
          activeHealthCheck?.id
        );
        successes.push({ email, link: inviteLink });

        try {
          const res = await fetch('/api/send-invite', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email,
              name: memberName || email,
              link: inviteLink,
              teamName: team.name,
              sessionName: activeSession?.name || activeHealthCheck?.name,
            })
          });

          if (!res.ok) {
            throw new Error('Email service not configured');
          }
        } catch (err: any) {
          errors.push(`${email}: ${err.message || 'Failed to send email'}`);
        }
      } catch (err: any) {
        errors.push(`${email}: ${err.message || 'Unable to generate invite'}`);
      }
    }

    if (successes.length) {
      setGeneratedLinks(successes);
      setStatus('sent');
      setStatusMessage(`${successes.length} invite${successes.length > 1 ? 's' : ''} ready to share`);
      setEmailsInput('');
    } else {
      setGeneratedLinks([]);
      setStatus('error');
      setStatusMessage('No invites created');
    }

    if (errors.length) {
      setStatus('error');
      setStatusMessage(errors.join(' | '));
    }
  };

  const renderEmailTab = () => (
    <form onSubmit={handleEmailInvite} className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-bold text-slate-700">Invite by email</p>
          <p className="text-xs text-slate-500">Paste one or more email addresses to send personal links.</p>
        </div>
        {status !== 'idle' && (
          <span className={`text-xs font-bold ${status === 'sent' ? 'text-emerald-600' : status === 'sending' ? 'text-slate-500' : 'text-amber-600'}`}>
            {statusMessage}
          </span>
        )}
      </div>

      {membersWithEmail.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-slate-600">Team members</span>
            <button
              type="button"
              className="text-[11px] font-bold text-indigo-600 hover:underline"
              onClick={() => setSelectedMemberIds(prev => prev.length === membersWithEmail.length ? [] : membersWithEmail.map(m => m.id))}
            >
              {selectedMemberIds.length === membersWithEmail.length ? 'Unselect all' : 'Select all'}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {membersWithEmail.map(member => {
              const selected = selectedMemberIds.includes(member.id);
              return (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => setSelectedMemberIds(prev => prev.includes(member.id) ? prev.filter(id => id !== member.id) : [...prev, member.id])}
                  className={`flex items-center justify-between px-3 py-2 rounded-lg border text-left transition ${selected ? 'border-indigo-400 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <div>
                    <div className="text-sm font-bold text-slate-700">{member.name}</div>
                    <div className="text-[11px] text-slate-500">{member.email}</div>
                  </div>
                  <span className={`material-symbols-outlined text-lg ${selected ? 'text-indigo-600' : 'text-slate-300'}`}>
                    {selected ? 'toggle_on' : 'toggle_off'}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <textarea
        className="w-full border border-slate-200 rounded-lg p-3 text-sm bg-white text-slate-900 h-28"
        placeholder="e.g. teammate@example.com, other@company.com"
        value={emailsInput}
        onChange={(e) => setEmailsInput(e.target.value)}
      />

      {manualInvites.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          {manualInvites.map(({ email }) => (
            <span key={email} className="px-2 py-1 bg-slate-100 border border-slate-200 rounded-full">{email}</span>
          ))}
        </div>
      )}

      <button
        type="submit"
        className="w-full px-4 py-2 bg-indigo-600 text-white rounded-lg font-bold text-sm hover:bg-indigo-700 disabled:opacity-50"
        disabled={!emailsToInvite.length || status === 'sending'}
      >
        {status === 'sending' ? 'Sending…' : 'Send invites'}
      </button>

      {generatedLinks.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-sm text-emerald-700 space-y-2">
          <div className="font-bold">Invite links ready</div>
          <div className="space-y-1 max-h-32 overflow-auto pr-1">
            {generatedLinks.map(({ email, link }) => (
              <div key={email} className="flex items-center gap-2">
                <span className="text-xs font-semibold text-emerald-800 min-w-[120px] truncate">{email}</span>
                <code className="text-[11px] truncate flex-1">{link}</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(link)}
                  className="text-emerald-700 font-bold text-[10px] hover:underline"
                >
                  COPY
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </form>
  );

  const renderLinkTab = () => (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm font-bold text-slate-700">Share via link or QR code</p>
        <p className="text-xs text-slate-500">Anyone can join and choose their name after scanning.</p>
      </div>

      <div className="flex justify-center">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-inner">
          <img src={qrUrl} alt="QR Code" className="w-48 h-48" />
        </div>
      </div>

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-center justify-between">
        <code className="text-xs text-slate-600 truncate mr-2">{link}</code>
        <button
          onClick={() => navigator.clipboard.writeText(link)}
          className="text-retro-primary font-bold text-xs hover:underline"
        >
          COPY
        </button>
      </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[100] backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-xl w-full relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        <h3 className="text-xl font-bold text-slate-800 mb-1 text-center">Invite teammates to {team.name}</h3>
        <p className="text-slate-500 text-sm text-center mb-4">Choose how you want to invite participants.</p>

        <div className="flex border-b border-slate-200 mb-6">
          <button
            className={`flex-1 py-2 text-sm font-bold ${activeTab === 'email' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}
            onClick={() => setActiveTab('email')}
          >
            EMAIL
          </button>
          <button
            className={`flex-1 py-2 text-sm font-bold ${activeTab === 'link' ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}
            onClick={() => setActiveTab('link')}
          >
            CODE & LINK
          </button>
        </div>

        {activeTab === 'email' ? renderEmailTab() : renderLinkTab()}

        {onLogout && (
          <div className="mt-6 pt-4 border-t border-slate-100 text-center">
            <p className="text-xs text-slate-400 mb-2">Want to test as another user?</p>
            <button
              onClick={onLogout}
              className="text-indigo-600 text-sm font-bold hover:underline"
            >
              Logout & Create New User
            </button>
          </div>
        )}

        <button onClick={onClose} className="w-full bg-slate-800 text-white py-2 rounded-lg font-bold mt-4">Done</button>
      </div>
    </div>
  );
};

export default InviteModal;
