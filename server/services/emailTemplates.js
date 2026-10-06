import { escapeHtml } from './security.js';

/**
 * The two mails a facilitator or an invitee reads, in the language of the
 * person who triggered them.
 *
 * The client sends its interface language with the request; anything other
 * than a supported code falls back to English, so the field can never select a
 * template that does not exist or carry text into the mail. The mails the super
 * administrator receives (feedback notifications, new-team alerts) stay in
 * English: the administrator never chose a language.
 *
 * Every caller-supplied value is escaped here, once, for the HTML part — the
 * plain-text part and the subject carry no markup.
 */

const SUPPORTED = new Set(['en', 'fr']);

export const resolveEmailLanguage = (value) => (SUPPORTED.has(value) ? value : 'en');

const INVITE = {
  en: {
    defaultName: 'You',
    subject: (team) => `Invitation to join ${team}`,
    forSession: (session) => ` for the session "${session}"`,
    invited: (team, sessionPart) => `You have been invited to join ${team}${sessionPart}.`,
    invitedHtml: (team, sessionPart) => `You have been invited to join <strong>${team}</strong>${sessionPart}.`,
    useLink: (link) => `Use this link to join: ${link}`,
    joinLink: 'Join with this link',
  },
  fr: {
    defaultName: 'Bonjour',
    subject: (team) => `Invitation à rejoindre ${team}`,
    forSession: (session) => ` pour la session « ${session} »`,
    invited: (team, sessionPart) => `Vous êtes invité(e) à rejoindre ${team}${sessionPart}.`,
    invitedHtml: (team, sessionPart) => `Vous êtes invité(e) à rejoindre <strong>${team}</strong>${sessionPart}.`,
    useLink: (link) => `Utilisez ce lien pour rejoindre la session : ${link}`,
    joinLink: 'Rejoindre avec ce lien',
  },
};

/**
 * @param {{ language?: string, name?: string, teamName: string, sessionName?: string, link: string, htmlLink: string }} input
 *   `link` is the canonical link for the text part; `htmlLink` the sanitised one for the anchor.
 */
export const buildInviteEmail = ({ language, name, teamName, sessionName, link, htmlLink }) => {
  const words = INVITE[resolveEmailLanguage(language)];
  const greeting = name || words.defaultName;
  const textSession = sessionName ? words.forSession(sessionName) : '';
  const htmlSession = sessionName ? words.forSession(escapeHtml(sessionName)) : '';

  return {
    subject: words.subject(teamName),
    text: `${greeting},

${words.invited(teamName, textSession)}
${words.useLink(link)}
`,
    html: `<p>${escapeHtml(greeting)},</p>
<p>${words.invitedHtml(escapeHtml(teamName), htmlSession)}</p>
<p><a href="${escapeHtml(htmlLink)}" target="_blank" rel="noreferrer">${words.joinLink}</a></p>`,
  };
};

const PASSWORD_RESET = {
  en: {
    subject: (team) => `Password Reset - ${team}`,
    hello: 'Hello,',
    requested: (team) => `You have requested a password reset for the team "${team}".`,
    requestedHtml: (team) => `You have requested a password reset for the team <strong>${team}</strong>.`,
    clickText: (link) => `Click this link to reset your password: ${link}`,
    clickHtml: 'Click here to reset your password',
    validity: 'This link is valid for 1 hour.',
    ignore: 'If you did not request this reset, please ignore this email.',
  },
  fr: {
    subject: (team) => `Réinitialisation du mot de passe - ${team}`,
    hello: 'Bonjour,',
    requested: (team) => `Vous avez demandé la réinitialisation du mot de passe de l'équipe « ${team} ».`,
    requestedHtml: (team) => `Vous avez demandé la réinitialisation du mot de passe de l'équipe <strong>${team}</strong>.`,
    clickText: (link) => `Cliquez sur ce lien pour réinitialiser votre mot de passe : ${link}`,
    clickHtml: 'Cliquez ici pour réinitialiser votre mot de passe',
    validity: 'Ce lien est valable 1 heure.',
    ignore: "Si vous n'êtes pas à l'origine de cette demande, ignorez simplement cet e-mail.",
  },
};

/** @param {{ language?: string, teamName: string, link: string }} input */
export const buildPasswordResetEmail = ({ language, teamName, link }) => {
  const words = PASSWORD_RESET[resolveEmailLanguage(language)];
  return {
    subject: words.subject(teamName),
    text: `${words.hello}

${words.requested(teamName)}

${words.clickText(link)}

${words.validity}

${words.ignore}
`,
    html: `<p>${words.hello}</p>
<p>${words.requestedHtml(escapeHtml(teamName))}</p>
<p><a href="${escapeHtml(link)}" target="_blank" rel="noreferrer">${words.clickHtml}</a></p>
<p>${words.validity}</p>
<p><em>${words.ignore}</em></p>`,
  };
};
