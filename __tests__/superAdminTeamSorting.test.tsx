import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import SuperAdmin from '../components/SuperAdmin';
import { Team } from '../types';

// Build mock teams with varying names, member counts, and dates
const mockTeams: Team[] = [
  {
    id: 'team-1',
    name: 'Charlie Team',
    passwordHash: 'hash1',
    members: [
      { id: 'u1', name: 'Alice', color: '#f00', role: 'participant' },
      { id: 'u2', name: 'Bob', color: '#0f0', role: 'participant' },
      { id: 'u3', name: 'Carol', color: '#00f', role: 'participant' },
    ],
    customTemplates: [],
    retrospectives: [],
    globalActions: [],
    lastConnectionDate: '2026-03-10T10:00:00.000Z',
  },
  {
    id: 'team-2',
    name: 'Alpha Team',
    passwordHash: 'hash2',
    members: [
      { id: 'u4', name: 'Dave', color: '#ff0', role: 'participant' },
    ],
    customTemplates: [],
    retrospectives: [],
    globalActions: [],
    lastConnectionDate: '2026-04-01T10:00:00.000Z',
  },
  {
    id: 'team-3',
    name: 'Bravo Team',
    passwordHash: 'hash3',
    members: [
      { id: 'u5', name: 'Eve', color: '#0ff', role: 'participant' },
      { id: 'u6', name: 'Frank', color: '#f0f', role: 'participant' },
    ],
    customTemplates: [],
    retrospectives: [],
    globalActions: [],
    // No lastConnectionDate — should be treated as "Never"
  },
];

// Mock all fetch calls needed by SuperAdmin on mount
function mockFetch() {
  global.fetch = vi.fn((url: string) => {
    if (typeof url === 'string' && url.includes('/api/super-admin/teams')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ teams: mockTeams }),
      });
    }
    if (typeof url === 'string' && url.includes('/api/super-admin/feedbacks')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ feedbacks: [] }),
      });
    }
    // Default — return empty success for other endpoints
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}),
    });
  }) as unknown as typeof fetch;
}

describe('SuperAdmin Teams sorting', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch();
  });

  const getTeamNameCells = () => {
    const rows = screen.getAllByRole('row');
    // Skip header row; extract the first cell (team name) from each data row
    return rows.slice(1).map((row) => {
      const cells = row.querySelectorAll('td');
      return cells[0]?.textContent || '';
    });
  };

  it('renders sortable column headers for Team Name, Members and Last Active', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Charlie Team')).toBeTruthy();
    });

    // Headers should be clickable buttons (or have sort indicators)
    const nameHeader = screen.getByRole('button', { name: /Team Name/i });
    const membersHeader = screen.getByRole('button', { name: /Members/i });
    const lastActiveHeader = screen.getByRole('button', { name: /Last Active/i });

    expect(nameHeader).toBeTruthy();
    expect(membersHeader).toBeTruthy();
    expect(lastActiveHeader).toBeTruthy();
  });

  it('sorts teams by name ascending on first click', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Charlie Team')).toBeTruthy();
    });

    const nameHeader = screen.getByRole('button', { name: /Team Name/i });
    fireEvent.click(nameHeader);

    const names = getTeamNameCells();
    // Ascending: Alpha, Bravo, Charlie
    expect(names[0]).toContain('Alpha Team');
    expect(names[1]).toContain('Bravo Team');
    expect(names[2]).toContain('Charlie Team');
  });

  it('sorts teams by name descending on second click', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Charlie Team')).toBeTruthy();
    });

    const nameHeader = screen.getByRole('button', { name: /Team Name/i });
    fireEvent.click(nameHeader); // asc
    fireEvent.click(nameHeader); // desc

    const names = getTeamNameCells();
    // Descending: Charlie, Bravo, Alpha
    expect(names[0]).toContain('Charlie Team');
    expect(names[1]).toContain('Bravo Team');
    expect(names[2]).toContain('Alpha Team');
  });

  it('sorts teams by member count ascending', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Charlie Team')).toBeTruthy();
    });

    const membersHeader = screen.getByRole('button', { name: /Members/i });
    fireEvent.click(membersHeader);

    const names = getTeamNameCells();
    // Alpha (1), Bravo (2), Charlie (3)
    expect(names[0]).toContain('Alpha Team');
    expect(names[1]).toContain('Bravo Team');
    expect(names[2]).toContain('Charlie Team');
  });

  it('sorts teams by member count descending', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Charlie Team')).toBeTruthy();
    });

    const membersHeader = screen.getByRole('button', { name: /Members/i });
    fireEvent.click(membersHeader); // asc
    fireEvent.click(membersHeader); // desc

    const names = getTeamNameCells();
    // Charlie (3), Bravo (2), Alpha (1)
    expect(names[0]).toContain('Charlie Team');
    expect(names[1]).toContain('Bravo Team');
    expect(names[2]).toContain('Alpha Team');
  });

  it('sorts teams by last active date ascending (Never last)', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Charlie Team')).toBeTruthy();
    });

    const lastActiveHeader = screen.getByRole('button', { name: /Last Active/i });
    fireEvent.click(lastActiveHeader);

    const names = getTeamNameCells();
    // Ascending by date: Charlie (Mar 10), Alpha (Apr 1), Bravo (Never = last)
    expect(names[0]).toContain('Charlie Team');
    expect(names[1]).toContain('Alpha Team');
    expect(names[2]).toContain('Bravo Team');
  });

  it('sorts teams by last active date descending (Never last)', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Charlie Team')).toBeTruthy();
    });

    const lastActiveHeader = screen.getByRole('button', { name: /Last Active/i });
    fireEvent.click(lastActiveHeader); // asc
    fireEvent.click(lastActiveHeader); // desc

    const names = getTeamNameCells();
    // Descending by date: Alpha (Apr 1), Charlie (Mar 10), Bravo (Never = last)
    expect(names[0]).toContain('Alpha Team');
    expect(names[1]).toContain('Charlie Team');
    expect(names[2]).toContain('Bravo Team');
  });

  it('resets sort when clicking a different column', async () => {
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByText('Charlie Team')).toBeTruthy();
    });

    // Sort by name first
    const nameHeader = screen.getByRole('button', { name: /Team Name/i });
    fireEvent.click(nameHeader);

    // Then sort by members
    const membersHeader = screen.getByRole('button', { name: /Members/i });
    fireEvent.click(membersHeader);

    const names = getTeamNameCells();
    // Should be sorted by members ascending: Alpha (1), Bravo (2), Charlie (3)
    expect(names[0]).toContain('Alpha Team');
    expect(names[1]).toContain('Bravo Team');
    expect(names[2]).toContain('Charlie Team');
  });
});
