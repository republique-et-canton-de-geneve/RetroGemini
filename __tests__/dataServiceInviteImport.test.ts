import { beforeEach, describe, expect, it, vi } from 'vitest';
import { translateErrorMessage } from '../i18n/errorMessages';
import { createTranslator } from '../i18n/translate';

/**
 * What a failed invite import tells the invitee (review finding on the
 * payloads lane).
 *
 * `importTeam` answered every refusal with "invalid invite link", and a fetch
 * that got no answer reached the screen as the browser's raw "Failed to
 * fetch". The join screen now offers "Try again", so the message has to say
 * whether trying again can help: a link the server refused (400, 401, 403)
 * cannot be fixed by retrying, too many attempts (the login limiter's 429)
 * needs a wait, and anything else (a 5xx or a gateway's answer during a rolling
 * update, no answer at all) is worth a retry now.
 */

let dataService: typeof import('../services/dataService').dataService;
let mockFetch: ReturnType<typeof vi.fn>;

const invite = { id: 'team-1', name: 'Alpha Team', inviteCredential: 'cred' };

const answerWith = (status: number) => {
  mockFetch.mockImplementation(async () => ({ ok: status < 400, status, json: async () => ({ error: 'x' }) }));
};

const INVALID = 'Failed to join team - invalid invite link';
const RATE_LIMITED = 'Too many attempts to join this team from this network. Please wait a few minutes, then try again.';
const UNAVAILABLE = 'The team could not be joined right now. Please try again in a moment.';
const UNREACHABLE = 'The server could not be reached. Check your connection, then try again.';

beforeEach(async () => {
  vi.resetModules();
  mockFetch = vi.fn();
  globalThis.fetch = mockFetch as unknown as typeof fetch;
  ({ dataService } = await import('../services/dataService'));
});

describe('dataService.importTeam — what a failed invite import says', () => {
  it.each([400, 401, 403])('a link the server refuses (%i) is an invalid link', async (status) => {
    answerWith(status);
    await expect(dataService.importTeam(invite)).rejects.toThrow(INVALID);
  });

  it('too many attempts (429) says to wait, not that the link is invalid', async () => {
    answerWith(429);
    await expect(dataService.importTeam(invite)).rejects.toThrow(RATE_LIMITED);
  });

  it.each([404, 500, 502, 503, 504])('any other answer (%i) is a failure worth retrying', async (status) => {
    answerWith(status);
    await expect(dataService.importTeam(invite)).rejects.toThrow(UNAVAILABLE);
  });

  it('no answer at all says the server could not be reached, not "Failed to fetch"', async () => {
    mockFetch.mockImplementation(async () => { throw new TypeError('Failed to fetch'); });
    await expect(dataService.importTeam(invite)).rejects.toThrow(UNREACHABLE);
  });

  it('every one of those messages reads as a sentence in French', () => {
    const fr = createTranslator('fr');
    for (const message of [INVALID, RATE_LIMITED, UNAVAILABLE, UNREACHABLE]) {
      const translated = translateErrorMessage(message, fr);
      expect(translated).not.toBe(message);
      expect(translated.length).toBeGreaterThan(20);
    }
  });
});
