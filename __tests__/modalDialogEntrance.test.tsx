import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useState } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import ModalDialog from '../components/common/ModalDialog';
import ImageGallery from '../components/common/ImageGallery';
import { prefersMotion, restoreMotionPreference } from './helpers/motionPreference';

/**
 * The entrance every dialog of the product takes (45.0): the veil fades in,
 * the panel rises into place. It is decoration, so three things matter more
 * than the effect itself: it runs once, when the dialog opens (never again on
 * a re-render or when another dialog opens over it); it leaves nothing behind
 * (the class comes off when the element's own animation ends); and the gallery,
 * whose close button is `position: fixed` inside the panel, takes no transform.
 */

const veilOf = (dialog: HTMLElement) => dialog.parentElement as HTMLElement;

const Stack: React.FC = () => {
  const [inner, setInner] = useState(false);
  return (
    <ModalDialog label="Outer" onClose={() => {}}>
      <button type="button" onClick={() => setInner(true)}>Open inner</button>
      {inner && (
        <ModalDialog label="Inner" onClose={() => setInner(false)}>
          <button type="button">Inner button</button>
        </ModalDialog>
      )}
    </ModalDialog>
  );
};

describe('ModalDialog — the entrance', () => {
  // A reader who did not ask for less motion; the case below states the other one.
  beforeEach(() => prefersMotion('no-preference'));
  afterEach(() => restoreMotionPreference());

  it.each([
    ['who asked for less motion', () => prefersMotion('reduce')],
    ['whose browser cannot say (no matchMedia)', () => restoreMotionPreference()],
  ])('gives a reader %s no entrance class at all, and the same dialog', (_, prefer) => {
    prefer();
    render(
      <ModalDialog label="Test" overlayClassName="fixed inset-0 a" panelClassName="b">
        <button type="button">Ok</button>
      </ModalDialog>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.className).toBe('b');
    expect(veilOf(dialog).className).toBe('fixed inset-0 a');
  });

  it('fades the veil and raises the panel when it opens', () => {
    render(
      <ModalDialog label="Test" overlayClassName="fixed inset-0 a" panelClassName="b">
        <button type="button">Ok</button>
      </ModalDialog>
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList).toContain('fx-dialog-in');
    expect(veilOf(dialog).classList).toContain('fx-veil-in');
    // Added beside the call site's own classes, never in their place.
    expect(dialog.classList).toContain('b');
    expect(veilOf(dialog).classList).toContain('a');
  });

  it('takes each class off when that element’s own animation ends, not a descendant’s', () => {
    render(
      <ModalDialog label="Test">
        <span data-testid="child">x</span>
      </ModalDialog>
    );
    const dialog = screen.getByRole('dialog');
    const veil = veilOf(dialog);

    // A descendant's animation bubbles up to the panel and the veil: it is not theirs.
    fireEvent.animationEnd(screen.getByTestId('child'));
    expect(dialog.classList).toContain('fx-dialog-in');
    expect(veil.classList).toContain('fx-veil-in');

    fireEvent.animationEnd(dialog);
    expect(dialog.classList).not.toContain('fx-dialog-in');
    // The panel's event bubbled to the veil, which kept its own until its end.
    expect(veil.classList).toContain('fx-veil-in');

    fireEvent.animationEnd(veil);
    expect(veil.classList).not.toContain('fx-veil-in');
  });

  // An animation that is interrupted never ends: the element hidden while it
  // plays, the reader turning motion off between the script's check and the
  // stylesheet's. The class then stayed for as long as the dialog was open,
  // and an animation it names plays again the next time its element is shown.
  it('takes each class off after its length even when no animation ever ends', () => {
    vi.useFakeTimers();
    const view = render(<ModalDialog label="Stuck" onClose={() => {}}><button type="button">One</button></ModalDialog>);
    try {
      const dialog = screen.getByRole('dialog');
      expect(dialog.classList.contains('fx-dialog-in')).toBe(true);
      expect(veilOf(dialog).classList.contains('fx-veil-in')).toBe(true);
      // Still there while the effect is playing.
      act(() => { vi.advanceTimersByTime(150); });
      expect(dialog.classList.contains('fx-dialog-in')).toBe(true);
      act(() => { vi.advanceTimersByTime(2000); });
      expect(dialog.classList.contains('fx-dialog-in')).toBe(false);
      expect(veilOf(dialog).classList.contains('fx-veil-in')).toBe(false);
    } finally {
      // The dialog leaves on this clock, and the clock runs dry before the
      // real one comes back. jsdom starts its own rendering interval with
      // whatever `setInterval` is installed when the focus moves; left
      // waiting on a clock that is gone, it never fires again, and no
      // animation frame runs for the rest of the file.
      view.unmount();
      act(() => { vi.runOnlyPendingTimers(); });
      vi.useRealTimers();
    }
  });

  it('does not replay on a re-render', () => {
    const { rerender } = render(
      <ModalDialog label="Test" panelClassName="p-4">
        <span>one</span>
      </ModalDialog>
    );
    const dialog = screen.getByRole('dialog');
    fireEvent.animationEnd(dialog);
    rerender(
      <ModalDialog label="Test" panelClassName="p-6">
        <span>two</span>
      </ModalDialog>
    );
    expect(screen.getByRole('dialog').classList).not.toContain('fx-dialog-in');
    expect(screen.getByRole('dialog').classList).toContain('p-6');
  });

  it('a dialog opened over another enters alone: the one below does not restart', () => {
    render(<Stack />);
    const outer = screen.getByRole('dialog', { name: 'Outer' });
    fireEvent.animationEnd(outer);
    fireEvent.animationEnd(veilOf(outer));

    fireEvent.click(screen.getByRole('button', { name: 'Open inner' }));

    const inner = screen.getByRole('dialog', { name: 'Inner' });
    expect(inner.classList).toContain('fx-dialog-in');
    expect(veilOf(inner).classList).toContain('fx-veil-in');
    expect(outer.classList).not.toContain('fx-dialog-in');
    expect(veilOf(outer).classList).not.toContain('fx-veil-in');
  });

  it('does not delay the first focus', async () => {
    render(
      <ModalDialog label="Test">
        <button type="button">First</button>
      </ModalDialog>
    );
    // Focus moves on the next frame, as before the entrance existed: nothing
    // waits for the animation to end.
    await act(async () => {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }));
    expect(screen.getByRole('dialog').classList).toContain('fx-dialog-in');
  });

  it('the gallery fades its panel in, with no transform, because its close button is fixed', () => {
    render(<ImageGallery images={['data:image/png;base64,AAAA']} altFor={(n) => `Image ${n}`} />);
    fireEvent.click(screen.getByRole('button', { name: 'Image 1' }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.classList).not.toContain('fx-dialog-in');
    expect(dialog.classList).toContain('fx-veil-in');
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.classList).toContain('fixed');
  });
});

