import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TeamLogin from '../components/TeamLogin';
import { TeamSummary } from '../types';

// Generate mock teams
const generateTeams = (count: number): TeamSummary[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `team-${i}`,
    name: `Team ${String.fromCharCode(65 + i)}`, // Team A, Team B, etc.
    memberCount: i + 1,
    lastConnectionDate: new Date().toISOString(),
  }));

// Mock dataService
vi.mock('../services/dataService', () => ({
  dataService: {
    listTeams: vi.fn(),
  },
}));

// Mock fetch for info-message
global.fetch = vi.fn(() =>
  Promise.resolve({
    ok: true,
    json: () => Promise.resolve({ infoMessage: '' }),
  })
) as unknown as typeof fetch;

describe('TeamLogin search', () => {
  const mockOnLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does not show search when there are 5 or fewer teams', async () => {
    const teams = generateTeams(5);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByText('Team A')).toBeTruthy();
    });

    expect(screen.queryByPlaceholderText('Search teams...')).toBeNull();
  });

  it('shows search input when there are more than 5 teams', async () => {
    const teams = generateTeams(6);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search teams...')).toBeTruthy();
    });
  });

  it('filters teams by search query', async () => {
    const teams = generateTeams(8);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search teams...')).toBeTruthy();
    });

    // All teams visible initially
    expect(screen.getByText('Team A')).toBeTruthy();
    expect(screen.getByText('Team B')).toBeTruthy();

    // Type search query
    const searchInput = screen.getByPlaceholderText('Search teams...');
    fireEvent.change(searchInput, { target: { value: 'Team A' } });

    // Only matching team visible
    expect(screen.getByText('Team A')).toBeTruthy();
    expect(screen.queryByText('Team B')).toBeNull();
  });

  it('search is case-insensitive', async () => {
    const teams = generateTeams(6);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search teams...')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText('Search teams...');
    fireEvent.change(searchInput, { target: { value: 'team a' } });

    expect(screen.getByText('Team A')).toBeTruthy();
    expect(screen.queryByText('Team B')).toBeNull();
  });

  it('clears search when clear button is clicked', async () => {
    const teams = generateTeams(6);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search teams...')).toBeTruthy();
    });

    const searchInput = screen.getByPlaceholderText('Search teams...');
    fireEvent.change(searchInput, { target: { value: 'Team A' } });

    expect(screen.queryByText('Team B')).toBeNull();

    // Click clear button
    const clearButton = searchInput.parentElement!.querySelector('button');
    expect(clearButton).toBeTruthy();
    fireEvent.click(clearButton!);

    // All teams visible again
    expect(screen.getByText('Team A')).toBeTruthy();
    expect(screen.getByText('Team B')).toBeTruthy();
  });
});
