import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ColorPicker } from '../components/ColorPicker';
import { IconPicker } from '../components/IconPicker';

/**
 * The template editors' two pickers say which colour and which icon a column
 * has as a state, not only by a ring or a border (WCAG 4.1.2; AGENTS.md,
 * *Accessibility*: a button that selects one option among several carries
 * `aria-pressed`), and a colour swatch is named by its colour in words, never
 * by its hex code.
 */

const swatches = () => screen.getAllByRole('button').filter((button) => button.hasAttribute('style'));
const pressed = (buttons: HTMLElement[]) => buttons.filter((button) => button.getAttribute('aria-pressed') === 'true');

describe('the colour picker', () => {
  it('presses the chosen colour, and only it, whatever case its code is stored in', () => {
    for (const stored of ['#dc2626', '#DC2626']) {
      const view = render(<ColorPicker initialColor={stored} onChange={vi.fn()} />);
      expect(swatches()).toHaveLength(17);
      expect(swatches().every((swatch) => swatch.hasAttribute('aria-pressed'))).toBe(true);
      expect(pressed(swatches()).map((swatch) => swatch.getAttribute('aria-label'))).toEqual(['Red']);
      view.unmount();
    }
  });

  it('presses none for a colour the palette does not offer', () => {
    render(<ColorPicker initialColor="#6366F1" onChange={vi.fn()} />);
    expect(pressed(swatches())).toEqual([]);
  });

  it('names every swatch by its colour in words, never by its code', () => {
    render(<ColorPicker initialColor="#dc2626" onChange={vi.fn()} />);
    const names = swatches().map((swatch) => swatch.getAttribute('aria-label'));
    expect(names).toEqual([
      'Red', 'Rose', 'Pink', 'Fuchsia', 'Purple', 'Violet', 'Indigo', 'Blue', 'Sky blue',
      'Cyan', 'Teal', 'Emerald', 'Green', 'Lime', 'Yellow', 'Orange', 'Slate grey',
    ]);
    for (const swatch of swatches()) expect(swatch.getAttribute('title')).toBe(swatch.getAttribute('aria-label'));
  });

  it('moves the press to the colour picked', () => {
    const onChange = vi.fn();
    render(<ColorPicker initialColor="#dc2626" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Teal' }));
    expect(onChange).toHaveBeenCalledWith('#0d9488');
    expect(pressed(swatches()).map((swatch) => swatch.getAttribute('aria-label'))).toEqual(['Teal']);
  });
});

describe('the icon picker', () => {
  const tiles = () => screen.getAllByRole('button', { name: /^Choose the .+ icon$/ });

  it('presses the chosen icon, and only it, and moves the press to the icon picked', () => {
    render(<IconPicker initialIcon="star" onChange={vi.fn()} />);
    expect(tiles().every((tile) => tile.hasAttribute('aria-pressed'))).toBe(true);
    expect(pressed(tiles()).map((tile) => tile.getAttribute('aria-label'))).toEqual(['Choose the star icon']);

    fireEvent.click(screen.getByRole('button', { name: 'Choose the lightbulb icon' }));
    expect(pressed(tiles()).map((tile) => tile.getAttribute('aria-label'))).toEqual(['Choose the lightbulb icon']);
  });
});
