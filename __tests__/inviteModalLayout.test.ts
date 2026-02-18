import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

describe('InviteModal responsive layout', () => {
  const inviteModalSource = readFileSync(
    join(__dirname, '..', 'components', 'InviteModal.tsx'),
    'utf-8'
  );

  it('keeps the modal within the viewport with an internal scroll area', () => {
    expect(inviteModalSource).toContain('overflow-y-auto');
    expect(inviteModalSource).toContain('max-h-[calc(100vh-2rem)]');
    expect(inviteModalSource).toContain('min-h-0');
  });

  it('keeps the close action visible regardless of content height', () => {
    expect(inviteModalSource).toContain('shrink-0');
    expect(inviteModalSource).toContain('material-symbols-outlined">close');
  });
});
