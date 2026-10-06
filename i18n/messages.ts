/**
 * The two dictionaries, assembled from one file per namespace.
 *
 * English is the source: its keys define `MessageKey`, and every French
 * namespace is typed `Record<keyof typeof en, string>`, so a key missing from
 * (or added only to) the French side fails `npm run type-check`.
 * `__tests__/i18nDictionaries.test.ts` adds what the type system cannot see:
 * every key carries its namespace prefix (two namespaces cannot silently
 * overwrite each other in the spread below) and both languages use the same
 * `{placeholders}`.
 */
import adminEn from './locales/en/admin';
import adminTeamsEn from './locales/en/adminTeams';
import adminFeedbacksEn from './locales/en/adminFeedbacks';
import adminLiveEn from './locales/en/adminLive';
import adminLogsEn from './locales/en/adminLogs';
import adminBackupsEn from './locales/en/adminBackups';
import appEn from './locales/en/app';
import commonEn from './locales/en/common';
import dashboardEn from './locales/en/dashboard';
import errorsEn from './locales/en/errors';
import feedbackEn from './locales/en/feedback';
import healthCheckEn from './locales/en/healthCheck';
import inviteEn from './locales/en/invite';
import loginEn from './locales/en/login';
import phasesEn from './locales/en/phases';
import sessionEn from './locales/en/session';
import sharedEn from './locales/en/shared';
import templatesEn from './locales/en/templates';
import adminFr from './locales/fr/admin';
import adminTeamsFr from './locales/fr/adminTeams';
import adminFeedbacksFr from './locales/fr/adminFeedbacks';
import adminLiveFr from './locales/fr/adminLive';
import adminLogsFr from './locales/fr/adminLogs';
import adminBackupsFr from './locales/fr/adminBackups';
import appFr from './locales/fr/app';
import commonFr from './locales/fr/common';
import dashboardFr from './locales/fr/dashboard';
import errorsFr from './locales/fr/errors';
import feedbackFr from './locales/fr/feedback';
import healthCheckFr from './locales/fr/healthCheck';
import inviteFr from './locales/fr/invite';
import loginFr from './locales/fr/login';
import phasesFr from './locales/fr/phases';
import sessionFr from './locales/fr/session';
import sharedFr from './locales/fr/shared';
import templatesFr from './locales/fr/templates';

/** Namespace name -> [English, French]. The name is also every key's prefix. */
export const NAMESPACES = {
  admin: [adminEn, adminFr],
  adminTeams: [adminTeamsEn, adminTeamsFr],
  adminFeedbacks: [adminFeedbacksEn, adminFeedbacksFr],
  adminLive: [adminLiveEn, adminLiveFr],
  adminLogs: [adminLogsEn, adminLogsFr],
  adminBackups: [adminBackupsEn, adminBackupsFr],
  app: [appEn, appFr],
  common: [commonEn, commonFr],
  dashboard: [dashboardEn, dashboardFr],
  errors: [errorsEn, errorsFr],
  feedback: [feedbackEn, feedbackFr],
  healthCheck: [healthCheckEn, healthCheckFr],
  invite: [inviteEn, inviteFr],
  login: [loginEn, loginFr],
  phases: [phasesEn, phasesFr],
  session: [sessionEn, sessionFr],
  shared: [sharedEn, sharedFr],
  templates: [templatesEn, templatesFr],
} as const;

export const en = {
  ...adminEn,
  ...adminTeamsEn,
  ...adminFeedbacksEn,
  ...adminLiveEn,
  ...adminLogsEn,
  ...adminBackupsEn,
  ...appEn,
  ...commonEn,
  ...dashboardEn,
  ...errorsEn,
  ...feedbackEn,
  ...healthCheckEn,
  ...inviteEn,
  ...loginEn,
  ...phasesEn,
  ...sessionEn,
  ...sharedEn,
  ...templatesEn,
};

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

export const fr: Messages = {
  ...adminFr,
  ...adminTeamsFr,
  ...adminFeedbacksFr,
  ...adminLiveFr,
  ...adminLogsFr,
  ...adminBackupsFr,
  ...appFr,
  ...commonFr,
  ...dashboardFr,
  ...errorsFr,
  ...feedbackFr,
  ...healthCheckFr,
  ...inviteFr,
  ...loginFr,
  ...phasesFr,
  ...sessionFr,
  ...sharedFr,
  ...templatesFr,
};
