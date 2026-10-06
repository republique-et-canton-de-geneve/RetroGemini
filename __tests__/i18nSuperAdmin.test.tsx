import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import SuperAdmin from '../components/SuperAdmin';
import { intlLocaleFor } from '../i18n/languages';
import { localizeDecimal } from '../i18n/formatNumber';
import { NoticeError, noticeFromError } from '../i18n/notice';
import { en, fr } from '../i18n/messages';
import { PASSWORD_MIN_LENGTH } from '../utils/passwordPolicy.js';
import type { ActiveSession, BackupEntry, ServerLogEntry, Team, TeamFeedback } from '../types';

/**
 * The French super-admin console. The English text is pinned by the console's
 * own suites (superAdminTeamSorting, passwordPolicyForms,
 * formLabelAssociation), which render without a provider; these cases render
 * under `initialLanguage="fr"` and check that the chrome switches on the header
 * and on every tab while data — team names, feedback text, the server's log
 * messages, a label the operator typed — stays exactly as it came.
 *
 * Until this change the console was the one screen left in English, and it
 * said so with `lang="en"` on its root; the first case pins that it no longer
 * does.
 */

const FR_LOCALE = intlLocaleFor('fr');

const teams: Team[] = [
  {
    id: 'team-1',
    name: 'Team One',
    passwordHash: 'hash',
    members: [
      { id: 'u1', name: 'Alice', color: '#f00', role: 'participant' },
      { id: 'u2', name: 'Bob', color: '#0f0', role: 'participant' },
      { id: 'u3', name: 'Carol', color: '#00f', role: 'participant' }
    ],
    customTemplates: [],
    retrospectives: [],
    globalActions: [],
    lastConnectionDate: '2026-03-10T10:00:00.000Z'
  },
  {
    id: 'team-2',
    name: 'Team Two',
    passwordHash: 'hash',
    facilitatorEmail: 'two@example.com',
    members: [{ id: 'u4', name: 'Dave', color: '#ff0', role: 'participant' }],
    customTemplates: [],
    retrospectives: [],
    globalActions: []
  }
];

const feedbacks: TeamFeedback[] = [
  {
    id: 'feedback-a',
    teamId: 'team-1',
    teamName: 'Team One',
    type: 'bug',
    title: 'Alpha report',
    description: 'The first feedback',
    submittedBy: 'u1',
    submittedByName: 'Alice',
    submittedAt: '2026-08-01T10:00:00.000Z',
    isRead: false,
    status: 'pending',
    comments: [
      {
        id: 'comment-1',
        feedbackId: 'feedback-a',
        authorId: 'u2',
        authorName: 'Bob',
        teamId: 'team-1',
        teamName: 'Team One',
        content: 'Same here',
        createdAt: '2026-08-02T10:00:00.000Z'
      }
    ]
  },
  {
    id: 'feedback-b',
    teamId: 'team-2',
    teamName: 'Team Two',
    type: 'feature',
    title: 'Beta request',
    description: 'The second feedback',
    submittedBy: 'u4',
    submittedByName: 'Dave',
    submittedAt: '2026-08-03T10:00:00.000Z',
    isRead: true,
    status: 'in_progress',
    comments: []
  }
];

const sessions: ActiveSession[] = [
  {
    sessionId: 'session-1',
    type: 'retrospective',
    teamId: 'team-1',
    teamName: 'Team One',
    sessionName: 'Sprint 12 retro',
    phase: 'BRAINSTORM',
    status: 'IN_PROGRESS',
    participants: [{ id: 'u1', name: 'Alice' }],
    connectedCount: 1
  }
];

const logs: ServerLogEntry[] = [
  {
    id: 'log-1',
    timestamp: '2026-09-01T08:30:00.000Z',
    level: 'error',
    source: 'server',
    message: 'Database connection lost'
  }
];

