# Motion

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


A guest who arrives, a card that lands, a vote that is cast, hidden cards that
are shown, a dialog that opens: each has a short animation. All of it is
**decoration**. The state an effect accompanies is already on screen in words
or in a count, and a reader who asked for less motion gets none of it. Nine
rules:

- **The effects are classes of `index.css`, all under
  `@media (prefers-reduced-motion: no-preference)`** (`fx-card-in`, `fx-ring`,
  `fx-pop`, `fx-bump`, `fx-press`, `fx-nope`, `fx-title-in`, `fx-person-in`,
  `fx-halo`, `fx-write`, `fx-reveal`, `fx-dialog-in`, `fx-veil-in`, `fx-swap`).
  Reduced motion is therefore "no animation" by construction, with no leftover
  delay. A transform's fill mode is `backwards`, never `forwards` or `both`: a
  transform that stays makes its element the containing block of every
  `position: fixed` descendant (`__tests__/lookTokens.test.ts` refuses it).
  Two eases, each with a job: `--ease-settle` for what comes to rest in its
  place (a card, a row, a dialog, a title), and `--ease-spring`, which
  overshoots on purpose, only for something small that is not aimed at (a dot,
  a count, a chosen avatar). The overshoot is the look's one flourish; it
  never goes on a box people click. A reaction chip is such a box: a new
  reaction, and one that gained a person, ring the chip in its card's colour
  (`fx-ring`, on the chip's pseudo-element, which is why the chip is
  `relative`), where until 45.3 the first popped in and the second bumped,
  both on the spring and both scaling the box the pointer aims at
  (`useSessionMotion.test.tsx` → *rings a new reaction and one that gained a
  person, and springs neither*; `reactionChipState.test.tsx` → *are
  positioned*).
- **An effect follows something that happened, never an element being drawn.**
  A phase change remounts the whole board and a card remounts when it changes
  group or column, so an animation tied to a mount would replay each time.
  `utils/sessionMotion.ts` → `diffSessionMotion` (pure) turns two states of a
  session into events, and `components/session/useSessionMotion.ts` plays them
  in a layout effect on the elements concerned, found by the data attributes of
  its `MOTION_HOOKS` table (`data-ticket-id`, `data-group-id`,
  `data-column-count`, `data-reaction`, `data-vote-count`, and the card text's
  `.whitespace-pre-wrap`). The participants panel does the same for people
  (`components/session/usePanelMotion.ts`, with `arrivedPeople`).
