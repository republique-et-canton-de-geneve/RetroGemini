# Accessibility (audit H42)

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


WCAG 2.1 AA is a conformance obligation for a Geneva public-sector deployment
(eCH-0059), not a polish item. Two rules bind every UI change:

**Every overlay goes through `components/common/ModalDialog.tsx`.** It owns the
`role="dialog"`, `aria-modal`, the accessible name, Escape (topmost dialog only,
via a small stack), a focus trap, and returning focus to whatever opened it.
Call sites pass their own `overlayClassName`/`panelClassName`, so adopting it
changes behaviour without moving a pixel. Hand-rolling `fixed inset-0` again is
exactly how the product reached **thirteen** overlays with **one**
`role="dialog"` between them. A dialog holding unsaved text may pass
`closeOnBackdropClick={false}` — never remove Escape. It also gives every
dialog its **entrance** (45.0): the veil fades in and the panel rises a few
pixels, once, when the dialog mounts, and nothing plays on the way out (an exit
would delay the return of focus and keep the focus trap alive). The effect
classes come off at their own `animationend`, or after a second when none
comes (`ENTRANCE_NET_MS`: a second, or the longest entrance in
`EFFECT_LENGTH_MS` plus a margin should one ever last longer; an animation
that is interrupted never ends), and their fill mode is
`backwards`, so no transform remains: a transformed panel is the containing
block of its `position: fixed` descendants. A dialog whose panel holds a fixed
child while it opens passes `entrance="fade"` (opacity only), as the image
gallery does for its close button. `DIALOG_OVERLAY_CLASS` and
`DIALOG_PANEL_CLASS` are the frame of the look, for a call site with no reason
to differ; `__tests__/dialogFrameConsistency.test.ts` reads every call site and
requires that veil and that panel (the image gallery is the stated exception).
A call site writes its classes out or names a recipe (`DIALOG_OVERLAY` and
`DIALOG_PANEL` of `dashboardLook.ts`, as the Dashboard and the console do): the
suite follows the name through the file's own import to its value, and
**fails on classes it cannot read** (a local variable, a conditional) rather
than pass them unread, which is how nine dialogs went unchecked while it read
string literals only.

> Its focusable-element check walks ancestors instead of reading `offsetParent`
> or `getClientRects()`. Those need a layout engine, so under jsdom they report
> every control as hidden and the trap silently does nothing — which is how a
> focus trap ships broken with a green test suite. The walk and its selector
> live in `components/common/focusable.ts` (`isVisible`, `FOCUSABLE_SELECTOR`),
> shared by `ModalDialog.tsx` and `components/common/seenOnce.ts`, whose
> one-time notes hand the keyboard only to a control that is drawn: no
> `hidden` attribute, `display: none` or `visibility: hidden` on it or above
> it.

**Anything a pointer can do, the keyboard must be able to do.** The Group phase
was pointer-only for the life of the product and **no automated tool in this
repository could report it**: the markup was well-formed, there was simply no
control. `components/session/groupingKeyboard.ts` holds the rules and
`Session.tsx` performs them; it reuses the *touch* flow's state machine
(`draggedTicket` + `isSelectThenDrop`) rather than adding a second interaction
model. When you add a drag, add the pointerless path in the same change.