// The gallery's panel takes the fade (`entrance="fade"`): the veil's class on
// the panel. It comes off like the rise does, at the panel's own animation
// end and at the net when none comes.
describe('ModalDialog — the fade a panel takes', () => {
  beforeEach(() => prefersMotion('no-preference'));
  afterEach(() => restoreMotionPreference());

  const Faded: React.FC = () => (
    <ModalDialog label="Faded" entrance="fade" onClose={() => {}}>
      <button type="button">Inside</button>
    </ModalDialog>
  );

  it('takes the fade off the panel when the panel’s own animation ends, not its veil’s nor a descendant’s', () => {
    render(<Faded />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.classList).toContain('fx-veil-in');
    expect(dialog.classList).not.toContain('fx-dialog-in');

    fireEvent.animationEnd(screen.getByRole('button', { name: 'Inside' }));
    fireEvent.animationEnd(veilOf(dialog));
    expect(dialog.classList).toContain('fx-veil-in');
    // The veil's own class went with the veil's own animation.
    expect(veilOf(dialog).classList).not.toContain('fx-veil-in');

    fireEvent.animationEnd(dialog);
    expect(dialog.classList).not.toContain('fx-veil-in');
  });

  it('takes the fade off the panel after its length when no animation ever ends', () => {
    vi.useFakeTimers();
    const view = render(<Faded />);
    try {
      const dialog = screen.getByRole('dialog');
      expect(dialog.classList).toContain('fx-veil-in');
      act(() => { vi.advanceTimersByTime(150); });
      expect(dialog.classList).toContain('fx-veil-in');
      act(() => { vi.advanceTimersByTime(2000); });
      expect(dialog.classList).not.toContain('fx-veil-in');
      expect(veilOf(dialog).classList).not.toContain('fx-veil-in');
    } finally {
      // See the same lines above: the dialog leaves on this clock, and the clock runs dry.
      view.unmount();
      act(() => { vi.runOnlyPendingTimers(); });
      vi.useRealTimers();
    }
  });
});

describe('the entrance effects in index.css', () => {
  const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');
  const rule = (name: string) => new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const keyframes = (name: string) => new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(css)?.[1] ?? '';

  it('fill backwards only, so no transform remains after the animation', () => {
    for (const name of ['fx-dialog-in', 'fx-veil-in']) {
      const body = rule(name);
      expect(body, name).toMatch(/animation:/);
      expect(body, name).toMatch(/\bbackwards\b/);
      expect(body, name).not.toMatch(/\b(both|forwards)\b/);
    }
  });

  it('the fade the gallery takes animates opacity alone', () => {
    const frames = keyframes('fx-veil-in');
    expect(frames).toMatch(/opacity/);
    expect(frames).not.toMatch(/transform/);
  });
});
