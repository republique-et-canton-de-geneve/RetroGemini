import React from 'react';

/**
 * MarkdownContent — a tiny, dependency-free Markdown renderer.
 *
 * The app must run fully offline / air-gapped (see AGENTS.md) and avoids
 * external UI component libraries, so instead of pulling in a heavy Markdown
 * stack (react-markdown + remark + micromark, etc.) this component parses the
 * limited subset of Markdown produced by our AI features into semantic,
 * Tailwind-styled HTML.
 *
 * Supported constructs:
 *  - ATX headings (`#` … `######`)
 *  - Unordered lists (`-`, `*`, `+`) and ordered lists (`1.`, `1)`),
 *    including one or more levels of indentation-based nesting and loose
 *    lists (blank lines between items)
 *  - Horizontal rules (`---`, `***`, `___`)
 *  - Blockquotes (`>`)
 *  - Paragraphs with hard line breaks
 *  - Inline: `**bold**`, `__bold__`, `*italic*`, `` `code` `` and
 *    `[links](https://example.com)`
 */

interface MarkdownContentProps {
  /** Raw Markdown text (e.g. an AI-generated analysis). */
  content: string;
  /** Optional extra class names applied to the wrapper. */
  className?: string;
}

// A single list item: (indent)(marker)(content). Markers are -, *, + for
// bullets and "1." / "1)" for ordered lists.
const LIST_ITEM_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const HEADING_RE = /^(#{1,6})\s+(.*)$/;
const HR_RE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const BLOCKQUOTE_RE = /^\s*>\s?(.*)$/;

// Inline tokens, in priority order: code first so it is never re-parsed, then
// bold before italic so `**x**` is not mistaken for two italics. Underscore
// italics are intentionally omitted to avoid mangling snake_case identifiers.
const INLINE_RE =
  /(`[^`]+`)|(\*\*[^\n]+?\*\*)|(__[^\n]+?__)|(\*[^\s*][^\n]*?\*)|\[([^\]]+)\]\(([^)\s]+)\)/;

const HEADING_STYLES: Record<number, string> = {
  1: 'text-base font-bold text-slate-900 mt-4 mb-2',
  2: 'text-base font-bold text-slate-800 mt-4 mb-2',
  3: 'text-sm font-bold text-slate-800 mt-3 mb-1.5',
  4: 'text-sm font-semibold text-slate-700 mt-3 mb-1',
  5: 'text-xs font-semibold text-slate-700 mt-2 mb-1',
  6: 'text-xs font-semibold text-slate-600 mt-2 mb-1'
};

/**
 * Parse inline Markdown into React nodes. A fresh RegExp is created per call so
 * the lazy `lastIndex` state is never shared across the recursive calls used to
 * format the inside of bold/italic/link spans.
 */
const parseInline = (text: string, keyPrefix: string): React.ReactNode[] => {
  const nodes: React.ReactNode[] = [];
  const re = new RegExp(INLINE_RE.source, 'g');
  let lastIndex = 0;
  let counter = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const key = `${keyPrefix}-${counter++}`;
    const [, code, boldStar, boldUnderscore, italic, linkText, linkHref] = match;

    if (code) {
      nodes.push(
        <code
          key={key}
          className="px-1 py-0.5 rounded bg-slate-200/70 font-mono text-[0.85em] text-slate-800"
        >
          {code.slice(1, -1)}
        </code>
      );
    } else if (boldStar || boldUnderscore) {
      const inner = (boldStar ?? boldUnderscore).slice(2, -2);
      nodes.push(
        <strong key={key} className="font-semibold text-slate-900">
          {parseInline(inner, key)}
        </strong>
      );
    } else if (italic) {
      nodes.push(
        <em key={key} className="italic">
          {parseInline(italic.slice(1, -1), key)}
        </em>
      );
    } else if (linkText !== undefined && linkHref !== undefined) {
      nodes.push(
        <a
          key={key}
          href={linkHref}
          target="_blank"
          rel="noopener noreferrer"
          className="text-violet-700 underline hover:text-violet-900"
        >
          {parseInline(linkText, key)}
        </a>
      );
    }
    lastIndex = re.lastIndex;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
};

const renderHeading = (level: number, content: string, key: string): React.ReactNode => {
  const className = HEADING_STYLES[level] ?? HEADING_STYLES[6];
  // Strip a trailing run of closing `#` (optional in ATX headings).
  const children = parseInline(content.replace(/\s+#+\s*$/, '').trim(), key);
  switch (level) {
    case 1:
      return <h1 key={key} className={className}>{children}</h1>;
    case 2:
      return <h2 key={key} className={className}>{children}</h2>;
    case 3:
      return <h3 key={key} className={className}>{children}</h3>;
    case 4:
      return <h4 key={key} className={className}>{children}</h4>;
    case 5:
      return <h5 key={key} className={className}>{children}</h5>;
    default:
      return <h6 key={key} className={className}>{children}</h6>;
  }
};

interface ListResult {
  node: React.ReactNode;
  nextIndex: number;
}

/**
 * Parse a list starting at `start`, consuming every item indented at
 * `baseIndent`. Deeper-indented items are folded into the preceding item as a
 * nested list, and blank lines between items are tolerated (loose lists).
 */
const parseList = (
  lines: string[],
  start: number,
  baseIndent: number,
  key: string
): ListResult => {
  const firstMatch = LIST_ITEM_RE.exec(lines[start]);
  const ordered = firstMatch ? /\d/.test(firstMatch[2]) : false;
  const items: React.ReactNode[] = [];
  let i = start;
  let itemKey = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      // Tolerate blank lines inside a list as long as it actually continues.
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') j++;
      const ahead = j < lines.length ? LIST_ITEM_RE.exec(lines[j]) : null;
      if (ahead && ahead[1].length >= baseIndent) {
        i = j;
        continue;
      }
      break;
    }

    const match = LIST_ITEM_RE.exec(line);
    if (!match) break;

    const indent = match[1].length;
    // Shallower item belongs to a parent list; deeper item without a sibling at
    // this level is handled by re-entering parseList from the caller.
    if (indent !== baseIndent) break;

    i++;
    const itemNodes: React.ReactNode[] = [
      <React.Fragment key="text">{parseInline(match[3], `${key}-${itemKey}`)}</React.Fragment>
    ];

    // Fold a deeper-indented block immediately after this item into a nested list.
    let j = i;
    while (j < lines.length && lines[j].trim() === '') j++;
    const nestedMatch = j < lines.length ? LIST_ITEM_RE.exec(lines[j]) : null;
    if (nestedMatch && nestedMatch[1].length > baseIndent) {
      const nested = parseList(lines, j, nestedMatch[1].length, `${key}-${itemKey}n`);
      itemNodes.push(<React.Fragment key="nested">{nested.node}</React.Fragment>);
      i = nested.nextIndex;
    }

    items.push(
      <li key={`${key}-${itemKey++}`} className="leading-relaxed">
        {itemNodes}
      </li>
    );
  }

  const className = ordered
    ? 'list-decimal pl-5 my-2 space-y-1 marker:text-slate-400'
    : 'list-disc pl-5 my-2 space-y-1 marker:text-slate-400';

  const node = ordered ? (
    <ol key={key} className={className}>{items}</ol>
  ) : (
    <ul key={key} className={className}>{items}</ul>
  );
  return { node, nextIndex: i };
};

