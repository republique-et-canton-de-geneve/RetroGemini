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
    localStorage.clear();
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

describe('TeamLogin favorites', () => {
  const mockOnLogin = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('shows star toggle on each team card', async () => {
    const teams = generateTeams(3);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByText('Team A')).toBeTruthy();
    });

    const stars = screen.getAllByRole('switch');
    expect(stars.length).toBe(3);
    // All should be unchecked initially
    stars.forEach(star => {
      expect(star.getAttribute('aria-checked')).toBe('false');
    });
  });

  it('toggles favorite and persists to localStorage', async () => {
    const teams = generateTeams(3);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByText('Team A')).toBeTruthy();
    });

    // Click star for Team A
    const starA = screen.getByLabelText('Add Team A to favorites');
    fireEvent.click(starA);

    // Should be checked now (re-query after re-render)
    await waitFor(() => {
      expect(screen.getByLabelText('Remove Team A from favorites')).toBeTruthy();
    });
    expect(screen.getByLabelText('Remove Team A from favorites').getAttribute('aria-checked')).toBe('true');

    // localStorage should be updated
    const stored = JSON.parse(localStorage.getItem('retro-favorite-teams') || '[]');
    expect(stored).toContain('team-0');
  });

  it('removes favorite on second click', async () => {
    localStorage.setItem('retro-favorite-teams', JSON.stringify(['team-0']));
    const teams = generateTeams(3);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByText('Team A')).toBeTruthy();
    });

    // Star for Team A should be checked
    const starA = screen.getByLabelText('Remove Team A from favorites');
    expect(starA.getAttribute('aria-checked')).toBe('true');

    // Click to remove
    fireEvent.click(starA);

    // Should be unchecked now (re-query after re-render)
    await waitFor(() => {
      expect(screen.getByLabelText('Add Team A to favorites')).toBeTruthy();
    });
    expect(screen.getByLabelText('Add Team A to favorites').getAttribute('aria-checked')).toBe('false');

    const stored = JSON.parse(localStorage.getItem('retro-favorite-teams') || '[]');
    expect(stored).not.toContain('team-0');
  });

  it('displays favorites section when favorites exist', async () => {
    localStorage.setItem('retro-favorite-teams', JSON.stringify(['team-0']));
    const teams = generateTeams(6);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByText('Team A')).toBeTruthy();
    });

    // Should show Favorites and All Teams sections
    expect(screen.getByText('Favorites')).toBeTruthy();
    expect(screen.getByText('All Teams')).toBeTruthy();
  });

  it('does not show Favorites section when no favorites', async () => {
    const teams = generateTeams(6);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByText('Team A')).toBeTruthy();
    });

    expect(screen.queryByText('Favorites')).toBeNull();
    expect(screen.queryByText('All Teams')).toBeNull();
  });

  it('shows favorite teams at the top of the list', async () => {
    // Favorite Team C (index 2)
    localStorage.setItem('retro-favorite-teams', JSON.stringify(['team-2']));
    const teams = generateTeams(6);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByText('Team C')).toBeTruthy();
    });

    // Team C should appear in the Favorites section (before "All Teams")
    const favoritesLabel = screen.getByText('Favorites');
    const allTeamsLabel = screen.getByText('All Teams');
    const teamCButton = screen.getByText('Team C').closest('button')!;

    // Favorites label should come before Team C, which comes before All Teams
    const container = favoritesLabel.closest('.overflow-y-auto')!;
    const allElements = Array.from(container.querySelectorAll('*'));
    const favIdx = allElements.indexOf(favoritesLabel);
    const teamCIdx = allElements.indexOf(teamCButton);
    const allTeamsIdx = allElements.indexOf(allTeamsLabel);

    expect(favIdx).toBeLessThan(teamCIdx);
    expect(teamCIdx).toBeLessThan(allTeamsIdx);
  });

  it('loads favorites from localStorage on mount', async () => {
    localStorage.setItem('retro-favorite-teams', JSON.stringify(['team-1']));
    const teams = generateTeams(3);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByText('Team B')).toBeTruthy();
    });

    // Team B star should be checked
    const starB = screen.getByLabelText('Remove Team B from favorites');
    expect(starB.getAttribute('aria-checked')).toBe('true');
  });

  it('clicking star does not navigate to login', async () => {
    const teams = generateTeams(3);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByText('Team A')).toBeTruthy();
    });

    // Click star for Team A
    const starA = screen.getByLabelText('Add Team A to favorites');
    fireEvent.click(starA);

    // Should still be on the list view, not the login view
    expect(screen.getByText('Your Teams')).toBeTruthy();
    expect(screen.queryByText('Enter the team password to continue.')).toBeNull();
  });

  it('favorites work with search filter', async () => {
    localStorage.setItem('retro-favorite-teams', JSON.stringify(['team-0', 'team-2']));
    const teams = generateTeams(8);
    const { dataService } = await import('../services/dataService');
    vi.mocked(dataService.listTeams).mockResolvedValue(teams);

    render(<TeamLogin onLogin={mockOnLogin} />);

    await waitFor(() => {
      expect(screen.getByPlaceholderText('Search teams...')).toBeTruthy();
    });

    // Search for "Team C"
    const searchInput = screen.getByPlaceholderText('Search teams...');
    fireEvent.change(searchInput, { target: { value: 'Team C' } });

    // Only Team C visible (it's a favorite)
    expect(screen.getByText('Team C')).toBeTruthy();
    expect(screen.queryByText('Team A')).toBeNull();
    expect(screen.queryByText('Team B')).toBeNull();

    // Favorites section should show since Team C is a favorite and matches search
    expect(screen.getByText('Favorites')).toBeTruthy();
  });
});
