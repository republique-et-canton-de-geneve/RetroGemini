import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import BoardColumnNavigator from '../components/session/BoardColumnNavigator';
import LanguageProvider from '../i18n/LanguageProvider';

/**
 * The strip that names every board column when they do not all fit. Off
 * screen must be said with more than a colour (WCAG 1.4.1), every icon-only
 * button needs a name, and the arrows must not offer a direction with nothing
 * in it.
 */

const COLUMNS = [
  { id: 'stop', title: 'Stop Doing' },
  { id: 'less', title: 'Less Of' },
  { id: 'keep', title: 'Keep Doing' },
  { id: 'more', title: 'More Of' },
  { id: 'start', title: 'Start Doing', lang: 'en' }
];

afterEach(() => cleanup());

const renderNavigator = (props: Partial<React.ComponentProps<typeof BoardColumnNavigator>> = {}, language: 'en' | 'fr' = 'en') => {
  const handlers = { onPrevious: vi.fn(), onNext: vi.fn(), onReveal: vi.fn() };
  render(
    <LanguageProvider initialLanguage={language}>
      <BoardColumnNavigator
        columns={COLUMNS}
        visibleIds={['stop', 'less', 'keep']}
        canScrollLeft={false}
        canScrollRight
        {...handlers}
        {...props}
      />
    </LanguageProvider>
  );
  return handlers;
};

describe('BoardColumnNavigator', () => {
  it('names every column and says which are off screen, in words and with an icon', () => {
    renderNavigator();
    const nav = screen.getByRole('navigation', { name: 'Board columns' });
    const chips = within(nav).getAllByRole('button').filter((button) => button.dataset.testid?.startsWith('board-column-chip-'));
    expect(chips.map((chip) => chip.getAttribute('data-in-view'))).toEqual(['true', 'true', 'true', 'false', 'false']);
    expect(screen.getByRole('button', { name: '5. Start Doing (off screen)' })).toHaveAttribute('data-in-view', 'false');
    expect(screen.getByRole('button', { name: '4. More Of (off screen)' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '3. Keep Doing' })).toHaveAttribute('data-in-view', 'true');
    expect(screen.getByText('Start Doing')).toHaveAttribute('lang', 'en');
    expect(screen.getByText('Columns in view: 3 of 5')).toBeTruthy();
  });

  it('offers only the directions that have something in them, and reveals a column on demand', () => {
    const { onPrevious, onNext, onReveal } = renderNavigator();
    expect(screen.getByRole('button', { name: 'Show the previous columns' })).toBeDisabled();
    const next = screen.getByRole('button', { name: 'Show the next columns' });
    expect(next).toBeEnabled();

    fireEvent.click(next);
    expect(onNext).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: /Start Doing/ }));
    expect(onReveal).toHaveBeenCalledWith('start');
    expect(onPrevious).not.toHaveBeenCalled();
  });

  it('speaks French', () => {
    renderNavigator({ visibleIds: ['keep', 'more', 'start'], canScrollLeft: true, canScrollRight: false }, 'fr');
    expect(screen.getByRole('navigation', { name: 'Colonnes du tableau' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Afficher les colonnes précédentes' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Afficher les colonnes suivantes' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '1. Stop Doing (hors de l’écran)' })).toBeTruthy();
    expect(screen.getByText('Colonnes visibles : 3 sur 5')).toBeTruthy();
  });
});
