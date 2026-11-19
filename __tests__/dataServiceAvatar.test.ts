import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Team } from '../types';
import { translateErrorMessage } from '../i18n/errorMessages';
import { createTranslator } from '../i18n/translate';

/**
 * `dataService.setMemberAvatar` (PLAN.md section 18.1): one awaited write
 * through the avatar route, then the cached team's map replaced by the one
 * the server answered. It never posts the roster, and never writes onto a
 * cached member row: those rows are replaced wholesale by roster posts, and a
 * field there would ride every one of them.
 */

let sequence = 0;
const createMockTeam = (overrides: Partial<Team> = {}): Team => ({
  id: `team-${++sequence}`,
  name: 'AvatarTeam',
  passwordHash: 'secret',
  members: [{ id: 'admin-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  ...overrides
});

const flush = () => new Promise(resolve => setTimeout(resolve, 50));

type FetchCall = { url: string; body: Record<string, unknown> };
type Override = { ok: boolean; status: number; body?: unknown; html?: boolean } | null;

describe('dataService.setMemberAvatar', () => {
  let dataService: typeof import('../services/dataService').dataService;
  let mockTeam: Team;
  let calls: FetchCall[];
  let respond: (url: string, body: Record<string, unknown>) => Override;
  const avatarCalls = () => calls.filter(c => /\/member\/avatar$/.test(c.url));

  beforeEach(async () => {
    vi.resetModules();
    calls = [];
    respond = () => null;
    global.fetch = vi.fn().mockImplementation(async (url: string, options?: { body?: string }) => {
      const urlPath = url.toString();
      const body = JSON.parse(options?.body || '{}');
      calls.push({ url: urlPath, body });

      const override = respond(urlPath, body);
      if (override) {
        return {
          ok: override.ok,
          status: override.status,
          json: async () => {
            if (override.html) throw new SyntaxError('Unexpected token \'<\', "<!DOCTYPE "... is not valid JSON');
            return override.body;
          }
        };
      }
      if (urlPath === '/api/team/create') {
        mockTeam = createMockTeam({ name: body.name });
        return { ok: true, status: 201, json: async () => ({ team: structuredClone(mockTeam), sessionToken: `token-${mockTeam.id}` }) };
      }
      if (/\/member\/avatar$/.test(urlPath)) {
        const memberAvatars = { ...(mockTeam.memberAvatars ?? {}), [body.memberId as string]: { id: body.avatar as string | null, at: 1234 } };
        mockTeam.memberAvatars = memberAvatars;
        return { ok: true, status: 200, json: async () => ({ success: true, memberAvatars: structuredClone(memberAvatars) }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    }) as unknown as typeof fetch;
    dataService = (await import('../services/dataService')).dataService;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const createTeam = async () => {
    const team = await dataService.createTeam('Alpha', 'secret-password', 'fac@example.com');
    await flush();
    calls = [];
    return team;
  };

  it('posts one choice on its route, with the session it was made in, and nothing else', async () => {
    const team = await createTeam();

    await dataService.setMemberAvatar('admin-1', 'fox', 'retro-1');

    expect(calls.map(c => c.url)).toEqual([`/api/team/${team.id}/member/avatar`]);
    expect(avatarCalls()[0].body).toMatchObject({ memberId: 'admin-1', avatar: 'fox', sessionId: 'retro-1', sessionToken: `token-${team.id}` });
  });

  it('sends no session id when none is given, and a clear as null', async () => {
    await createTeam();
    await dataService.setMemberAvatar('admin-1', null);
    expect(avatarCalls()[0].body.avatar).toBeNull();
    expect(avatarCalls()[0].body).not.toHaveProperty('sessionId');
  });

  it('replaces the cached map with the answer, as a new object, and never touches a member row', async () => {
    const team = await createTeam();
    const cached = dataService.getTeam(team.id)!;
    const rowsBefore = structuredClone(cached.members);
    const mapBefore = cached.memberAvatars;

    const answered = await dataService.setMemberAvatar('admin-1', 'fox');

    const after = dataService.getTeam(team.id)!;
    expect(after.memberAvatars).toEqual({ 'admin-1': { id: 'fox', at: 1234 } });
    expect(answered).toEqual(after.memberAvatars);
    expect(after.memberAvatars).not.toBe(mapBefore);
    expect(after.members).toEqual(rowsBefore);
    expect(after.members.every(member => !('avatar' in member))).toBe(true);
  });

  it('never posts the roster', async () => {
    await createTeam();
    await dataService.setMemberAvatar('admin-1', 'fox');
    await dataService.setMemberAvatar('admin-1', null);
    await flush();
    expect(calls.filter(c => /\/members$/.test(c.url))).toHaveLength(0);
    expect(calls.filter(c => /\/update$/.test(c.url))).toHaveLength(0);
  });

  it('retries a pod of the previous release (an HTML 404) until one that serves the route answers', async () => {
    await createTeam();
    let attempts = 0;
    respond = (url) => /\/member\/avatar$/.test(url) && attempts++ < 2 ? { ok: false, status: 404, html: true } : null;
    vi.useFakeTimers();

    const saving = dataService.setMemberAvatar('admin-1', 'owl');
    await vi.advanceTimersByTimeAsync(10_000);

    await expect(saving).resolves.toEqual({ 'admin-1': { id: 'owl', at: 1234 } });
    expect(avatarCalls()).toHaveLength(3);
  });

  it.each(['invalid_avatar', 'invalid_member'])('treats the route\'s %s as final, throws, and leaves the cache as it was', async (code) => {
    const team = await createTeam();
    respond = (url) => /\/member\/avatar$/.test(url) ? { ok: false, status: 400, body: { error: code } } : null;
    vi.useFakeTimers();

    const saving = dataService.setMemberAvatar('admin-1', 'owl');
    const outcome = expect(saving).rejects.toThrow('The avatar could not be saved.');
    await vi.advanceTimersByTimeAsync(10_000);
    await outcome;

    expect(avatarCalls()).toHaveLength(1);
    expect(dataService.getTeam(team.id)!.memberAvatars).toBeUndefined();
  });

  it('throws once a server that never serves the route has been retried for the rollout window', async () => {
    await createTeam();
    respond = (url) => /\/member\/avatar$/.test(url) ? { ok: false, status: 404, html: true } : null;
    vi.useFakeTimers();

    const saving = dataService.setMemberAvatar('admin-1', 'owl');
    const outcome = expect(saving).rejects.toThrow('The avatar could not be saved.');
    await vi.advanceTimersByTimeAsync(20_000);
    await outcome;
    expect(avatarCalls()).toHaveLength(5);
  });

  it('throws when the server cannot be reached', async () => {
    await createTeam();
    respond = () => { throw new TypeError('Failed to fetch'); };
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const saving = dataService.setMemberAvatar('admin-1', 'owl');
    const outcome = expect(saving).rejects.toThrow('The avatar could not be saved.');
    await vi.advanceTimersByTimeAsync(20_000);
    await outcome;
  });

  it('throws without sending anything when signed out, or for a value the route would refuse', async () => {
    await expect(dataService.setMemberAvatar('admin-1', 'fox')).rejects.toThrow('The avatar could not be saved.');
    await createTeam();
    await expect(dataService.setMemberAvatar('admin-1', 'dragon')).rejects.toThrow('The avatar could not be saved.');
    expect(avatarCalls()).toHaveLength(0);
  });

  it('keeps the cache as it was when the answer carries no map it can read', async () => {
    const team = await createTeam();
    respond = (url) => /\/member\/avatar$/.test(url) ? { ok: true, status: 200, body: { success: true, memberAvatars: ['fox'] } } : null;
    await dataService.setMemberAvatar('admin-1', 'fox');
    expect(dataService.getTeam(team.id)!.memberAvatars).toBeUndefined();
  });

  it('throws a sentence the screens translate', async () => {
    const { AVATAR_NOT_SAVED } = await import('../services/dataService');
    expect(translateErrorMessage(AVATAR_NOT_SAVED, createTranslator('en'))).toBe('The avatar could not be saved.');
    expect(translateErrorMessage(AVATAR_NOT_SAVED, createTranslator('fr'))).toBe("L'avatar n'a pas pu être enregistré.");
  });
});
