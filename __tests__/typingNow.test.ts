import { describe, expect, it } from 'vitest';
import type { ParticipantActivity } from '../types';
import { GUIDED_RETRO_PHASES, OPEN_BOARD_PHASE } from '../utils/openBoard';
import {
  activityOf,
  joinNames,
  splitTypingNames,
  TYPING_NAMES_SHOWN,
  typingKindForPhase,
  typingMembers,
} from '../utils/typingNow';

/**
 * Who the participants panel says is typing (utils/typingNow.ts): the line
 * above the list and the rows' cue read the same rule, so their counts cannot
 * disagree, and the signal is read as data, since other clients send it.
 */

// Keyed by the guided phases, so a new phase fails the type check until its
// expectation is written here.
const GUIDED_KIND: Record<(typeof GUIDED_RETRO_PHASES)[number], ParticipantActivity | null> = {
  ICEBREAKER: null,
  WELCOME: null,
  OPEN_ACTIONS: null,
  BRAINSTORM: 'brainstorm',
  GROUP: null,
  VOTE: null,
  DISCUSS: 'proposal',
  REVIEW: null,
  CLOSE: null,
};

describe('typingKindForPhase', () => {
  const table: Array<[string, string | undefined, ParticipantActivity | null]> = [
    ...GUIDED_RETRO_PHASES.map((phase): [string, string, ParticipantActivity | null] => [phase, phase, GUIDED_KIND[phase]]),
    [OPEN_BOARD_PHASE, OPEN_BOARD_PHASE, 'brainstorm'],
    ['SURVEY (a health check phase)', 'SURVEY', null],
    ['an empty phase', '', null],
    ['no phase', undefined, null],
  ];

  it.each(table)('reads %s', (_label, phase, kind) => {
    expect(typingKindForPhase(phase)).toBe(kind);
  });
});

describe('activityOf', () => {
  it('reads own entries only', () => {
    for (const id of ['constructor', 'toString', '__proto__']) {
      expect(activityOf({}, id)).toBeNull();
    }
  });

  it('reads an own __proto__ entry by its value', () => {
    // JSON.parse makes "__proto__" an own data property, which shadows the
    // accessor Object.prototype carries.
    const map = JSON.parse('{"__proto__":"brainstorm"}') as Record<string, unknown>;
    expect(activityOf(map, '__proto__')).toBe('brainstorm');
  });

  it('refuses an unknown kind', () => {
    expect(activityOf({ a: 'vote' }, 'a')).toBeNull();
    expect(activityOf({ a: {} }, 'a')).toBeNull();
  });

  it('reads nothing from no map', () => {
    expect(activityOf(undefined, 'a')).toBeNull();
  });
});

describe('typingMembers', () => {
  const member = (id: string) => ({ id, name: id.toUpperCase() });
  const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(member);

  it("keeps the list's order whatever order the signals came in", () => {
    const signals: Record<string, ParticipantActivity> = {};
    signals.c = 'brainstorm';
    signals.a = 'brainstorm';
    expect(Object.keys(signals)).toEqual(['c', 'a']);

    expect(typingMembers([a, b, c], signals, { kind: 'brainstorm', currentUserId: 'me' })).toEqual([a, c]);
  });

  it('never the reader, someone marked as having left, another kind, an unknown value or an id the list does not hold', () => {
    const reader = member('me');
    const signals: Record<string, unknown> = {
      me: 'brainstorm',
      a: 'brainstorm',
      b: 'proposal',
      c: '__proto__',
      d: 'brainstorm',
      ghost: 'brainstorm',
    };

    expect(
      typingMembers([reader, a, b, c, d], signals, { kind: 'brainstorm', currentUserId: 'me', leftUserIds: ['d'] }),
    ).toEqual([a]);
  });

  it('answers nobody where the phase types nothing', () => {
    expect(typingMembers([a, b], { a: 'brainstorm', b: 'proposal' }, { kind: null, currentUserId: 'me' })).toEqual([]);
  });
});

describe('splitTypingNames', () => {
  const names = (count: number) => Array.from({ length: count }, (_, index) => `P${index + 1}`);

  it('gives every name up to three', () => {
    expect(TYPING_NAMES_SHOWN).toBe(3);
    expect(splitTypingNames([])).toEqual({ shown: [], others: 0 });
    expect(splitTypingNames(names(2))).toEqual({ shown: ['P1', 'P2'], others: 0 });
    expect(splitTypingNames(names(3))).toEqual({ shown: ['P1', 'P2', 'P3'], others: 0 });
  });

  it('gives two names and how many others past three, never "1 other"', () => {
    expect(splitTypingNames(names(4))).toEqual({ shown: ['P1', 'P2'], others: 2 });
    expect(splitTypingNames(names(30))).toEqual({ shown: ['P1', 'P2'], others: 28 });
  });

  it('respects a custom number of names', () => {
    expect(splitTypingNames(names(5), 5)).toEqual({ shown: names(5), others: 0 });
    expect(splitTypingNames(names(6), 5)).toEqual({ shown: ['P1', 'P2', 'P3', 'P4'], others: 2 });
  });
});

describe('joinNames', () => {
  it("joins the reader's way", () => {
    expect(joinNames(['Alice', 'Bob', 'Carol'], 'en-US')).toBe('Alice, Bob, and Carol');
    expect(joinNames(['Alice', 'Bob', 'Carol'], 'en-GB')).toBe('Alice, Bob and Carol');
    expect(joinNames(['Alice', 'Bob', 'Carol'], 'fr-CH')).toBe('Alice, Bob et Carol');
    expect(joinNames(['Alice', 'Bob', '2 autres'], 'fr-CH')).toBe('Alice, Bob et 2 autres');
  });

  it('gives one name as it is, and nothing for nobody', () => {
    expect(joinNames(['Alice'], 'en-US')).toBe('Alice');
    expect(joinNames([], 'en-US')).toBe('');
  });

  it('falls back to commas on a locale Intl refuses, instead of throwing while rendering', () => {
    expect(() => new Intl.ListFormat('xx_YY')).toThrow(RangeError);
    expect(joinNames(['A', 'B'], 'xx_YY')).toBe('A, B');
  });
});
