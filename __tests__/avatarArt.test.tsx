import React from 'react';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import ts from 'typescript';
import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AvatarArt from '../components/common/avatars/AvatarArt';
import Avatar from '../components/common/Avatar';
import {
  AVATAR_ART,
  AVATAR_ART_IDS,
  AVATAR_FAMILIES,
  AVATAR_FAMILY_LABEL_KEYS,
  AVATAR_FAMILY_PITCH_KEYS,
  AVATAR_NAME_KEYS,
  type AvatarArtId,
  type AvatarShape,
} from '../components/common/avatars/avatarArt';
import { AVATAR_IDS, AVATAR_FAMILIES as SERVER_FAMILIES } from '../utils/avatars.js';
import { avatarColorClasses } from '../utils/participantColors';
import { en, fr } from '../i18n/messages';

// How many times each picture's shapes were read. AvatarArt reads
// AVATAR_ART[id] once each time it draws, so the count says how often a
// picture was built. The proxy only counts: every read answers as before.
const artReads = vi.hoisted(() => new Map<string, number>());
vi.mock('../components/common/avatars/avatarArt', async (importOriginal) => {
  const original = await importOriginal<typeof import('../components/common/avatars/avatarArt')>();
  return {
    ...original,
    AVATAR_ART: new Proxy(original.AVATAR_ART, {
      get(target, key, receiver) {
        if (typeof key === 'string') artReads.set(key, (artReads.get(key) ?? 0) + 1);
        return Reflect.get(target, key, receiver);
      },
    }),
  };
});

/**
 * The avatar pictures are data (components/common/avatars/avatarArt.ts): every
 * chosen id must draw, have a name in both languages and use nothing but the
 * closed vocabulary of shapes index.css knows how to colour. The picture is
 * drawn on everyone's screen from a value another client wrote, so it must
 * never carry anything a browser would run or fetch.
 */

