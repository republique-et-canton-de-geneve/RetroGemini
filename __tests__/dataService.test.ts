import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Column, RetroSession, ActionItem, HealthCheckSession, HealthCheckTemplate, Team } from '../types';

let dataService: typeof import('../services/dataService').dataService;
const columns: Column[] = [
  { id: 'col', title: 'Column', color: 'bg', border: 'border', icon: 'icon', text: 'text', ring: 'ring' },
];

// Helper to create a mock team response
const createMockTeam = (overrides: Partial<Team> = {}): Team => ({
  id: 'team-' + Math.random().toString(36).substr(2, 9),
  name: 'TestTeam',
  passwordHash: 'password',
  members: [
    { id: 'admin-1', name: 'Facilitator', color: 'bg-indigo-500', role: 'facilitator' }
  ],
  archivedMembers: [],
  customTemplates: [],
  retrospectives: [],
  globalActions: [],
  lastConnectionDate: new Date().toISOString(),
  ...overrides
});

describe('dataService', () => {
  let mockTeam: Team;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    mockTeam = createMockTeam();

    // Mock fetch for the new secure API
    mockFetch = vi.fn().mockImplementation(async (url: string, options?: { method?: string; body?: string }) => {
      const urlPath = url.toString();

      // POST /api/team/create
      if (urlPath === '/api/team/create' && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        mockTeam = createMockTeam({
          name: body.name,
          passwordHash: body.password,
          facilitatorEmail: body.facilitatorEmail
        });
        return {
          ok: true,
          status: 201,
          json: async () => ({ team: mockTeam, meta: { revision: 1, updatedAt: new Date().toISOString() } })
        };
      }

      // POST /api/team/login
      if (urlPath === '/api/team/login' && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        if (body.teamName?.toLowerCase() === mockTeam.name.toLowerCase() && body.password === mockTeam.passwordHash) {
          return {
            ok: true,
            status: 200,
            json: async () => ({ team: mockTeam, meta: { revision: 1 } })
          };
        }
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: body.teamName?.toLowerCase() === mockTeam.name.toLowerCase() ? 'invalid_password' : 'team_not_found' })
        };
      }

      // GET /api/team/exists/:teamName
      if (urlPath.startsWith('/api/team/exists/')) {
        const teamName = decodeURIComponent(urlPath.split('/').pop() || '');
        return {
          ok: true,
          status: 200,
          json: async () => ({ exists: teamName.toLowerCase() === mockTeam.name.toLowerCase() })
        };
      }

      // GET /api/team/list
      if (urlPath === '/api/team/list') {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            teams: [
              {
                id: mockTeam.id,
                name: mockTeam.name,
                memberCount: mockTeam.members.length,
                lastConnectionDate: mockTeam.lastConnectionDate
              }
            ]
          })
        };
      }

      if (urlPath === '/api/password-reset/verify' && options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ valid: true, teamName: mockTeam.name })
        };
      }

      if (urlPath === '/api/password-reset/confirm' && options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true, message: 'Password updated', teamName: mockTeam.name })
        };
      }

      // POST /api/team/:teamId (get team data)
      if (urlPath.match(/^\/api\/team\/[^/]+$/) && options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ team: mockTeam, meta: { revision: 1 } })
        };
      }

      // POST /api/team/:teamId/update
      if (urlPath.match(/^\/api\/team\/[^/]+\/update$/) && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        if (body.updates) {
          Object.assign(mockTeam, body.updates);
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ team: mockTeam, meta: { revision: 1 } })
        };
      }

      // POST /api/team/:teamId/members
      if (urlPath.match(/^\/api\/team\/[^/]+\/members$/) && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        if (body.members) mockTeam.members = body.members;
        if (body.archivedMembers) mockTeam.archivedMembers = body.archivedMembers;
        return {
          ok: true,
          status: 200,
          json: async () => ({ team: mockTeam, meta: { revision: 1 } })
        };
      }

      // POST /api/team/:teamId/retrospective/:retroId
      if (urlPath.match(/^\/api\/team\/[^/]+\/retrospective\/[^/]+$/) && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        if (body.retrospective) {
          const idx = mockTeam.retrospectives.findIndex(r => r.id === body.retrospective.id);
          if (idx !== -1) {
            mockTeam.retrospectives[idx] = body.retrospective;
          } else {
            mockTeam.retrospectives.unshift(body.retrospective);
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ meta: { revision: 1 } })
        };
      }

      // POST /api/team/:teamId/healthcheck/:hcId
      if (urlPath.match(/^\/api\/team\/[^/]+\/healthcheck\/[^/]+$/) && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        if (body.healthCheck) {
          if (!mockTeam.healthChecks) mockTeam.healthChecks = [];
          const idx = mockTeam.healthChecks.findIndex(h => h.id === body.healthCheck.id);
          if (idx !== -1) {
            mockTeam.healthChecks[idx] = body.healthCheck;
          } else {
            mockTeam.healthChecks.unshift(body.healthCheck);
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ meta: { revision: 1 } })
        };
      }

      // POST /api/team/:teamId/action
      if (urlPath.match(/^\/api\/team\/[^/]+\/action$/) && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        if (body.action) {
          const idx = mockTeam.globalActions.findIndex(a => a.id === body.action.id);
          if (idx !== -1) {
            mockTeam.globalActions[idx] = body.action;
          } else {
            mockTeam.globalActions.unshift(body.action);
          }
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ meta: { revision: 1 } })
        };
      }

      // POST /api/team/:teamId/password
      if (urlPath.match(/^\/api\/team\/[^/]+\/password$/) && options?.method === 'POST') {
        const body = JSON.parse(options.body || '{}');
        if (body.newPassword) {
          mockTeam.passwordHash = body.newPassword;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        };
      }

      // POST /api/team/:teamId/delete
      if (urlPath.match(/^\/api\/team\/[^/]+\/delete$/) && options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        };
      }

      // POST /api/send-password-reset
      if (urlPath === '/api/send-password-reset' && options?.method === 'POST') {
        return {
          ok: true,
          status: 200,
          json: async () => ({ success: true })
        };
      }

      // Default response
      return {
        ok: true,
        status: 200,
        json: async () => ({ teams: [], meta: { revision: 0, updatedAt: '2024-01-01T00:00:00.000Z' } })
      };
    });

    global.fetch = mockFetch as unknown as typeof fetch;

    // Mock window.location for invite link generation
    Object.defineProperty(global, 'window', {
      writable: true,
      value: { location: { origin: 'http://localhost:3000' } }
    });

    dataService = (await import('../services/dataService')).dataService;
    await dataService.hydrateFromServer();
  });

  describe('Team Management', () => {
    it('creates and logs in a team with unique name', async () => {
      const team = await dataService.createTeam('Alpha', 'secret', 'facilitator@example.com');
      expect(team.name).toBe('Alpha');
      expect(team.facilitatorEmail).toBe('facilitator@example.com');

      const logged = await dataService.loginTeam('Alpha', 'secret');
      expect(logged.id).toBe(team.id);
      expect(logged.archivedMembers).toEqual([]);
    });

    it('gets the authenticated team', async () => {
      const team = await dataService.createTeam('TestTeam', 'password');
      const retrieved = dataService.getTeam(team.id);
      expect(retrieved?.name).toBe('TestTeam');

      const notFound = dataService.getTeam('non-existent-id');
      expect(notFound).toBeUndefined();
    });

    it('updates team information', async () => {
      const team = await dataService.createTeam('Original', 'pwd');
      team.facilitatorEmail = 'new@example.com';
      dataService.updateTeam(team);

      // Wait for persist queue
      await new Promise(resolve => setTimeout(resolve, 50));

      const updated = dataService.getTeam(team.id);
      expect(updated?.facilitatorEmail).toBe('new@example.com');
    });

    it('updates facilitator email', async () => {
      const team = await dataService.createTeam('Team', 'pwd', 'old@example.com');
      dataService.updateFacilitatorEmail(team.id, 'new@example.com');

      // Wait for persist queue
      await new Promise(resolve => setTimeout(resolve, 50));

      const updated = dataService.getTeam(team.id);
      expect(updated?.facilitatorEmail).toBe('new@example.com');
    });

    it('renames team when name is available', async () => {
      const team = await dataService.createTeam('Original', 'pwd');
      await dataService.renameTeam(team.id, 'Renamed');

      // Wait for persist queue
      await new Promise(resolve => setTimeout(resolve, 50));

      const updated = dataService.getTeam(team.id);
      expect(updated?.name).toBe('Renamed');
    });

    it('rejects empty or duplicate team names', async () => {
      const team = await dataService.createTeam('Alpha', 'pwd');

      await expect(dataService.renameTeam(team.id, '')).rejects.toThrow('Team name cannot be empty');
      await expect(dataService.renameTeam(team.id, 'Alpha')).rejects.toThrow('A team with this name already exists');
    });

    it('changes team password', async () => {
      const team = await dataService.createTeam('Team', 'oldpassword');
      await dataService.changeTeamPassword(team.id, 'newpassword');

      // The mock should have updated the password
      expect(mockTeam.passwordHash).toBe('newpassword');
    });

    it('rejects password change with short password', async () => {
      const team = await dataService.createTeam('Team', 'password');
      await expect(dataService.changeTeamPassword(team.id, 'abc')).rejects.toThrow('Password must be at least 4 characters');
    });

    it('checks authentication status', async () => {
      expect(dataService.isAuthenticated()).toBe(false);

      await dataService.createTeam('Team', 'pwd');
      expect(dataService.isAuthenticated()).toBe(true);

      dataService.logout();
      expect(dataService.isAuthenticated()).toBe(false);
    });

    it('lists team summaries', async () => {
      const list = await dataService.listTeams();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe(mockTeam.name);
      expect(list[0].memberCount).toBe(mockTeam.members.length);
    });

    it('requests password reset email', async () => {
      const result = await dataService.requestPasswordReset('Team', 'team@example.com');

      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/send-password-reset',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('verifies reset token via API', async () => {
      const result = await dataService.verifyResetToken('token-value');

      expect(result.valid).toBe(true);
      expect(result.teamName).toBe(mockTeam.name);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/password-reset/verify',
        expect.objectContaining({ method: 'POST' })
      );
    });

    it('resets password via API', async () => {
      const result = await dataService.resetPassword('token-value', 'new-password');

      expect(result.success).toBe(true);
      expect(result.teamName).toBe(mockTeam.name);
      expect(mockFetch).toHaveBeenCalledWith(
        '/api/password-reset/confirm',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('Member Management', () => {
    it('adds and removes members while preventing duplicates', async () => {
      const team = await dataService.createTeam('Alpha', 'secret');
      const user = dataService.addMember(team.id, 'User', 'user@example.com');
      const duplicate = dataService.addMember(team.id, 'Someone else', 'user@example.com');

      expect(duplicate.id).toBe(user.id);
      dataService.removeMember(team.id, user.id);
      const refreshed = dataService.getTeam(team.id)!;
      expect(refreshed.archivedMembers?.some(m => m.id === user.id)).toBe(true);
    });

    it('allows reusing an archived email for a new participant', async () => {
      const team = await dataService.createTeam('Gamma', 'secret');
      const user = dataService.addMember(team.id, 'John', 'john@example.com');
      dataService.removeMember(team.id, user.id);

      const { team: updatedTeam, user: newUser } = dataService.joinTeamAsParticipant(
        team.id,
        'Tom',
        'john@example.com',
        undefined,
        true
      );

      expect(newUser.name).toBe('Tom');
      expect(newUser.email).toBe('john@example.com');
      expect(updatedTeam.archivedMembers?.some(m => m.email === 'john@example.com')).toBe(false);

      const renamed = dataService.updateMember(team.id, newUser.id, { name: 'Patrick', email: 'john@example.com' });
      expect(renamed.name).toBe('Patrick');
    });

    it('adds member without email', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const member = dataService.addMember(team.id, 'NoEmail');

      expect(member.name).toBe('NoEmail');
      expect(member.email).toBeUndefined();
    });

    it('assigns different colors to members', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const member1 = dataService.addMember(team.id, 'User1');
      const member2 = dataService.addMember(team.id, 'User2');
      const member3 = dataService.addMember(team.id, 'User3');

      expect(member1.color).toBeTruthy();
      expect(member2.color).toBeTruthy();
      expect(member3.color).toBeTruthy();
    });

    it('persists participants', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const participants = [
        { id: '1', name: 'User1', color: 'bg-blue-500', role: 'participant' as const },
        { id: '2', name: 'User2', color: 'bg-green-500', role: 'participant' as const },
      ];

      dataService.persistParticipants(team.id, participants);
      const updated = dataService.getTeam(team.id);
      expect(updated?.members.length).toBeGreaterThanOrEqual(2);
    });

    it('updates member details and prevents duplicate emails', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const memberA = dataService.addMember(team.id, 'Member A');
      dataService.addMember(team.id, 'Member B', 'memberb@example.com');

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

    it('joins team as participant', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      // Create an invite first
      dataService.createMemberInvite(team.id, 'p1@example.com', undefined, 'Participant1');

      const result = dataService.joinTeamAsParticipant(team.id, 'Participant1', 'p1@example.com', undefined, true);

      expect(result.user.role).toBe('participant');
      expect(result.team.id).toBe(team.id);
    });
  });

  describe('Retrospective Sessions', () => {
    it('creates sessions and reuses previous icebreaker question', async () => {
      const team = await dataService.createTeam('Alpha', 'secret');
      const firstSession = dataService.createSession(team.id, 'Retro 1', columns);
      firstSession.icebreakerQuestion = 'Custom icebreaker';
      dataService.updateSession(team.id, firstSession as RetroSession);

      const second = dataService.createSession(team.id, 'Retro 2', columns);
      expect(second.icebreakerQuestion).toBe('Custom icebreaker');
    });

    it('creates session with anonymous option', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const session = dataService.createSession(team.id, 'Anonymous Retro', columns, { isAnonymous: true });

      expect(session.settings.isAnonymous).toBe(true);
    });

    it('updates session data', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const session = dataService.createSession(team.id, 'Retro', columns);

      session.phase = 'VOTE';
      session.status = 'CLOSED';
      dataService.updateSession(team.id, session as RetroSession);

      const updated = dataService.getTeam(team.id)!.retrospectives[0];
      expect(updated.phase).toBe('VOTE');
      expect(updated.status).toBe('CLOSED');
    });

    it('deletes a retrospective', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
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

  describe('Health Checks', () => {
    it('creates and updates health check sessions', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const templateId = dataService.getHealthCheckTemplates(team.id)[0].id;
      const session = dataService.createHealthCheckSession(team.id, 'Health', templateId);

      expect(session.id).toBeTruthy();
      expect(dataService.getHealthCheck(team.id, session.id)).toBeDefined();

      session.status = 'CLOSED';
      dataService.updateHealthCheckSession(team.id, session as HealthCheckSession);

      const updated = dataService.getHealthCheck(team.id, session.id);
      expect(updated?.status).toBe('CLOSED');
    });

    it('saves and deletes custom health check templates', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const template: HealthCheckTemplate = {
        id: 'custom-template',
        name: 'Custom Template',
        isDefault: false,
        dimensions: [
          {
            id: 'custom-dim',
            name: 'Custom Dimension',
            goodDescription: 'All good',
            badDescription: 'Needs work'
          }
        ]
      };

      dataService.saveHealthCheckTemplate(team.id, template);
      let templates = dataService.getHealthCheckTemplates(team.id);
      expect(templates.some(t => t.id === template.id)).toBe(true);

      dataService.deleteHealthCheckTemplate(team.id, template.id);
      templates = dataService.getHealthCheckTemplates(team.id);
      expect(templates.some(t => t.id === template.id)).toBe(false);
    });
  });

  describe('Action Items', () => {
    it('adds global action', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const member = dataService.addMember(team.id, 'User');
      const action = dataService.addGlobalAction(team.id, 'Do something', member.id);

      expect(action.text).toBe('Do something');
      expect(action.assigneeId).toBe(member.id);
      expect(dataService.getTeam(team.id)!.globalActions.length).toBe(1);
    });

    it('adds global action without assignee', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const action = dataService.addGlobalAction(team.id, 'Unassigned task', null);

      expect(action.text).toBe('Unassigned task');
      expect(action.assigneeId).toBeNull();
    });

    it('updates global actions', async () => {
      const team = await dataService.createTeam('Alpha', 'secret');
      const action = dataService.addGlobalAction(team.id, 'Follow up', null);
      const updated: ActionItem = { ...action, done: true, type: 'new', proposalVotes: {} } as ActionItem;
      dataService.updateGlobalAction(team.id, updated);
      expect(dataService.getTeam(team.id)!.globalActions[0].done).toBe(true);
    });

    it('deletes action item', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const action = dataService.addGlobalAction(team.id, 'Task', null);

      expect(dataService.getTeam(team.id)!.globalActions.length).toBe(1);
      dataService.deleteAction(team.id, action.id);
      expect(dataService.getTeam(team.id)!.globalActions.length).toBe(0);
    });
  });

  describe('Team Feedback', () => {
    it('creates and updates feedback items', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const feedback = dataService.createTeamFeedback(team.id, {
        teamId: team.id,
        teamName: team.name,
        type: 'feature',
        title: 'Great job',
        description: 'Keep up the good work',
        submittedBy: 'facilitator',
        submittedByName: 'Facilitator'
      });

      expect(feedback.isRead).toBe(false);
      dataService.updateTeamFeedback(team.id, feedback.id, { status: 'in_progress' });

      const stored = dataService.getTeamFeedbacks(team.id);
      expect(stored[0].status).toBe('in_progress');
    });

    it('marks feedback as read and counts unread items', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const feedback = dataService.createTeamFeedback(team.id, {
        teamId: team.id,
        teamName: team.name,
        type: 'bug',
        title: 'Needs improvement',
        description: 'Please address this',
        submittedBy: 'facilitator',
        submittedByName: 'Facilitator'
      });

      expect(dataService.getUnreadFeedbackCount()).toBe(1);
      dataService.markFeedbackAsRead(team.id, feedback.id);
      expect(dataService.getUnreadFeedbackCount()).toBe(0);
    });
  });

  describe('Health Check Sessions', () => {
    it('gets health check templates', () => {
      const templates = dataService.getHealthCheckTemplates();
      expect(templates.length).toBeGreaterThan(0);
      expect(templates[0]).toHaveProperty('name');
      expect(templates[0]).toHaveProperty('dimensions');
    });

    it('creates health check session', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'Health Check 1', templates[0].id);

      expect(session.name).toBe('Health Check 1');
      expect(session.status).toBe('IN_PROGRESS');
      expect(dataService.getTeam(team.id)!.healthChecks?.length).toBe(1);
    });

    it('updates health check session', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'HC', templates[0].id);

      session.status = 'CLOSED';
      session.phase = 'CLOSE';
      dataService.updateHealthCheckSession(team.id, session as HealthCheckSession);

      const updated = dataService.getTeam(team.id)!.healthChecks![0];
      expect(updated.status).toBe('CLOSED');
      expect(updated.phase).toBe('CLOSE');
    });

    it('gets specific health check by id', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'HC', templates[0].id);

      const retrieved = dataService.getHealthCheck(team.id, session.id);
      expect(retrieved?.id).toBe(session.id);

      const notFound = dataService.getHealthCheck(team.id, 'non-existent');
      expect(notFound).toBeUndefined();
    });

    it('deletes health check', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'HC', templates[0].id);

      expect(dataService.getTeam(team.id)!.healthChecks?.length).toBe(1);
      dataService.deleteHealthCheck(team.id, session.id);
      expect(dataService.getTeam(team.id)!.healthChecks?.length).toBe(0);
    });

    it('creates health check invite', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const templates = dataService.getHealthCheckTemplates();
      const session = dataService.createHealthCheckSession(team.id, 'HC', templates[0].id);

      const invite = dataService.createHealthCheckInvite(team.id, session.id);
      expect(invite).toHaveProperty('inviteLink');
      expect(invite.inviteLink).toContain('join=');
    });
  });

  describe('Invites', () => {
    it('creates member invite for session', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const session = dataService.createSession(team.id, 'Retro', columns);
      const existing = dataService.addMember(team.id, 'John', 'user@example.com');
      const invite = dataService.createMemberInvite(team.id, 'user@example.com', session.id, 'John');

      expect(invite).toHaveProperty('inviteLink');
      expect(invite).toHaveProperty('user');
      expect(invite.inviteLink).toContain('join=');
      expect(invite.user?.email).toBe('user@example.com');
      expect(invite.user?.id).toBe(existing.id);
    });

    it('creates member invite without session', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const invite = dataService.createMemberInvite(team.id, 'user@example.com');

      expect(invite).toHaveProperty('inviteLink');
      expect(invite.inviteLink).toContain('join=');
      expect(invite.user).toBeUndefined();
    });
  });

  describe('Utility Functions', () => {
    it('gets hex color from tailwind class', () => {
      const hex = dataService.getHex('bg-blue-500');
      expect(hex).toBeTruthy();
      expect(hex).toMatch(/^#[0-9a-fA-F]{6}$/);
    });

    it('ensures session placeholder exists', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const sessionId = 'test-session-id';
      dataService.ensureSessionPlaceholder(team.id, sessionId);

      const updated = dataService.getTeam(team.id);
      expect(updated?.retrospectives).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('handles updating non-existent team gracefully', async () => {
      await dataService.createTeam('Team', 'pwd');
      const fakeTeam = { id: 'non-existent', name: 'Fake', passwordHash: 'pwd', members: [], retrospectives: [], globalActions: [], customTemplates: [] };
      expect(() => dataService.updateTeam(fakeTeam)).not.toThrow();
    });

    it('handles removing non-existent member gracefully', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      expect(() => dataService.removeMember(team.id, 'non-existent-id')).not.toThrow();
    });

    it('handles deleting non-existent action gracefully', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      expect(() => dataService.deleteAction(team.id, 'non-existent-id')).not.toThrow();
    });

    it('handles deleting non-existent retrospective gracefully', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      expect(() => dataService.deleteRetrospective(team.id, 'non-existent-id')).not.toThrow();
    });

    it('handles deleting non-existent health check gracefully', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      expect(() => dataService.deleteHealthCheck(team.id, 'non-existent-id')).not.toThrow();
    });

    it('allows joining as existing participant by name to prevent duplicates', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const member = dataService.joinTeamAsParticipant(team.id, 'Alice', 'alice@test.com', 'token123', true);

      // Join again with same name - should match existing participant
      const result = dataService.joinTeamAsParticipant(team.id, 'Alice', undefined, undefined, true);
      expect(result.user.id).toBe(member.user.id);
      expect(result.user.role).toBe('participant');
    });

    it('prevents joining as facilitator by name without authentication', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const facilitator = team.members.find(m => m.role === 'facilitator');

      if (facilitator) {
        // Try to join with facilitator name without auth - should fail
        expect(() => dataService.joinTeamAsParticipant(team.id, facilitator.name, undefined, undefined, true))
          .toThrow('This name is reserved');
      }
    });
  });

  describe('Session and Health Check Renaming', () => {
    it('renames a retrospective session', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const session = dataService.createSession(team.id, 'Old Name', columns);

      dataService.updateSessionName(team.id, session.id, 'New Name');

      const updated = dataService.getTeam(team.id);
      const renamedSession = updated?.retrospectives.find(r => r.id === session.id);
      expect(renamedSession?.name).toBe('New Name');
    });

    it('renames a health check session', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      const healthCheck = dataService.createHealthCheckSession(team.id, 'Old HC Name', 'team_health_en');

      dataService.updateHealthCheckName(team.id, healthCheck.id, 'New HC Name');

      const updated = dataService.getTeam(team.id);
      const renamedHC = updated?.healthChecks?.find(hc => hc.id === healthCheck.id);
      expect(renamedHC?.name).toBe('New HC Name');
    });

    it('handles renaming non-existent session gracefully', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      expect(() => dataService.updateSessionName(team.id, 'fake-id', 'New Name')).not.toThrow();
    });

    it('handles renaming non-existent health check gracefully', async () => {
      const team = await dataService.createTeam('Team', 'pwd');
      expect(() => dataService.updateHealthCheckName(team.id, 'fake-id', 'New Name')).not.toThrow();
    });
  });
});
