import { describe, expect, it } from 'vitest';
import type { ParticipantActivity } from '../types';
import { toParticipantActivity } from '../utils/participantActivity.js';

/**
 * The live "is typing" signal crosses a trust boundary (any team credential,
 * an invitation-link login included, can send one) and a version boundary (a
 * pod from before 43.0 relays whatever a client sent). The relay and the
 * browser both read it through `toParticipantActivity`: a peer sending
 * '__proto__' used to make the participants panel's label an object, and React
 * blanked every expanded panel of the room.
 */

describe('toParticipantActivity', () => {
  it('accepts every kind the type names, and only those', () => {
    // A kind added to ParticipantActivity breaks this literal at compile time,
    // then the assertion below, until the rule accepts it too.
    const every: Record<ParticipantActivity, true> = { brainstorm: true, proposal: true };
    for (const kind of Object.keys(every)) {
      expect(toParticipantActivity(kind)).toBe(kind);
    }
  });

  it.each([
    ['"__proto__"', '__proto__'],
    ['"constructor"', 'constructor'],
    ['"toString"', 'toString'],
    ['"hasOwnProperty"', 'hasOwnProperty'],
    ['an unknown kind', 'vote'],
    ['an empty string', ''],
    ['a kind in another case', 'Brainstorm'],
    ['a kind with a leading space', ' brainstorm'],
    ['an object', {}],
    ['an array holding a kind', ['brainstorm']],
    ['a number', 1],
    ['a boolean', true],
    ['null', null],
    ['undefined', undefined],
    ['Object.prototype', Object.prototype],
    ['a 100 kB string', 'x'.repeat(100_000)],
  ])('reads %s as no signal', (_label, value) => {
    expect(toParticipantActivity(value)).toBeNull();
  });
});
