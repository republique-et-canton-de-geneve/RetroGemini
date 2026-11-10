/**
 * The live "is typing" signal (`ParticipantActivity` in types.ts), read where it
 * crosses a trust and a version boundary: any team credential, an invitation-link
 * login included, can send one, and the server relays it to the whole room.
 *
 * The relay used to pass on whatever a client sent, and the participants panel
 * looked the value up as an object key: a peer sending '__proto__' made the label
 * an object, React threw, and every expanded panel of the room went blank (there
 * is no error boundary). The server relays only what this rule accepts, and the
 * browser reads what it receives through it too, because during a rolling update
 * a pod from before 43.0 still relays raw values. Plain JS because both sides use it.
 */

/**
 * A kind this release draws (writing a card, proposing an action) or `null` for
 * none. Compared, never looked up: no key of Object.prototype and no other value
 * passes. `__tests__/participantActivity.test.ts` fails when ParticipantActivity
 * names a kind this rule refuses.
 *
 * @param {unknown} value
 * @returns {'brainstorm' | 'proposal' | null}
 */
export const toParticipantActivity = (value) =>
  value === 'brainstorm' || value === 'proposal' ? value : null;
