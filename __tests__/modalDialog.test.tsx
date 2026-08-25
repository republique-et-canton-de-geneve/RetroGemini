import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import React from 'react';
import ModalDialog from '../components/common/ModalDialog';

/**
 * The shared modal shell (H42).
 *
 * The accessibility pass found thirteen `fixed inset-0` overlays across the
 * product and exactly **one** declaring `role="dialog"`. Probing the create-team
 * modal: focus moved into it on open (good), but Tab walked straight out into
 * the page behind it, and Escape did nothing. Fixing that thirteen times over
 * would have produced thirteen slightly different answers, so the behaviour
 * lives here once and the call sites keep only their own markup.
 */

const Fixture: React.FC<{ onClose?: () => void; dismissible?: boolean }> = ({ onClose, dismissible = true }) => (
  <ModalDialog label="Test dialog" onClose={dismissible ? onClose : undefined}>
    <button type="button">First</button>
    <input aria-label="Middle" />
    <button type="button">Last</button>
  </ModalDialog>
);

describe('ModalDialog — the dialog contract', () => {
  it('announces itself as a modal dialog with a name', () => {
    render(<Fixture />);

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-label')).toBe('Test dialog');
  });

  it('takes its name from an element in the content when asked to', () => {
    render(
      <ModalDialog labelledBy="dialog-title">
        <h2 id="dialog-title">Invite the team</h2>
      </ModalDialog>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-labelledby')).toBe('dialog-title');
    expect(dialog.getAttribute('aria-label')).toBeNull();
  });

  it('is the panel that is the dialog, not the backdrop', () => {
    render(<Fixture />);

    // The backdrop is click-to-close scenery; a screen reader that treats it as
    // the dialog reads the whole page as being inside it.
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).not.toContain('inset-0');
  });
});

describe('ModalDialog — Escape', () => {
  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does nothing on Escape when the dialog is not dismissible', () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} dismissible={false} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps Escape on the innermost dialog even after the outer one re-renders', () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();

    // Call sites pass inline arrow functions, so `onClose` gets a new identity
    // on every render. If the stack registration depends on that identity, an
    // outer re-render silently promotes the outer dialog to the top and Escape
    // closes the wrong one.
    // Memoized, so the outer's state change re-renders the outer *alone* —
    // which is the case that actually reorders the stack. When both re-render,
    // React's cleanup-then-setup order happens to preserve it.
    const Inner = React.memo(function Inner() {
      return (
        <ModalDialog label="Inner" onClose={() => onCloseInner()}>
          <button type="button">Inner button</button>
        </ModalDialog>
      );
    });

    const Stack: React.FC = () => {
      const [tick, setTick] = React.useState(0);
      return (
        <>
          <ModalDialog label="Outer" onClose={() => onCloseOuter()}>
            <button type="button" onClick={() => setTick(tick + 1)}>Re-render outer</button>
          </ModalDialog>
          <Inner />
        </>
      );
    };

    render(<Stack />);
    fireEvent.click(screen.getByRole('button', { name: 'Re-render outer' }));

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });

  it('closes only the topmost dialog when two are stacked', () => {
    const onCloseOuter = vi.fn();
    const onCloseInner = vi.fn();

    render(
      <>
        <ModalDialog label="Outer" onClose={onCloseOuter}>
          <button type="button">Outer button</button>
        </ModalDialog>
        <ModalDialog label="Inner" onClose={onCloseInner}>
          <button type="button">Inner button</button>
        </ModalDialog>
      </>
    );

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCloseInner).toHaveBeenCalledTimes(1);
    expect(onCloseOuter).not.toHaveBeenCalled();
  });
});

describe('ModalDialog — focus', () => {
  it('moves focus into the dialog on open', async () => {
    render(<Fixture />);

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    });
  });

  it('leaves focus alone when the content has already claimed it', async () => {
    render(
      <ModalDialog label="Autofocused">
        <button type="button">First</button>
        <input aria-label="Search" autoFocus />
      </ModalDialog>
    );

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText('Search'));
    });
  });

  it('returns focus to whatever opened it', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = render(<Fixture />);
    await waitFor(() => expect(document.activeElement).not.toBe(opener));

    unmount();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });

  it('gives focus back without a ring when the dialog was opened by pointer', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    // A button clicked with the mouse is focused but not focus-visible. jsdom
    // does not implement `:focus-visible`, so the state is stubbed rather than
    // simulated — `e2e/accessibility-audit.spec.ts` measures the real thing.
    opener.matches = ((selector: string) =>
      selector === ':focus-visible' ? false : Element.prototype.matches.call(opener, selector)) as Element['matches'];
    opener.focus();

    const { unmount } = render(<Fixture />);
    unmount();

    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(opener.dataset.focusRestore).toBe('pointer');
    opener.remove();
  });

  it('keeps the ring when the dialog was opened from the keyboard', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.matches = ((selector: string) =>
      selector === ':focus-visible' ? true : Element.prototype.matches.call(opener, selector)) as Element['matches'];
    opener.focus();

    const { unmount } = render(<Fixture />);
    unmount();

    await waitFor(() => expect(document.activeElement).toBe(opener));
    // Nothing suppresses the indicator: this user navigates by keyboard and
    // needs to see where focus landed.
    expect(opener.dataset.focusRestore).toBeUndefined();
    opener.remove();
  });

  it('clears the suppression on the next blur, so an ordinary tab rings again', async () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.matches = ((selector: string) =>
      selector === ':focus-visible' ? false : Element.prototype.matches.call(opener, selector)) as Element['matches'];
    opener.focus();

    const { unmount } = render(<Fixture />);
    unmount();
    await waitFor(() => expect(opener.dataset.focusRestore).toBe('pointer'));

    opener.blur();
    await waitFor(() => expect(opener.dataset.focusRestore).toBeUndefined());
    opener.remove();
  });

  it('wraps Tab from the last control back to the first', async () => {
    render(<Fixture />);
    const last = screen.getByRole('button', { name: 'Last' });
    const first = screen.getByRole('button', { name: 'First' });

    last.focus();
    fireEvent.keyDown(last, { key: 'Tab' });

    await waitFor(() => expect(document.activeElement).toBe(first));
  });

  it('wraps Shift+Tab from the first control back to the last', async () => {
    render(<Fixture />);
    const first = screen.getByRole('button', { name: 'First' });
    const last = screen.getByRole('button', { name: 'Last' });

    first.focus();
    fireEvent.keyDown(first, { key: 'Tab', shiftKey: true });

    await waitFor(() => expect(document.activeElement).toBe(last));
  });

  it('pulls focus back in when it has escaped to the page behind', async () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    render(<Fixture />);

    outside.focus();
    fireEvent.keyDown(document, { key: 'Tab' });

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    });
    outside.remove();
  });
});

describe('ModalDialog — the backdrop', () => {
  it('closes when the backdrop itself is clicked', () => {
    const onClose = vi.fn();
    const { container } = render(<Fixture onClose={onClose} />);

    fireEvent.click(container.firstElementChild!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does not close when a click inside the panel bubbles out', () => {
    const onClose = vi.fn();
    render(<Fixture onClose={onClose} />);

    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('keeps the backdrop inert when the dialog opts out of backdrop dismissal', () => {
    const onClose = vi.fn();
    const { container } = render(
      <ModalDialog label="Sticky" onClose={onClose} closeOnBackdropClick={false}>
        <button type="button">First</button>
      </ModalDialog>
    );

    fireEvent.click(container.firstElementChild!);
    expect(onClose).not.toHaveBeenCalled();
    // Escape still works: the keyboard is never the thing taken away.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
