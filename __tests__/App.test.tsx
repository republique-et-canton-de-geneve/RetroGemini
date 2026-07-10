import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import App from '../App';
import { dataService } from '../services/dataService';

const originalFetch = global.fetch;

// Mock the dataService
vi.mock('../services/dataService', () => ({
  dataService: {
    hydrateFromServer: vi.fn(() => Promise.resolve()),
    getAllTeams: vi.fn(() => []),
    listTeams: vi.fn(() => Promise.resolve([])),
    getTeam: vi.fn(() => null),
    getSessionToken: vi.fn(() => 'in-memory-session-token'),
    restoreSession: vi.fn(() => Promise.resolve(null)),
    refreshFromServer: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../components/Dashboard', () => ({
  default: () => null,
}));

describe('App Component', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    global.fetch = originalFetch;
    // Clear all mocks
    vi.clearAllMocks();
  });

  it('should render without crashing', async () => {
    render(<App />);
    await waitFor(() => expect(document.body).toBeTruthy());
  });

  it('should start with LOGIN view by default', async () => {
    render(<App />);
    // The TeamLogin component should be rendered initially
    // You can check for specific elements that appear in TeamLogin
    await waitFor(() => expect(document.body).toBeTruthy());
  });

  it('should call hydrateFromServer on mount', async () => {
    render(<App />);
    await waitFor(() => {
      expect(dataService.hydrateFromServer).toHaveBeenCalledTimes(1);
    });
  });

  it('should keep the saved super-admin token when session validation is rate-limited', async () => {
    localStorage.setItem('retro-super-admin-session', 'saved-super-admin-token');
    const fetchMock = vi.fn(async (url: unknown) => {
      if (url === '/api/super-admin/validate-session') {
        return {
          ok: false,
          status: 429,
          json: async () => ({ error: 'too_many_requests', retryAfter: '1 minute' })
        } as Response;
      }

      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<App />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/super-admin/validate-session', expect.any(Object));
    });
    expect(localStorage.getItem('retro-super-admin-session')).toBe('saved-super-admin-token');
  });

  it('should clear the saved super-admin token when session validation rejects it', async () => {
    localStorage.setItem('retro-super-admin-session', 'expired-super-admin-token');
    const fetchMock = vi.fn(async (url: unknown) => {
      if (url === '/api/super-admin/validate-session') {
        return {
          ok: false,
          status: 401,
          json: async () => ({ error: 'invalid_or_expired_token' })
        } as Response;
      }

      return { ok: false, status: 404, json: async () => ({}) } as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    render(<App />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/super-admin/validate-session', expect.any(Object));
    });
    expect(localStorage.getItem('retro-super-admin-session')).toBeNull();
  });

  it('migrates a legacy persisted team token without writing it back to localStorage', async () => {
    const team = {
      id: 'team-1',
      name: 'Team',
      members: [{ id: 'user-1', name: 'User', color: 'bg-blue-500', role: 'facilitator' }],
      retrospectives: [],
      healthChecks: [],
    };
    localStorage.setItem('retro-open-session', JSON.stringify({
      teamId: team.id,
      userId: 'user-1',
      userName: 'User',
      view: 'DASHBOARD',
      sessionToken: 'legacy-session-token',
    }));
    vi.mocked(dataService.getTeam).mockReturnValue(null);
    vi.mocked(dataService.restoreSession).mockResolvedValue(team as never);

    render(<App />);

    await waitFor(() => {
      expect(dataService.restoreSession).toHaveBeenCalledWith('legacy-session-token');
    });
    await waitFor(() => {
      const saved = JSON.parse(localStorage.getItem('retro-open-session') || '{}');
      expect(saved.sessionToken).toBeUndefined();
    });
  });
});