const backups: BackupEntry[] = [
  {
    id: 'backup-1',
    filename: 'startup.json.gz',
    type: 'startup',
    label: 'Server startup',
    createdAt: '2026-09-01T06:00:00.000Z',
    sizeBytes: 1536,
    teamCount: 2,
    protected: false
  },
  {
    id: 'backup-2',
    filename: 'manual.json.gz',
    type: 'manual',
    label: 'Before upgrade',
    createdAt: '2026-09-02T06:00:00.000Z',
    sizeBytes: 512,
    teamCount: 2,
    protected: true
  }
];

type Reply = { status: number; body: unknown };
let overrides: Record<string, Reply> = {};

const routes = (): Record<string, Reply> => ({
  '/api/super-admin/teams': { status: 200, body: { teams } },
  '/api/super-admin/feedbacks': { status: 200, body: { feedbacks } },
  '/api/info-message': { status: 200, body: { infoMessage: '' } },
  '/api/super-admin/admin-email': { status: 200, body: { adminEmail: 'ops@example.com', notifyNewTeam: false } },
  '/api/super-admin/ai-settings': { status: 200, body: { ai: { enabled: true, apiUrl: 'https://llm.internal/v1' } } },
  '/api/super-admin/active-sessions': { status: 200, body: { sessions } },
  '/api/super-admin/logs': { status: 200, body: { logs } },
  '/api/super-admin/backups/list': {
    status: 200,
    body: {
      backups,
      config: { enabled: true, intervalHours: 24, maxCount: 7, backupDir: '/data/backups', onStartup: true }
    }
  },
  ...overrides
});

const mockFetch = () => {
  global.fetch = vi.fn((url: string) => {
    const reply = routes()[url] ?? { status: 200, body: {} };
    return Promise.resolve({
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: () => Promise.resolve(reply.body)
    });
  }) as unknown as typeof fetch;
};

const renderConsole = async () => {
  const view = render(
    <LanguageProvider initialLanguage="fr">
      <SuperAdmin sessionToken="test-token" onExit={vi.fn()} />
    </LanguageProvider>
  );
  // The team list, not the header: the header is in the very first render, so
  // waiting on it would wait for nothing.
  await waitFor(() => expect(screen.getByText('Team One')).toBeTruthy());
  return view;
};

// A tab's accessible name starts with its icon's ligature ("stream", "backup"…).
const openTab = (name: RegExp) => fireEvent.click(screen.getByRole('button', { name }));

