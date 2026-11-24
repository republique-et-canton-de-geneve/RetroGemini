# Moving cards on the board — two phases, two meanings

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


Brainstorm and Group both let a card be dragged, and they mean **different
things**. Keeping them apart is the whole design, so the code keeps them apart
too: `utils/retroGrouping.ts` + `components/session/groupingKeyboard.ts` for
grouping, `utils/brainstormColumnMove.ts` + `components/session/brainstormMove.ts`
for the move, and a separate hold in `Session.tsx` (`movingItem`, never
`draggedTicket`) so a future change cannot make one phase's rule leak into the
other.

| | Brainstorm | Group |
|---|---|---|
| Drop target | a **column**, only | another card, a group, or a column |
| Result | the card changes column and stays itself | a group is created, joined or left |
| Grouped card | travels with its group, never alone | freely regrouped |

The open board (see *The open board* below) carries both on one screen without
mixing them: a **card** is held the Group phase's way (`draggedTicket`), a
**group** the Brainstorm way (`movingItem`), never both at once, and a held
group is received by a column only.

Four rules:

- **A card is only movable by someone who can read it.** With "Reveal cards"
  off, every other author's card is blurred, so only your own move; revealing
  opens them to everyone. Nothing here is enforced server-side — like ticket
  editing and deletion, it is a UI rule over a shared board (`sessionGuard.js`
  still refuses the facilitator-only fields, and `colId` is not one of them).
