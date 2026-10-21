import React, { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import LanguageProvider from '../i18n/LanguageProvider';
import LanguageSwitcher from '../components/common/LanguageSwitcher';
import type { ActionItem, RetroSession, Team } from '../types';
import { installJiraFetch, ok, refused, statusWith } from './helpers/jiraClientFetch';

/**
 * Every Jira control, rendered under the French interface. The English
 * suites pin the behaviour; this one pins that nothing a French reader sees is
 * left in English, and that an issue's preview follows the *retro's* language
 * (content), not the reader's (chrome).
 *
 * Role names are matched with the real French spaces (U+00A0 before a colon):
 * `getByRole({ name })` does not normalise them, `getByText` does.
 */

vi.mock('../services/dataService', () => ({
  dataService: {
    getSessionToken: () => 'token-1',
    getAuthenticatedPassword: () => null,
    whenPersisted: async () => {},
    applyJiraLinks: () => {},
    applyJiraParents: () => {}
  }
}));

import JiraLinkBadge from '../components/jira/JiraLinkBadge';
import JiraActionControl from '../components/jira/JiraActionControl';
import JiraReasonLine from '../components/jira/JiraReasonLine';
import JiraDiscoveryNote from '../components/jira/JiraDiscoveryNote';
import JiraTargetFields from '../components/jira/JiraTargetFields';
import JiraBatchButton from '../components/jira/JiraBatchButton';
import JiraBatchDialog from '../components/jira/JiraBatchDialog';
import JiraParentLine from '../components/jira/JiraParentLine';
import JiraTeamSettings from '../components/jira/JiraTeamSettings';
import JiraSettingsCard from '../components/admin/JiraSettingsCard';
import { draftFromTarget, type JiraTargetDraft } from '../components/jira/jiraTargetDraft';
import { jiraInFlight } from '../components/jira/jiraInFlight';

const inFrench = (ui: React.ReactElement) => render(<LanguageProvider initialLanguage="fr">{ui}</LanguageProvider>);

const action = (id: string, text: string, overrides: Partial<ActionItem> = {}): ActionItem => ({
  id,
  text,
  assigneeId: null,
  done: false,
  type: 'new',
  proposalVotes: {},
  ...overrides
});

describe('the Jira controls in French', () => {
  beforeEach(() => {
    localStorage.clear();
    jiraInFlight.clear();
    installJiraFetch({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('JiraLinkBadge', () => {
    const { unmount } = inFrench(<JiraLinkBadge link={{ key: 'TEAM-1', createdAt: 'x' }} baseUrl="https://jira.example.org" />);
    expect(screen.getByRole('link', { name: 'TEAM-1, ouvrir dans Jira (nouvel onglet)' })).toBeInTheDocument();
    unmount();

    inFrench(<JiraLinkBadge link={{ key: 'TEAM-1', createdAt: 'x' }} baseUrl={null} />);
    expect(screen.getByText('Jira : TEAM-1')).toBeInTheDocument();
  });

  it('JiraActionControl', () => {
    inFrench(
      <JiraActionControl
        action={action('a1', 'Accélérer le build', { jira: { uncertainSince: 'x' } })}
        status={statusWith()}
        teamId="team-1"
        isFacilitator
        kind="retro"
        requestedBy="Anne"
        team={{}}
      />
    );
    expect(screen.getByText('Peut-être déjà dans Jira')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vérifier dans Jira, Accélérer le build (nouvel onglet)' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Créer quand même, Accélérer le build' }));
    expect(screen.getByRole('button', { name: 'Oui, le créer, Accélérer le build' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });

  it('JiraActionControl, idle', () => {
    inFrench(
      <JiraActionControl
        action={action('a1', 'Accélérer le build')}
        status={statusWith()}
        teamId="team-1"
        isFacilitator
        kind="retro"
        requestedBy="Anne"
        team={{}}
      />
    );
    expect(screen.getByRole('button', { name: 'Créer dans Jira, Accélérer le build' })).toHaveTextContent('Créer dans Jira');
  });

  it('JiraReasonLine', () => {
    inFrench(<JiraReasonLine status={statusWith({ target: null })} isFacilitator />);
    expect(screen.getByText('Choisissez où créer les tickets dans Paramètres → Jira.')).toBeInTheDocument();
  });

  it('JiraDiscoveryNote', () => {
    inFrench(<JiraDiscoveryNote status={statusWith({ target: null })} isFacilitator userId="u1" />);
    const note = screen.getByRole('note', { name: 'Nouveau : créez vos actions dans Jira' });
    expect(note).toHaveTextContent('terminez la configuration de Jira dans Paramètres → Jira');
    expect(within(note).getByRole('button', { name: 'Compris' })).toBeInTheDocument();
  });

  it('JiraTargetFields', () => {
    inFrench(<JiraTargetFields teamId="team-1" value={draftFromTarget(null)} onChange={() => {}} idPrefix="fr" />);
    expect(screen.getByRole('radiogroup', { name: 'Créer en tant que' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sous-tâches d’un ticket' })).toBeInTheDocument();
    expect(screen.getByLabelText('Clé du projet')).toBeInTheDocument();
    expect(screen.getByLabelText('Type de ticket')).toBeInTheDocument();
    expect(screen.getByLabelText('Étiquettes')).toBeInTheDocument();
  });

  it('JiraBatchButton, with the preview in the retro\'s language', () => {
    const actions = [action('a1', 'Accélérer le build'), action('a2', 'Écrire le runbook')];
    const retro = {
      id: 'r1', name: 'Sprint 12', date: '2026-10-06', templateLanguage: 'fr', actions, tickets: [], groups: []
    } as unknown as RetroSession;
    const team = { id: 'team-1', retrospectives: [retro], healthChecks: [], globalActions: [] } as unknown as Team;
    inFrench(
      <JiraBatchButton
        actions={actions}
        status={statusWith()}
        teamId="team-1"
        isFacilitator
        sessionId="r1"
        kind="retro"
        team={team}
        session={retro}
        requestedBy="Anne"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Créer dans Jira (2)' }));
    const dialog = screen.getByRole('dialog', { name: 'Créer les actions dans Jira' });
    expect(within(dialog).getByText('Dans le projet TEAM')).toBeInTheDocument();
    expect(within(dialog).getByRole('list', { name: 'Ce qui sera envoyé dans Jira' })).toHaveTextContent(
      'Action de la rétrospective Sprint 12 (2026-10-06). Demandée dans RetroGemini par Anne.'
    );
    // Content, marked with its language for a screen reader.
    const descriptions = within(dialog).getAllByText(/^Action de la rétrospective Sprint 12/);
    expect(descriptions).toHaveLength(2);
    for (const description of descriptions) expect(description).toHaveAttribute('lang', 'fr');
    expect(within(dialog).getByRole('button', { name: 'Créer 2 tickets' })).toBeInTheDocument();
  });

  it('JiraBatchButton, an English retro previewed for a French reader stays English', () => {
    const actions = [action('a1', 'Speed up the build')];
    const retro = { id: 'r1', name: 'Sprint 12', date: '2026-10-06', templateLanguage: 'en', actions } as unknown as RetroSession;
    const team = { id: 'team-1', retrospectives: [retro], healthChecks: [], globalActions: [] } as unknown as Team;
    inFrench(
      <JiraBatchButton
        actions={actions}
        status={statusWith()}
        teamId="team-1"
        isFacilitator
        kind="retro"
        team={team}
        session={retro}
        requestedBy="Anne"
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Créer dans Jira (1)' }));
    expect(screen.getByRole('list', { name: 'Ce qui sera envoyé dans Jira' })).toHaveTextContent(
      'Action from the retrospective Sprint 12 (2026-10-06). Requested in RetroGemini as Anne.'
    );
    // Read in English, on a French page: the description says so.
    expect(screen.getByText('Action from the retrospective Sprint 12 (2026-10-06). Requested in RetroGemini as Anne.'))
      .toHaveAttribute('lang', 'en');
  });

  // An action the server finds with no text: refused with `no_text` and no
  // Jira message, and said as such, never as a refusal by Jira (I3).
  it('JiraActionControl and JiraBatchButton, an action with no text', async () => {
    installJiraFetch({
      '/jira/issues': () => ok({ results: [{ actionId: 'a1', status: 'refused', reason: 'no_text', jiraMessages: [] }], remaining: [] })
    });
    const actions = [action('a1', 'Accélérer le build')];
    const retro = { id: 'r1', name: 'Sprint 12', date: '2026-10-06', templateLanguage: 'fr', actions } as unknown as RetroSession;
    const team = { id: 'team-1', retrospectives: [retro], healthChecks: [], globalActions: [] } as unknown as Team;
    const { unmount } = inFrench(
      <JiraActionControl action={actions[0]} status={statusWith()} teamId="team-1" isFacilitator kind="retro" requestedBy="Anne" team={team} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Créer dans Jira, Accélérer le build' }));
    expect(await screen.findByText('Cette action n’a pas de texte, elle ne peut donc pas être créée dans Jira.')).toBeInTheDocument();
    expect(screen.queryByText(/Jira a refusé/)).toBeNull();
    unmount();

    inFrench(
      <JiraBatchButton actions={actions} status={statusWith()} teamId="team-1" isFacilitator sessionId="r1" kind="retro" team={team} session={retro} requestedBy="Anne" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Créer dans Jira (1)' }));
    const dialog = screen.getByRole('dialog', { name: 'Créer les actions dans Jira' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer 1 ticket' }));
    expect(await within(dialog).findByText('1 action n’a pas de texte, elle ne peut donc pas être créée dans Jira')).toBeInTheDocument();
    expect(within(dialog).queryByText(/refusée par Jira/)).toBeNull();
  });

  // Jira refused without words (a gateway's page): Jira's refusal, never
  // "no text" (I3).
  it('JiraActionControl and JiraBatchButton, a refusal Jira gave without words', async () => {
    installJiraFetch({
      '/jira/issues': () => ok({ results: [{ actionId: 'a1', status: 'refused', jiraMessages: [] }], remaining: [] })
    });
    const actions = [action('a1', 'Accélérer le build')];
    const retro = { id: 'r1', name: 'Sprint 12', date: '2026-10-06', templateLanguage: 'fr', actions } as unknown as RetroSession;
    const team = { id: 'team-1', retrospectives: [retro], healthChecks: [], globalActions: [] } as unknown as Team;
    const { unmount } = inFrench(
      <JiraActionControl action={actions[0]} status={statusWith()} teamId="team-1" isFacilitator kind="retro" requestedBy="Anne" team={team} />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Créer dans Jira, Accélérer le build' }));
    expect(await screen.findByText('Jira a refusé ce ticket.')).toBeInTheDocument();
    expect(screen.queryByText(/pas de texte/)).toBeNull();
    unmount();

    inFrench(
      <JiraBatchButton actions={actions} status={statusWith()} teamId="team-1" isFacilitator sessionId="r1" kind="retro" team={team} session={retro} requestedBy="Anne" />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Créer dans Jira (1)' }));
    const dialog = screen.getByRole('dialog', { name: 'Créer les actions dans Jira' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Créer 1 ticket' }));
    expect(await within(dialog).findByText('1 refusée par Jira')).toBeInTheDocument();
    expect(within(dialog).getByText(/Jira a refusé ce ticket\./)).toBeInTheDocument();
    expect(within(dialog).queryByText(/pas de texte/)).toBeNull();
  });

  describe('one parent issue per session', () => {
    const SESSION_TARGET = { mode: 'sessionParent' as const, projectKey: 'EQUIPE', parentIssueTypeId: '10001', issueTypeId: '10003', labels: [] };
    const TYPES = [
      { id: '10001', name: 'Tâche', subtask: false },
      { id: '10003', name: 'Sous-tâche', subtask: true }
    ];
    const frRetro = { id: 'r1', name: 'Sprint 12', date: '21.10.2026', templateLanguage: 'fr', actions: [action('a1', 'Accélérer le build')] } as unknown as RetroSession;
    const frTeam = (jiraParents: Team['jiraParents'] = {}) =>
      ({ id: 'team-1', name: 'Plateforme', retrospectives: [frRetro], healthChecks: [], globalActions: [action('b1', 'Ranger le tableau')], jiraParents } as unknown as Team);

    it('JiraTargetFields, the third mode and its two lists', async () => {
      installJiraFetch({ '/jira/issue-types': () => ok({ issueTypes: TYPES, projectKey: 'EQUIPE', subtasksIncluded: true }) });
      const Harness = () => {
        const [draft, setDraft] = useState<JiraTargetDraft>(draftFromTarget(SESSION_TARGET));
        return <JiraTargetFields teamId="team-1" value={draft} onChange={setDraft} idPrefix="t" />;
      };
      inFrench(<Harness />);

      const radio = screen.getByRole('radio', { name: 'Sous-tâches d’un nouveau ticket par rétrospective ou bilan de santé' });
      expect(radio).toBeChecked();
      expect(radio).toHaveAccessibleDescription(/RetroGemini crée dans ce projet un ticket par rétrospective ou bilan de santé/);
      await waitFor(() => expect(within(screen.getByLabelText('Type du ticket parent')).getByRole('option', { name: 'Tâche' })).toBeInTheDocument());
      expect(within(screen.getByLabelText('Type de sous-tâche')).getByRole('option', { name: 'Sous-tâche' })).toBeInTheDocument();
    });

    it('JiraBatchDialog, the parent field, the parents and the results', async () => {
      installJiraFetch({
        '/jira/issue-types': (body) => (body.parentKey
          ? ok({ issueTypes: [{ id: '10006', name: 'Sous-tâche technique', subtask: true }], projectKey: 'OPS' })
          : ok({ issueTypes: TYPES, projectKey: 'EQUIPE', subtasksIncluded: true })),
        '/jira/issues': () => ok({
          results: [
            { actionId: 'b1', status: 'created', key: 'EQUIPE-2', parentKey: 'EQUIPE-1' },
            { actionId: 'a1', status: 'parent_uncertain' }
          ],
          remaining: [],
          parents: [
            { scope: 'backlog', status: 'created', key: 'EQUIPE-1' },
            { scope: 'retro:r1', status: 'uncertain', uncertainSince: '2026-10-21T10:00:00.000Z' }
          ]
        })
      });
      inFrench(
        <JiraBatchDialog
          actions={[action('b1', 'Ranger le tableau'), action('a1', 'Accélérer le build')]}
          status={statusWith({ target: SESSION_TARGET })}
          teamId="team-1"
          kind="backlog"
          team={frTeam()}
          requestedBy="Anne"
          onClose={() => {}}
        />
      );
      const dialog = screen.getByRole('dialog', { name: 'Créer les actions dans Jira' });
      expect(within(dialog).getByText('En sous-tâches d’un ticket par rétrospective ou bilan de santé, dans le projet EQUIPE')).toBeInTheDocument();
      await waitFor(() => expect(within(dialog).getByText('Type du ticket parent : Tâche')).toBeInTheDocument());

      const field = within(dialog).getByLabelText('Ticket parent (facultatif)');
      expect(field).toHaveAccessibleDescription(/Laissez vide pour utiliser le ticket parent de chaque rétrospective ou bilan de santé/);
      const rows = within(within(dialog).getByRole('list', { name: 'Tickets parents' })).getAllByRole('listitem');
      expect(rows[0]).toHaveTextContent('Tableau de bord de l’équipe');
      // The titles are content, in the session's language, marked as such.
      // getByText normalises the element's U+00A0 to a space.
      expect(within(rows[0]).getByText('Actions de l’équipe : Plateforme')).toHaveAttribute('lang', 'fr');
      expect(within(rows[0]).getByText('Actions de l’équipe : Plateforme').textContent).toBe('Actions de l\u2019équipe\u00a0: Plateforme');
      expect(rows[1]).toHaveTextContent('Rétrospective Sprint 12');
      expect(within(dialog).getByText('Un ticket parent créé ici reste le ticket parent de sa rétrospective ou de son bilan de santé pour ses actions suivantes.')).toBeInTheDocument();

      fireEvent.change(field, { target: { value: 'ops-1' } });
      fireEvent.blur(field);
      await waitFor(() => expect(field).toHaveAccessibleDescription(/OPS-1 est dans le projet OPS\./));
      expect(within(dialog).getByLabelText('Type de sous-tâche dans OPS')).toHaveValue('10006');
      expect(rows[0]).toHaveTextContent('Va sous OPS-1, qui devient son ticket parent');
      fireEvent.change(field, { target: { value: '' } });
      fireEvent.blur(field);

      fireEvent.click(within(dialog).getByRole('button', { name: 'Créer 4 tickets' }));
      await within(dialog).findByRole('button', { name: 'Fermer' });
      expect(within(dialog).getByText('1 non envoyée : son ticket parent est peut-être déjà dans Jira')).toBeInTheDocument();
      expect(within(dialog).getByText('Ticket parent créé :')).toBeInTheDocument();
      const doubt = within(dialog).getByText('Son ticket parent est peut-être déjà dans Jira : vérifiez avant d’envoyer à nouveau ses actions.').closest('li') as HTMLElement;
      expect(within(doubt).getByRole('link', { name: 'Vérifier dans Jira, ticket parent\u00a0: Rétrospective Sprint 12 (nouvel onglet)' })).toBeInTheDocument();
    });

    it('JiraActionControl, the dialog button and a refused parent issue', async () => {
      installJiraFetch({ '/jira/issues': () => ok({ results: [{ actionId: 'a1', status: 'parent_refused', jiraMessages: [] }], remaining: [] }) });
      const { unmount } = inFrench(
        <JiraActionControl action={action('a1', 'Accélérer le build')} status={statusWith({ target: SESSION_TARGET })} teamId="team-1" isFacilitator kind="retro" requestedBy="Anne" team={frTeam()} />
      );
      expect(screen.getByRole('button', { name: 'Créer dans Jira…, Accélérer le build' })).toHaveTextContent('Créer dans Jira…');
      unmount();

      inFrench(<JiraActionControl action={action('a1', 'Accélérer le build')} status={statusWith()} teamId="team-1" isFacilitator kind="retro" requestedBy="Anne" team={frTeam()} />);
      fireEvent.click(screen.getByRole('button', { name: 'Créer dans Jira, Accélérer le build' }));
      expect(await screen.findByText('Non envoyée : Jira a refusé son ticket parent.')).toBeInTheDocument();
    });

    it('JiraParentLine', () => {
      inFrench(
        <JiraParentLine
          link={{ key: 'EQUIPE-9', createdAt: 'x' }}
          status={statusWith({ target: SESSION_TARGET })}
          isFacilitator
          kind="retro"
          session={frRetro}
          team={frTeam()}
        />
      );
      expect(screen.getByText('Ticket parent dans Jira :')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'EQUIPE-9, ouvrir dans Jira (nouvel onglet)' })).toBeInTheDocument();
    });
  });

  it('JiraTeamSettings', async () => {
    installJiraFetch({
      '/jira/status': () => ok(statusWith({ target: null, token: { configured: false, usable: false } }))
    });
    const team = { id: 'team-1' } as unknown as Team;
    inFrench(<JiraTeamSettings team={team} />);
    expect(await screen.findByLabelText('Jeton d’accès Jira')).toBeInTheDocument();
    expect(screen.getByLabelText('E-mail (Jira Cloud uniquement)')).toBeInTheDocument();
    expect(screen.getByText('Aucun jeton enregistré pour l’instant.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer le jeton' })).toBeInTheDocument();
  });

  it('JiraSettingsCard', async () => {
    installJiraFetch({
      '/api/super-admin/jira-settings': () => ok({ enabled: true, baseUrl: 'https://jira.example.org', allowSelfSignedCerts: false })
    });
    inFrench(<JiraSettingsCard sessionToken="admin-token" />);
    await waitFor(() => expect(screen.getByLabelText('URL de base de Jira')).toHaveValue('https://jira.example.org'));
    expect(screen.getByRole('switch', { name: 'Activer Jira' })).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Autoriser les certificats auto-signés' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tester' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Enregistrer les paramètres Jira' })).toBeInTheDocument();
  });

  // The console's test sends no token: a 404 is about the address (I2).
  it('JiraSettingsCard, a test answered 404', async () => {
    installJiraFetch({
      '/api/super-admin/jira-settings': () => ok({ enabled: true, baseUrl: 'https://jira.example.org', allowSelfSignedCerts: false }),
      '/api/super-admin/test-jira': () => ok({ ok: false, error: 'jira_not_found', status: 404 })
    });
    inFrench(<JiraSettingsCard sessionToken="admin-token" />);
    await waitFor(() => expect(screen.getByLabelText('URL de base de Jira')).toHaveValue('https://jira.example.org'));
    fireEvent.click(screen.getByRole('button', { name: 'Tester' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Aucune API REST de Jira ne répond à cette adresse. Vérifiez son chemin de contexte (par exemple /jira).'
    ));
  });

  it('JiraSettingsCard, a test stopped by a certificate this server does not trust', async () => {
    installJiraFetch({
      '/api/super-admin/jira-settings': () => ok({ enabled: true, baseUrl: 'https://jira.example.org', allowSelfSignedCerts: false }),
      '/api/super-admin/test-jira': () => ok({ ok: false, error: 'jira_unreachable', transport: 'tls', transportCode: 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY' })
    });
    inFrench(<JiraSettingsCard sessionToken="admin-token" />);
    await waitFor(() => expect(screen.getByLabelText('URL de base de Jira')).toHaveValue('https://jira.example.org'));
    fireEvent.click(screen.getByRole('button', { name: 'Tester' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(
      'Ce serveur ne fait pas confiance au certificat de Jira. Donnez-lui votre autorité de certification interne avec NODE_EXTRA_CA_CERTS ; autoriser les certificats auto-signés est le dernier recours.'
    ));
    expect(screen.getByRole('status')).toHaveTextContent('Code : UNABLE_TO_GET_ISSUER_CERT_LOCALLY');
  });

  // The token form: a 404 there is the server's address, not a project (I2).
  it('JiraTeamSettings, a token checked against an address that does not reach Jira', async () => {
    installJiraFetch({
      '/jira/status': () => ok(statusWith({ target: null, token: { configured: false, usable: false } })),
      '/jira/token': () => refused(404, 'jira_not_found')
    });
    inFrench(<JiraTeamSettings team={{ id: 'team-1' } as unknown as Team} />);
    const token = await screen.findByLabelText('Jeton d’accès Jira');
    fireEvent.change(token, { target: { value: 'pat-123' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le jeton' }));
    expect(await screen.findByText(
      'Jira n’a pas répondu à l’adresse configurée sur ce serveur. Demandez à votre administrateur de vérifier l’URL de base de Jira.'
    )).toBeInTheDocument();
  });
});

/**
 * A message already on screen when the reader switches language. The switcher
 * stays usable while it shows, so each one is kept as what to say (a Notice,
 * i18n/notice.ts) and translated when rendered: kept as a sentence, it would
 * stay in the old language while the rest of the screen changes.
 */
describe('a Jira message on screen follows a language switch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const withSwitcher = (ui: React.ReactElement) =>
    render(<LanguageProvider initialLanguage="en"><LanguageSwitcher />{ui}</LanguageProvider>);
  const toFrench = () => fireEvent.click(screen.getByRole('button', { name: 'FR, Français' }));
  const describedBy = (element: HTMLElement) =>
    (element.getAttribute('aria-describedby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map(id => document.getElementById(id)?.textContent ?? '')
      .join(' ');

  const Fields: React.FC = () => {
    const [draft, setDraft] = useState<JiraTargetDraft>(draftFromTarget(null));
    return <JiraTargetFields teamId="team-1" value={draft} onChange={setDraft} idPrefix="switch" />;
  };

  it('JiraTargetFields: Jira\'s refusal of the key typed', async () => {
    installJiraFetch({ '/jira/issue-types': () => refused(404, 'jira_not_found') });
    withSwitcher(<Fields />);
    const key = screen.getByLabelText('Project key');
    fireEvent.change(key, { target: { value: 'TEAM' } });
    fireEvent.blur(key);
    await waitFor(() => expect(describedBy(screen.getByLabelText('Issue type'))).toContain('Jira found no such project or issue'));

    toFrench();
    const select = screen.getByLabelText('Type de ticket');
    expect(describedBy(select)).toContain('Jira ne trouve pas ce projet ou ce ticket');
    expect(describedBy(select)).not.toContain('Jira found no such');
  });

  it('JiraTeamSettings: Jira\'s refusal of the token', async () => {
    installJiraFetch({
      '/jira/status': () => ok(statusWith({ target: null, token: { configured: false, usable: false } })),
      '/jira/token': () => refused(400, 'jira_auth_failed')
    });
    withSwitcher(<JiraTeamSettings team={{ id: 'team-1' } as unknown as Team} />);
    const token = await screen.findByLabelText('Jira access token');
    fireEvent.change(token, { target: { value: 'wrong' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save the token' }));
    await waitFor(() => expect(describedBy(token)).toContain('Jira refused this token. Check it, then try again.'));

    toFrench();
    const field = screen.getByLabelText('Jeton d’accès Jira');
    expect(describedBy(field)).toContain('Jira a refusé ce jeton. Vérifiez-le, puis réessayez.');
  });

  it('JiraSettingsCard: the confirmation of a save', async () => {
    const stored = { enabled: true, baseUrl: 'https://jira.example.org', allowSelfSignedCerts: false };
    installJiraFetch({
      '/api/super-admin/jira-settings': () => ok(stored),
      '/api/super-admin/update-jira-settings': () => ok(stored)
    });
    withSwitcher(<JiraSettingsCard sessionToken="admin-token" />);
    const save = screen.getByRole('button', { name: 'Save the Jira settings' });
    await waitFor(() => expect(save).not.toHaveAttribute('aria-disabled'));
    fireEvent.click(save);
    expect(await screen.findByText('Jira settings saved')).toBeInTheDocument();

    toFrench();
    expect(screen.getByText('Paramètres Jira enregistrés')).toBeInTheDocument();
    expect(screen.queryByText('Jira settings saved')).toBeNull();
  });
});
