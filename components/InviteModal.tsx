import { appFetch, appUrl } from '../services/publicPath';
import React, { useMemo, useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { Team, RetroSession, HealthCheckSession } from '../types';
import { dataService } from '../services/dataService';
import { parseInviteEmails } from '../utils/parseInviteEmails';
import { parseEmailInput } from '../utils/emailAddress.js';
import ModalDialog from './common/ModalDialog';
import { useTranslation } from '../i18n/I18nContext';
import { translateErrorMessage } from '../i18n/errorMessages';
import type { MessageKey } from '../i18n/translate';

interface Props {
  team: Team;
  activeSession?: RetroSession;
  activeHealthCheck?: HealthCheckSession;
  onClose: () => void;
  onLogout?: () => void;
  /**
   * Called with the team members whose email invites were just created, so
   * the session can list them as "invited — waiting to join" in the
   * participants panel.
   */
  onInvitesSent?: (invitees: { id: string; name: string; email: string }[]) => void;
}

type StatusState = 'idle' | 'sending' | 'sent' | 'error';
type TabType = 'email' | 'link' | 'wifi';

// Server error codes a facilitator can actually act on. Anything else
// (`send_failed`, …) falls back to the generic message. There is no send
// quota, so no quota message.
const INVITE_SEND_ERRORS: Record<string, MessageKey> = {
  email_not_configured: 'invite.email.notConfigured',
  unauthenticated: 'invite.email.sessionExpired',
  invalid_email: 'errors.invalidEmail'
};

const InviteModal: React.FC<Props> = ({ team, activeSession, activeHealthCheck, onClose, onLogout, onInvitesSent }) => {
  const { t, tp } = useTranslation();
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

  // The invite link is generated asynchronously (stage 7e): the client asks
  // the server for a team-scoped invite credential instead of embedding the
  // plaintext password in the link.
  const [link, setLink] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [wifiConfig, setWifiConfig] = useState<{ ssid: string; password: string } | null>(null);
  const [wifiQrDataUrl, setWifiQrDataUrl] = useState<string>('');

  useEffect(() => {
    let cancelled = false;
    dataService.createSessionInvite(team.id, activeSession?.id, activeHealthCheck?.id)
      .then(({ inviteLink }) => {
        if (!cancelled) setLink(inviteLink);
      })
      .catch((err) => {
        console.warn('[InviteModal] Failed to generate session invite link', err);
        if (!cancelled) setLink(appUrl());
      });
    return () => {
      cancelled = true;
    };
  }, [team.id, activeSession?.id, activeHealthCheck?.id]);

  useEffect(() => {
    if (!link) return;
    QRCode.toDataURL(link, { width: 200, margin: 1 }).then(setQrDataUrl).catch(() => {});
  }, [link]);

  useEffect(() => {
    // Authenticated since H31: the Wi-Fi password is a credential, so the route
    // requires the team credential this modal already holds (POST, because the
    // credential belongs in the body rather than in a logged URL).
    appFetch('/api/wifi-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        teamId: team.id,
        password: dataService.getAuthenticatedPassword(),
        sessionToken: dataService.getSessionToken() ?? undefined
      })
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data?.ssid) return;
        setWifiConfig(data);
        const wifiString = `WIFI:T:WPA;S:${data.ssid};P:${data.password};;`;
        QRCode.toDataURL(wifiString, { width: 200, margin: 1 }).then(setWifiQrDataUrl).catch(() => {});
      })
      .catch(() => {});
  }, [team.id]);

  const manualInvites = useMemo(() => parseInviteEmails(emailsInput), [emailsInput]);

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
    setStatusMessage(t('invite.email.sendingStatus'));

    const successes: { email: string; link: string }[] = [];
    const invitedMembers: { id: string; name: string; email: string }[] = [];
    const errors: string[] = [];

    for (const email of emailsToInvite) {
      // The shared rule the server mails by (`utils/emailAddress.js`): an
      // address it would refuse — a roster entry stored before the rule, a
      // paste the field's pattern let through — gets no member and no link.
      const parsedAddress = parseEmailInput(email);
      if (!parsedAddress.ok || !parsedAddress.email) {
        errors.push(t('invite.email.errorLine', { email, message: t('errors.invalidEmail') }));
        continue;
      }
      try {
        const memberName = membersWithEmail.find(m => m.email === email)?.name
          || manualInviteLookup.get(email.toLowerCase());
        const { user, inviteLink } = await dataService.createMemberInvite(
          team.id,
          email,
          activeSession?.id,
          memberName,
          activeHealthCheck?.id
        );
        successes.push({ email, link: inviteLink });
        invitedMembers.push({ id: user.id, name: user.name, email });

        try {
          // Credentials are attached inside dataService: the endpoint is
          // authenticated (audit H3) and the server supplies the team name
          // itself, so neither is passed from here.
          await dataService.sendInviteEmail(team.id, {
            email,
            name: memberName || email,
            link: inviteLink,
            sessionName: activeSession?.name || activeHealthCheck?.name,
          });
        } catch (err: any) {
          const sendErrorKey = INVITE_SEND_ERRORS[err?.message] ?? 'invite.email.sendFailed';
          errors.push(t('invite.email.errorLine', { email, message: t(sendErrorKey) }));
        }
      } catch (err: any) {
        const message = err.message ? translateErrorMessage(err.message, t) : t('invite.email.generateFailed');
        errors.push(t('invite.email.errorLine', { email, message }));
      }
    }

    if (successes.length) {
      setGeneratedLinks(successes);
      setStatus('sent');
      // Always at least one here, where "only 1 is singular" is the old English rule.
      setStatusMessage(tp('invite.email.readyCount', successes.length));
      setEmailsInput('');
      // Even when the email itself could not be sent, the invite exists and
      // its link can be shared, so the person is genuinely expected to join.
      if (invitedMembers.length) {
        onInvitesSent?.(invitedMembers);
      }
    } else {
      setGeneratedLinks([]);
      setStatus('error');
      setStatusMessage(t('invite.email.noneCreated'));
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
          <p className="text-sm font-bold text-slate-700">{t('invite.email.heading')}</p>
          <p className="text-xs text-slate-500">{t('invite.email.description')}</p>
        </div>
        {status !== 'idle' && (
          <span className={`text-xs font-semibold ${status === 'sent' ? 'text-emerald-700' : status === 'sending' ? 'text-slate-500' : 'text-amber-700'}`}>
            {statusMessage}
          </span>
        )}
      </div>

      {membersWithEmail.length > 0 && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-slate-600">{t('invite.email.teamMembers')}</span>
            <button
              type="button"
              className="text-xs font-semibold text-indigo-700 hover:underline"
              onClick={() => setSelectedMemberIds(prev => prev.length === membersWithEmail.length ? [] : membersWithEmail.map(m => m.id))}
            >
              {selectedMemberIds.length === membersWithEmail.length ? t('invite.email.unselectAll') : t('invite.email.selectAll')}
            </button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {membersWithEmail.map(member => {
              const selected = selectedMemberIds.includes(member.id);
              return (
                // A toggle: `aria-pressed` says what only the drawn box
                // showed, and the box replaces a switch glyph that was the
                // only sign of the state (and read out as "toggle_on").
                <button
                  key={member.id}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => setSelectedMemberIds(prev => prev.includes(member.id) ? prev.filter(id => id !== member.id) : [...prev, member.id])}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-lg border text-left transition ${selected ? 'border-indigo-600 bg-indigo-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 truncate">{member.name}</div>
                    <div className="text-xs text-slate-600 truncate">{member.email}</div>
                  </div>
                  <span
                    data-testid="invite-member-check"
                    className={`w-5 h-5 shrink-0 flex items-center justify-center rounded-md border ${selected ? 'bg-indigo-600 border-indigo-600 text-white' : 'bg-white border-slate-400 text-white'}`}
                    aria-hidden="true"
                  >
                    {selected && <span className="material-symbols-outlined text-base! leading-none">check</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <textarea
        className="w-full border border-slate-400 rounded-lg p-3 text-sm bg-white text-slate-900 placeholder:text-slate-500 h-28 outline-hidden focus:border-indigo-600 focus:ring-4 focus:ring-indigo-600/15"
        placeholder={t('invite.email.placeholder')}
        value={emailsInput}
        onChange={(e) => setEmailsInput(e.target.value)}
      />

      {manualInvites.length > 0 && (
        <div className="flex flex-wrap gap-2 text-xs text-slate-600">
          {manualInvites.map(({ email }) => (
            <span key={email} className="px-2.5 py-0.5 bg-slate-100 text-slate-700 font-medium rounded-full">{email}</span>
          ))}
        </div>
      )}

      <button
        type="submit"
        // Off when there is no one to invite or a send is on its way: said by
        // its colours rather than an opacity, so the state can be measured.
        className={`w-full px-4 py-2.5 rounded-lg font-semibold text-sm transition ${
          !emailsToInvite.length || status === 'sending'
            ? 'bg-slate-200 text-slate-600 cursor-not-allowed'
            : 'bg-indigo-600 text-white hover:bg-indigo-700 btn-brand-glow motion-safe:active:scale-[0.97]'
        }`}
        disabled={!emailsToInvite.length || status === 'sending'}
      >
        {status === 'sending' ? t('invite.email.sending') : t('invite.email.send')}
      </button>

      {generatedLinks.length > 0 && (
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800 space-y-2">
          <div className="font-semibold">{t('invite.email.linksReady')}</div>
          <div className="space-y-1 max-h-32 overflow-auto pr-1">
            {generatedLinks.map(({ email, link }) => (
              <div key={email} className="flex items-center gap-2">
                <span className="text-xs font-semibold text-emerald-800 min-w-[120px] truncate">{email}</span>
                <code className="text-xs font-mono truncate flex-1">{link}</code>
                <button
                  type="button"
                  onClick={() => navigator.clipboard.writeText(link)}
                  className="text-emerald-800 font-semibold text-xs hover:underline"
                >
                  {t('invite.copy')}
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
        <p className="text-sm font-bold text-slate-700">{t('invite.link.heading')}</p>
        <p className="text-xs text-slate-500">{t('invite.link.description')}</p>
      </div>

      <div className="flex justify-center">
        <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs">
          {qrDataUrl ? <img src={qrDataUrl} alt={t('invite.link.qrAlt')} className="w-48 h-48" /> : <div className="w-48 h-48 bg-slate-100 animate-pulse rounded" />}
        </div>
      </div>

      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 flex items-center justify-between gap-2">
        <code className="text-xs font-mono text-slate-600 truncate">{link ?? t('invite.link.generating')}</code>
        <button
          onClick={() => link && navigator.clipboard.writeText(link)}
          disabled={!link}
          className={`shrink-0 font-semibold text-xs px-3 py-1.5 rounded-lg border transition ${
            link
              ? 'bg-white text-slate-700 border-slate-200 hover:border-slate-300 hover:bg-slate-50'
              : 'bg-slate-100 text-slate-600 border-slate-200 cursor-not-allowed'
          }`}
        >
          {t('invite.copy')}
        </button>
      </div>
    </div>
  );

  const [showWifiPassword, setShowWifiPassword] = useState(false);

  const renderWifiTab = () => (
    <div className="space-y-4">
      <div className="text-center">
        <p className="text-sm font-bold text-slate-700">{t('invite.wifi.heading')}</p>
        <p className="text-xs text-slate-500">{t('invite.wifi.description')}</p>
      </div>

      <div className="flex justify-center">
        <div className="p-4 bg-white border border-slate-200 rounded-2xl shadow-xs">
          {wifiQrDataUrl ? <img src={wifiQrDataUrl} alt={t('invite.wifi.qrAlt')} className="w-48 h-48" /> : <div className="w-48 h-48 bg-slate-100 animate-pulse rounded" />}
        </div>
      </div>

      <div className="bg-slate-50 p-3 rounded-xl border border-slate-200 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-600">{t('invite.wifi.network')}</span>
          <span className="text-sm font-semibold text-slate-800">{wifiConfig?.ssid}</span>
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-600">{t('invite.wifi.password')}</span>
          <div className="flex items-center gap-1">
            <span className="text-sm font-mono text-slate-800">{showWifiPassword ? wifiConfig?.password : '••••••••'}</span>
            <button
              type="button"
              onClick={() => setShowWifiPassword(prev => !prev)}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-200 hover:text-slate-900 transition"
              aria-label={showWifiPassword ? t('invite.wifi.hidePassword') : t('invite.wifi.showPassword')}
            >
              <span className="material-symbols-outlined text-lg! leading-none" aria-hidden="true">{showWifiPassword ? 'visibility_off' : 'visibility'}</span>
            </button>
          </div>
        </div>
      </div>

      <p className="text-xs text-slate-500 text-center">{t('invite.wifi.hint')}</p>
    </div>
  );

  const tabs: { key: TabType; label: string }[] = [
    { key: 'email', label: t('invite.tab.email') },
    { key: 'link', label: t('invite.tab.link') },
    ...(wifiConfig ? [{ key: 'wifi' as TabType, label: t('invite.tab.wifi') }] : []),
  ];

  return (
    <ModalDialog
      labelledBy="invite-modal-title"
      onClose={onClose}
      // No blur behind it: the veil alone sets it apart, and a blurred veil is
      // the costly effect that drew doubled content in software compositing.
      overlayClassName="fixed inset-0 bg-slate-900/45 flex items-start sm:items-center justify-center z-100 p-4 overflow-y-auto"
      panelClassName="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-xl w-full relative max-h-[calc(100vh-2rem)] flex flex-col"
    >
      <>
        <button
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition"
        >
          <span className="material-symbols-outlined" aria-hidden="true">close</span>
        </button>

        <h3 id="invite-modal-title" className="text-xl font-semibold tracking-tight text-slate-900 mb-1 text-center px-10">{t('invite.title', { teamName: team.name })}</h3>
        <p className="text-slate-500 text-sm text-center mb-4">{t('invite.subtitle')}</p>

        {/* Segmented pills. The chosen one is told by its tint, its weight
            and `aria-pressed`, never by colour alone. */}
        <div className="flex gap-1 p-1 mb-5 rounded-xl bg-slate-100">
          {tabs.map(tab => (
            <button
              key={tab.key}
              data-testid="invite-tab"
              aria-pressed={activeTab === tab.key}
              className={`flex-1 py-1.5 px-2 rounded-lg text-sm transition ${activeTab === tab.key ? 'bg-white text-indigo-700 font-semibold shadow-xs' : 'text-slate-600 font-medium hover:text-slate-900'}`}
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
          <div className="mt-6 pt-4 border-t border-slate-200 text-center">
            <p className="text-xs text-slate-500 mb-2">{t('invite.testAnotherUser')}</p>
            <button
              onClick={onLogout}
              className="text-indigo-700 text-sm font-semibold hover:underline"
            >
              {t('invite.logoutAndCreate')}
            </button>
          </div>
        )}

        <button onClick={onClose} className="w-full bg-white text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 py-2.5 rounded-lg font-semibold mt-4 shrink-0 transition">{t('invite.done')}</button>
      </>
    </ModalDialog>
  );
};

export default InviteModal;
