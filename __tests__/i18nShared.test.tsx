import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LanguageProvider from '../i18n/LanguageProvider';
import TeamFeedback from '../components/TeamFeedback';
import AnnouncementModal from '../components/AnnouncementModal';
import StarRating from '../components/common/StarRating';
import { IconPicker } from '../components/IconPicker';
import { ColorPicker } from '../components/ColorPicker';

/**
 * The French interface for the feedback board and the shared widgets. The
 * English text is pinned by each component's own suite, which renders without a
 * provider; these cases render under `initialLanguage="fr"` and check that the
 * chrome switches while content stays exactly as it was supplied: a feedback's
 * title, an announcement from CHANGELOG.md (English by project rule), a
 * caller's star label.
 */

const inFrench = (ui: React.ReactElement) =>
  render(<LanguageProvider initialLanguage="fr">{ui}</LanguageProvider>);

describe('TeamFeedback in French', () => {
  const feedbacks = [
    {
      id: 'feedback-a',
      teamId: 'team-1',
      teamName: 'Team One',
      type: 'bug',
      title: 'Alpha report',
      description: 'The first feedback',
      submittedBy: 'user-1',
      submittedByName: 'User One',
      submittedAt: '2026-08-01T10:00:00.000Z',
      isRead: false,
      status: 'pending',
      comments: []
    },
    {
      id: 'feedback-b',
      teamId: 'team-2',
      teamName: 'Team Two',
      type: 'feature',
      title: 'Beta request',
      description: 'The second feedback',
      submittedBy: 'user-2',
      submittedByName: 'User Two',
      submittedAt: '2026-08-02T10:00:00.000Z',
      isRead: true,
      status: 'in_progress',
      comments: []
    }
  ];

  const renderBoard = () =>
    inFrench(
      <TeamFeedback
        teamId="team-1"
        teamName="Team One"
        teamPassword="pw"
        sessionToken="token"
        currentUserId="user-1"
        currentUserName="User One"
        feedbacks={[]}
        onSubmitFeedback={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

  beforeEach(() => {
    globalThis.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('/api/feedbacks/all')) {
        return { ok: true, status: 200, json: async () => ({ feedbacks }) } as unknown as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('translates the board chrome and leaves feedback content as written', async () => {
    renderBoard();
    await screen.findByText('Alpha report');

    expect(screen.getByRole('heading', { name: 'Espace retours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Nouveau retour/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Actualiser la liste des retours' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tous (2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mon équipe (1)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fonctionnalités (1)' })).toBeInTheDocument();
    expect(screen.getByText('Statut :')).toBeInTheDocument();
    expect(screen.getAllByText('En attente').length).toBeGreaterThan(0);
    expect(screen.getAllByText('En cours').length).toBeGreaterThan(0);
    expect(screen.getByText('Fonctionnalité')).toBeInTheDocument();

    // Content is data: titles, descriptions and team names are not translated.
    expect(screen.getByText('Beta request')).toBeInTheDocument();
    expect(screen.getByText('The first feedback')).toBeInTheDocument();

    expect(screen.queryByText('Feedback Hub')).not.toBeInTheDocument();
    expect(screen.queryByText(/New Feedback/)).not.toBeInTheDocument();
    expect(screen.queryByText('Pending')).not.toBeInTheDocument();
  });

  // The English line used `formatDate(...).split(',')[0]` to keep only the
  // date, which relies on a comma between date and time. French dates have
  // none, so the time used to leak into the sentence.
  it('writes the submission line as one French sentence with the date only', async () => {
    renderBoard();
    const title = await screen.findByText('Alpha report');
    const card = title.closest('div[class*="bg-white"]') as HTMLElement;

    const meta = within(card).getByText(/Soumis par/);
    expect(meta.textContent).toContain('Équipe\u00a0: Team One · Soumis par User One le 01.08.2026');
    expect(meta.textContent).not.toMatch(/le 01\.08\.2026\s*\d/);
  });

  it('asks the delete confirmation and labels the comment thread in French', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderBoard();
    const title = await screen.findByText('Alpha report');
    const card = title.closest('div[class*="bg-white"]') as HTMLElement;

    await user.click(within(card).getByRole('button', { name: /Supprimer le retour/ }));
    expect(confirmSpy).toHaveBeenCalledWith('Voulez-vous vraiment supprimer ce retour\u202f?');

    await user.click(within(card).getByRole('button', { name: /Commentaires \(0\)/ }));
    expect(within(card).getByText('Aucun commentaire pour le moment')).toBeInTheDocument();
    expect(within(card).getByPlaceholderText('Ajouter un commentaire…')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Envoyer' })).toBeInTheDocument();
  });

  it('labels the submission form in French', async () => {
    const user = userEvent.setup();
    renderBoard();
    await screen.findByText('Alpha report');

    await user.click(screen.getByRole('button', { name: /Nouveau retour/ }));

    expect(screen.getByRole('heading', { name: 'Soumettre un retour' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Type' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Demande de fonctionnalité/)).toBeInTheDocument();
    expect(screen.getByLabelText('Titre')).toHaveAttribute('placeholder', 'Résumé succinct');
    expect(screen.getByLabelText('Images (5 au maximum, 2 Mo par image)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Soumettre' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeInTheDocument();
  });
});

describe('AnnouncementModal in French', () => {
  const announcements = [
    {
      version: '42.0',
      date: '2026-08-15',
      items: [{ type: 'feature' as const, description: 'Add a dark mode to the dashboard' }]
    }
  ];

  it('translates the chrome and keeps the changelog text in English', () => {
    inFrench(
      <AnnouncementModal
        announcements={announcements}
        currentVersion="42.0"
        onDismiss={vi.fn()}
        onMarkAsRead={vi.fn()}
      />
    );

    expect(screen.getByRole('dialog', { name: 'Nouveautés' })).toBeInTheDocument();
    expect(screen.getByText('Version 42.0')).toBeInTheDocument();
    expect(screen.getByText('Nouvelle fonctionnalité')).toBeInTheDocument();
    // The date is formatted in the French locale (the day may shift with the
    // test machine's timezone, so only month and year are pinned).
    expect(screen.getByText(/^\d{1,2} août 2026$/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Plus tard' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Compris\u202f!' })).toBeInTheDocument();

    // The announcement itself is CHANGELOG content and stays as given.
    expect(screen.getByText('Add a dark mode to the dashboard')).toBeInTheDocument();

    expect(screen.queryByText("What's New")).not.toBeInTheDocument();
    expect(screen.queryByText('New Feature')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Got it!' })).not.toBeInTheDocument();
  });

  it('translates the empty state', () => {
    inFrench(
      <AnnouncementModal announcements={[]} currentVersion="42.0" onDismiss={vi.fn()} onMarkAsRead={vi.fn()} />
    );

    expect(screen.getByText('Vous êtes à jour !')).toBeInTheDocument();
    expect(screen.getByText('Aucune nouveauté depuis votre dernière visite.')).toBeInTheDocument();
  });
});

describe('StarRating in French', () => {
  // The component owns no text: its accessible name is whatever the caller
  // translated, and it must come through untouched.
  it('announces the caller’s label as given', () => {
    inFrench(<StarRating value={2} label="Impact moyen : 2 sur 3" />);

    expect(screen.getByRole('img', { name: 'Impact moyen : 2 sur 3' })).toBeInTheDocument();
  });
});

describe('IconPicker and ColorPicker in French', () => {
  it('translates the icon picker, including the French plural rule for zero', async () => {
    const user = userEvent.setup();
    inFrench(<IconPicker initialIcon="star" onChange={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Choisir une icône')).toBeInTheDocument();
    expect(screen.getByText('Icône sélectionnée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: "Fermer le sélecteur d'icône" })).toBeInTheDocument();
    // Icon names are data: the French label names the ligature as is.
    expect(screen.getByRole('button', { name: "Choisir l'icône lightbulb" })).toBeInTheDocument();

    const search = screen.getByPlaceholderText('Rechercher des icônes (en anglais)…');

    await user.type(search, 'anchor');
    expect(screen.getByText('1 icône trouvée')).toBeInTheDocument();

    await user.clear(search);
    await user.type(search, 'lightbulb');
    await waitFor(() => expect(screen.getByText('3 icônes trouvées')).toBeInTheDocument());

    // French treats 0 as singular, unlike English's "0 icons found".
    await user.clear(search);
    await user.type(search, 'zzzz');
    expect(screen.getByText('0 icône trouvée')).toBeInTheDocument();
    expect(screen.getByText('Aucune icône trouvée')).toBeInTheDocument();
    expect(screen.getByText('Essayez un autre terme de recherche')).toBeInTheDocument();
  });

  it('translates the colour picker', () => {
    inFrench(<ColorPicker initialColor="#4f46e5" onChange={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByText('Choisir une couleur')).toBeInTheDocument();
    expect(screen.getByText('Sélectionnée')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Fermer le sélecteur de couleur' })).toBeInTheDocument();
    expect(screen.queryByText('Pick a color')).not.toBeInTheDocument();
  });
});
