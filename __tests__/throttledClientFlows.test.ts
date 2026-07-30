import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Codex review on PR #401 (audit H5 follow-up).
 *
 * Adding limiters to the anonymous routes introduced a response the client had
 * never seen before: `429`. Both consumers treated *any* non-2xx as a
 * domain answer rather than as "ask again later", so a throttled request was
 * silently misreported:
 *
 *  - `verifyResetToken` collapsed 429 into `{ valid: false }`, and the reset
 *    view then told the user the link was invalid or expired — sending them to
 *    request a *new* link (burning the reset-email limiter too) when the one in
 *    their inbox was perfectly good.
 *  - `renameTeam` skipped the availability check on any non-OK reply and
 *    renamed anyway, so the UI reported success for a rename the server could
 *    still reject as a duplicate.
 *
 * These pin the classification. `throttledUiSurfacing.test.tsx` pins that the
 * two components actually show it.
 */

let dataService: typeof import('../services/dataService').dataService;

type Reply = { ok: boolean; status: number; json: () => Promise<unknown> };

const reply = (status: number, body: unknown): Reply => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body
});

describe('client handling of throttled anonymous routes', () => {
  let existsReply: Reply;
  let verifyReply: Reply;
  let confirmReply: Reply;
  let updateCalls: string[];

  beforeEach(async () => {
    vi.resetModules();
    existsReply = reply(200, { exists: false });
    verifyReply = reply(200, { valid: true, teamName: 'Platform Team' });
    confirmReply = reply(200, { success: true, message: 'Password updated', teamName: 'Platform Team' });
    updateCalls = [];

    const mockTeam = {
      id: 'team-1',
      name: 'Platform Team',
      passwordHash: 'pw',
      members: [{ id: 'fac-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }],
      archivedMembers: [],
      customTemplates: [],
      retrospectives: [],
      globalActions: [],
      lastConnectionDate: new Date().toISOString()
    };

    global.fetch = vi.fn(async (url: string, options?: { method?: string; body?: string }) => {
      const path = url.toString();

      if (path === '/api/team/create') {
        return reply(201, { team: mockTeam, sessionToken: 'session-team-1', meta: { revision: 1 } });
      }
      if (path.startsWith('/api/team/exists/')) {
        return existsReply;
      }
      if (path === '/api/password-reset/verify') {
        return verifyReply;
      }
      if (path === '/api/password-reset/confirm') {
        return confirmReply;
      }
      if (path.endsWith('/update') && options?.method === 'POST') {
        updateCalls.push(options.body || '');
        return reply(200, { team: mockTeam });
      }
      return reply(200, {});
    }) as unknown as typeof fetch;

    ({ dataService } = await import('../services/dataService'));
    await dataService.createTeam('Platform Team', 'pw');
  });

  describe('verifyResetToken', () => {
    it('reports a throttled check as throttled, not as an invalid link', async () => {
      verifyReply = reply(429, { error: 'too_many_attempts', retryAfter: '15 minutes' });

      const result = await dataService.verifyResetToken('a'.repeat(64));

      // The distinction that matters: the link itself was never judged.
      expect(result.throttled).toBe(true);
      expect(result.valid).toBe(false);
    });

    it('still reports a genuinely invalid token as invalid, not throttled', async () => {
      verifyReply = reply(200, { valid: false });

      const result = await dataService.verifyResetToken('a'.repeat(64));

      expect(result.valid).toBe(false);
      expect(result.throttled).toBeFalsy();
    });

    it('does not claim throttling when the server simply errors', async () => {
      verifyReply = reply(500, { error: 'verification_failed' });

      const result = await dataService.verifyResetToken('a'.repeat(64));

      expect(result.valid).toBe(false);
      expect(result.throttled).toBeFalsy();
    });

    it('still accepts a live token', async () => {
      const result = await dataService.verifyResetToken('a'.repeat(64));

      expect(result).toEqual({ valid: true, teamName: 'Platform Team' });
    });
  });

  describe('resetPassword', () => {
    it('explains a throttled confirm instead of surfacing the raw error code', async () => {
      confirmReply = reply(429, { error: 'too_many_attempts', retryAfter: '15 minutes' });

      const result = await dataService.resetPassword('a'.repeat(64), 'brand-new');

      expect(result.success).toBe(false);
      // `too_many_attempts` was being rendered verbatim into the error banner.
      expect(result.message).not.toBe('too_many_attempts');
      expect(result.message.toLowerCase()).toContain('too many');
    });
  });

  describe('renameTeam', () => {
    it('fails the rename when the availability check is throttled', async () => {
      existsReply = reply(429, { error: 'too_many_requests', retryAfter: '1 minute' });

      await expect(dataService.renameTeam('team-1', 'New Name')).rejects.toThrow(/too many/i);

      // Nothing was persisted, so the UI cannot claim a rename that did not happen.
      expect(updateCalls).toHaveLength(0);
    });

    it('fails the rename when the availability check cannot be answered', async () => {
      // Same consequence as a 429: proceeding would queue a write the server
      // may reject as a duplicate, while the UI reports success.
      existsReply = reply(500, { error: 'check_failed' });

      await expect(dataService.renameTeam('team-1', 'New Name')).rejects.toThrow();

      expect(updateCalls).toHaveLength(0);
    });

    it('still refuses a name that is already taken', async () => {
      existsReply = reply(200, { exists: true });

      await expect(dataService.renameTeam('team-1', 'Taken')).rejects.toThrow(/already exists/i);

      expect(updateCalls).toHaveLength(0);
    });

    it('still renames when the name is free', async () => {
      await expect(dataService.renameTeam('team-1', 'Fresh Name')).resolves.toBeUndefined();

      await vi.waitFor(() => expect(updateCalls).toHaveLength(1));
      expect(updateCalls[0]).toContain('Fresh Name');
    });
  });
});