**A pointer gesture is start, move and end — never just the end.**
`components/session/groupingTouch.ts` holds the tap rule of both board phases
in one sentence: *one gesture drops the held card at most once, and only if the
finger stayed put.* It exists because the group container had only an
`onTouchEnd`, and touch events **bubble**: that did not merely leave the
container unguarded, it overrode the ticket card's own 8px threshold, so a swipe
the card had correctly ignored was acted on by its parent. When you add a touch
target inside another one, give it the whole gesture and let exactly one handler
claim it. **A tap a handler claims sends no emulated click**: the handler calls
`preventDefault` on its `touchend`. Acting on the tap lays the board out again
under the finger, and the mousedown and click a browser emulates for a tap then
went to whatever control came there — on the open board a grouping tap deleted
a card with no confirmation, added a vote or opened an editor, and took the
focus off the new group's title. A scroll, or a tap on a control, keeps them.
**What the cancelled mousedown did besides is done by hand** (`actOnClaimedTap`
in `Session.tsx`, the one path every claimed tap takes): before acting, the tap
takes the focus out of the field being typed and closes the reaction picker.
Without it an open card editor stayed open through the taps and lost what was
typed when one broke up its card's group, a group title stayed "being typed"
and a teammate's rename was sent back, the phone's keyboard stayed over the
board, and the picker stayed open over the next card to tap. What the field
writes as it is left rides the tap's own write (`updateSession` folds it in, as
it folds the votes number), or goes alone, at once, when the tap writes nothing
(a hold): two writes from one revision, and the server refused the second.
**A press of the mouse ends with its release, or its drag's end** (`pressRef`
in `Session.tsx`): a card's editor whose focus the press's own mousedown takes
— of the mouse, or of the mouse a browser emulates for a tap on a control —
stays drawn until the press ends: once the task of its release is over (its
click, and the click a label then gives its box, come first), or at its
drag's end. Closed at the press, it grew the card back by the rows it hides
while edited and pushed everything under it down, so the release and the
click landed beside the control pressed (its own vote, the next card's, "Move
selected card here"). A drag's end is sent to the element dragged, so it is
heard there: a drop that moved its card removed that element, nothing on the
window heard it end, and for 10 s the editor stayed drawn and every blur was
read as a press. Drawn on, the editor is no longer typed in: the press can
drag its card, or its group (still "being edited", they were not draggable,
and the drag selected text across the board) — draggable from the press's
mousedown, since Firefox chooses between a drag and a selection there, before
the blur, but never from a press in a field: a group is not draggable while a
press in its title lasts, where Firefox put no caret and both browsers dragged
the group instead of selecting its words (its keyboard control stays: a right
click's release goes to the context menu, and the press lasts until the next
one) — and a copy React draws again
for a teammate's write takes no focus and shows the typing (it took the focus
from the field pressed, and closed with it at the release). Its text rides
the write of that click, of the drop, of the change a select picked from
its own list makes, with no click ("Colour by"; pressed, dragged onto the
option and released, Firefox gives the option a mousedown of its own, which
is the same press), or of the input of a paste the middle button makes on
Linux, in the field it presses, with no click either (folded only while one of them is
dispatched, and the editor closes with that write: drawn on, a drop that put
its card in a new group drew it again over the title to name the group), or
goes alone as the press ends; never a write nobody asked for (a teammate
joining, the timer's expiry), which every client sends from one revision and
all but one lose — held for "the next write" for 400 ms, the text rode those
and was lost with them. Enter, which no click follows, and a blur of the
keyboard during a press write it at once. Gone back into before the press
ends — the keyboard, or a press on the field, its release lost to a context
menu or the button still held — the editor is typed in again, and the press
no longer writes its text: written at the press's end, or by the next press,
it went over the newer typing, or alone, closing the editor under it. A press
on the field puts the caret where it presses, never where the draft had it
(Firefox puts it before the focus). Closed by the write that took its text,
the editor is no longer drawn as left: opened again before the press ends, it
takes the focus, and the press's end leaves it open.

**The double-gesture guard — the presses that follow the first press of a
double click, or the taps that follow the first tap of a double tap, press
nothing but what that first press pressed.**
`components/session/doubleGestureGuard.ts` (`useDoubleGestureGuard`, mounted
first by both session types; see *One double-gesture guard* below). The harm
it prevents is real and was seen many times in review: the first click deletes
a card, closes an editor or opens a dialog, the layout moves, and the second
click lands on the next card's Delete (which asks nothing), a vote, *Undo
accept* or a dialog's backdrop — for everyone. One rule, and it reads no
layout:

- **A gesture** is a press and the presses that go on it: those the browser
  counts as the next of a double click (`detail > 1`), and for taps
  (`isTapMouse` tells the mouse a browser emulates for a tap from the mouse
  itself) those within half a second of the tap before and a fingertip (24 px)
  of where the gesture began (`isNextTap`), or counted by the browser within
  that fingertip (`isNearAim`). Each press is counted from the one before, as
  a browser counts; a pause ends the gesture. The keyboard's click (no
  `detail`) is never stopped.
