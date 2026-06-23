import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MarkdownContent from '../components/common/MarkdownContent';

describe('MarkdownContent', () => {
  it('renders ATX headings as semantic heading elements', () => {
    render(<MarkdownContent content={'# Title\n\n## Section\n\n### Subsection'} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 2, name: 'Section' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Subsection' })).toBeTruthy();
  });

  it('renders bold and italic inline markup', () => {
    const { container } = render(
      <MarkdownContent content={'This is **bold** and *italic* text.'} />
    );
    const strong = container.querySelector('strong');
    const em = container.querySelector('em');
    expect(strong?.textContent).toBe('bold');
    expect(em?.textContent).toBe('italic');
  });

  it('renders inline code without leaving backticks', () => {
    const { container } = render(<MarkdownContent content={'Run `npm run ci` first.'} />);
    const code = container.querySelector('code');
    expect(code?.textContent).toBe('npm run ci');
    expect(container.textContent).not.toContain('`');
  });

  it('renders unordered lists', () => {
    const { container } = render(
      <MarkdownContent content={'- First item\n- Second item\n- Third item'} />
    );
    const lists = container.querySelectorAll('ul');
    expect(lists).toHaveLength(1);
    const items = container.querySelectorAll('ul > li');
    expect(items).toHaveLength(3);
    expect(items[0].textContent).toContain('First item');
  });

  it('renders ordered lists as <ol>', () => {
    const { container } = render(
      <MarkdownContent content={'1. Alpha\n2. Beta\n3. Gamma'} />
    );
    expect(container.querySelector('ol')).toBeTruthy();
    expect(container.querySelectorAll('ol > li')).toHaveLength(3);
  });

  it('keeps a single ordered list across blank lines (loose list) and nests bullets', () => {
    const markdown = [
      '1. **First driver**',
      '   - detail one',
      '   - detail two',
      '',
      '2. **Second driver**',
      '   - detail three'
    ].join('\n');
    const { container } = render(<MarkdownContent content={markdown} />);

    // A single top-level ordered list with two items (numbering not restarted).
    const topLists = container.querySelectorAll(':scope > div > ol');
    expect(topLists).toHaveLength(1);
    const topItems = topLists[0].querySelectorAll(':scope > li');
    expect(topItems).toHaveLength(2);

    // Each item carries a nested bullet list.
    const firstNested = topItems[0].querySelector('ul');
    expect(firstNested).toBeTruthy();
    expect(within(topItems[0] as HTMLElement).getByText('First driver')).toBeTruthy();
    expect(firstNested?.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders horizontal rules', () => {
    const { container } = render(<MarkdownContent content={'Above\n\n---\n\nBelow'} />);
    expect(container.querySelector('hr')).toBeTruthy();
  });

  it('renders paragraphs and preserves plain text content', () => {
    render(<MarkdownContent content={'A first paragraph.\n\nA second paragraph.'} />);
    expect(screen.getByText('A first paragraph.')).toBeTruthy();
    expect(screen.getByText('A second paragraph.')).toBeTruthy();
  });

  it('renders links with safe rel/target attributes', () => {
    const { container } = render(
      <MarkdownContent content={'See [the docs](https://example.com/docs).'} />
    );
    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/docs');
    expect(link?.getAttribute('rel')).toContain('noopener');
    expect(link?.getAttribute('target')).toBe('_blank');
  });

  it('does not crash on empty content', () => {
    const { container } = render(<MarkdownContent content={''} />);
    expect(container.querySelector('[data-testid="markdown-content"]')).toBeTruthy();
  });
});