describe('the super-admin console in French', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    overrides = {};
    mockFetch();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    try {
      localStorage.clear();
    } catch {
      // Storage is optional in the page; it is optional here too.
    }
  });

  it('translates the header, the settings blocks and the tab bar, and offers the switcher', async () => {
    await renderConsole();

    const title = screen.getByRole('heading', { level: 1, name: /Tableau de bord super administrateur/ });
    // No `lang="en"` on the console any more: the nearest declaration is the
    // page's own, which follows the interface language.
    expect(title.closest('[lang]')?.getAttribute('lang')).toBe('fr');
    expect(screen.getByText('Gérez toutes les équipes et leurs e-mails de récupération')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Quitter le mode administrateur/ })).toBeTruthy();
    expect(screen.getByTestId('language-switcher')).toBeTruthy();

    expect(screen.getByRole('heading', { name: /Message d’information/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Notifications de retours/ })).toBeTruthy();
    expect(screen.getByLabelText('Adresse e-mail de l’administrateur')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Assistant IA/ })).toBeTruthy();
    await waitFor(() => expect(screen.getByLabelText(/URL de l’API/)).toBeTruthy());
    expect(screen.getByLabelText('Clé d’API')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Tester la connexion/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Sauvegarde des données/ })).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Restauration des données/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Importer et restaurer/ })).toBeTruthy();

    expect(screen.getByRole('button', { name: /Équipes \(2\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Retours \(2\)/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sessions en direct$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Journaux du serveur$/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Sauvegardes$/ })).toBeTruthy();

    for (const english of [
      'Super Admin Dashboard',
      'Exit Admin Mode',
      'Info Message',
      'Feedback Notifications',
      'AI Assistant',
      'Backup Data',
      'Live Sessions',
      'Server Logs'
    ]) {
      expect(screen.queryByText(english), english).toBeNull();
    }
  });

  it('translates the Teams tab while team names and emails stay as stored', async () => {
    await renderConsole();

    expect(screen.getByRole('heading', { name: 'Équipes (2)' })).toBeTruthy();
    for (const header of ['Nom de l’équipe', 'Membres', 'Dernière activité']) {
      expect(screen.getByRole('button', { name: new RegExp(header) })).toBeTruthy();
    }
    expect(screen.getByRole('columnheader', { name: 'E-mail de récupération' })).toBeTruthy();
    expect(screen.getAllByRole('columnheader', { name: 'Actions' })).toHaveLength(1);

    expect(screen.getByText('3 membres')).toBeTruthy();
    expect(screen.getByText('1 membre')).toBeTruthy();
    expect(screen.getByText('Jamais')).toBeTruthy();
    expect(screen.getByText('Non configuré')).toBeTruthy();
    expect(screen.getByText('two@example.com')).toBeTruthy();
    // getByText normalises the element's no-break space, not the matcher's.
    expect(screen.getByText('ID : team-1')).toBeTruthy();
    expect(
      screen.getByText(new Date('2026-03-10T10:00:00.000Z').toLocaleDateString(FR_LOCALE))
    ).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Renommer' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Changer le mot de passe' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Modifier l’e-mail' })).toHaveLength(2);

    for (const english of ['Team Name', 'Recovery Email', 'Last Active', 'Never', 'Not configured', 'Rename']) {
      expect(screen.queryByText(english), english).toBeNull();
    }
  });

  it('keeps a visible notice in step with the language switcher', async () => {
    await renderConsole();
    fireEvent.click(screen.getAllByRole('button', { name: 'Changer le mot de passe' })[0]);

    const field = screen.getByPlaceholderText(`Nouveau mot de passe (${PASSWORD_MIN_LENGTH} caractères min.)`);
    fireEvent.change(field, { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer' }));

    const french = `Le mot de passe doit contenir au moins ${PASSWORD_MIN_LENGTH} caractères`;
    expect(screen.getByText(french)).toBeTruthy();

    // The notice is stored as what to say, so the switch re-reads it.
    fireEvent.click(screen.getByTestId('language-option-en'));

    expect(screen.getByText(`Password must be at least ${PASSWORD_MIN_LENGTH} characters`)).toBeTruthy();
    expect(screen.queryByText(french)).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: /Super Admin Dashboard/ })).toBeTruthy();
  });

  it('translates a notice the console raises itself, and a sentence the server sent', async () => {
    overrides = {
      '/api/super-admin/info-message': { status: 401, body: { error: 'unauthorized' } },
      '/api/super-admin/test-ai': {
        status: 400,
        body: { error: 'ai_not_configured', message: 'AI is not enabled or not configured' }
      }
    };
    await renderConsole();

    fireEvent.click(screen.getByRole('button', { name: /Enregistrer le message/ }));
    await waitFor(() =>
      expect(screen.getByText('La session super administrateur a expiré. Veuillez vous reconnecter.')).toBeTruthy()
    );

    await waitFor(() => expect(screen.getByRole('button', { name: /Tester la connexion/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Tester la connexion/ }));
    await waitFor(() => expect(screen.getByText('L’IA n’est pas activée ou n’est pas configurée')).toBeTruthy());

    fireEvent.click(screen.getByTestId('language-option-en'));

    expect(screen.getByText('Super admin session expired. Please log in again.')).toBeTruthy();
    expect(screen.getByText('AI is not enabled or not configured')).toBeTruthy();
  });

  it('translates the Feedbacks tab and its comment dialog while feedback text stays as written', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderConsole();
    openTab(/Retours \(2\)/);

    // The type filter and the status filter both offer "all".
    expect(screen.getAllByRole('button', { name: 'Tous (2)' })).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Non lus (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Bugs (1)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Fonctionnalités (1)' })).toBeTruthy();
    expect(screen.getByText('Statut :')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'En attente (1)' })).toBeTruthy();
    expect(screen.getByText('Nouveau')).toBeTruthy();
    expect(screen.getByText('Commentaires (1) :')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Marquer comme lu' })).toBeTruthy();
    expect(screen.getByRole('combobox', { name: 'Statut du retour\u00a0: Alpha report' })).toBeTruthy();
    expect(
      screen.getAllByText(
        new Date('2026-08-01T10:00:00.000Z').toLocaleDateString(FR_LOCALE, {
          month: '2-digit',
          day: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit'
        })
      ).length
    ).toBeGreaterThan(0);

    // Data stays data.
    expect(screen.getByText('Alpha report')).toBeTruthy();
    expect(screen.getByText('Same here')).toBeTruthy();

    fireEvent.click(screen.getAllByRole('button', { name: 'Supprimer' })[0]);
    expect(confirmSpy).toHaveBeenCalledWith(
      'Voulez-vous vraiment supprimer ce retour de l’équipe «\u00a0Team One\u00a0»\u202f?'
    );

    fireEvent.click(screen.getAllByRole('button', { name: 'Ajouter un commentaire' })[0]);
    const dialog = screen.getByRole('dialog', { name: 'Ajouter un commentaire' });
    expect(within(dialog).getByPlaceholderText('Rédigez votre commentaire ici…')).toBeTruthy();
    expect(within(dialog).getByText('1 000 caractères au maximum')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Annuler' })).toBeTruthy();

    for (const english of ['Unread (1)', 'Mark as Read', 'Add Comment', 'Write your comment here...']) {
      expect(screen.queryByText(english), english).toBeNull();
    }
  });

  it('translates the Live sessions tab, the phase and the status included', async () => {
    await renderConsole();
    openTab(/Sessions en direct$/);

    await waitFor(() => expect(screen.getByText('Sprint 12 retro')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Sessions actives' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Actualiser/ })).toBeTruthy();
    expect(screen.getByText('Sessions actives détectées')).toBeTruthy();
    expect(screen.getByText(/1 session\(s\) avec 1 utilisateur\(s\) connecté\(s\)/)).toBeTruthy();
    expect(screen.getByText('Rétrospective')).toBeTruthy();
    expect(screen.getByText('EN DIRECT')).toBeTruthy();
    expect(screen.getByText('Équipe : Team One')).toBeTruthy();
    // The fixture's session has one participant, the common case: the caption
    // under the count must not be a plural ('1 Connectés').
    expect(screen.getByText('En ligne')).toBeTruthy();
    expect(screen.queryByText('Connectés')).toBeNull();
    expect(screen.getByText('BRAINSTORMING')).toBeTruthy();
    expect(screen.getByText('En cours')).toBeTruthy();
    expect(screen.getByText('Participants connectés :')).toBeTruthy();

    for (const english of ['Active Sessions', 'Active sessions detected', 'LIVE', 'Connected', 'IN_PROGRESS']) {
      expect(screen.queryByText(english), english).toBeNull();
    }
  });

  it('translates the Logs tab and marks the server’s own message as English', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderConsole();
    openTab(/Journaux du serveur$/);

    const message = await screen.findByText('Database connection lost');
    expect(message.getAttribute('lang')).toBe('en');

    expect(screen.getByRole('heading', { name: 'Journaux du serveur' })).toBeTruthy();
    expect(screen.getByLabelText('Niveau :')).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Tous les niveaux' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Avertissements' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Toutes les sources' })).toBeTruthy();
    expect(screen.getByRole('option', { name: 'Serveur' })).toBeTruthy();
    expect(screen.getByText('1 entrée de journal')).toBeTruthy();
    for (const header of ['Horodatage', 'Niveau', 'Source', 'Message']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(screen.getByText('erreur')).toBeTruthy();
    expect(screen.getByText('serveur')).toBeTruthy();
    expect(screen.getByText(new Date('2026-09-01T08:30:00.000Z').toLocaleString(FR_LOCALE))).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: /Effacer les journaux/ }));
    expect(confirmSpy).toHaveBeenCalledWith('Voulez-vous vraiment effacer tous les journaux du serveur\u202f?');

    for (const english of ['Clear Logs', 'All Levels', 'Timestamp', '1 log entries', '1 log entry']) {
      expect(screen.queryByText(english), english).toBeNull();
    }
  });

  it('translates the Backups tab, server-written labels included, and leaves the operator’s label alone', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await renderConsole();
    openTab(/Sauvegardes$/);

    await waitFor(() => expect(screen.getByText('Before upgrade')).toBeTruthy());
    expect(screen.getByRole('heading', { name: /Configuration/ })).toBeTruthy();
    expect(screen.getByText('Activées')).toBeTruthy();
    expect(screen.getByText('24 h')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Créer un point de contrôle/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Créer un point de contrôle/ })).toBeTruthy();
    expect(screen.getByPlaceholderText('Libellé facultatif (p. ex. Avant la mise à jour v10)')).toBeTruthy();
    for (const header of ['Type', 'Libellé / date', 'Équipes', 'Taille', 'Protégée']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeTruthy();
    }
    expect(screen.getByText('démarrage')).toBeTruthy();
    expect(screen.getByText('manuelle')).toBeTruthy();
    expect(screen.getByText('Démarrage du serveur')).toBeTruthy();
    expect(screen.getByText(`${localizeDecimal('1.5', FR_LOCALE)} Ko`)).toBeTruthy();
    expect(screen.getByText('512 o')).toBeTruthy();
    expect(screen.getByText(new Date('2026-09-01T06:00:00.000Z').toLocaleString(FR_LOCALE))).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Télécharger la sauvegarde' })).toHaveLength(2);
    expect(screen.getAllByRole('button', { name: 'Restaurer la sauvegarde' })).toHaveLength(2);

    fireEvent.click(screen.getAllByRole('button', { name: 'Supprimer la sauvegarde' })[0]);
    expect(confirmSpy).toHaveBeenCalledWith('Supprimer la sauvegarde «\u00a0Démarrage du serveur\u00a0»\u202f?');

    for (const english of ['Create Checkpoint', 'Server startup', 'Loading backups...', 'Enabled', 'startup']) {
      expect(screen.queryByText(english), english).toBeNull();
    }
  });
});