- **What a press presses** (`pressKey`): the control around its target (the
  button around an icon); else the card or the group around it, whatever
  inline element of their words it reached; else its target. Text a click
  turns into its own field, in place (a proposal's text), carries the same
  `data-press-key` as that field, so a double click there still selects a
  word — put a key on such a pair only, never on a container, where it would
  let the next press reach every control inside.
- **A press that goes on a gesture presses nothing unless it reaches what the
  gesture's first press reached** (`guardsPress` stops its mousedown and its
  click), and neither does one the browser counts as the next of a double
  click whose first the guard never saw (the click that opened the session).
  The taps the board claims and acts on itself (`actOnClaimedTap` in
  `Session.tsx`), for which the browser sends no mouse, ask the same rule
  (`pressesClaimedTap`).

**Its costs are stated, not guessed around** (the maintainer's decision,
2026-11-09): a quick second press on another element at the same place
presses nothing — a quick retry beside a missed control, a correction tap
within a fingertip of the first (the score beside the one chosen usually lies
further) — and is pressed after a short pause; taps at a steady pace, each
less than half a second after the one before, are one gesture, so clearing
cards that keep coming up under the finger deletes one card per pause; on
macOS, whose click count has no bound, clicks behave the same until a pause.
A control that acts on `pointerdown` rather than on its click is not guarded.

**Never put the heuristic back.** From 42.0 to 42.2 the guard guessed whether
something had moved under the pointer: it measured every control, card and
group of the page at each press (85 to 150 ms per press on a 1000-card board
on a throttled phone), kept marks of editors closed and controls gone, and each
of twenty reviews found cases it guessed wrong in one browser or another,
several made by the fix before (`HARDENING_STATUS.md` → *H54*). Comparing what
two presses reach needs no layout, and its errors are the costs above.

The tests: `__tests__/doubleGestureGuard.test.ts` (the rule, element by
element — it reads no layout, so nothing is laid out),
`__tests__/sessionGroupTouch.test.tsx` (the taps and presses on the board,
with an event clock of their own, since jsdom stamps events with `Date.now()`;
taps on two cards land at two places, as on a real board),
`__tests__/healthCheckDoubleGesture.test.tsx`,
`__tests__/sessionOpenBoard.test.tsx` and `e2e/retro-touch-card-controls.spec.ts`
(a real browser, on a phone and a computer: a double click on a card's Delete,
a double tap half a second apart on its Comments, the steady pace).

