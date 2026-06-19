import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import HealthCheckCommentsSection, { DimensionComment } from '../components/session/HealthCheckCommentsSection';

const baseHandlers = () => ({
  onAddComment: vi.fn(),
  onUpdateComment: vi.fn(),
  onDeleteComment: vi.fn()
});

const renderSection = (
  comments: DimensionComment[],
  currentUserId: string,
  handlers = baseHandlers()
) => {
  const getAuthorLabel = (userId: string) =>
    userId === currentUserId ? 'You' : userId === 'unknown' ? null : `User ${userId}`;
  render(
    <HealthCheckCommentsSection
      comments={comments}
      currentUserId={currentUserId}
      getAuthorLabel={getAuthorLabel}
      {...handlers}
    />
  );
  return handlers;
};

describe('HealthCheckCommentsSection', () => {
  it('renders existing comments without duplicating the current user comment', () => {
    renderSection(
      [
        { userId: 'u1', comment: 'Mine' },
        { userId: 'u2', comment: 'Theirs' }
      ],
      'u1'
    );

    // The current user's comment appears exactly once (no separate editable mirror)
    expect(screen.getAllByText('Mine')).toHaveLength(1);
    expect(screen.getByText('Theirs')).toBeTruthy();
    // No "Add a comment" composer when the user already has a comment
    expect(screen.queryByPlaceholderText('Add a comment...')).toBeNull();
  });

  it('shows edit/delete controls only on the current user comment', () => {
    renderSection(
      [
        { userId: 'u1', comment: 'Mine' },
        { userId: 'u2', comment: 'Theirs' }
      ],
      'u1'
    );

    // Only one edit button and one delete button (for the own comment)
    expect(screen.getAllByLabelText('Edit comment')).toHaveLength(1);
    expect(screen.getAllByLabelText('Delete comment')).toHaveLength(1);
  });

  it('shows the composer when the user has no comment yet and submits it', () => {
    const handlers = renderSection([{ userId: 'u2', comment: 'Theirs' }], 'u1');

    const textarea = screen.getByPlaceholderText('Add a comment...');
    const submit = screen.getByRole('button', { name: 'Comment' });

    // Submit is disabled until there is text
    expect((submit as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textarea, { target: { value: 'New thought' } });
    expect((submit as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(submit);

    expect(handlers.onAddComment).toHaveBeenCalledWith('New thought');
  });

  it('edits the own comment in place and calls onUpdateComment', () => {
    const handlers = renderSection([{ userId: 'u1', comment: 'Mine' }], 'u1');

    fireEvent.click(screen.getByLabelText('Edit comment'));

    const editTextarea = screen.getByDisplayValue('Mine');
    fireEvent.change(editTextarea, { target: { value: 'Updated' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(handlers.onUpdateComment).toHaveBeenCalledWith('Updated');
  });

  it('confirms before deleting the own comment', () => {
    const handlers = renderSection([{ userId: 'u1', comment: 'Mine' }], 'u1');

    fireEvent.click(screen.getByLabelText('Delete comment'));
    // A confirmation appears before the destructive action runs
    expect(handlers.onDeleteComment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Yes'));
    expect(handlers.onDeleteComment).toHaveBeenCalledTimes(1);
  });

  it('hides the author label when getAuthorLabel returns null', () => {
    renderSection([{ userId: 'unknown', comment: 'Anonymous note' }], 'u1');

    expect(screen.getByText('Anonymous note')).toBeTruthy();
    expect(screen.queryByText(/User unknown/)).toBeNull();
  });

  it('shows an empty state and a composer when there are no comments', () => {
    renderSection([], 'u1');

    expect(screen.getByText('No comments yet.')).toBeTruthy();
    expect(screen.getByPlaceholderText('Add a comment...')).toBeTruthy();
  });
});
