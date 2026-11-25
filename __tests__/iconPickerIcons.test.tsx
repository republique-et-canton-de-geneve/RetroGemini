import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { IconPicker } from '../components/IconPicker';
import { ICON_PICKER_ICONS, columnIconName } from '../components/iconPickerIcons';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The icon picker offers the names a column stores, and a stored name reaches
 * every screen as a font ligature. A name no cut of Material Symbols draws
 * shows as its own letters ("CLARITY") and stretches its tile, which is what
 * `clarity` did from the first release (the icon study of 45.0). The real
 * glyphs are measured in a browser by `e2e-prod/icon-ligatures.spec.ts`; this
 * file pins the list and the read-time alias.
 */

describe('the icon picker list', () => {
  it('offers each name once', () => {
    const names = ICON_PICKER_ICONS.map((icon) => icon.name);
    expect(names.length).toBeGreaterThan(100);
    expect(new Set(names).size).toBe(names.length);
  });

  it('no longer offers clarity, which no cut of the font draws, and offers light_mode for it', () => {
    const names = ICON_PICKER_ICONS.map((icon) => icon.name);
    expect(names).not.toContain('clarity');
    expect(names).toContain('light_mode');
    // A search for the old word still finds its replacement.
    expect(ICON_PICKER_ICONS.find((icon) => icon.name === 'light_mode')?.keywords).toMatch(/\bclarity\b/);
  });

  it('writes only ligature-shaped names', () => {
    for (const { name } of ICON_PICKER_ICONS) expect(name).toMatch(/^[a-z0-9_]+$/);
  });
});

describe('a stored column icon, as it is drawn', () => {
  it('reads a stored clarity as light_mode', () => {
    expect(columnIconName('clarity')).toBe('light_mode');
  });

  it('leaves every other name as it was stored, unknown ones included', () => {
    for (const name of ['star', 'play_arrow', 'light_mode', 'not_an_icon', '']) expect(columnIconName(name)).toBe(name);
  });

  it('opens the picker on the replacement for a column that stored clarity, and writes nothing by opening', () => {
    const onChange = vi.fn();
    render(<IconPicker initialIcon="clarity" onChange={onChange} />);

    expect(screen.queryByText('clarity')).toBeNull();
    // The preview glyph and its caption.
    expect(screen.getAllByText('light_mode').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole('button', { name: 'Choose the light_mode icon' })).toHaveClass('border-indigo-500');
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('the picker’s muted controls and text', () => {
  // The close button is an icon shown at rest: 3:1 for a control (1.4.11). The
  // empty state's text is only seen after a search that finds nothing, which no
  // audit walks: 4.5:1.
  it('draws the close icon at 3:1 and the empty state at 4.5:1 on its white panel', () => {
    render(<IconPicker initialIcon="star" onChange={vi.fn()} onClose={vi.fn()} />);
    const close = screen.getByRole('button', { name: 'Close the icon picker' });
    expect(effectivePair(close.querySelector('.material-symbols-outlined')!).ratio).toBeGreaterThanOrEqual(3);

    fireEvent.change(screen.getByPlaceholderText('Search icons...'), { target: { value: 'zzzz-nothing' } });
    for (const text of ['No icons found', 'Try a different search term', '0 icons found']) {
      expect(effectivePair(screen.getByText(text)).ratio, text).toBeGreaterThanOrEqual(4.5);
    }
  });
});