**A control shown on hover is shown on focus, and never hidden where nothing
hovers.** A card's edit, delete and first-comment controls were `opacity-0`
until the pointer hovered the card: a keyboard user tabbed onto a control
nobody could see (2.4.7), and on a phone, where nothing hovers, editing and
commenting were never found while the delete was invisible yet tappable. Hide
such a control with `[@media(hover:hover)]:opacity-0 group-hover:opacity-100
focus:opacity-100` (`focus-within:` for a wrapper) — the participants panel's
pattern — so a touch screen always shows it. Tailwind already applies
`group-hover:` only where a pointer can hover; a bare `opacity-0` has no such
guard. A control a phone always shows must then be seen and must not hide the
content: the card's pencil takes the ink of the card's hue, measured on its
tint (slate-300 measured 1.48:1), a float of its size (`ticket-edit-room`) ends
the first line
before it on every screen — kept on a computer too, where the pencil used to
appear over the last words of the line under the pointer — and the corner
delete is not drawn while the card is edited, where it would lie over the
field, nor over its foot row's controls. On a guided Brainstorm card or a
grouped card on an open board it takes the last 24px of the card's content
across and down, and under the one condition that draws it
(`drawsCornerDelete`) the card's foot row stops 28px short (`pr-7`). That
row's reactions, *Add reaction* and Comments have shared one line since 45.0,
and the Delete asks nothing: on a phone (a 294px card) with four reactions, a
tap meant for Comments deleted the card for everyone
(`__tests__/sessionOpenBoard.test.tsx` → *leaves the corner of a card's foot
row to its corner Delete, wherever that Delete is drawn and nowhere else*).
A keyboard path (the Brainstorm move's, the grouping control of a board's
grouped card) is drawn only while it is focused, the card's whole width at
its foot, and its last 24px across and down still lie under that corner.
Every icon control shown at rest, hover or not, must be seen too: the card's
*Add reaction*, a comment's edit and delete, and an action row's done circle
(open and checked) and trash, in Review, Open Actions, the health check's
Review and the Dashboard's Actions tab, were slate-300 on white (1.49:1) or a
check in emerald-500 (2.54:1); they are slate-500 and emerald-600 (emerald-700
on the Dashboard's Actions tab), and the tests measure what each paints (`effectivePair`), never a class refused:
slate-400, 2.63:1, passed a check that only refused slate-300. (Those numbers
are Tailwind's slate, before 45.0; the look's slate-500 measures 5.41:1 on
white and its slate-400 3.41:1, an edge's value and still no text colour.)
axe-core skips
icon ligatures, so no audit reports them. **Measure a card's control on a
coloured card**: every column a template or Edit Layout makes has a colour,
and cards are coloured by topic by default, so the white card is the rare
one. *Add reaction* took slate-500 there too, at 1.0 to 1.6:1 on the columns'
colours, worse than the slate-300 it replaced. Since 45.0 a card is a soft tint
of its hue, and its pencil, *Add reaction* and comment button all take that
hue's ink (`cardTones(hue).ink`, see *A card's colour*), painted inline; their
test measures each against the card's own background, which `effectivePair`
cannot read (an inline style).
`__tests__/sessionOpenBoard.test.tsx` pins the classes and measures the
colours, `__tests__/sessionActionControlsContrast.test.tsx` the action rows,
and `e2e/retro-touch-card-controls.spec.ts` the layout, on an emulated phone
and a computer: jsdom applies no media query.

**An icon is not a name, and `title` does not rescue it (audit H52).** A button
whose only content is `<span className="material-symbols-outlined">delete</span>`
is announced as **"delete"**: in the accessible-name algorithm a button's content
wins over its `title`, so `title="Delete Team"` is never reached. Every icon-only
button therefore carries an `aria-label`, and
`__tests__/iconButtonNames.test.tsx` fails the build on the next one that does
not — a **source** guard, because neither axe nor `jsx-a11y` can report this: a
name exists, it is merely the wrong one. The same suite refuses a button that
renders nothing and names nothing (a toggle switch whose only child is its knob);
there `title` *is* accepted, because with no content it is the last resort the
algorithm actually reaches. **In new code, an icon beside a label is
`aria-hidden` too**: without it the ligature becomes part of the button's name,
as the console's sortable Teams headers did ("Members unfold_more"). It is a
fact about the codebase since 45.0, and the same suite holds it (its third
family, `beside`): 51 buttons read an icon beside their label on the release
before, none does now, and the next one fails the build. The suite knows an
icon span by its class, written out or one of the look's icon recipes, which
are all named `…ICON…` (`TAB_ICON`, `CHIP_ICON_CLASS`, `BANNER_ICON_CLASS`).
The rule lives in `__tests__/helpers/iconClass.ts` (`drawsIconFont`), which
the ligature gate (`e2e-prod/icon-ligatures.spec.ts`) reads too: name a new
icon recipe that way, or the guard reads the icon as the button's words and
the gate never measures its name. An icon that is the only carrier of a
state gets that state another way
(words, `aria-pressed`, `aria-busy`) before it is hidden; and **a button whose
only content is an icon and a count is named in words, the count it shows
first** (WCAG 2.5.3): a card's comments button is "2 comments", a proposal's
votes "1 vote for" and "Vote neutral" (the icon read as a name said
"comment 2", "thumb_up 1" and, for a neutral vote, "remove"). **A choice that stays chosen says so as a state, not only as a
colour**: a button that selects one option among several carries
`aria-pressed` (the Welcome phase's moods, Discuss's *Move On*, the ROTI
scores of both session types, the health check's survey scores, the invite
dialog's tabs and member rows, the avatar picker's tiles, the filter pills of
the Dashboard's Actions tab, the Feedback Hub and the console's feedback tab,
the template editors' colour swatches and icon tiles, a card's reaction
chips, pressed when the viewer reacted with them, joining the language
switcher and the impact-rating choices that had it;
`__tests__/filterPillState.test.tsx` reads every element drawn with
`FILTER_PILL_ON` with the TypeScript parser, through constants,
class-building arrows and import aliases, and refuses one without it, and
`__tests__/reactionChipState.test.tsx` holds the chips). A colour swatch is
named by its colour in words, never by its code (`shared.colorPicker.color.*`).
A switch says its state with `role="switch"` and `aria-checked`, and every
switch of the Dashboard and of the console does: the Dashboard's anonymity
switches, the console's own three (the new-team notification, the AI
features and the AI's self-signed certificates, each named by its setting, a
name no state changes: `__tests__/superAdminSwitches.test.tsx`) and its Jira
switches. So does the login screen's star, whose name still says what a
press does ("Add … to favorites", then "Remove … from favorites":
`ACCESSIBILITY.md`, gap 10). The current item of a set says so too: the
Dashboard's and the console's current tab carry `aria-current="page"`, and
the phase a session is in carries `aria-current="step"`, the same in both
session headers (`__tests__/currentItemState.test.tsx`). And a chosen
option is never drawn by fading the others (`opacity-*`, `grayscale`), which
both hides the choice from assistive technology and takes the unchosen text
under 4.5:1. A sortable table header carries `aria-sort` on the
sorted column only (`components/admin/teamSort.ts` → `ariaSortOf`, pinned by
`__tests__/superAdminTeamSorting.test.tsx`).