describe('the console’s French wording', () => {
  // An English sentence the console shares with the dashboard reads the same
  // in French on both screens: the operator and the facilitator see one
  // message for one event. Apostrophes are compared as one character, since
  // the two files differ only in which glyph they write.
  const sameApostrophe = (text: string) => text.replace(/\u2019/g, "'");
  const shared = [
    ['adminTeams.notice.renamed', 'dashboard.settings.renamed'],
    ['adminTeams.notice.renameFailed', 'dashboard.settings.renameFailed'],
  ] as const;

  it.each(shared)('says %s the way the dashboard says %s', (adminKey, dashboardKey) => {
    expect(en[adminKey]).toBe(en[dashboardKey]);
    expect(sameApostrophe(fr[adminKey])).toBe(sameApostrophe(fr[dashboardKey]));
  });
});

describe('NoticeError', () => {
  it('carries the notice to the catch, with an English message for logs', () => {
    const err = new NoticeError({ key: 'admin.notice.sessionExpired' });
    expect(err.message).toBe('Super admin session expired. Please log in again.');
    expect(noticeFromError(err, { key: 'errors.unknown' })).toEqual({ key: 'admin.notice.sessionExpired' });
  });

  it('keeps any other error as raw text, and falls back only when there is none', () => {
    expect(noticeFromError(new TypeError('Failed to fetch'), { key: 'errors.unknown' })).toEqual({ raw: 'Failed to fetch' });
    expect(noticeFromError(new Error(''), { key: 'errors.unknown' })).toEqual({ key: 'errors.unknown' });
    expect(noticeFromError('not an error', { key: 'errors.unknown' })).toEqual({ key: 'errors.unknown' });
  });
});
