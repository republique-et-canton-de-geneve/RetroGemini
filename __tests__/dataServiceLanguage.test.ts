import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Column, Team } from '../types';

/**
 * The language choices that reach the data layer:
 *  - a retro's *template* language is stored on the session at creation and
 *    decides its default icebreaker, independently of the interface language;
 *  - the *interface* language travels with the invitation and password-reset
 *    requests, so those mails are written in the language the sender is using.
 */

let dataService: typeof import('../services/dataService').dataService;
let languages: typeof import('../i18n/languages');

const columns: Column[] = [
  { id: 'col', title: 'Column', color: 'bg', border: 'border', icon: 'icon', text: 'text', ring: 'ring-3' },
];

const mockTeam = (): Team => ({
  id: 'team-lang',
  name: 'Polyglots',
  passwordHash: 'secret',
  members: [{ id: 'admin-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
});

describe('dataService language handling', () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockFetch = vi.fn(async (url: string) => {
      if (url === '/api/team/create') {
        return { ok: true, status: 201, json: async () => ({ team: mockTeam(), sessionToken: 'session-token' }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    });
    vi.stubGlobal('fetch', mockFetch);
    languages = await import('../i18n/languages');
    ({ dataService } = await import('../services/dataService'));
    await dataService.createTeam('Polyglots', 'secret');
  });

  afterEach(() => {
    languages.setActiveLanguage('en');
    vi.unstubAllGlobals();
  });

  const bodyOf = (path: string) => {
    const call = mockFetch.mock.calls.find(([url]) => url === path);
    expect(call, `a request to ${path}`).toBeDefined();
    return JSON.parse((call![1] as { body: string }).body);
  };

  it('stores the template language and opens a French retro with a French icebreaker', () => {
    const session = dataService.createSession('team-lang', 'Rétro', columns, { templateLanguage: 'fr' });
    expect(session.templateLanguage).toBe('fr');
    expect(session.icebreakerQuestion).toBe('Quel a été le meilleur moment de votre semaine\u202f?');
  });

  it('keeps creating English retros for a caller that chooses no language', () => {
    const session = dataService.createSession('team-lang', 'Retro', columns);
    expect(session.templateLanguage).toBe('en');
    expect(session.icebreakerQuestion).toBe('What was the highlight of your week?');
  });

  it('carries a built-in icebreaker over in the new retro’s language, and a written one as written', () => {
    dataService.createSession('team-lang', 'Retro 1', columns, { templateLanguage: 'en' });
    const french = dataService.createSession('team-lang', 'Rétro 2', columns, { templateLanguage: 'fr' });
    expect(french.icebreakerQuestion).toBe('Quel a été le meilleur moment de votre semaine\u202f?');

    french.icebreakerQuestion = 'Une question maison ?';
    dataService.updateSession('team-lang', french);
    const english = dataService.createSession('team-lang', 'Retro 3', columns, { templateLanguage: 'en' });
    expect(english.icebreakerQuestion).toBe('Une question maison ?');
  });

  it('keeps serving the English built-in templates to legacy callers', () => {
    expect(dataService.getPresets()['start_stop_continue'].map(c => c.title)).toEqual(['Start', 'Stop', 'Continue']);
  });

  it('stores English for a template language it does not know', () => {
    const session = dataService.createSession('team-lang', 'Retro', columns, { templateLanguage: 'de' as never });
    expect(session.templateLanguage).toBe('en');
    expect(session.icebreakerQuestion).toBe('What was the highlight of your week?');
  });

  it('sends the interface language with an invitation email', async () => {
    languages.setActiveLanguage('fr');
    await dataService.sendInviteEmail('team-lang', { email: 'guest@example.test', link: 'https://retro.example/?join=x' });
    expect(bodyOf('/api/send-invite').language).toBe('fr');
  });

  it('sends the interface language with a password-reset request', async () => {
    languages.setActiveLanguage('fr');
    await dataService.requestPasswordReset('Polyglots', 'lead@example.test');
    expect(bodyOf('/api/send-password-reset').language).toBe('fr');
  });
});
