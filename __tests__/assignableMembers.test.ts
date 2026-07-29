import { describe, expect, it, vi, beforeEach } from 'vitest';
import { getAssignableMembers } from '../components/session/assignableMembers';
import { dataService } from '../services/dataService';
import { Team, User } from '../types';

vi.mock('../services/dataService', () => ({
  dataService: {
    getTeam: vi.fn()
  }
}));

const getTeam = vi.mocked(dataService.getTeam);

const member = (id: string, name: string): User => ({
  id,
  name,
  color: 'bg-indigo-500',
  role: 'participant'
});

const makeTeam = (overrides: Partial<Team> = {}): Team =>
  ({
    id: 'team-1',
    name: 'Team',
    passwordHash: 'scrypt$hash',
    members: [member('m1', 'Alice')],
    archivedMembers: [],
    customTemplates: [],
    retrospectives: [],
    globalActions: [],
    ...overrides
  }) as Team;

describe('getAssignableMembers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses the roster dataService holds, which is fresher than the session prop', () => {
    const propTeam = makeTeam({ members: [member('m1', 'Alice')] });
    getTeam.mockReturnValue(
      makeTeam({ members: [member('m1', 'Alice'), member('m2', 'Bob')] })
    );

    expect(getAssignableMembers(propTeam).map(m => m.id)).toEqual(['m1', 'm2']);
    expect(getTeam).toHaveBeenCalledWith('team-1');
  });

  it('falls back to the team prop when the team is not cached', () => {
    getTeam.mockReturnValue(null);

    const propTeam = makeTeam({ members: [member('m1', 'Alice'), member('m2', 'Bob')] });

    expect(getAssignableMembers(propTeam).map(m => m.id)).toEqual(['m1', 'm2']);
  });

  it('never offers archived members as assignees', () => {
    getTeam.mockReturnValue(
      makeTeam({
        members: [member('m1', 'Alice')],
        archivedMembers: [member('gone', 'Departed')]
      })
    );

    const assignable = getAssignableMembers(makeTeam());

    expect(assignable.map(m => m.id)).toEqual(['m1']);
    expect(assignable.some(m => m.id === 'gone')).toBe(false);
  });

  it('never offers archived members from the fallback roster either', () => {
    getTeam.mockReturnValue(null);

    const assignable = getAssignableMembers(
      makeTeam({
        members: [member('m1', 'Alice')],
        archivedMembers: [member('gone', 'Departed')]
      })
    );

    expect(assignable.map(m => m.id)).toEqual(['m1']);
  });

  it('returns a copy so callers cannot mutate the cached roster', () => {
    const cached = makeTeam({ members: [member('m1', 'Alice')] });
    getTeam.mockReturnValue(cached);

    const assignable = getAssignableMembers(makeTeam());
    assignable.push(member('intruder', 'Intruder'));

    expect(cached.members.map(m => m.id)).toEqual(['m1']);
  });
});
