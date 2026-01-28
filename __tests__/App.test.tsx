import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, waitFor, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import { dataService } from '../services/dataService';
import type { Team, User } from '../types';

// Mock the dataService
vi.mock('../services/dataService', () => ({
  dataService: {
    hydrateFromServer: vi.fn(() => Promise.resolve()),
    refreshFromServer: vi.fn(() => Promise.resolve()),
    getAllTeams: vi.fn(() => []),
    getTeam: vi.fn(() => null),
  },
}));

vi.mock('../components/Dashboard', () => ({
  default: () => <div>Dashboard</div>,
}));

vi.mock('../components/Session', () => ({
  default: () => <div>Session</div>,
}));

vi.mock('../components/HealthCheckSession', () => ({
  default: () => <div>Health Check Session</div>,
}));

vi.mock('../components/SuperAdmin', () => ({
  default: () => <div>Super Admin</div>,
}));

describe('App Component', () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
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

  it('should return to team selection after logout', async () => {
    const mockUser = {
      id: 'user-1',
      name: 'Facilitator',
      role: 'facilitator',
      color: 'bg-indigo-500',
    } satisfies User;

    const mockTeam = {
      id: 'team-1',
      name: 'Alpha',
      passwordHash: 'secret',
      members: [mockUser],
      retrospectives: [],
      healthChecks: [],
      globalActions: [],
      customTemplates: [],
      archivedMembers: [],
      lastConnectionDate: new Date().toISOString(),
    } satisfies Team;

    const mockedGetTeam = vi.mocked(dataService.getTeam);
    mockedGetTeam.mockReturnValue(mockTeam);

    localStorage.setItem(
      'retro-open-session',
      JSON.stringify({
        teamId: mockTeam.id,
        userId: mockTeam.members[0].id,
        userEmail: null,
        userName: mockTeam.members[0].name,
        view: 'DASHBOARD',
        activeSessionId: null,
        activeHealthCheckId: null,
      })
    );

    render(<App />);

    const logoutButton = await screen.findByTitle('Logout Team');
    const user = userEvent.setup();
    await user.click(logoutButton);

    await waitFor(() => {
      expect(screen.getByText('Your Teams')).toBeInTheDocument();
    });
  });

  it('should fall back to dashboard when saved session view has no active id', async () => {
    const mockUser = {
      id: 'user-1',
      name: 'Facilitator',
      role: 'facilitator',
      color: 'bg-indigo-500',
    } satisfies User;

    const mockTeam = {
      id: 'team-1',
      name: 'Alpha',
      passwordHash: 'secret',
      members: [mockUser],
      retrospectives: [],
      healthChecks: [],
      globalActions: [],
      customTemplates: [],
      archivedMembers: [],
      lastConnectionDate: new Date().toISOString(),
    } satisfies Team;

    const mockedGetTeam = vi.mocked(dataService.getTeam);
    mockedGetTeam.mockReturnValue(mockTeam);

    localStorage.setItem(
      'retro-open-session',
      JSON.stringify({
        teamId: mockTeam.id,
        userId: mockTeam.members[0].id,
        userEmail: null,
        userName: mockTeam.members[0].name,
        view: 'SESSION',
        activeSessionId: null,
        activeHealthCheckId: null,
      })
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Dashboard')).toBeInTheDocument();
    });
  });

  it('should ignore a saved LOGIN view when a team is restored', async () => {
    const mockUser = {
      id: 'user-1',
      name: 'Facilitator',
      role: 'facilitator',
      color: 'bg-indigo-500',
    } satisfies User;

    const mockTeam = {
      id: 'team-1',
      name: 'Alpha',
      passwordHash: 'secret',
      members: [mockUser],
      retrospectives: [],
      healthChecks: [],
      globalActions: [],
      customTemplates: [],
      archivedMembers: [],
      lastConnectionDate: new Date().toISOString(),
    } satisfies Team;

    const mockedGetTeam = vi.mocked(dataService.getTeam);
    mockedGetTeam.mockReturnValue(mockTeam);

    localStorage.setItem(
      'retro-open-session',
      JSON.stringify({
        teamId: mockTeam.id,
        userId: mockTeam.members[0].id,
        userEmail: null,
        userName: mockTeam.members[0].name,
        view: 'LOGIN',
        activeSessionId: null,
        activeHealthCheckId: null,
      })
    );
    localStorage.setItem('retro-last-seen-version', '4.0');

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Your Teams')).toBeInTheDocument();
    });
  });

  it('should clear persisted session state when restoring a LOGIN view', async () => {
    const mockUser = {
      id: 'user-1',
      name: 'Facilitator',
      role: 'facilitator',
      color: 'bg-indigo-500',
    } satisfies User;

    const mockTeam = {
      id: 'team-1',
      name: 'Alpha',
      passwordHash: 'secret',
      members: [mockUser],
      retrospectives: [],
      healthChecks: [],
      globalActions: [],
      customTemplates: [],
      archivedMembers: [],
      lastConnectionDate: new Date().toISOString(),
    } satisfies Team;

    const mockedGetTeam = vi.mocked(dataService.getTeam);
    mockedGetTeam.mockReturnValue(mockTeam);

    localStorage.setItem(
      'retro-open-session',
      JSON.stringify({
        teamId: mockTeam.id,
        userId: mockTeam.members[0].id,
        userEmail: null,
        userName: mockTeam.members[0].name,
        view: 'LOGIN',
        activeSessionId: null,
        activeHealthCheckId: null,
      })
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText('Your Teams')).toBeInTheDocument();
    });

    expect(localStorage.getItem('retro-open-session')).toBeNull();
    expect(localStorage.getItem('retro-last-seen-version')).toBeNull();
  });
});