> ⚠️ **Scan JSX with the TypeScript parser, never with a regular expression.**
> This finding's size was recorded wrongly three times — 17, then 8, then the
> real 72 — always from the same line: `<button[^>]*>` to match an opening tag,
> which stops at the first `>`, and nearly every button here has
> `onClick={() => …}`. The attributes then read as the button's *content*, so a
> button counted as "has text" because its class names contain letters. A regex
> also silently dropped three buttons. `typescript` is already a dependency;
> `ts.createSourceFile(..., ts.ScriptKind.TSX)` costs one import.

**A visible label is part of the name (WCAG 2.5.3).** When a control has an
`aria-label` *and* visible text, the name must contain that text as words — a
voice-control user says what they see. axe-core 4.14 enforces it by default
(`label-content-name-mismatch`) and is strict about it: it matches whole words
and **drops anything in parentheses** from both sides, so "Set the timer (7:00)"
does not contain "7:00", and "English" does not contain "EN". Put the visible
text first and outside parentheses ("7:00, set the timer", "FR, Français");
`__tests__/labelInName.test.tsx` applies the rule. A dependency bump that adds
an axe rule turns every audited screen red without a code change — fix the
markup, never the `BASELINE`.

**Colour is checked, not judged by eye.** `utils/colorUtils.ts` carries
`contrastRatio`, `readableTextColor` (for any colour a *user* chooses — today a
column title in the two template editors; no default can fix a value the
facilitator picks) and `bestTextColorOn` (black or white on a coloured surface,
guaranteed to clear 4.5:1 for **every** background: black clears it above
luminance 0.175 and white below 0.183, and the ranges overlap). Since 45.0 a
board's column title is slate-900 and a card is a tint with dark words (see
*A card's colour*), so no screen calls `bestTextColorOn` any more; it stays
for the next saturated surface. The brand primary is indigo-600 (white on it
6.36:1). Tailwind's indigo-500 measured 4.46:1 under white, which is why the
brand moved off it; the look's indigo-500 clears 4.5:1, but the brand is
still 600, the value every recipe and `__tests__/lookTokens.test.ts` name.

