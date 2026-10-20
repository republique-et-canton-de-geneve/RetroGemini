import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Column, HealthCheckSession, RetroSession } from '../types';

/**
 * Every gesture in a live session saves the whole session to the team record,
 * through one queue that runs the saves one at a time. Typing a group or
 * column title is a gesture per keystroke, so the queue used to send one save
 * per keystroke, each the whole retro, each costing the server a parse and a
 * rewrite of the team's whole history. Only the last of them mattered: each
 * save carries the whole session.
 *
 * A save still waiting at the end of the queue is now replaced by a newer save
 * of the same session. One that has started is never replaced, and anything
 * queued after a save closes that window: coalescing never moves a save past
 * another write.
 */

const columns: Column[] = [
  { id: 'col', title: 'Column', color: 'bg', border: 'border', icon: 'icon', text: 'text', ring: 'ring-3' }
];

type Sent = { path: string; body: Record<string, unknown> };

let dataService: typeof import('../services/dataService').dataService;
let sent: Sent[];
let held: (() => void) | null;
let holdNextSessionSave: boolean;

const isSessionSave = (path: string) => /\/(retrospective|healthcheck)\/[^/]+$/.test(path);

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

beforeEach(async () => {
  vi.resetModules();
  sent = [];
  held = null;
  holdNextSessionSave = false;

  global.fetch = vi.fn(async (url: string, options?: { body?: string }) => {
    const path = url.toString();
    const body = JSON.parse(options?.body || '{}');
    if (path === '/api/team/create') {
      return {
        ok: true,
        status: 201,
        json: async () => ({
          team: { id: 'team-1', name: body.name, members: [], archivedMembers: [], customTemplates: [], retrospectives: [], healthChecks: [], globalActions: [] },
          sessionToken: 'session-team-1'
        })
      };
    }
    sent.push({ path, body });
    if (holdNextSessionSave && isSessionSave(path)) {
      holdNextSessionSave = false;
      await new Promise<void>((resolve) => {
        held = resolve;
      });
    }
    return { ok: true, status: 200, json: async () => ({ success: true }) };
  }) as unknown as typeof fetch;

  Object.defineProperty(global, 'window', {
    writable: true,
    value: { location: { origin: 'http://localhost:3000' } }
  });

  dataService = (await import('../services/dataService')).dataService;
  await dataService.createTeam('Alpha', 'password-long-enough', 'fac@example.com');
});

const release = () => {
  expect(held).not.toBeNull();
  held!();
};

const retroSaves = () => sent.filter((s) => /\/retrospective\/[^/]+$/.test(s.path));
const icebreakerOf = (save: Sent) => (save.body.retrospective as RetroSession).icebreakerQuestion;

describe('saving a live session to the team record', () => {
  it('sends only the newest state of a session waiting behind a save in flight', async () => {
    holdNextSessionSave = true;
    const session = dataService.createSession('team-1', 'Sprint 1', columns);
    await settle();
    expect(retroSaves()).toHaveLength(1);

    for (let i = 1; i <= 5; i++) {
      dataService.updateSession('team-1', { ...session, icebreakerQuestion: `edit ${i}` });
    }
    release();
    await settle();

    expect(retroSaves()).toHaveLength(2);
    expect(icebreakerOf(retroSaves()[1])).toBe('edit 5');
  });

  it('never moves a save past a write queued after it', async () => {
    holdNextSessionSave = true;
    const session = dataService.createSession('team-1', 'Sprint 1', columns);
    await settle();

    dataService.updateSession('team-1', { ...session, icebreakerQuestion: 'edit 1' });
    dataService.addGlobalAction('team-1', 'Fix the build', null);
    dataService.updateSession('team-1', { ...session, icebreakerQuestion: 'edit 2' });
    dataService.updateSession('team-1', { ...session, icebreakerQuestion: 'edit 3' });
    release();
    await settle();

    expect(sent.map((s) => (s.path.endsWith('/action') ? 'action' : icebreakerOf(s)))).toEqual([
      expect.any(String),
      'edit 1',
      'action',
      'edit 3'
    ]);
  });

  it('keeps two sessions apart', async () => {
    holdNextSessionSave = true;
    const first = dataService.createSession('team-1', 'Sprint 1', columns);
    await settle();
    const second = dataService.createSession('team-1', 'Sprint 2', columns);

    dataService.updateSession('team-1', { ...first, icebreakerQuestion: 'first edited' });
    release();
    await settle();

    const ids = retroSaves().map((s) => (s.body.retrospective as RetroSession).id);
    expect(ids).toEqual([first.id, second.id, first.id]);
  });

  it('coalesces the saves of a health check the same way', async () => {
    holdNextSessionSave = true;
    const session = dataService.createHealthCheckSession('team-1', 'Health 1', 'team_health_en');
    await settle();

    for (let i = 1; i <= 4; i++) {
      dataService.updateHealthCheckSession('team-1', { ...session, name: `rename ${i}` } as HealthCheckSession);
    }
    release();
    await settle();

    const saves = sent.filter((s) => /\/healthcheck\/[^/]+$/.test(s.path));
    expect(saves).toHaveLength(2);
    expect((saves[1].body.healthCheck as HealthCheckSession).name).toBe('rename 4');
  });
});
