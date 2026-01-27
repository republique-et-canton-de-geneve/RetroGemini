import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Column, RetroSession, ActionItem, HealthCheckSession } from '../types';

let dataService: typeof import('../services/dataService').dataService;
const columns: Column[] = [
  { id: 'col', title: 'Column', color: 'bg', border: 'border', icon: 'icon', text: 'text', ring: 'ring' },
];

describe('dataService', () => {
  beforeEach(async () => {
    vi.resetModules();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ teams: [], meta: { revision: 0, updatedAt: '2024-01-01T00:00:00.000Z' } })
    }) as any;
    // Mock window.location for invite link generation
    Object.defineProperty(global, 'window', {
      writable: true,
      value: { location: { origin: 'http://localhost:3000' } }
    });
    dataService = (await import('../services/dataService')).dataService;
    await dataService.hydrateFromServer();
  });

  describe('Team Management', () => {
    it('creates and logs in a team with unique name', () => {
      const team = dataService.createTeam('Alpha', 'secret', 'facilitator@example.com');
      expect(team.name).toBe('Alpha');
      expect(team.facilitatorEmail).toBe('facilitator@example.com');
      expect(() => dataService.createTeam('alpha', 'pwd')).toThrow('Team name already exists');

      const logged = dataService.loginTeam('Alpha', 'secret');
      expect(logged.id).toBe(team.id);
      expect(logged.archivedMembers).toEqual([]);
    });

    it('gets all teams sorted alphabetically', () => {
      dataService.createTeam('Zebra', 'pwd1');
      dataService.createTeam('Alpha', 'pwd2');
      dataService.createTeam('Beta', 'pwd3');

      const teams = dataService.getAllTeams();
      expect(teams.map(t => t.name)).toEqual(['Alpha', 'Beta', 'Zebra']);
    });

    it('gets a specific team by id', () => {
      const team = dataService.createTeam('TestTeam', 'password');
      const retrieved = dataService.getTeam(team.id);
      expect(retrieved?.name).toBe('TestTeam');

      const notFound = dataService.getTeam('non-existent-id');
      expect(notFound).toBeUndefined();
    });

    it('updates team information', () => {
      const team = dataService.createTeam('Original', 'pwd');
      team.facilitatorEmail = 'new@example.com';
      dataService.updateTeam(team);

      const updated = dataService.getTeam(team.id);
      expect(updated?.facilitatorEmail).toBe('new@example.com');
    });

    it('deletes a team', () => {
      const team = dataService.createTeam('ToDelete', 'pwd');
      expect(dataService.getTeam(team.id)).toBeDefined();

      dataService.deleteTeam(team.id);
      expect(dataService.getTeam(team.id)).toBeUndefined();
    });

    it('updates facilitator email', () => {
      const team = dataService.createTeam('Team', 'pwd', 'old@example.com');
      dataService.updateFacilitatorEmail(team.id, 'new@example.com');

      const updated = dataService.getTeam(team.id);
      expect(updated?.facilitatorEmail).toBe('new@example.com');
    });

    it('changes team password', () => {
      const team = dataService.createTeam('Team', 'oldpassword');
      dataService.changeTeamPassword(team.id, 'newpassword');

      // Should be able to login with new password
      const logged = dataService.loginTeam('Team', 'newpassword');
      expect(logged.id).toBe(team.id);

      // Should fail with old password
      expect(() => dataService.loginTeam('Team', 'oldpassword')).toThrow();
    });

    it('rejects password change with short password', () => {
      const team = dataService.createTeam('Team', 'password');
      expect(() => dataService.changeTeamPassword(team.id, 'abc')).toThrow('Password must be at least 4 characters');
    });

    it('rejects password change for non-existent team', () => {
      expect(() => dataService.changeTeamPassword('non-existent', 'newpassword')).toThrow('Team not found');
    });

    it('refreshes data from server', async () => {
      const team = dataService.createTeam('Team', 'pwd');

      // Mock fetch to return updated data
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ teams: [{ ...team, name: 'UpdatedTeam' }], meta: { revision: 1, updatedAt: '2024-01-01T00:00:00.000Z' } })
      }) as any;

      await dataService.refreshFromServer();

      const refreshed = dataService.getTeam(team.id);
      expect(refreshed?.name).toBe('UpdatedTeam');
    });

    it('handles refresh failure gracefully', async () => {
      const team = dataService.createTeam('Team', 'pwd');

      // Mock fetch to fail
      global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 }) as any;

      // Should not throw
      await dataService.refreshFromServer();

      // Original data should still be there
      const stillThere = dataService.getTeam(team.id);
      expect(stillThere?.name).toBe('Team');
    });

    it('renames a team', () => {
      const team = dataService.createTeam('OldName', 'password');
      dataService.renameTeam(team.id, 'NewName');

      const renamed = dataService.getTeam(team.id);
      expect(renamed?.name).toBe('NewName');
    });

    it('trims whitespace when renaming team', () => {
      const team = dataService.createTeam('Team', 'password');
      dataService.renameTeam(team.id, '  Trimmed Name  ');

      const renamed = dataService.getTeam(team.id);
      expect(renamed?.name).toBe('Trimmed Name');
    });

    it('rejects empty team name', () => {
      const team = dataService.createTeam('Team', 'password');
      expect(() => dataService.renameTeam(team.id, '')).toThrow('Team name cannot be empty');
      expect(() => dataService.renameTeam(team.id, '   ')).toThrow('Team name cannot be empty');
    });

    it('rejects duplicate team name (case-insensitive)', () => {
      dataService.createTeam('ExistingTeam', 'password1');
      const team = dataService.createTeam('MyTeam', 'password2');

      expect(() => dataService.renameTeam(team.id, 'existingteam')).toThrow('A team with this name already exists');
      expect(() => dataService.renameTeam(team.id, 'EXISTINGTEAM')).toThrow('A team with this name already exists');
    });

    it('allows renaming to same name with different case', () => {
      const team = dataService.createTeam('myteam', 'password');
      dataService.renameTeam(team.id, 'MyTeam');

      const renamed = dataService.getTeam(team.id);
      expect(renamed?.name).toBe('MyTeam');
    });

    it('rejects rename for non-existent team', () => {
      expect(() => dataService.renameTeam('non-existent', 'NewName')).toThrow('Team not found');
    });
  });

  describe('Member Management', () => {
    it('adds and removes members while preventing duplicates', () => {
      const team = dataService.createTeam('Alpha', 'secret');
      const user = dataService.addMember(team.id, 'User', 'user@example.com');
      const duplicate = dataService.addMember(team.id, 'Someone else', 'user@example.com');

      expect(duplicate.id).toBe(user.id);
      dataService.removeMember(team.id, user.id);
      const refreshed = dataService.getTeam(team.id)!;
      expect(refreshed.archivedMembers?.some(m => m.id === user.id)).toBe(true);
    });

    it('adds member without email', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const member = dataService.addMember(team.id, 'NoEmail');

      expect(member.name).toBe('NoEmail');
      expect(member.email).toBeUndefined();
    });

    it('assigns different colors to members', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const member1 = dataService.addMember(team.id, 'User1');
      const member2 = dataService.addMember(team.id, 'User2');
      const member3 = dataService.addMember(team.id, 'User3');

      expect(member1.color).toBeTruthy();
      expect(member2.color).toBeTruthy();
      expect(member3.color).toBeTruthy();
    });

    it('persists participants', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const participants = [
        { id: '1', name: 'User1', color: 'bg-blue-500', role: 'participant' as const },
        { id: '2', name: 'User2', color: 'bg-green-500', role: 'participant' as const },
      ];

      dataService.persistParticipants(team.id, participants);
      const updated = dataService.getTeam(team.id);
      expect(updated?.members.length).toBeGreaterThanOrEqual(2);
    });

    it('updates member details and prevents duplicate emails', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const memberA = dataService.addMember(team.id, 'Member A');
      const _memberB = dataService.addMember(team.id, 'Member B', 'memberb@example.com');

      const updated = dataService.updateMember(team.id, memberA.id, {
        name: 'Member A Updated',
        email: 'membera@example.com'
      });

      expect(updated.name).toBe('Member A Updated');
      expect(updated.email).toBe('membera@example.com');

      expect(() =>
        dataService.updateMember(team.id, memberA.id, {
          name: 'Member A Updated',
          email: 'memberb@example.com'
        })
      ).toThrow('Another member already uses this email');
    });

    it('joins team as participant with invite', () => {
      const team = dataService.createTeam('Team', 'pwd');
      // Create an invite first
      dataService.createMemberInvite(team.id, 'p1@example.com', undefined, 'Participant1');

      const result = dataService.joinTeamAsParticipant(team.id, 'Participant1', 'p1@example.com', undefined, true);

      expect(result.user.role).toBe('participant');
      expect(result.team.id).toBe(team.id);
    });

    it('links a new email invite to an existing member without creating duplicates', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const existing = dataService.addMember(team.id, 'Froud Jean-Pierre (DIN)');
      const beforeCount = dataService.getTeam(team.id)!.members.length;

      dataService.createMemberInvite(team.id, 'jean-pierre.froud@etat.ge.ch', undefined, 'Jean-Pierre Froud (DIN)');

      const afterInvite = dataService.getTeam(team.id)!;
      expect(afterInvite.members.length).toBe(beforeCount);
      expect(afterInvite.members.some(m => m.email)).toBe(false);

      const joined = dataService.joinTeamAsParticipant(
        team.id,
        existing.name,
        'jean-pierre.froud@etat.ge.ch',
        undefined,
        true
      );

      expect(joined.user.id).toBe(existing.id);
      const updated = dataService.getTeam(team.id)!.members.find(m => m.id === existing.id);
      expect(updated?.email).toBe('jean-pierre.froud@etat.ge.ch');
    });
  });

  describe('Retrospective Sessions', () => {
    it('creates sessions and reuses previous icebreaker question', () => {
      const team = dataService.createTeam('Alpha', 'secret');
      const firstSession = dataService.createSession(team.id, 'Retro 1', columns);
      firstSession.icebreakerQuestion = 'Custom icebreaker';
      dataService.updateSession(team.id, firstSession as RetroSession);

      const second = dataService.createSession(team.id, 'Retro 2', columns);
      expect(second.icebreakerQuestion).toBe('Custom icebreaker');
    });

    it('creates session with anonymous option', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const session = dataService.createSession(team.id, 'Anonymous Retro', columns, { isAnonymous: true });

      expect(session.settings.isAnonymous).toBe(true);
    });

    it('updates session data', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const session = dataService.createSession(team.id, 'Retro', columns);

      session.phase = 'VOTE';
      session.status = 'CLOSED';
      dataService.updateSession(team.id, session as RetroSession);

      const updated = dataService.getTeam(team.id)!.retrospectives[0];
      expect(updated.phase).toBe('VOTE');
      expect(updated.status).toBe('CLOSED');
    });

    it('deletes a retrospective', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const session = dataService.createSession(team.id, 'Retro', columns);

      expect(dataService.getTeam(team.id)!.retrospectives.length).toBe(1);
      dataService.deleteRetrospective(team.id, session.id);
      expect(dataService.getTeam(team.id)!.retrospectives.length).toBe(0);
    });

    it('gets retrospective templates', () => {
      const presets = dataService.getPresets();
      expect(presets).toBeDefined();
      expect(Object.keys(presets).length).toBeGreaterThan(0);
      expect(presets['start_stop_continue']).toBeDefined();
      expect(Array.isArray(presets['start_stop_continue'])).toBe(true);
    });
  });

  describe('Action Items', () => {
    it('adds global action', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const member = dataService.addMember(team.id, 'User');
      const action = dataService.addGlobalAction(team.id, 'Do something', member.id);

      expect(action.text).toBe('Do something');
      expect(action.assigneeId).toBe(member.id);
      expect(dataService.getTeam(team.id)!.globalActions.length).toBe(1);
    });

    it('adds global action without assignee', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const action = dataService.addGlobalAction(team.id, 'Unassigned task', null);

      expect(action.text).toBe('Unassigned task');
      expect(action.assigneeId).toBeNull();
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

    it('deletes action item', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const action = dataService.addGlobalAction(team.id, 'Task', null);

      expect(dataService.getTeam(team.id)!.globalActions.length).toBe(1);
      dataService.deleteAction(team.id, action.id);
      expect(dataService.getTeam(team.id)!.globalActions.length).toBe(0);
    });
  });

  describe('Health Check Sessions', () => {
    it('gets health check templates', () => {
      const templates = dataService.getHealthCheckTemplates();
      expect(templates.length).toBeGreaterThan(0);
      expect(templates[0]).toHaveProperty('name');
      expect(templates[0]).toHaveProperty('dimensions');
    });

    it('gets custom health check templates for team', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates(team.id);
      expect(templates).toBeDefined();
    });

    it('creates health check session', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'Health Check 1', templates[0].id);

      expect(session.name).toBe('Health Check 1');
      expect(session.status).toBe('IN_PROGRESS');
      expect(dataService.getTeam(team.id)!.healthChecks?.length).toBe(1);
    });

    it('updates health check session', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'HC', templates[0].id);

      session.status = 'CLOSED';
      session.phase = 'CLOSE';
      dataService.updateHealthCheckSession(team.id, session as HealthCheckSession);

      const updated = dataService.getTeam(team.id)!.healthChecks![0];
      expect(updated.status).toBe('CLOSED');
      expect(updated.phase).toBe('CLOSE');
    });

    it('gets specific health check by id', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'HC', templates[0].id);

      const retrieved = dataService.getHealthCheck(team.id, session.id);
      expect(retrieved?.id).toBe(session.id);

      const notFound = dataService.getHealthCheck(team.id, 'non-existent');
      expect(notFound).toBeUndefined();
    });

    it('deletes health check', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'HC', templates[0].id);

      expect(dataService.getTeam(team.id)!.healthChecks?.length).toBe(1);
      dataService.deleteHealthCheck(team.id, session.id);
      expect(dataService.getTeam(team.id)!.healthChecks?.length).toBe(0);
    });

    it('deletes custom health check template', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates(team.id);
      const customTemplates = templates.filter(t => !t.isDefault);

      if (customTemplates.length > 0) {
        const beforeCount = dataService.getHealthCheckTemplates(team.id).length;
        dataService.deleteHealthCheckTemplate(team.id, customTemplates[0].id);
        const afterCount = dataService.getHealthCheckTemplates(team.id).length;
        expect(afterCount).toBeLessThanOrEqual(beforeCount);
      }
    });

    it('creates health check invite', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'HC', templates[0].id);

      const invite = dataService.createHealthCheckInvite(team.id, session.id);
      expect(invite).toHaveProperty('inviteLink');
      expect(invite.inviteLink).toContain('join=');
    });
  });

  describe('Invites', () => {
    it('creates member invite for session', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const session = dataService.createSession(team.id, 'Retro', columns);
      const existing = dataService.addMember(team.id, 'John', 'user@example.com');
      const invite = dataService.createMemberInvite(team.id, 'user@example.com', session.id, 'John');

      expect(invite).toHaveProperty('inviteLink');
      expect(invite).toHaveProperty('user');
      expect(invite.inviteLink).toContain('join=');
      expect(invite.user?.email).toBe('user@example.com');
      expect(invite.user?.id).toBe(existing.id);
    });

    it('creates member invite without session', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const invite = dataService.createMemberInvite(team.id, 'user@example.com');

      expect(invite).toHaveProperty('inviteLink');
      expect(invite.inviteLink).toContain('join=');
      expect(invite.user).toBeUndefined();
    });

    it('creates member invite for health check', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const hc = dataService.createHealthCheckSession(team.id, 'HC', templates[0].id);
      const existing = dataService.addMember(team.id, 'Jane', 'user@example.com');
      const invite = dataService.createMemberInvite(team.id, 'user@example.com', undefined, 'Jane', hc.id);

      expect(invite).toHaveProperty('inviteLink');
      expect(invite).toHaveProperty('user');
      expect(invite.inviteLink).toContain('join=');
      expect(invite.user?.name).toBe('Jane');
      expect(invite.user?.id).toBe(existing.id);
    });
  });

  describe('Utility Functions', () => {
    it('gets hex color from tailwind class', () => {
      const hex = dataService.getHex('bg-blue-500');
      expect(hex).toBeTruthy();
      expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('ensures session placeholder exists', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const sessionId = 'test-session-id';
      dataService.ensureSessionPlaceholder(team.id, sessionId);

      const updated = dataService.getTeam(team.id);
      expect(updated?.retrospectives).toBeDefined();
    });
  });

  describe('Data Persistence', () => {
    it('hydrates from server on initialization', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
          teams: [
            { id: '1', name: 'PreloadedTeam', passwordHash: 'pwd', members: [], retrospectives: [], globalActions: [] }
          ],
          meta: { revision: 2, updatedAt: '2024-01-01T00:00:00.000Z' }
        })
      }) as any;

      vi.resetModules();
      const freshService = (await import('../services/dataService')).dataService;
      await freshService.hydrateFromServer();

      const teams = freshService.getAllTeams();
      expect(teams.some(t => t.name === 'PreloadedTeam')).toBe(true);
    });

    it('refreshes local data when a persist conflict occurs', async () => {
      const team = dataService.createTeam('Team', 'pwd');

      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 409,
        json: async () => ({
          teams: [{ ...team, name: 'ServerCopy' }],
          meta: { revision: 5, updatedAt: '2024-01-02T00:00:00.000Z' }
        })
      }) as any;

      dataService.updateTeam({ ...team, name: 'LocalEdit' });

      await new Promise(resolve => setTimeout(resolve, 0));

      const refreshed = dataService.getTeam(team.id);
      expect(refreshed?.name).toBe('ServerCopy');
    });
  });

  describe('Edge Cases', () => {
    it('handles updating non-existent team gracefully', () => {
      const fakeTeam = { id: 'non-existent', name: 'Fake', passwordHash: 'pwd', members: [], retrospectives: [], globalActions: [], customTemplates: [] };
      expect(() => dataService.updateTeam(fakeTeam)).not.toThrow();
    });

    it('handles removing non-existent member gracefully', () => {
      const team = dataService.createTeam('Team', 'pwd');
      expect(() => dataService.removeMember(team.id, 'non-existent-id')).not.toThrow();
    });

    it('handles deleting non-existent action gracefully', () => {
      const team = dataService.createTeam('Team', 'pwd');
      expect(() => dataService.deleteAction(team.id, 'non-existent-id')).not.toThrow();
    });

    it('handles deleting non-existent retrospective gracefully', () => {
      const team = dataService.createTeam('Team', 'pwd');
      expect(() => dataService.deleteRetrospective(team.id, 'non-existent-id')).not.toThrow();
    });

    it('handles deleting non-existent health check gracefully', () => {
      const team = dataService.createTeam('Team', 'pwd');
      expect(() => dataService.deleteHealthCheck(team.id, 'non-existent-id')).not.toThrow();
    });

    it('allows joining as existing participant by name to prevent duplicates', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const member = dataService.joinTeamAsParticipant(team.id, 'Alice', 'alice@test.com', 'token123', true);

      // Join again with same name but no token/email - should match existing participant (prevent "Alice" vs "alice" duplicates)
      const result = dataService.joinTeamAsParticipant(team.id, 'Alice', undefined, undefined, true);
      expect(result.user.id).toBe(member.user.id);
      expect(result.user.role).toBe('participant');
    });

    it('prevents joining as facilitator by name without authentication', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const facilitator = team.members.find(m => m.role === 'facilitator');

      if (facilitator) {
        // Try to join with facilitator name without auth - should fail
        expect(() => dataService.joinTeamAsParticipant(team.id, facilitator.name, undefined, undefined, true))
          .toThrow('This name is reserved');
      }
    });

    it('allows joining with existing member name if authenticated', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const member = dataService.joinTeamAsParticipant(team.id, 'Alice', 'alice@test.com', 'token123', true);

      // Join again with same token - should succeed
      const result = dataService.joinTeamAsParticipant(team.id, 'Alice', 'alice@test.com', 'token123', true);
      expect(result.user.id).toBe(member.user.id);
    });
  });

  describe('Session and Health Check Renaming', () => {
    it('renames a retrospective session', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const session = dataService.createSession(team.id, 'Old Name', columns);

      dataService.updateSessionName(team.id, session.id, 'New Name');

      const updated = dataService.getTeam(team.id);
      const renamedSession = updated?.retrospectives.find(r => r.id === session.id);
      expect(renamedSession?.name).toBe('New Name');
    });

    it('renames a health check session', () => {
      const team = dataService.createTeam('Team', 'pwd');
      const healthCheck = dataService.createHealthCheckSession(team.id, 'Old HC Name', 'team_health_en');

      dataService.updateHealthCheckName(team.id, healthCheck.id, 'New HC Name');

      const updated = dataService.getTeam(team.id);
      const renamedHC = updated?.healthChecks?.find(hc => hc.id === healthCheck.id);
      expect(renamedHC?.name).toBe('New HC Name');
    });

    it('handles renaming non-existent session gracefully', () => {
      const team = dataService.createTeam('Team', 'pwd');
      expect(() => dataService.updateSessionName(team.id, 'fake-id', 'New Name')).not.toThrow();
    });

    it('handles renaming non-existent health check gracefully', () => {
      const team = dataService.createTeam('Team', 'pwd');
      expect(() => dataService.updateHealthCheckName(team.id, 'fake-id', 'New Name')).not.toThrow();
    });
  });
});
