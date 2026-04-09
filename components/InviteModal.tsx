import React, { useMemo, useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
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
type TabType = 'email' | 'link' | 'wifi';

const InviteModal: React.FC<Props> = ({ team, activeSession, activeHealthCheck, onClose, onLogout }) => {
  const [activeTab, setActiveTab] = useState<TabType>('email');
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

  let link = window.location.origin;
  try {
    link = dataService.createSessionInvite(
      team.id,
      activeSession?.id,
      activeHealthCheck?.id
    ).inviteLink;
  } catch (err) {
    console.warn('[InviteModal] Failed to generate session invite link', err);
  }
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const qrGenerated = useRef(false);
  const [wifiConfig, setWifiConfig] = useState<{ ssid: string; password: string } | null>(null);
  const [wifiQrDataUrl, setWifiQrDataUrl] = useState<string>('');

  useEffect(() => {
    if (qrGenerated.current) return;
    qrGenerated.current = true;
    QRCode.toDataURL(link, { width: 200, margin: 1 }).then(setQrDataUrl).catch(() => {});
    fetch('/api/wifi-config')
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.ssid) return;
        setWifiConfig(data);
        const wifiString = `WIFI:T:WPA;S:${data.ssid};P:${data.password};;`;
        QRCode.toDataURL(wifiString, { width: 200, margin: 1 }).then(setWifiQrDataUrl).catch(() => {});
      })
      .catch(() => {});
  }, [link]);

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
          {qrDataUrl ? <img src={qrDataUrl} alt="QR Code" className="w-48 h-48" /> : <div className="w-48 h-48 bg-slate-100 animate-pulse rounded" />}
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

  const [showWifiPassword, setShowWifiPassword] = useState(false);

  const renderWifiTab = () => (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm font-bold text-slate-700">Connect to Wi-Fi</p>
        <p className="text-xs text-slate-500">Scan this QR code with your phone to join the network.</p>
      </div>

      <div className="flex justify-center">
        <div className="p-4 bg-white border border-slate-200 rounded-xl shadow-inner">
          {wifiQrDataUrl ? <img src={wifiQrDataUrl} alt="Wi-Fi QR Code" className="w-48 h-48" /> : <div className="w-48 h-48 bg-slate-100 animate-pulse rounded" />}
        </div>
      </div>

      <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 space-y-1">
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Network</span>
          <span className="text-sm font-bold text-slate-700">{wifiConfig?.ssid}</span>
        </div>
        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">Password</span>
          <div className="flex items-center gap-2">
            <span className="text-sm font-mono text-slate-700">{showWifiPassword ? wifiConfig?.password : '••••••••'}</span>
            <button
              type="button"
              onClick={() => setShowWifiPassword(prev => !prev)}
              className="text-slate-400 hover:text-slate-600"
            >
              <span className="material-symbols-outlined text-lg">{showWifiPassword ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-400 text-center">Once connected, open the invite link or scan the session QR code to join.</p>
    </div>
  );

  const tabs: { key: TabType; label: string }[] = [
    { key: 'email', label: 'EMAIL' },
    { key: 'link', label: 'CODE & LINK' },
    ...(wifiConfig ? [{ key: 'wifi' as TabType, label: 'WI-FI' }] : []),
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-100 backdrop-blur-xs p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-xl w-full relative max-h-[calc(100vh-2rem)] flex flex-col">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-slate-400 hover:text-slate-600"
        >
          <span className="material-symbols-outlined">close</span>
        </button>

        <h3 className="text-xl font-bold text-slate-800 mb-1 text-center pr-8">Invite teammates to {team.name}</h3>
        <p className="text-slate-500 text-sm text-center mb-4">Choose how you want to invite participants.</p>

        <div className="flex border-b border-slate-200 mb-6">
          {tabs.map(tab => (
            <button
              key={tab.key}
              className={`flex-1 py-2 text-sm font-bold ${activeTab === tab.key ? 'text-indigo-600 border-b-2 border-indigo-600' : 'text-slate-400'}`}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="overflow-y-auto min-h-0 pr-1">
          {activeTab === 'email' && renderEmailTab()}
          {activeTab === 'link' && renderLinkTab()}
          {activeTab === 'wifi' && renderWifiTab()}
        </div>

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

        <button onClick={onClose} className="w-full bg-slate-800 text-white py-2 rounded-lg font-bold mt-4 shrink-0">Done</button>
      </div>
    </div>
  );
};

export default InviteModal;
