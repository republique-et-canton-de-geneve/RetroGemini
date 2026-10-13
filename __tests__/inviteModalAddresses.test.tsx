import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import InviteModal from '../components/InviteModal';
import { dataService } from '../services/dataService';
import type { Team } from '../types';

/**
 * Inviting by email checks each address against the rule the server mails by
 * (`utils/emailAddress.js`). A roster entry stored before that rule — a
 * single-label `jdoe@corp` the old invite route accepted — would otherwise get
 * a member record and an invite link for an address the server now refuses to
 * mail, and the facilitator would read only "Failed to send email".
 */

vi.mock('qrcode', () => ({ default: { toDataURL: vi.fn(async () => 'data:image/png;base64,stub') } }));

vi.mock('../services/dataService', () => ({
  dataService: {
    createSessionInvite: vi.fn(async () => ({ inviteLink: 'https://retro.example/?join=stub' })),
    createMemberInvite: vi.fn(async (_teamId: string, email: string) => ({
      user: { id: `id-${email}`, name: email },
      inviteLink: `https://retro.example/?join=${email}`
    })),
    sendInviteEmail: vi.fn(async (_teamId: string, payload: { email: string }) => {
      if (payload.email === 'refused@example.com') throw new Error('invalid_email');
    }),
    getAuthenticatedPassword: vi.fn(() => 'team-password'),
    getSessionToken: vi.fn(() => 'rg1.team-session-token')
  }
}));

const team: Team = {
  id: 'team-1',
  name: 'Rocket Squad',
  passwordHash: 'scrypt$stub',
  members: [
    { id: 'u1', name: 'Alice', color: 'bg-rose-500', role: 'facilitator', email: 'alice@example.com' },
    { id: 'u2', name: 'Jo', color: 'bg-emerald-500', role: 'participant', email: 'jdoe@corp' },
    { id: 'u3', name: 'Ref', color: 'bg-sky-500', role: 'participant', email: 'refused@example.com' }
  ],
  customTemplates: [],
  retrospectives: [],
  globalActions: []
};

describe('InviteModal — addresses', () => {
  beforeEach(() => {
    vi.mocked(dataService.createMemberInvite).mockClear();
    globalThis.fetch = vi.fn(async () => ({ ok: false, status: 404, json: async () => ({}) })) as unknown as typeof fetch;
  });

  it('creates no member and no link for an address the server would refuse to mail, and says why', async () => {
    render(<InviteModal team={team} onClose={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Send invites' }));

    await waitFor(() => expect(screen.getByText(/jdoe@corp: Enter one valid email address/)).toBeTruthy());
    const invited = vi.mocked(dataService.createMemberInvite).mock.calls.map(([, email]) => email);
    expect(invited).toEqual(['alice@example.com', 'refused@example.com']);
    // The server's own refusal reads the same way, not as a mail failure.
    expect(screen.getByText(/refused@example\.com: Enter one valid email address/)).toBeTruthy();
  });
});