- **A class is put on for one animation and taken off**
  (`components/common/motion/effects.ts` → `playEffect`: at the element's own
  `animationend`, with a timeout as a net; the lengths the net waits for,
  `EFFECT_LENGTH_MS`, are a copy of the stylesheet's, and
  `__tests__/motionEffects.test.ts` reads `index.css` and requires them
  equal, so an animation lengthened in one place is not cut off by the other).
  Every other clock that takes an effect class off reads that table too, plus
  a margin: the participants panel's (`ARRIVAL_MS`, `POP_MS` in
  `usePanelMotion.ts`, which listens for no `animationend` at all), the avatar
  picker's swap net (`SWAP_FALLBACK_MS`) and a dialog's entrance net
  (`ENTRANCE_NET_MS`, a second at least); `__tests__/motionNets.test.tsx`
  holds each one past its animation, at today's 2200, 500, 700 and 1000 ms.
  Where React state puts the class on instead (a dialog's entrance, the avatar
  picker's swap), its end is listened for in a **layout** effect, in the commit
  that puts the class on: a passive effect runs after that commit, later still
  when React's scheduler yields, and an end sent in between was lost, leaving
  the class on until its net (`modalDialogEntrance.test.tsx` and
  `avatarPicker.test.tsx` → *in the commit that puts its class on*; a loaded
  CI runner failed the picker's test so). On the board it is put on
  imperatively: it costs no render of a component of nearly 5,000 lines, a
  remounted element simply has no class, and the unit tests of the screens
  keep seeing the class strings React wrote. `motionAllowed()` reads the
  reader's setting live, and **every effect asks it first**: the board's, the
  vote's flight, a dialog's entrance, an arriving row, the writing pencil, the
  avatar picker's swap. So does every smooth scroll, written `behavior:
  motionAllowed() ? 'smooth' : 'auto'`: the Discuss focus of both session
  types, the release analysis' result, the board's column navigator. A smooth
  scroll has no media query of its own, and the Discuss focus and the release
  analysis' result glided for every reader until 45.3.
  `__tests__/reducedMotionGate.test.ts` reads the code of `components/`,
  `App.tsx`, `index.tsx`, `utils/` (its `.js` rules included) and
  `services/`, and refuses there any `'smooth'` that is not that question's
  first branch and any class that sets `scroll-behavior: smooth`
  (`scroll-smooth`, or `[scroll-behavior:smooth]`) without `motion-safe:`; in
  `index.css` it refuses a `scroll-behavior: smooth` outside `no-preference`.
  A reader who asked for less motion, or a browser that cannot tell (jsdom
  has no `matchMedia`), is given no `fx-*` class at all and no glide;
  the CSS gate above remains the guarantee. Tests state the preference with
  `__tests__/helpers/motionPreference.ts`, whose queries match exactly (a stub
  that matched "reduce" inside "reduced-motion" tested nothing).
- **Quiet by default.** Nothing plays on first paint, on a phase change or a
  change of session, while the connection is down, in the three seconds after
  the state it brings back lands (a rolling update reconnects everybody, and a
  pod that starts cold answers the re-join late), or for a burst: more
  than six cards or more than two people at once is a healed state or a
  restore, not people working. The card burst is one rule, decided in
  `diffSessionMotion`: more than six new cards in one write
  (`MAX_CARD_BURST`), one's own included, is no motion at all — no card
  arrives, one's own included, and nothing that came with them moves. More
  than two people at once (`MAX_PEOPLE_BURST`, `arrivedPeople`) is the
  participants panel's rule. The reveal is the one effect that grows with
  the board (a blur and a fade on every hidden card), so it plays on the cards
  in the window only, sixty at most (`MAX_REVEALED_AT_ONCE`); the others are
  simply shown. Who finished is the participants panel's to show: it is not an
  event of the board, which a state that only says "someone is done" does not
  wake. **The first paint is a seed, never a "before", and so is the state
  from before an outage.** A session screen is drawn first from the cached
  team record, which lags the session row, and after a reconnection from the
  state it showed before the drop; the server's state or roster can land
  seconds later. So nothing is compared until the server's first state since
  the session was last live has been applied: `useSessionMotion`'s `ready`,
  which is `serverStateApplied` in `Session.tsx`, put down by its `setIsLive`
  whenever the session stops being live and put up again in the same batch as
  the next state (the phase title's slide waits for it too); for the panel,
  its first roster since then (`usePanelMotion`'s `ready`, the panel's
  `rosterReceived`, put down the same way by both session screens). The three
  quiet seconds (`QUIET_AFTER_LIVE_MS` in `utils/sessionMotion.ts`, one value
  for the board, the phase title, the vote controls and the panel) open at
  that moment, not at the mount; the board's hook also opens them when the
  socket comes back, but the window the state opens always comes later and
  supersedes it. Counted from the mount, a join snapshot four seconds late
  played every card and every person it brought; counted from the
  reconnection, so did a re-join that a cold pod answered four seconds late.
- **An effect never changes a box that a test measures or a click aims at.**
  Rings and washes are drawn on pseudo-elements; a participant's row may
  animate only opacity, a pseudo-element and `translateX`, never its height or
  `y`; a card's hover is a deeper shadow, never a lift. One exception, on
  purpose: **a card that arrives rises into its own place** (`fx-card-in`: 14px
  and three percent of scale, for half a second). Its place in the layout is
  taken at once, nothing around it moves, and only that card's own controls are
  a few pixels off until it settles: the arrival is what the owner asked to
  see. Nothing animates on the
  way out: a deleted card's place is taken at once, and a dialog gives focus
  back at once.
- **A press answers with a colour, never with its box.** A control that
  shrinks or shifts while it is pressed moves its own edge from under the
  pointer: pressed on its outer pixel, the release lands beside it, the
  browser sends the click to the ancestor both events share, and the control
  does nothing. 45.0 was first written with `active:scale-[0.97]` on every
  primary button, and a press held on the outer pixel of "New Team" clicked
  the page behind it (measured in a browser, with motion on). A primary
  button darkens instead (`enabled:active:bg-indigo-800`, rose-900 for a
  destructive one; `enabled:` because a disabled button matches `:active`
  too). `__tests__/lookTokens.test.ts` → *a press never moves the control
  pressed* refuses an `active:` class that transforms, sizes or spaces an
  element, in every component and recipe, and a `:active` rule of
  `index.css` that does. `fx-press`, the answer a vote button gives, is not
  a press state: it plays after the click it answers, once its write is
  drawn.
- **A vote's flight follows the write, it never decides it.** In the guided
  Vote phase, while the budget draws its tokens (ten votes or fewer, not
  unlimited), a vote that landed sends a token from the budget to the card's
  dots (`components/common/motion/flight.ts` → `fly`, the Web Animations API),
  the dot pops where it lands and a ring closes on the card; past three dots
  the token lands on the count, which bumps there once, with the ring (the
  pop or the bump the control gives in the vote's own commit waits for the
  token, `flyVote`). A vote taken back flies home, and one taken back before
  its token lands takes back the vote that token carries, the last one still
  on its way to that card or group, whose dot it removes: that token lands on
  nothing and plays no mark, and the item stays held until both tokens are in
  (`carryVote`, `takeBackCarriedVote`, `landCarriedVote`). A click refused for
  lack of votes shakes the budget (`shakeVoteBudget`). The session holds the
  vote's marks until the token lands
  (`heldVotes`, `playLandedVote`; the hold is counted, so two quick votes on
  one card each keep it held until their own token lands; and a token arrives
  once, even when its animation ends after the net's timer took it, as in a
  tab shown again: `motionFlight.test.ts` → *removes the token at the timeout
  when the animation never finishes*), and a button
  answers its press once the vote
  is drawn: played during the click, the class was wiped by the one React
  wrote in the same commit. A write that wrote nothing is followed by nothing
  (`castVote` stops on it): while the session reconnects an edit is dropped,
  and a vote "taken back" then, read as gone, queued its token's flight home
  for the next state. A token that cannot fly (an end outside the window, a
  browser that cannot animate) arrives at once, so the marks play where they
  stand and nothing stays held. Past ten votes, with unlimited votes and on the
  open board, no token flies and nothing is held: the dot pops in place, or,
  past three dots, the number bumps in place, in the guided pill and on the
  board's control alike. Every mark a vote control plays on its own keeps the
  board's quiet (*Quiet by default*), and so does the budget's refilled token:
  `GuidedVoteControl` and `BoardVoteControl` take `Session.tsx`'s
  `motionQuiet`, which the phase title reads too, and `VoteBudget` takes
  `budgetMotionQuiet` under the same prop name, quiet with the board unless the
  change it draws is a vote of the viewer's own (`castVote` says so for the
  commit that draws it). Each is a required prop, read when the count
  changes, never while drawing. So a dot, a number or a token that the
  server's first state, or a reconnection's snapshot, brings back is drawn
  without its spring, while a press of the control's own button in those
  seconds is still answered (`PRESS_ANSWER_MS`). The budget (`VoteBudget`)
  draws one filled
  token per vote left and one outline per vote the viewer really cast: a vote
  one vote per item leaves no item to place on (five votes, three items) is
  neither, and is not drawn, so the tokens never show a vote as cast that was
  not. **In the guided Vote phase, and on a board
  whose counts are hidden, only the viewer's own votes are marked**: a ring
  must never tell where a teammate's vote went. And **a vote total moves only
  where the screen draws a vote** (`visibleVoteChanges` in
  `useSessionMotion.ts`): in the guided Vote phase and on the open board. The
  Group phase draws none, and neither does a board whose voting is off and
  whose counts are hidden, the viewer's own included (its bar says "Voting is
  off"; `showsBoardVotes`, `showsGroupVotes`), so a regrouping that carries a
  card's votes into its group (`combineVotes`) or a lowered number
  (`capVotes`) rings and bumps nothing there; with voting off and the counts
  shown, every total is still drawn and still moves. Neither screen draws a
  vote on a card inside a group (every vote control of the card is drawn only
  when it is not grouped): a card that joins a group hands its votes over, and
  only the group it joins rings and bumps, where its total is drawn. A group
  made in that same write is not compared, so nothing rings for it (quiet by
  default).
- **A new effect is a class in `index.css` with its numbers, a trigger read
  from two states, and a test.** `__tests__/sessionMotion.test.ts`,
  `motionEffects.test.ts`, `motionFlight.test.ts`, `useSessionMotion.test.tsx`,
  `sessionVoteMotion.test.tsx`, `panelMotion.test.tsx`,
  `modalDialogEntrance.test.tsx` and `motionNets.test.tsx` (the clocks of the
  classes React puts on) hold the rules in jsdom. jsdom has neither
  `matchMedia` nor `Element.animate`: each suite stubs what it needs, and all
  but `motionNets.test.tsx` also run bare. `e2e/session-motion.spec.ts`, in the
  `motion` project, proves in a browser that each effect plays once, leaves no
  class and no layer behind, moves no box, and that reduced motion plays
  nothing.
- **A spinner, a pulse and a transition that moves a box are gated like the
  effects.** Tailwind's `animate-*` utilities carry no media query, so each is
  written behind `motion-safe:` (`motion-safe:animate-spin`). So is a
  transition that moves or resizes a box, or draws a line that moves: the
  participants panel's width, a bar's height or width, a switch's knob
  (`SWITCH_KNOB`, `adminSwitchKnob`), the timer's ring and the reaction
  picker's grow on hover (which, for a reader who asked for less motion,
  snaps to its size). `.bar-anim` in `index.css` is gated too, under
  `no-preference` in a block after the effects block (`lookTokens.test.ts`
  reads everything before that block's start). The duration goes behind the
  gate with its transition:
  `transition-property` starts as `all`, so a `duration-*` left alone
  animates every change of the box. A mixed transition is gated whole; a
  transition of colours, a shadow or an opacity stays for everyone. One
  animation of `index.css` is declared for every reader and stopped under
  `prefers-reduced-motion: reduce` instead, the typing cue's dots
  (`.typing-dot`). Nothing pulses at rest: the console's Live dot is still,
  as the session's Live chip is. A smooth scroll asks the reader too
  (`behavior: motionAllowed() ? 'smooth' : 'auto'`; see the rule on
  `motionAllowed()` above). `__tests__/reducedMotionGate.test.ts` reads every
  class list of `components/` and `App.tsx` through the TypeScript parser (a
  template whole, with its branches and the capitalised recipes it names) and
  every rule of `index.css`, and refuses an ungated animation, a moving
  transition outside the gate, a lone duration, an animation of `index.css`
  declared outside `no-preference` and not stopped under `reduce`, and a
  smooth scroll that does not ask.
