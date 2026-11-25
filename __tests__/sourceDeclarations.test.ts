import { describe, expect, it } from 'vitest';
import { join } from 'path';
import { declarationOf, sourceOf } from './helpers/sourceDeclarations';

/**
 * The guards that read class lists through constants look the same names up
 * again and again: the field-edge guard resolves the recipes for every field
 * of every screen, and it walked the file's whole tree on each lookup (its
 * slowest case took 3.9 s of its 5 s in CI's coverage run). A name is looked
 * up once per file: every later lookup answers the declaration found then.
 */

const ROOT = join(__dirname, '..');
const RECIPES = join(ROOT, 'components/dashboard/dashboardLook.ts');
const ACTIONS_TAB = join(ROOT, 'components/dashboard/DashboardActionsTab.tsx');

describe('the declaration a guard follows a class list through', () => {
  it('is the initializer of the const of that name', () => {
    expect(declarationOf('FIELD_BOX', RECIPES)?.expression.getText(sourceOf(RECIPES))).toContain('border-slate-400');
  });

  it('is found once per file and name: a second lookup answers the first one', () => {
    const first = declarationOf('FIELD_BOX', RECIPES);
    expect(first).not.toBeNull();
    expect(declarationOf('FIELD_BOX', RECIPES)).toBe(first);
  });

  it('follows a relative import to the file that declares it, once too', () => {
    const imported = declarationOf('FIELD_BOX', ACTIONS_TAB);
    expect(imported?.file).toBe(RECIPES);
    expect(declarationOf('FIELD_BOX', ACTIONS_TAB)).toBe(imported);
    expect(imported).toBe(declarationOf('FIELD_BOX', RECIPES));
  });

  it('is nothing for a name no const of the file or of its relative imports carries', () => {
    expect(declarationOf('NO_SUCH_RECIPE', ACTIONS_TAB)).toBeNull();
    expect(declarationOf('NO_SUCH_RECIPE', ACTIONS_TAB)).toBeNull();
  });
});