> ⚠️ **A contrast fix is directional, and a global find-and-replace gets half of
> it backwards.** Darkening muted text is right on white and wrong on
> `bg-slate-900`: the sweep that fixed six light screens took the close screens'
> muted grey from 6.78:1 to 3.74:1 and their reveal link from 5.70:1 to 2.76:1.
> Both close screens are now in the axe audit so the next one fails loudly, but
> the rule comes first: **ask which surfaces a token lands on before replacing
> it everywhere.** The super-admin console is the other worked example: it has
> no dark surface carrying muted text, yet `text-slate-500` still stays on its
> white cards (4.77:1) and went to slate-600 only where it lands on the grey
> page or a tinted panel (4.35:1). (Both examples measured Tailwind's palette,
> before 45.0. The look's slate-500 reads on white, the page and the brand
> tints, and its muted text on the dark Icebreaker and Close screens is
> slate-200 and -300; the rule is unchanged, and `__tests__/lookTokens.test.ts`
> states which surface each token serves.) The audit prints each `color-contrast`
> finding as its colour pairs and ratios, which is what tells you the surface.

**A participant's colour is data, and as a class it reaches the screen
through one module.** `User.color` is a Tailwind class written by the team
record and by every participant's own client into the session blob, so it is
never interpolated into `className`. The stored class never changes; since 45.0
it names a *tone* (a pastel body, a dark ink of the same hue, a brighter
accent: the `person-*` tokens of `index.css`), and `utils/participantColors.ts`
is the only way from one to the other: `avatarColorClasses` (the body and the
initials' ink, plus the `tone-*` class a picture reads), `participantColorClass`
(the ink alone, for the non-text dots) and `participantToneHex` (the same tone
as hex, for a surface painted with a `style`). White initials failed on seven
of the eight palette colours; the initials are now the ink on the body of one
tone, and `__tests__/participantColors.test.ts` measures every pair from
Tailwind's `theme.css` and then the `@theme` blocks of `index.css`, with
**axe-core's own colour engine** (the copy the e2e gate injects): the initials
at 4.5:1, the dots at 3:1 on white and on the reader's own row. A token that
moves fails the build. A value the palette does not know renders in the neutral
tone (`bg-person-neutral`, `text-person-neutral-ink`), which also keeps a
participant from writing classes such as `fixed inset-0 z-50` onto everyone's
screen; a colour an older release stored renders neutral too, so grey avatars
on an old team are expected, and nothing is migrated. **Every person is drawn
by `components/common/Avatar.tsx`**, which takes its classes as `colorClasses`
(what `avatarColorClasses` or `DEPARTED_AVATAR_CLASSES` returned) and has no
`className`: margins, rings and visibility belong to a wrapper at the call
site. One row is not a person in the session yet, and is not drawn by it: an
invitee still expected, in the participants panel, is a dashed circle holding
initials, with no colour and no picture (see *Avatars*).
A departed participant's avatar is neutral, never faded, and
nothing adds opacity, `grayscale` or a second text colour beside the call —
`__tests__/avatarColorSource.test.ts` walks the AST of `App.tsx` and every
`.ts`/`.tsx` file under `components/` and fails on a raw `.color` in any JSX
attribute but `style` and `key` (the dots take theirs through a `colorClass`
prop, which a `className`-only guard never saw) — and on one anywhere else that
is not inside those three functions, a roster copy (`color: member.color`, with
an optional `||`/`??` fallback) or a key into a colour map, because a class
built in a local variable and interpolated later reads `.color` outside every
attribute. It also fails on an `<Avatar>` whose `colorClasses` is anything but
the module's word (its function, one of its two constants, or a choice between
them); only the avatar picker may hand its own `colorClasses` prop on. The
colour-by-author card takes its author's tone through
`participantToneHex(color).pop`, called in `utils/cardHue.ts` (`Session.tsx`
no longer imports it), and `utils/cardTones.ts` gives the card its
tint, its line and the ink of its controls, painted as a hex `style` (see *A
card's colour* in *The look*). A `color` destructured out of a user escapes the
guard; do not write one. The health-check score tooltip's digits follow the
same measurement (`utils/healthRatingColors.ts`),
and because a measured table proves nothing about the line that reads it,
`__tests__/healthRatingTooltipContrast.test.tsx` renders the tooltip and
measures what it paints — as `__tests__/teamLoginInviteContrast.test.tsx` does
for the two hints only a member-email invite link shows. Text that only a hover
or one kind of link reveals is what the e2e audit never walks: measure it in
jsdom with `__tests__/helpers/tailwindTheme.ts` → `effectivePair`.
