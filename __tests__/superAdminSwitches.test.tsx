import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SuperAdmin from '../components/SuperAdmin';
import LanguageProvider from '../i18n/LanguageProvider';
import type { Language } from '../i18n/languages';

/**
 * The console's three switches of its own (the new-team notification, the AI
 * features and the AI's self-signed certificates) say their state as a
 * state, as the Jira card's and the Dashboard's anonymity switches do: role
 * "switch" and `aria-checked`, under the setting's own name, which no state
 * changes. They were buttons whose only name was a title naming the action
 * ("Enable AI features", then "Disable AI features"), so a screen reader
 * heard a button that changed its name and never a setting that was on or
 * off (WCAG 4.1.2).
 */

let replies: Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  replies = {
    '/api/super-admin/teams': { teams: [] },
    '/api/super-admin/feedbacks': { feedbacks: [] },
    '/api/super-admin/admin-email': { adminEmail: 'admin@example.com', notifyNewTeam: true },
    '/api/super-admin/ai-settings': { ai: { enabled: true, apiUrl: 'http://llm.local', allowSelfSignedCerts: false } },
    '/api/super-admin/logs': { logs: [] },
    '/api/super-admin/active-sessions': { sessions: [] },
    '/api/super-admin/backups/list': { backups: [], config: { enabled: true, intervalHours: 24, maxCount: 7, onStartup: true } },
  };
  global.fetch = vi.fn((url: string) =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(replies[url] ?? {}) })
  ) as unknown as typeof fetch;
});

const NAMES: Record<Language, { notify: string; ai: string; selfSigned: string; selfSignedDescription: RegExp; notifyDescription: RegExp; needsEmail: string }> = {
  en: {
    notify: 'New Team Notification',
    ai: 'AI Assistant',
    selfSigned: 'Allow Self-Signed Certificates',
    selfSignedDescription: /^Enable this for internal servers with self-signed or corporate TLS certificates\.$/,
    notifyDescription: /^Receive an email when a new team is created\./,
    needsEmail: 'Set an admin email first',
  },
  fr: {
    notify: 'Notification de nouvelle équipe',
    ai: 'Assistant IA',
    selfSigned: 'Autoriser les certificats auto-signés',
    selfSignedDescription: /^Activez cette option pour les serveurs internes/,
    notifyDescription: /^Recevez un e-mail lorsqu’une nouvelle équipe est créée\./,
    needsEmail: 'Définissez d’abord une adresse e-mail d’administrateur',
  },
};

/**
 * The AI card's self-signed switch. The Jira card draws one of its own, which
 * shares its name in French ("Autoriser les certificats auto-signés"): each
 * says what it does in its description.
 */
const aiSelfSigned = (names: (typeof NAMES)[Language]): HTMLElement | null => {
  const jira = within(screen.getByRole('region', { name: 'Jira' })).queryByRole('switch', { name: names.selfSigned });
  const found = screen.queryAllByRole('switch', { name: names.selfSigned }).filter((element) => element !== jira);
  expect(found.length).toBeLessThanOrEqual(1);
  return found[0] ?? null;
};

const renderConsole = async (language: Language = 'en') => {
  render(
    <LanguageProvider initialLanguage={language}>
      <SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />
    </LanguageProvider>
  );
  const names = NAMES[language];
  // The settings arrive with their own reads: the AI's fields once it says it is on.
  await waitFor(() => expect(aiSelfSigned(names)).not.toBeNull());
  await waitFor(() => expect(screen.getByRole('switch', { name: names.notify })).toBeEnabled());
  return names;
};

describe('the console’s switches', () => {
  it.each(['en', 'fr'] as const)('are switches named by their setting, which say whether it is on (%s)', async (language) => {
    const names = await renderConsole(language);

    const notify = screen.getByRole('switch', { name: names.notify });
    const ai = screen.getByRole('switch', { name: names.ai });
    const selfSigned = aiSelfSigned(names) as HTMLElement;
    expect(notify).toHaveAttribute('aria-checked', 'true');
    expect(ai).toHaveAttribute('aria-checked', 'true');
    expect(selfSigned).toHaveAttribute('aria-checked', 'false');
    for (const control of [notify, ai, selfSigned]) {
      expect(control.tagName).toBe('BUTTON');
      expect(control).toHaveAttribute('type', 'button');
      // The state is said by aria-checked alone: no title that names an action.
      expect(control).not.toHaveAttribute('title');
    }
    // The two self-signed switches of the console (the AI's here, Jira's in
    // its own card) are told apart by what each one says it does.
    expect(selfSigned).toHaveAccessibleDescription(names.selfSignedDescription);
    expect(notify).toHaveAccessibleDescription(names.notifyDescription);
    // No button is left named by an action.
    expect(screen.queryByRole('button', { name: /^(Enable|Disable|Allow|Activer|Désactiver|Autoriser) / })).toBeNull();
  });

  it('keeps each name when its state changes, and says the new state', async () => {
    const names = await renderConsole();

    const selfSigned = aiSelfSigned(names) as HTMLElement;
    fireEvent.click(selfSigned);
    expect(aiSelfSigned(names)).toBe(selfSigned);
    expect(selfSigned).toHaveAttribute('aria-checked', 'true');

    const notify = screen.getByRole('switch', { name: names.notify });
    await act(async () => { fireEvent.click(notify); });
    await waitFor(() => expect(screen.getByRole('switch', { name: names.notify })).toHaveAttribute('aria-checked', 'false'));
    expect(screen.getByRole('switch', { name: names.notify })).toBe(notify);

    const ai = screen.getByRole('switch', { name: names.ai });
    await act(async () => { fireEvent.click(ai); });
    expect(screen.getByRole('switch', { name: names.ai })).toBe(ai);
    expect(ai).toHaveAttribute('aria-checked', 'false');
    // Off, the AI's fields and its self-signed switch go.
    expect(aiSelfSigned(names)).toBeNull();
  });

  it.each(['en', 'fr'] as const)('says why the new-team switch cannot be used before an admin email is set (%s)', async (language) => {
    replies['/api/super-admin/admin-email'] = { adminEmail: '', notifyNewTeam: false };
    const names = NAMES[language];
    render(
      <LanguageProvider initialLanguage={language}>
        <SuperAdmin sessionToken="admin-token" onExit={vi.fn()} />
      </LanguageProvider>
    );
    const notify = await screen.findByRole('switch', { name: names.notify });
    expect(notify).toBeDisabled();
    expect(notify).toHaveAttribute('aria-checked', 'false');
    // The pointer's tooltip says why; the description says what the setting needs.
    expect(notify).toHaveAttribute('title', names.needsEmail);
    expect(notify).toHaveAccessibleDescription(names.notifyDescription);
  });
});
