import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ImageGallery from '../components/common/ImageGallery';
import TeamFeedback from '../components/TeamFeedback';
import SuperAdmin from '../components/SuperAdmin';

/**
 * Field report: an image attached to a feedback could only be seen through the
 * context menu's "Open image in new tab"; a plain click did nothing. The
 * thumbnails called `window.open(img, '_blank')` on a `data:` URI, and browsers
 * refuse a script-opened top-level navigation to `data:` — Chromium opens no
 * window at all. The image now opens in a dialog inside the app, on both the
 * team's feedback board and the super-admin console.
 */

// A real (1×1) PNG, stored the way the upload stores it.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const feedback = {
  id: 'feedback-a',
  teamId: 'team-1',
  teamName: 'Team One',
  type: 'bug',
  title: 'Broken export',
  description: 'See the screenshot',
  images: [PNG, PNG],
  submittedBy: 'user-1',
  submittedByName: 'User One',
  submittedAt: '2026-08-01T10:00:00.000Z',
  isRead: false,
  status: 'pending',
  comments: []
};

const mockFetch = (routes: Record<string, unknown>) => {
  globalThis.fetch = vi.fn(async (url: string) => {
    const body = routes[String(url)] ?? {};
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as unknown as typeof fetch;
};

let openSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  openSpy = vi.spyOn(window, 'open').mockReturnValue(null);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ImageGallery', () => {
  const renderGallery = () =>
    render(<ImageGallery images={[PNG, PNG]} altFor={(n) => `Attached image ${n}`} />);

  it('opens the clicked image full size in a dialog, without navigating anywhere', () => {
    renderGallery();

    fireEvent.click(screen.getByRole('button', { name: 'Attached image 2' }));

    const dialog = screen.getByRole('dialog', { name: 'Attached image 2' });
    expect(within(dialog).getByRole('img', { name: 'Attached image 2' }).getAttribute('src')).toBe(PNG);
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('opens from the keyboard, which the old clickable <img> could not', async () => {
    const user = userEvent.setup();
    renderGallery();

    await user.tab();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Attached image 1' }));
    await user.keyboard('{Enter}');

    expect(screen.getByRole('dialog', { name: 'Attached image 1' })).toBeTruthy();
  });

  it('closes with its close button and with Escape', () => {
    renderGallery();

    fireEvent.click(screen.getByRole('button', { name: 'Attached image 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Attached image 1' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders nothing for a feedback without images', () => {
    const { container } = render(<ImageGallery images={[]} altFor={(n) => `Attached image ${n}`} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('Feedback images open inside the app', () => {
  it('on the super-admin console, where the report came from', async () => {
    mockFetch({
      '/api/super-admin/teams': { teams: [] },
      '/api/super-admin/feedbacks': { feedbacks: [feedback] },
      '/api/info-message': { infoMessage: '' },
      '/api/super-admin/admin-email': { adminEmail: '', notifyNewTeam: false },
      '/api/super-admin/ai-settings': { ai: { enabled: false, apiUrl: '' } },
      '/api/super-admin/active-sessions': { sessions: [] },
      '/api/super-admin/logs': { logs: [] },
      '/api/super-admin/backups/list': { backups: [], config: {} }
    });
    render(<SuperAdmin sessionToken="test-token" onExit={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole('button', { name: /Feedback \(1\)/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Feedback \(1\)/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Attached image 1' }));

    expect(screen.getByRole('dialog', { name: 'Attached image 1' })).toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it('on the team feedback board, which had the same thumbnails', async () => {
    mockFetch({ '/api/feedbacks/all': { feedbacks: [feedback] } });
    render(
      <TeamFeedback
        teamId="team-1"
        teamName="Team One"
        teamPassword="pw"
        sessionToken="token"
        currentUserId="user-1"
        currentUserName="User One"
        feedbacks={[]}
        onSubmitFeedback={vi.fn()}
        onRefresh={vi.fn()}
      />
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Attached image 1' }));

    expect(screen.getByRole('dialog', { name: 'Attached image 1' })).toBeTruthy();
    expect(openSpy).not.toHaveBeenCalled();
  });
});