- **A group moves whole, or not at all.** Coming back to Brainstorm after
  grouping must not become a second way to edit a group's composition, so a
  grouped card exposes no control of its own and the container carries every
  member. A card open for editing suspends the drag — a `draggable` ancestor
  competes with its own textarea — and words dragged out of a field (the
  editor, a group's title) hold no card and no group (`dragsFieldText`): the
  board leaves their drop to the browser, which moves them within the field or
  into another field that takes them, and refuses them elsewhere. Taken as a
  drag of the card, they grouped the card being edited with the card they were
  dropped on, and the board cancelled their drop in the field itself, so they
  moved nowhere. **No title takes them** — a group's, or a column's in Edit
  Layout, their own words included (`refusesFieldText`): a title writes on
  every keystroke, and the browser drops words as two edits, their deletion
  where they were, then their insertion, from one revision; the server kept the
  deletion alone, and the words were gone for everyone. Their drag's end puts
  down nothing the keyboard or a tap holds (the card's and the group's
  `onDragEnd` skip a field's), and a field that left the page drags nothing:
  Firefox sends it no dragend, and every later drag read as its words.
  **Only a drag the board started drops what it carries** (`boardDrags`: a
  card's or a group's, from `handleDragStart` or `handleBrainstormDragStart`,
  over once another gesture begins — a press, another drag, a hold of the
  keyboard or a tap, its own drop). Any other drag — words from a field, the
  page's own text, a file or text from another window — is refused by a
  column, a card or a group (`refusesForeignDrag`), but for words a field takes,
  and no field takes a file. Taken for a drop, such a drag performed what the
  keyboard or a tap held — the held card grouped with the card under the
  pointer, the held group moved — and so did words whose field a teammate's
  write drew again during their drag; and Firefox sends no dragend to a field
  React only moved during the drag of its words, so a drag from outside the
  page was let through to the browser until the next press. **Words selected
  in a card are no drag of that card, nor of its group** (`dragsOwnElement`:
  a card's or a group's own drag starts at that element, while it can be
  dragged; a card in a group is a drag of its own, whose start stops at the
  card): their drag starts at the words — or, pressed on its padding inside
  the selection, at the card itself, or at a group that cannot be moved, in
  both browsers — and went up to the card's handler, or its group's, which
  took it for theirs, so the board performed what the keyboard held and the
  end of their drag put the hold down. **Only the end of a drag whose start the
  board took puts what it held down** (`boardDrag`, heard at its source in
  `dragStarts`): read from what the element was at the end, the end of their
  drag put the keyboard's hold down once a teammate's write made the element
  draggable during it; and a drag whose card or group a teammate's write drew
  again elsewhere ended where React heard nothing, so its hold stayed — the
  "Selected" banner and every target, the board's groups no longer
  draggable, the next keyboard activation dropping it for everyone. A card's
  words can be selected where nothing around them can be dragged: on a board
  while a group is held, and in Brainstorm on a grouped card whose group
  cannot be moved (a card in it hidden from its reader). A group that can be
  moved drags itself from its cards' words; under a selection made some other
  way first (Select All), both browsers start a drag of the selection at the
  words instead, which the board refuses.
- **The "from ..." chip follows who moved the card.** A card moved by hand is
  re-homed and loses the chip (same rule as dropping one on a column in the
  Group phase); a card displaced *by its group* keeps naming the column it was
  written in. The stamping lives in one place, `stampOriginColumn`, so the two
  paths cannot disagree.
- **`colId` is shared content, not own data.** It is deliberately **not** in the
  own-change ledger: two people moving the same card is a real conflict where
  the server's state must win, exactly as it does for a card's text. A move that
  loses the optimistic-concurrency race is healed away and redone by hand —
  adding a ledger slice for it would make two clients fight over a card's
  position, which is the failure the ledger exists to prevent.

**A board wider than the screen names its hidden columns** (37.0). A Starfish
retro on a 1920px screen used to show four of its five columns and a scrollbar
at the bottom of the board; nobody saw the fifth. Two layers, in this order:

- **Fit first, and fill.** From `md` up the columns share the board's whole
  width (`md:grow md:basis-0`, at least 16rem each, no upper bound), so five
  fit beside the participants panel on a wide screen and three or two leave no
  empty band on the right (39.0: a 24rem cap left a third of a 1920px screen
  empty with three columns). Inside a column the cards are a grid of as many
  18rem-or-wider cards per row as fit (`repeat(auto-fill, minmax(min(100%,
  18rem), 1fr))`): one per row in a narrow column, side by side in a wide one,
  always in reading order, which is also the DOM and tab order. Rows leave no
  hole: the cards of a row stretch to its height, and a group — which grows
  with every card put in it — spans the whole row (`col-span-full`) and lays
  its own cards out on the same grid. The add-idea field and the move buttons
  span the row too. The column's grid gap spaces its cards and groups and a
  group's own grid gap spaces the cards inside it, so neither a card nor a
  group carries a margin of its own. Never use `grid-auto-flow: dense` to fill
  holes: it places cards out of DOM order, which breaks reading and focus order
  (WCAG 1.3.2, 2.4.3). Phones keep one 20rem column at a time, swiped.
- **Then say what does not fit.** When the board still overflows,
  `components/session/BoardColumnNavigator.tsx` sits under the phase bar — which
  never scrolls away — and names every column, marks the off-screen ones with an
  icon and words (never colour alone), and brings each into view on a click.
  The geometry is pure (`components/session/boardColumns.ts`: a column counts as
  in view once 60% of it shows, "next" goes to the first column past the edge,
  never a fixed distance) and `useBoardColumnsInView.ts` measures the DOM.

jsdom measures every element at zero, so the layout itself is guarded by
`e2e/retro-wide-board.spec.ts` (five columns fit at 1920px; at 1280px the
navigator appears and reveals the fifth; three columns reach the board's edge
at 1920px; at 2560px a column shows two cards side by side, a short and a long
card in one row end together, and a group spans its column) — a unit test
cannot hold it.

**Columns are reordered with buttons, in three places, by one rule** (38.0).
The two template editors on the Dashboard (*Create Custom Template* in the new
retro dialog, *Create Retro Template* in Settings) and the facilitator's *Edit
Layout* in Brainstorm all render `components/common/ColumnMoveButtons.tsx` and
move through `utils/columnOrder.ts` → `moveColumn`. Buttons rather than a drag:
the pointer and the keyboard use the same control, and a column drag inside
Brainstorm would compete with the card move, whose drop target is the column.
Three rules:

- **Only the array order moves.** Cards and groups point at a column by
  `colId`, so nothing else is rewritten, and a client from an older release
  renders the new order as it is. `columns` stays facilitator-only in
  `sessionGuard.js`.
- **A click with nothing to do sends nothing.** `moveColumn` returns the very
  array it was given at an edge, and the session checks that before calling
  `updateSession`.
- **The keyboard stays on the column just moved, and the move is announced.**
  React DOM keeps focus through a keyed move (it records the focused element
  before a commit, ignores its own handlers while the nodes move, and gives
  focus and the caret back afterwards). At an edge it cannot, because the
  pressed arrow turns disabled in that commit, so the buttons hand focus to the
  other arrow; a polite status says "Position 2 of 3" and empties itself a
  moment later (so the same position is announced again, and no stale one
  stays behind), since the button's name does not change. The same React behaviour is what keeps a participant typing
  a card in a column the facilitator moves: **keep the board keyed by
  `col.id`** — keyed by position, or remounted, it would lose the field. Both
  are pinned in Chromium by `e2e/retro-column-order.spec.ts` (jsdom keeps focus
  either way and cannot see it).
- **A reorder is claimed in the own-change ledger** (`columnOrder`). Two quick
  presses are two writes stamped with the same revision; the server keeps the
  first and heals the second away, and `columns` is facilitator-only content
  where incoming wins, so the board jumped back one place a round-trip later.
  The slice claims and re-asserts only the *relative order of the columns both
  sides have* — never a title, an addition or a removal, which stay the
  server's. The e2e forces that race (two presses with no acknowledgement in
  between) and fails without the claim.
- **The arrows are off while the session reconnects**, like the other inputs:
  `updateSession` drops edits offline, and a click that does nothing silently
  is worse than a disabled control.
