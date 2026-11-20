import React from 'react';
import { useTranslation } from '../../i18n/I18nContext';
import { BANNER_ACTION_CLASS, BANNER_ALERT_CLASS, BANNER_CLASS, BANNER_ICON_CLASS } from '../session/SessionConnectionStatus';

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
 *
 * It is drawn as the session's own "signed out" band (the recipes of
 * `SessionConnectionStatus`): one revocation, one look, on both screens.
 */
const DashboardRevokedBanner: React.FC<Props> = ({ onLogInAgain }) => {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className={`shrink-0 ${BANNER_CLASS} ${BANNER_ALERT_CLASS}`}
    >
      <span className={BANNER_ICON_CLASS} aria-hidden="true">lock</span>
      <span>{t('app.sessionRevoked.banner')}</span>
      <button
        type="button"
        onClick={onLogInAgain}
        className={BANNER_ACTION_CLASS}
      >
        {t('app.sessionRevoked.logInAgain')}
      </button>
    </div>
  );
};

export default DashboardRevokedBanner;
