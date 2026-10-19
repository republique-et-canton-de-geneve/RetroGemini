import { describe, it, expect } from 'vitest';
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import ColumnMoveButtons from '../components/common/ColumnMoveButtons';
import { moveColumn } from '../utils/columnOrder';

/**
 * The reorder control the column editors share. A move re-renders the row in a
 * new place, and React may re-insert the very node holding focus; the control
 * must leave the keyboard on the column the user just moved, on a button that
 * still works — at an edge the button they pressed is disabled.
 */
const Harness: React.FC<{ orientation: 'vertical' | 'horizontal'; refuseMoves?: boolean }> = ({ orientation, refuseMoves = false }) => {
  const [columns, setColumns] = useState([
    { id: 'a', title: 'Start' },
    { id: 'b', title: 'Stop' },
    { id: 'c', title: 'Continue' }
  ]);
  return (
    <>
    <button type="button" onClick={() => setColumns((current) => [...current].reverse())}>Reverse elsewhere</button>
    <ul>
      {columns.map((column, index) => (
        <li key={column.id} data-testid={`row-${column.id}`}>
          {column.title}
          <ColumnMoveButtons
            index={index}
            count={columns.length}
            orientation={orientation}
            previousLabel={`Move ${column.title} back`}
            nextLabel={`Move ${column.title} on`}
            onMove={(direction) => {
              if (refuseMoves) return;
              setColumns((current) => moveColumn(current, column.id, direction));
            }}
          />
        </li>
      ))}
    </ul>
    </>
  );
};

const order = () => screen.getAllByRole('listitem').map((item) => item.getAttribute('data-testid'));

describe('ColumnMoveButtons', () => {
  it('disables the move past each edge', () => {
    render(<Harness orientation="vertical" />);
    expect((screen.getByRole('button', { name: 'Move Start back' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Move Start on' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'Move Continue on' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('moves the column and keeps focus on the button pressed while it still applies', () => {
    render(<Harness orientation="horizontal" />);
    const button = screen.getByRole('button', { name: 'Move Start on' });
    button.focus();
    fireEvent.click(button);
    expect(order()).toEqual(['row-b', 'row-a', 'row-c']);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Start on' }));
  });

  it('hands focus to the other button of the same column once it reaches an edge', () => {
    render(<Harness orientation="vertical" />);
    const button = screen.getByRole('button', { name: 'Move Stop back' });
    button.focus();
    fireEvent.click(button);
    expect(order()).toEqual(['row-b', 'row-a', 'row-c']);
    expect((screen.getByRole('button', { name: 'Move Stop back' }) as HTMLButtonElement).disabled).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Move Stop on' }));
  });

  // A session drops a move made while offline. The focus request must not
  // survive it: the next reorder made by someone else would pull the keyboard
  // back to this button, out of whatever the user is doing.
  it('forgets a refused move, so a later reorder does not steal focus', async () => {
    render(<Harness orientation="horizontal" refuseMoves />);
    fireEvent.click(screen.getByRole('button', { name: 'Move Start on' }));
    expect(order()).toEqual(['row-a', 'row-b', 'row-c']);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const elsewhere = screen.getByRole('button', { name: 'Reverse elsewhere' });
    elsewhere.focus();
    fireEvent.click(elsewhere);
    expect(order()).toEqual(['row-c', 'row-b', 'row-a']);
    expect(document.activeElement).toBe(elsewhere);
  });

  it('draws arrows that match the direction of the list', () => {
    const { unmount } = render(<Harness orientation="vertical" />);
    expect(screen.getByRole('button', { name: 'Move Stop back' }).textContent).toBe('arrow_upward');
    unmount();
    render(<Harness orientation="horizontal" />);
    expect(screen.getByRole('button', { name: 'Move Stop back' }).textContent).toBe('chevron_left');
  });
});
