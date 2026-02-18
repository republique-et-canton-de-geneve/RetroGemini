import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('assignableMembers only uses active team members', () => {
  const sessionSource = readFileSync(
    join(__dirname, '..', 'components', 'Session.tsx'),
    'utf-8'
  );

  const healthCheckSource = readFileSync(
    join(__dirname, '..', 'components', 'HealthCheckSession.tsx'),
    'utf-8'
  );

  it('Session.tsx does not include participants in assignableMembers', () => {
    // The assignableMembers should only use team.members, not session participants
    const assignableBlock = sessionSource.match(/const assignableMembers[^;]+;/s)?.[0] ?? '';
    expect(assignableBlock).not.toContain('participants');
    expect(assignableBlock).not.toContain('archivedMembers');
  });

  it('Session.tsx derives assignableMembers from team.members only', () => {
    expect(sessionSource).toContain('const assignableMembers = [...team.members];');
  });

  it('HealthCheckSession.tsx does not include participants in assignableMembers', () => {
    const assignableBlock = healthCheckSource.match(/const assignableMembers[^;]+;/s)?.[0] ?? '';
    expect(assignableBlock).not.toContain('participants');
    expect(assignableBlock).not.toContain('archivedMembers');
  });

  it('HealthCheckSession.tsx derives assignableMembers from team.members only', () => {
    expect(healthCheckSource).toContain('const assignableMembers = [...team.members];');
  });
});
