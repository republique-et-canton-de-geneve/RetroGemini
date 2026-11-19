import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React, { useState } from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import ModalDialog from '../components/common/ModalDialog';
import ImageGallery from '../components/common/ImageGallery';

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

describe('the entrance effects in index.css', () => {
  const css = readFileSync(join(__dirname, '..', 'index.css'), 'utf8');
  const rule = (name: string) => new RegExp(`\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1] ?? '';
  const keyframes = (name: string) => new RegExp(`@keyframes ${name}\\s*\\{([\\s\\S]*?)\\n  \\}`).exec(css)?.[1] ?? '';

  it('fill backwards only, so no transform remains after the animation (decision D24)', () => {
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
