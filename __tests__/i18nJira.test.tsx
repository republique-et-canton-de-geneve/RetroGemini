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
    applyJiraLinks: () => {}
  }
}));

import JiraLinkBadge from '../components/jira/JiraLinkBadge';
import JiraActionControl from '../components/jira/JiraActionControl';
import JiraReasonLine from '../components/jira/JiraReasonLine';
import JiraDiscoveryNote from '../components/jira/JiraDiscoveryNote';
import JiraTargetFields from '../components/jira/JiraTargetFields';
import JiraBatchButton from '../components/jira/JiraBatchButton';
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