const renderBlocks = (markdown: string): React.ReactNode[] => {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    if (HR_RE.test(line)) {
      blocks.push(<hr key={`b${key++}`} className="my-4 border-t border-slate-200" />);
      i++;
      continue;
    }

    const heading = HEADING_RE.exec(line.trim());
    if (heading) {
      blocks.push(renderHeading(heading[1].length, heading[2], `b${key++}`));
      i++;
      continue;
    }

    if (BLOCKQUOTE_RE.test(line)) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].trim() !== '' && BLOCKQUOTE_RE.test(lines[i])) {
        const m = BLOCKQUOTE_RE.exec(lines[i]);
        quote.push(m ? m[1] : '');
        i++;
      }
      blocks.push(
        <blockquote
          key={`b${key++}`}
          className="border-l-4 border-violet-200 pl-3 my-2 italic text-slate-600"
        >
          {parseInline(quote.join(' '), `b${key}`)}
        </blockquote>
      );
      continue;
    }

    if (LIST_ITEM_RE.test(line)) {
      const baseMatch = LIST_ITEM_RE.exec(line);
      const baseIndent = baseMatch ? baseMatch[1].length : 0;
      const { node, nextIndex } = parseList(lines, i, baseIndent, `b${key++}`);
      blocks.push(node);
      i = nextIndex;
      continue;
    }

    // Paragraph: gather consecutive plain lines until a blank line or a new block.
    const paragraph: string[] = [];
    while (i < lines.length) {
      const current = lines[i];
      if (
        current.trim() === '' ||
        HR_RE.test(current) ||
        HEADING_RE.test(current.trim()) ||
        BLOCKQUOTE_RE.test(current) ||
        LIST_ITEM_RE.test(current)
      ) {
        break;
      }
      paragraph.push(current.trim());
      i++;
    }
    blocks.push(
      <p key={`b${key++}`} className="my-2 leading-relaxed text-slate-700">
        {paragraph.map((text, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <br />}
            {parseInline(text, `b${key}-${idx}`)}
          </React.Fragment>
        ))}
      </p>
    );
  }

  return blocks;
};

const MarkdownContent: React.FC<MarkdownContentProps> = ({ content, className }) => {
  const blocks = React.useMemo(() => renderBlocks(content ?? ''), [content]);
  const wrapperClass = [
    'markdown-content',
    '[&>*:first-child]:mt-0',
    '[&>*:last-child]:mb-0',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div data-testid="markdown-content" className={wrapperClass}>
      {blocks}
    </div>
  );
};

export default MarkdownContent;
