import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('feedback notification email template', () => {
  const source = readFileSync(
    join(__dirname, '..', 'server', 'routes', 'publicRoutes.js'),
    'utf8'
  );

  it('includes a Claude-ready prompt section in feedback notification emails', () => {
    expect(source).toContain('Claude prompt (copy/paste into Claude)');
    expect(source).toContain('buildClaudePromptFromFeedback');
  });

  it('includes a direct Claude link for quick opening', () => {
    expect(source).toContain('https://claude.ai/new');
  });
});
