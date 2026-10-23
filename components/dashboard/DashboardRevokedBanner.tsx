import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';

interface Props {
  onLogInAgain: () => void;
}

/**
 * Decision D3b — the team's password was changed elsewhere, and this
 * Dashboard's session was signed out with it. Shown above the Dashboard
 * rather than replacing it with the login screen, for the reason the session
 * screens give (`useSessionRevoked`, the H12 rationale): whatever the user was
 * writing — a feedback with its screenshots, a reply to one — lives only on
 * this screen, and an immediate sign-out took it away before they could copy
 * it. Nothing is saved meanwhile: every write is refused (`dataService`
 * sends none while revoked, the feedback routes answer `401`), and each form
 * already says so in its own words. "Log in again" is the way out.
 */
const DashboardRevokedBanner: React.FC<Props> = ({ onLogInAgain }) => {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="shrink-0 bg-rose-100 border-b border-rose-300 text-rose-900 text-sm px-4 sm:px-6 py-2 flex flex-wrap items-center justify-center gap-2"
    >
      <span className="material-symbols-outlined text-base" aria-hidden="true">lock</span>
      <span>{t('app.sessionRevoked.banner')}</span>
      <button
        type="button"
        onClick={onLogInAgain}
        className="font-bold underline underline-offset-2 hover:text-rose-700"
      >
        {t('app.sessionRevoked.logInAgain')}
      </button>
    </div>
  );
};

export default DashboardRevokedBanner;
