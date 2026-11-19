import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Avatar, { type AvatarSize } from '../components/common/Avatar';

import { DEPARTED_AVATAR_CLASSES, PARTICIPANT_PALETTE, avatarColorClasses } from '../utils/participantColors';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The one component that draws a person. Its colours come from
 * `utils/participantColors.ts` (the call site passes what the module returned),
 * so what is measured here is the pair every screen paints.
 */

const FLOOR = 4.5;
const AVATAR_SIZES: readonly AvatarSize[] = [20, 24, 28, 32, 36, 40];

const disc = (initials: string) => screen.getByText(initials);

describe('Avatar', () => {
  // Today's sizes, and the text each already used (nothing shrinks); 12px at
  // least from 28 up.
  it.each([
    [20, 'w-5 h-5', 'text-[9px]'],
    [24, 'w-6 h-6', 'text-[10px]'],
    [28, 'w-7 h-7', 'text-xs'],
    [32, 'w-8 h-8', 'text-xs'],
    [36, 'w-9 h-9', 'text-sm'],
    [40, 'w-10 h-10', 'text-base'],
  ] as const)('size %i is %s with %s initials', (size, box, text) => {
    render(<Avatar colorClasses={avatarColorClasses('bg-lime-500')} initials="LI" size={size} />);
    const classes = disc('LI').className.split(/\s+/);
    for (const token of [...box.split(' '), text, 'rounded-full', 'shrink-0', 'font-bold']) expect(classes).toContain(token);
  });

  it('is decoration without a label: hidden from assistive technology, no role', () => {
    render(<Avatar colorClasses={avatarColorClasses('bg-rose-500')} initials="RO" size={32} />);
    expect(disc('RO').getAttribute('aria-hidden')).toBe('true');
    expect(disc('RO').getAttribute('role')).toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('is an image named by its label when it carries the only sign of who it is', () => {
    render(<Avatar colorClasses={avatarColorClasses('bg-rose-500')} initials="RO" size={24} label="Rose" />);
    const image = screen.getByRole('img', { name: 'Rose' });
    expect(image).toBe(disc('RO'));
    expect(image.getAttribute('aria-hidden')).toBeNull();
  });

  it('paints no class from an intruder value', () => {
    render(<Avatar colorClasses={avatarColorClasses('fixed inset-0 z-50')} initials="XA" size={32} />);
    const classes = disc('XA').className.split(/\s+/);
    for (const token of ['fixed', 'inset-0', 'z-50']) expect(classes).not.toContain(token);
    expect(classes).toContain('tone-neutral');
  });

  it('carries no opacity, no grayscale and no second text colour', () => {
    for (const size of AVATAR_SIZES) {
      const { unmount } = render(<Avatar colorClasses={DEPARTED_AVATAR_CLASSES} initials="DE" size={size} />);
      const classes = disc('DE').className;
      expect(classes).not.toMatch(/\bopacity-\d+|\bgrayscale\b/);
      expect(classes.split(/\s+/).filter((token) => token.startsWith('text-person-'))).toHaveLength(1);
      unmount();
    }
  });

  it.each([
    ...PARTICIPANT_PALETTE.map((color) => [color, avatarColorClasses(color)]),
    ['an unknown colour', avatarColorClasses('bg-sky-500')],
    ['a departed participant', DEPARTED_AVATAR_CLASSES],
  ])('%s: the initials clear 4.5:1 as painted', (_who, colorClasses) => {
    render(<Avatar colorClasses={colorClasses} initials="AB" size={20} />);
    const pair = effectivePair(disc('AB'));
    expect(pair.ratio, `${pair.fg} on ${pair.bg}`).toBeGreaterThanOrEqual(FLOOR);
  });
});