const TAGS = new Set(['path', 'circle', 'ellipse', 'rect', 'line', 'polygon', 'polyline', 'g']);
const CLASSES = new Set(['bg', 'pop', 'light', 'ink', 'dot', 'shade', 'blush']);
const STRING_ATTRS = new Set(['d', 'points', 'transform']);
const NUMBER_ATTRS = new Set(['cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'width', 'height', 'x1', 'y1', 'x2', 'y2']);

const walk = (shapes: readonly AvatarShape[], visit: (shape: AvatarShape) => void) => {
  for (const shape of shapes) {
    visit(shape);
    if (shape.children) walk(shape.children, visit);
  }
};

describe('avatar art data', () => {
  it('holds 120 avatars in six families of twenty, each id once', () => {
    expect(AVATAR_ART_IDS).toHaveLength(120);
    expect(new Set(AVATAR_ART_IDS).size).toBe(120);
    expect(AVATAR_FAMILIES.map(f => f.id)).toEqual(['animals', 'monsters', 'objects', 'shapes', 'nature', 'games']);
    for (const family of AVATAR_FAMILIES) expect(family.avatars, family.id).toHaveLength(20);
  });

  // The families are the one list of ids: the id list and its type are read
  // from them. A second list written out beside them is a second source that
  // the next edit of a family has to repeat, and tsc then reports a missing
  // key far from the cause. Read with the TypeScript parser: every array
  // literal of the file made of ids only is a family's own list.
  it('writes the ids once, in their families', () => {
    const path = resolve(__dirname, '../components/common/avatars/avatarArt.ts');
    const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const known = new Set<string>(AVATAR_ART_IDS);
    const lists: string[][] = [];
    const visit = (node: ts.Node) => {
      if (ts.isArrayLiteralExpression(node) && node.elements.length > 0) {
        const ids = node.elements.filter(ts.isStringLiteral).map((element) => element.text);
        if (ids.length === node.elements.length && ids.every((id) => known.has(id))) lists.push(ids);
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    expect(lists).toEqual(AVATAR_FAMILIES.map((family) => [...family.avatars]));
  });

  it('draws every id, and no id it does not list', () => {
    expect(Object.keys(AVATAR_ART).sort()).toEqual([...AVATAR_ART_IDS].sort());
    for (const id of AVATAR_ART_IDS) expect(AVATAR_ART[id].length, id).toBeGreaterThan(0);
  });

  it('uses only the allowed tags, classes and attributes', () => {
    for (const id of AVATAR_ART_IDS) {
      walk(AVATAR_ART[id], shape => {
        expect(TAGS.has(shape.tag), `${id}: <${shape.tag}>`).toBe(true);
        if (shape.tag === 'g') {
          expect(shape.class, `${id}: a group carries no class`).toBeUndefined();
          expect(shape.children?.length, `${id}: an empty group`).toBeGreaterThan(0);
        } else {
          expect(CLASSES.has(shape.class ?? ''), `${id}: class ${shape.class}`).toBe(true);
          expect(shape.children, `${id}: children on <${shape.tag}>`).toBeUndefined();
        }
        for (const [key, value] of Object.entries(shape)) {
          if (key === 'tag' || key === 'class' || key === 'children') continue;
          if (NUMBER_ATTRS.has(key)) expect(Number.isFinite(value), `${id}: ${key}`).toBe(true);
          else expect(STRING_ATTRS.has(key) && typeof value === 'string', `${id}: attribute ${key}`).toBe(true);
        }
      });
    }
  });

  it('names every avatar and family in both languages, with literal keys of the namespace', () => {
    for (const id of AVATAR_ART_IDS) expect(AVATAR_NAME_KEYS[id]).toBe(`avatars.name.${id}`);
    for (const family of AVATAR_FAMILIES) {
      expect(AVATAR_FAMILY_LABEL_KEYS[family.id]).toBe(`avatars.family.${family.id}`);
      expect(AVATAR_FAMILY_PITCH_KEYS[family.id]).toBe(`avatars.familyPitch.${family.id}`);
    }
    const expected = [
      ...AVATAR_ART_IDS.map(id => `avatars.name.${id}`),
      ...AVATAR_FAMILIES.flatMap(f => [`avatars.family.${f.id}`, `avatars.familyPitch.${f.id}`]),
    ].sort();
    for (const messages of [en, fr]) {
      // The picker's own strings (avatars.picker.*) and the one-time hint's
      // (avatars.hint.*) live in the namespace too; every other key is a
      // picture's or a family's.
      expect(Object.keys(messages).filter(key => key.startsWith('avatars.') && !key.startsWith('avatars.picker.') && !key.startsWith('avatars.hint.')).sort()).toEqual(expected);
    }
  });

  it('gives each avatar a name unique within its language, at most 24 characters', () => {
    for (const messages of [en, fr]) {
      const names = AVATAR_ART_IDS.map(id => messages[AVATAR_NAME_KEYS[id]]);
      expect(new Set(names.map(name => name.toLocaleLowerCase())).size).toBe(names.length);
      for (const name of names) {
        expect([...name].length, name).toBeLessThanOrEqual(24);
        expect(name.trim(), 'no blank name').not.toBe('');
      }
    }
  });

  it('keeps the French accents of the names', () => {
    expect(fr['avatars.name.hedgehog']).toBe('Hérisson');
    expect(en['avatars.name.hedgehog']).toBe('Hedgehog');
    expect(fr['avatars.family.animals']).toBe('Bestiaire');
  });
});

describe('AvatarArt', () => {
  it('renders an svg of the 40 by 40 box, hidden from assistive technology', () => {
    const { container } = render(<AvatarArt id="fox" />);
    const svg = container.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.getAttribute('class')).toBe('avatar-art');
    expect(svg?.getAttribute('viewBox')).toBe('0 0 40 40');
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    expect(svg?.getAttribute('focusable')).toBe('false');
    expect(svg?.querySelectorAll('[class]').length).toBeGreaterThan(1);
  });

  it('draws groups with their children and keeps the numbers as written', () => {
    const withGroup = AVATAR_ART_IDS.find(id => AVATAR_ART[id].some(shape => shape.tag === 'g')) as AvatarArtId;
    expect(withGroup).toBeDefined();
    const { container } = render(<AvatarArt id={withGroup} />);
    const group = container.querySelector('svg > g');
    expect(group?.children.length).toBeGreaterThan(0);
    const firstCircle = AVATAR_ART.fox.find(shape => shape.tag === 'circle');
    const fox = render(<AvatarArt id="fox" />).container.querySelector('circle');
    expect(fox?.getAttribute('cx')).toBe(String(firstCircle?.cx));
  });

  it('carries nothing a browser would run, fetch or style inline, for any avatar', () => {
    for (const id of AVATAR_ART_IDS) {
      const { container, unmount } = render(<AvatarArt id={id} />);
      const svg = container.querySelector('svg') as SVGSVGElement;
      expect(svg.querySelector('script, foreignObject, use, image, a, style'), id).toBeNull();
      for (const element of [svg, ...svg.querySelectorAll('*')]) {
        expect(TAGS.has(element.tagName) || element === svg, `${id}: <${element.tagName}>`).toBe(true);
        for (const attribute of element.getAttributeNames()) {
          expect(attribute, id).not.toMatch(/^(on|href$|xlink:href$|style$)/i);
        }
      }
      unmount();
    }
  });

  it('renders nothing for an id it does not know, rather than throwing', () => {
    for (const unknown of ['nope', '__proto__', 'constructor', 'toString', '', 'Fox']) {
      const { container, unmount } = render(<AvatarArt id={unknown as AvatarArtId} />);
      expect(container.innerHTML, unknown).toBe('');
      unmount();
    }
  });

  // The board draws every card again on each change of the session, and each
  // card draws its author's avatar: rebuilt each time, the pictures of a
  // thousand cards cost about 20 ms more per redraw. A picture depends on its
  // id alone, so it is built once and kept while the id stays.
  it('is not built again when its parent draws again with the same id, and a new id draws at once', () => {
    const Card: React.FC<{ id: AvatarArtId; tick: number }> = ({ id, tick }) => (
      <div data-tick={tick}>
        <Avatar colorClasses={avatarColorClasses('bg-rose-500')} initials="RO" size={28} avatarId={id} />
      </div>
    );
    artReads.clear();
    const { container, rerender, unmount } = render(<Card id="owl" tick={0} />);
    const built = artReads.get('owl') ?? 0;
    expect(built, 'the first draw builds the picture').toBeGreaterThan(0);

    rerender(<Card id="owl" tick={1} />);
    rerender(<Card id="owl" tick={2} />);
    expect(container.querySelector('[data-tick="2"] [data-avatar-art="owl"] svg')).not.toBeNull();
    expect(artReads.get('owl'), 'redraws with the same id').toBe(built);

    rerender(<Card id="cat" tick={3} />);
    expect(container.querySelector('[data-avatar-art="cat"] svg circle, [data-avatar-art="cat"] svg path')).not.toBeNull();
    expect(container.querySelector('[data-avatar-art="owl"]')).toBeNull();
    unmount();
  });
});

describe('avatar art and the id list of utils/avatars.js', () => {
  // utils/avatars.js is the list the server validates against; the art must
  // draw exactly those ids, family by family.
  it('draws exactly the ids the server accepts, in the same families', () => {
    expect([...AVATAR_IDS]).toEqual([...AVATAR_ART_IDS]);
    expect(SERVER_FAMILIES.map(f => ({ id: f.id, avatars: [...f.avatars] }))).toEqual(
      AVATAR_FAMILIES.map(f => ({ id: f.id, avatars: [...f.avatars] })),
    );
  });
});
