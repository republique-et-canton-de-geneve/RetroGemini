import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Column, RetroSession, ActionItem } from '../types';

let dataService: typeof import('../services/dataService').dataService;
const columns: Column[] = [
  { id: 'col', title: 'Column', color: 'bg', border: 'border', icon: 'icon', text: 'text', ring: 'ring' },
];

describe('dataService', () => {
  beforeEach(async () => {
    vi.resetModules();
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ teams: [] }) }) as any;
    dataService = (await import('../services/dataService')).dataService;
    await dataService.hydrateFromServer();
  });

  it('creates and logs in a team with unique name', () => {
    const team = dataService.createTeam('Alpha', 'secret', 'facilitator@example.com');
    expect(team.name).toBe('Alpha');
    expect(() => dataService.createTeam('alpha', 'pwd')).toThrow('Team name already exists');

    const logged = dataService.loginTeam('Alpha', 'secret');
    expect(logged.id).toBe(team.id);
    expect(logged.archivedMembers).toEqual([]);
  });

  it('adds and removes members while preventing duplicates', () => {
    const team = dataService.createTeam('Alpha', 'secret');
    const user = dataService.addMember(team.id, 'User', 'user@example.com');
    const duplicate = dataService.addMember(team.id, 'Someone else', 'user@example.com');

    expect(duplicate.id).toBe(user.id);
    dataService.removeMember(team.id, user.id);
    const refreshed = dataService.getTeam(team.id)!;
    expect(refreshed.archivedMembers?.some(m => m.id === user.id)).toBe(true);
  });

  it('creates sessions and reuses previous icebreaker question', () => {
    const team = dataService.createTeam('Alpha', 'secret');
    const firstSession = dataService.createSession(team.id, 'Retro 1', columns);
    firstSession.icebreakerQuestion = 'Custom icebreaker';
    dataService.updateSession(team.id, firstSession as RetroSession);

    const second = dataService.createSession(team.id, 'Retro 2', columns);
    expect(second.icebreakerQuestion).toBe('Custom icebreaker');
  });

  it('updates global actions and falls back to retrospective actions', () => {
    const team = dataService.createTeam('Alpha', 'secret');
    const session = dataService.createSession(team.id, 'Retro', columns);
    const action = dataService.addGlobalAction(team.id, 'Follow up', null);
    const updated: ActionItem = { ...action, done: true, type: 'new', proposalVotes: {} } as ActionItem;
    dataService.updateGlobalAction(team.id, updated);
    expect(dataService.getTeam(team.id)!.globalActions[0].done).toBe(true);

    const retroAction: ActionItem = { ...action, id: 'retro-1', text: 'Retro action', done: false, type: 'new', proposalVotes: {} } as ActionItem;
    session.actions.push(retroAction);
    dataService.updateSession(team.id, session as RetroSession);

    const applied: ActionItem = { ...retroAction, text: 'Updated retro action', proposalVotes: {} };
    dataService.updateGlobalAction(team.id, applied);

    const storedSession = dataService.getTeam(team.id)!.retrospectives[0];
    expect(storedSession.actions.find(a => a.id === retroAction.id)?.text).toBe('Updated retro action');
  });
});
