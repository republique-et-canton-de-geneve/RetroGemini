import React, { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import ModalDialog from '../components/common/ModalDialog';
import { IconPicker } from '../components/IconPicker';

/**
 * Returning focus to whatever opened an overlay (WCAG 2.4.3), and the bug that
 * made `ModalDialog` fail it silently — raised by Codex on PR #437 against
 * `IconPicker`, and found on measuring to be the shared primitive's too.
 *
 * **Why the existing 19 ModalDialog cases were green while it was broken.**
 * None of them put an `autoFocus` inside the dialog. React applies `autoFocus`
 * while committing the DOM, before any effect runs, so the effect that captured
 * `document.activeElement` as "the opener" captured the autofocused *field*
 * instead. That field unmounts with the dialog, the restore found a
 * disconnected element and gave up, and focus landed on `<body>` — the exact
 * outcome the component exists to prevent. Every dialog in the product whose
 * content autofocuses had it: the delete-team confirmation is the one a user
 * meets.
 *
 * So the first case here is the regression test, and it is deliberately
 * written with an `autoFocus` child: that single detail is the difference
 * between the suite noticing and not.
 */

const DialogHarness = ({ withAutoFocus }: { withAutoFocus: boolean }) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-testid="opener" onClick={() => setOpen(true)}>Open</button>
      {open && (
        <ModalDialog label="probe" onClose={() => setOpen(false)}>
          {/* The `autoFocus` is the case under test, not an oversight: it is
              the single detail that decides whether this suite can see the
              bug. `jsx-a11y` is not configured for `__tests__/`, so no
              suppression is needed (or accepted) here. */}
          {withAutoFocus
            ? <input data-testid="field" autoFocus />
            : <input data-testid="field" />}
          <button data-testid="close" onClick={() => setOpen(false)}>Close</button>
        </ModalDialog>
      )}
    </>
  );
};

describe('a dialog gives focus back to its opener', () => {
  it('does so even when its content autofocuses', () => {
    render(<DialogHarness withAutoFocus />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);

    // The content claimed focus, which is allowed and better informed.
    expect(document.activeElement).toBe(screen.getByTestId('field'));

    fireEvent.click(screen.getByTestId('close'));

    // Was `<body>` before this fix.
    expect(document.activeElement).toBe(opener);
  });

  it('still does so when nothing inside claimed focus', () => {
    render(<DialogHarness withAutoFocus={false} />);
    const opener = screen.getByTestId('opener');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByTestId('close'));

    expect(document.activeElement).toBe(opener);
  });
});

/**
 * `IconPicker` is a popover beside its trigger rather than a modal, so it is
 * deliberately not a `ModalDialog` — but it autofocuses its search box and both
 * call sites close it by unmounting, so it owed its user the same thing.
 */
const PickerHarness = () => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button data-testid="trigger" onClick={() => setOpen(true)}>Pick an icon</button>
      {open && (
        <IconPicker initialIcon="star" onChange={vi.fn()} onClose={() => setOpen(false)} />
      )}
    </>
  );
};

describe('the icon picker gives focus back to its trigger', () => {
  it('does so when closed with its close button', () => {
    render(<PickerHarness />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);

    expect(document.activeElement).toBe(screen.getByPlaceholderText('Search icons...'));

    fireEvent.click(screen.getByLabelText('Close the icon picker'));

    expect(document.activeElement).toBe(trigger);
  });

  it('does so when an icon is chosen, which closes it on a timer', () => {
    vi.useFakeTimers();
    try {
      render(<PickerHarness />);
      const trigger = screen.getByTestId('trigger');
      trigger.focus();
      fireEvent.click(trigger);

      fireEvent.click(screen.getAllByTitle('lightbulb')[0]);
      // The picker closes 150 ms after the choice; the button the user pressed
      // unmounts with it, so this is the path that loses focus in real use.
      act(() => { vi.advanceTimersByTime(200); });

      expect(document.activeElement).toBe(trigger);
    } finally {
      vi.useRealTimers();
    }
  });
});
