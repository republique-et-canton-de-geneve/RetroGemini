import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import ts from 'typescript';
import { tokenContrast } from './helpers/tailwindTheme';

/**
 * The team-side Jira forms mark an invalid field, and say what is wrong with
 * it, in the rose of the console's Jira card (`components/admin/JiraSettingsCard.tsx`),
 * the look's danger hue: they drew it in red, so one product showed two hues
 * for one state (review of 45.3). Read with the TypeScript parser, every
 * string of each file: a class list built in a constant or a conditional is
 * read too. The fields are white, and so are the cards and the dialog their
 * messages are drawn on, where the two colours are measured.
 */

const ROOT = join(__dirname, '..');
const TEAM_FORMS = ['components/jira/JiraTeamSettings.tsx', 'components/jira/JiraTargetFields.tsx', 'components/jira/JiraParentField.tsx'];
const CONSOLE_CARD = 'components/admin/JiraSettingsCard.tsx';
const BATCH_DIALOG = 'components/jira/JiraBatchDialog.tsx';

const sourceOf = (file: string) =>
  ts.createSourceFile(file, readFileSync(join(ROOT, file), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

/** Every whitespace-separated token of every string a file writes. */
const tokensOf = (file: string): string[] => {
  const tokens: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) tokens.push(...node.text.split(/\s+/));
    if (ts.isTemplateExpression(node)) {
      tokens.push(...node.head.text.split(/\s+/), ...node.templateSpans.flatMap((span) => span.literal.text.split(/\s+/)));
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceOf(file));
  return tokens.filter(Boolean);
};

const RED = /(^|:)(?:text|bg|border|ring|outline|decoration|fill|stroke)-red-\d+/;
const invalidEdges = (file: string) => [...new Set(tokensOf(file).filter((token) => token.startsWith('aria-invalid:')))];

describe('an invalid field of the team-side Jira forms', () => {
  it.each(TEAM_FORMS)('is drawn in no red in %s', (file) => {
    expect(tokensOf(file).filter((token) => RED.test(token))).toEqual([]);
  });

  it.each(TEAM_FORMS)('takes the console card’s edge in %s', (file) => {
    expect(invalidEdges(CONSOLE_CARD)).toEqual(['aria-invalid:border-rose-600']);
    expect(invalidEdges(file)).toEqual(invalidEdges(CONSOLE_CARD));
  });

  // The batch dialog draws the target fields above its own line that says
  // what is wrong with the target they hold: in the same rose as theirs.
  it('is explained in the same rose under the batch dialog’s target fields', () => {
    const source = sourceOf(BATCH_DIALOG);
    const lines: string[] = [];
    const visit = (node: ts.Node) => {
      if (
        ts.isBinaryExpression(node)
        && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken
        && ts.isIdentifier(node.left)
        && node.left.text === 'targetError'
        && ts.isJsxElement(node.right)
      ) {
        const className = node.right.openingElement.attributes.properties.find(
          (attribute): attribute is ts.JsxAttribute => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === 'className',
        );
        lines.push(className?.initializer && ts.isStringLiteral(className.initializer) ? className.initializer.text : '');
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
    expect(lines).toHaveLength(1);
    expect(lines[0].split(/\s+/)).toContain('text-rose-700');
  });

  it('reads on white: its edge at 3:1, its message at 4.5:1', () => {
    expect(tokenContrast('rose-600', 'white')).toBeGreaterThanOrEqual(3);
    expect(tokenContrast('rose-700', 'white')).toBeGreaterThanOrEqual(4.5);
  });
});
