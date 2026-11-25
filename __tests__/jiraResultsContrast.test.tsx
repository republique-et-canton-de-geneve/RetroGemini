import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import JiraLinkBadge from '../components/jira/JiraLinkBadge';
import JiraParentResults from '../components/jira/JiraParentResults';
import type { JiraParentResult } from '../types';
import { effectivePair } from './helpers/tailwindTheme';

/**
 * The Jira words that appear only after a send — a key, a doubt, a parent
 * issue's outcome — under the 45.0 tokens. The e2e audit of the batch dialog
 * runs before anything is sent, so it never reaches these branches.
 */

const BASE = 'https://jira.example.org';

/** Every element that holds words of its own, icons excepted. */
const wordsIn = (root: HTMLElement): HTMLElement[] =>
  [...root.querySelectorAll<HTMLElement>('*')].filter(
    (element) =>
      !element.classList.contains('material-symbols-outlined')
      && [...element.childNodes].some((node) => node.nodeType === Node.TEXT_NODE && node.textContent!.trim() !== ''),
  );

const expectReadable = (root: HTMLElement) => {
  const words = wordsIn(root);
  expect(words.length).toBeGreaterThan(0);
  for (const element of words) {
    const { fg, bg, ratio } = effectivePair(element);
    expect(ratio, `"${element.textContent}" in ${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  }
};

describe('a Jira link, in each of its states', () => {
  it.each([
    ['a key with an address', { key: 'TEAM-12', createdAt: '' }, BASE],
    ['a key with no address', { key: 'TEAM-12', createdAt: '' }, null],
    ['a creation in doubt', { uncertainSince: '2026-10-20T10:00:00.000Z' }, BASE],
  ] as const)('reads on a white card and on the slate-50 preview rows: %s', (_label, link, baseUrl) => {
    for (const surface of ['bg-white', 'bg-slate-50']) {
      const { container, unmount } = render(<div className={surface}><JiraLinkBadge link={link} baseUrl={baseUrl} /></div>);
      expectReadable(container.firstElementChild as HTMLElement);
      unmount();
    }
  });
});

describe('what became of each parent issue', () => {
  it('says every outcome in words that read on the dialog', () => {
    const parents: JiraParentResult[] = [
      { scope: 'retro:r1', status: 'created', key: 'TEAM-1' },
      { scope: 'retro:r2', status: 'adopted', key: 'TEAM-2' },
      { scope: 'retro:r3', status: 'uncertain', uncertainSince: '2026-10-20T10:00:00.000Z' },
      { scope: 'retro:r4', status: 'in_progress' },
      { scope: 'retro:r5', status: 'refused', jiraMessages: ['Field labels is invalid'], jiraFields: ['labels'] },
      { scope: 'retro:r6', status: 'not_saved', key: 'TEAM-6' },
    ];
    const { container } = render(
      <div className="bg-white">
        <ul>
          <JiraParentResults parents={parents} previews={[]} team={null} baseUrl={BASE} target={null} />
        </ul>
      </div>,
    );
    expect(container.querySelectorAll('li li')).toHaveLength(parents.length + 1);
    expectReadable(container.firstElementChild as HTMLElement);
  });
});
