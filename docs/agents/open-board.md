# The open board — a retrospective on one screen (42.0)

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


An open board is a retrospective whose every card activity — writing, voting,
grouping, moving — happens on one screen, with no phases to go through, and
which stays open for as long as the team keeps it (a Lean Coffee, a board kept
for weeks). The facilitator chooses it in *Start New Retrospective* (board type:
guided or open; an open board starts as a guided retro's Brainstorm does —
its authors named unless the facilitator makes it anonymous, each person
reading only their own cards, five votes each and several per card — and with
voting off and its counts hidden until the facilitator opens the vote
(`CARD_AND_VOTE_START_SETTINGS` and `BOARD_START_SETTINGS` in
`utils/openBoard.ts`, which `dataService.createSession` applies; tester
feedback, 42.2 — it used to start anonymous, its cards shown, one vote per card
and no limit); every one of those is changed from the board's *Settings*
dialog, `BoardSettingsDialog`, and the creation dialog says where), and
can turn a retro in progress into a board and back from the session. The rules
are pure and coverage-gated in `utils/openBoard.ts`, `utils/boardView.ts` and
`utils/voteBudget.ts`; `renderColumns('BOARD')` in `Session.tsx` draws it.
Eleven rules:

- **The board is a phase, not a flag and not a session type.** Its phase is
  `OPEN_BOARD`, which is none of the guided phases, so no guided phase rule (the
  Vote phase's auto-finish, the Review step's snapshots, Close ending the
  session) can fire on a board by accident, and every `phase === 'X'` check keeps
  meaning what it meant. Same record, same cards, groups and votes, same sync.
- **Switching is a phase change, and only `setPhase` makes it.**
  `recordBoardTypeChange` remembers the guided phase in `guidedPhase` on the way
  to the board and forgets it on the way back; `guidedResumePhase` resumes there,
  at Icebreaker for a board created open, and **never at Close** (reaching Close
  ends the session, and switching must not end it as a side effect). The timer
  stops at the target's timebox like any phase change (the board's is
  `OPEN_BOARD` in `retroTips.ts`: 5 minutes per topic). `phase` and `guidedPhase`
  are facilitator-only in `sessionGuard.js`, and a merge reads both as
  navigation (`teamMerge.js` → `NAVIGATION_KEYS`). A closed retro is not switched
  (`canSwitchBoardType`). Before any card is written, switching is choosing
  the type again — the Icebreaker offers it to a facilitator who chose wrong —
  so the session takes the new type's card and vote settings, as if it had
  been created that way: both hide the cards and count five votes each,
  several per card, and a board also turns voting off and hides its counts
  (`recordBoardTypeChange`); anonymity and the colour are their own choices and
  stay. A retro that already holds a card keeps its settings either way. The switch is offered on the board's bar, the
  Icebreaker screen and the Brainstorm, Group and Vote bars — never in the
  session header, which the header-fit e2e already measures to the pixel. The
  bars wrap rather than overflow (French labels pushed *Next Phase* off a
  1024px screen), and `e2e/i18n.spec.ts` → *headers fit in both languages*
  measures the Brainstorm and Vote bars at 1024 and 1280px and the board's at
  every width, in both languages.
- **Nothing is lost either way.** What only the guided phases show (actions,
  happiness, ROTI, invitees, the discussion focus) stays stored on the board and
  is there again on the way back — Discuss resumes on the topic it was on, or on
  the most voted one when the board grouped or deleted it; the board shows every
  card, group and vote the guided phases left.
- **A hidden card is out of reach** (`canReadCard`, `canReadGroup`). The
  board's *Hide cards* is Brainstorm's *Reveal cards* turned off — one
  setting, `revealBrainstorm` — and a card its viewer cannot read is not voted
  on, grouped, moved, dropped on or found by a search; a group is read whole,
  so one card in it its viewer cannot read and the group takes no card and no
  vote from them. A drop is refused where it is performed (`boardReceives` →
  `canDropHeldCard`), whatever path brought it, and asks of the held card too:
  the cards can be hidden before the effect that puts the hold down has run. A
  hold on a card that becomes hidden is put down; a card released over itself,
  or anywhere in its own group, is put down where it was — a group that takes
  no card would otherwise hand the drop on to its column, which took the card
  out of the group — and writes nothing, by a drag or the keyboard, as a card
  dropped back on its own column does: the write changed nothing but the
  revision, and a teammate's write from the revision before lost its race; a tap or a keyboard target is offered on a card only
  where the held card can go — offered and refused, the drop put the hold
  down with nothing said; *Delete group* and the title field are offered on a
  group its viewer can read only (its title is still shown); the comments and
  the editor of a card hidden since they were opened close; and the votes a
  viewer gave a card or group before it was hidden stay theirs to take back
  (they count against a limit, and taking one back tells nothing), though no
  vote is added. **Its words never reach the page**: a hidden card shows a
  blurred filler of the same shape (`hiddenCardFiller`), hidden from assistive
  technology, and says "Hidden card" to a screen reader — in Brainstorm too;
  blurred by CSS alone, a screen reader read it out and a find in page matched
  it. **The assistant never reads a hidden card** (`assistantMayReadCards`):
  *Suggest groups with AI* is not offered, a group of one's own hidden cards
  gets no title from it (the title would say what they hold, to everyone), and
  its suggestions close when the cards are hidden. A board is created with
  its cards hidden, as a guided Brainstorm is, and one entered from a phase
  that showed every card (Group, Vote, Discuss, Review) shows them
  (`recordBoardTypeChange`): switching never hides what everyone was reading.
- **A board is voted on with one button per card or group**
  (`BoardVoteControl`, EasyRetro's shape): a thumb that adds a vote and carries
  the total (its name starts with the number, WCAG 2.5.3), the voter's own
  votes as dots, and a cross that takes one back — one number per item, never
  the total beside a counter of one's own votes. The facilitator's settings:
  *Disable voting* leaves the totals and says "Voting is off" on the bar,
  *Hide vote count* leaves each person their own votes and refuses the sort by
  votes (`effectiveBoardSort`), and *Unlimited votes* (`voteBudget`, read by the
  guided Vote phase too, which offers the box as well) never runs out; turning
  it off takes back the votes above the number (`capVotes`, the rule lowering
  the number always applied), so the number stays usable while votes are
  unlimited, where it caps nothing: it is set first, then the box unticked. A
  typed number is applied on Enter or when the field is left, never per
  keystroke — typing 10 passed through 1, which took every vote above one back
  for good. Left for a click on another control, it is written with that
  control's own write (`updateSession` folds it in; alone 400 ms later when the
  click writes nothing): the blur and the click were two writes from one
  revision, and a Next Phase or a timer start pressed right after typing
  snapped back. Folded in, it is still claimed as a write of its own: a phase
  change claims none of the settings it writes, so a Next Phase that lost its
  race healed the number away while the votes it took back stayed taken. The
  vote buttons read the number left for them (`votesLeftToCast`, from a copy
  of it the screen holds, put down with the one the writes read): raised over
  a spent budget, the button was still off at the release, and the click cast
  nothing; lowered, the button goes off as the field is left. A vote's write
  still judges the vote again on the state it is built on (`mayAddVote`), for
  a click handled before the field's blur is drawn: it went in past the new
  number. A number abandoned with Escape, which leaves no field, is
  dropped when the settings close, never applied later; so is one whose write
  the session refused offline, the draft with it (left waiting, the next write
  after the reconnect applied it, a teammate's join included), and one left
  and then typed in again, where the field holds the number. `unlimitedVotes`, `votingDisabled` and
  `voteCountHidden` are facilitator-only in `sessionGuard.js`; the last two are
  read on a board only. An own vote that loses its race is re-sent under one
  vote per item too (a board's default until 42.2): never re-sending made every
  lost vote silent there. Only a **tighter** vote model lets the server win
  (`mergeRemoteSession.ts`: one vote per item turned on, a lower budget —
  unlimited votes turned off included — or voting turned off): its state is
  then the cleanup, or votes are closed. A looser one took nothing back, so a
  vote that raced it is re-sent — the facilitator's own unconfirmed loosening
  included: the model the merge compares with is the one it ends with, its
  own re-asserted settings applied. And re-sent votes never take the voter past
  the budget, nor past what the server already counts for them: two browsers
  of one person voting from one revision would otherwise both keep their vote.
  The control keeps the keyboard where it is (2.4.3): a vote button that cannot
  add right now is `aria-disabled`, not `disabled` — the vote that used up one
  vote per item disabled the very button it was cast with, under the focus;
  the guided Vote phase's plus and minus are `aria-disabled` too, since the
  vote that used the last one, or took the last one back, did the same —
  and taking back one's last vote moves the focus to it before the cross goes
  — on a card or group its viewer cannot read, which has no vote button, to
  the card or group itself (`data-vote-focus-host`).
- **The sort and the search belong to the person looking**
  (`utils/boardView.ts`, `BoardViewControls`): newest first by default — a
  board kept for weeks shows on top what nobody has talked about yet — then
  oldest first or most voted first; a search ignores accents, case and word
  order, reads the apostrophe a phone types (’) and the modifier letter (ʼ) as
  the one a laptop does (') — folded before the accents go, since ʼ is a
  diacritic to Unicode — and œ, æ as oe, ae; it drops the diacritics, never
  every combining mark, so the point médian of inclusive writing
  ("participant·es") is ignored and the vowel signs of other scripts are kept,
  and it reads superscript letters as their letters ("1ᵉʳ" as "1er").
  It never finds a card its reader cannot read, shows a group whole when
  its title or one of its readable cards matches, and a status says how many
  it found. The card or group held right now stays in view whatever the search
  finds, and is not counted: its own control is the way to put it down. So
  does every group whose title was focused on the board during the search,
  until the search changes, whoever made it stop matching
  (`searchKeptGroupIds`): the keystroke that stopped it matching took the field
  away mid-word, and kept only while the field had the focus, it went at the
  blur — the press of a click on its own vote button, the Tab to its next
  control — and took that control with it. And a title field React removes
  (the cards hidden, a move, a phase change) runs no blur, so the merge keeps a
  local title only while its field really has the focus
  (`data-group-title-id`): a group left "being typed" kept its old title over
  every rename and sent it back with that screen's next write. A title is
  "being typed" from its first keystroke, not from the focus: a new group's
  title takes the focus to be named, and a name a teammate gave it meanwhile
  was kept off the screen and erased by its next write. It is the very field
  typed in that is "being typed": a field React draws again (the cards shown
  again, the group moved, the phase back) is another one, typed in by no one,
  where a field React only moves, re-sorted, keeps its typing.
  A card's editor is a field React fills once, as it mounts, so its draft
  lives in that field alone and the merge keeps no old text for it — kept in
  the state, the old text showed nowhere and went out with the next write.
  Nothing typed yet, the editor shows a teammate's edit of its card; typed in,
  it keeps the typing. Typed in or not, it keeps its selection — a caret, or a
  word selected to be typed over, and its direction — also when another
  person's write draws the card again (put in a group, moved): at the end, or
  at the start, the next keystrokes went away from the word they were fixing.
  The selection is kept as each key goes up too: after a drag, React builds no
  select event until the next release of the mouse, and a drag sends none.
  It is
  written as it is left only when its text changed. A card whose editor was
  opened during the search stays in view, with its group, until the search
  changes (`searchKeptTicketIds`): a teammate's edit took it out, and the
  focus fell to the page; kept only while the editor was open, it went as it
  was left, with the control the Tab or the click was going to. An editor
  whose card leaves the screen with no blur closes: a phase that draws no
  card stores what was typed, a card deleted takes it with it (came back with
  its card, the editor took the focus from whatever was being typed).
  Nothing is written: two people read one board in two orders. A group's own
  cards keep the order they were written in.
- **The votes travel with the cards**, on a board and in the guided Group
  phase alike (`utils/retroGrouping.ts` → `combineVotes`): a group gets the
  votes of the cards put in it, a group left with one card hands its votes to
  that card, and a person who voted for two cards that become one keeps one vote
  when only one per item is allowed. The guided Group phase usually has none to
  carry, but a retro turned back from a board, or browsed back from the Vote
  phase, has votes on its cards, and grouping there cleared them until 42.0 —
  silently, since that phase shows no vote. The board's vote control shows the
  total each card or group received (the Vote phase keeps its totals to
  itself). Deleting takes none either: "Delete group" (`deleteGroup`) gives the
  group's votes to the card it was made on (its first card, once that one has
  left), and a card deleted out of a pair hands the group's votes to the card
  left. Removing a column (`removeColumn`, Edit Layout, in Brainstorm too) moves
  its cards and groups to the column before it (after it, for the first):
  removed with it, they stayed in the session out of sight, their votes still
  counting against their voters with no control left to take them back. A card
  written in it while it was removed follows them when its creation is
  restored (`inExistingColumn` in `mergeRemoteSession.ts`). The last column can
  only be removed empty.
- **Votes moved by a regrouping are not own votes.** `registerOwnRetroChanges`
  claims no vote slice for a card whose group changed, or a group whose cards
  changed, in the same write, and drops a claim still outstanding on one; the
  merge never re-asserts an own vote on a card the incoming state has grouped.
  Read as own votes, a regrouping that lost its race took the grouper's vote
  with it, and a vote racing a regrouping was re-asserted on a grouped card,
  where it counts against the budget with no control to take it back
  (`__tests__/mergeRemoteSession.test.ts` → *votes moved by a regrouping*). The
  other way round, a vote claim on a group counts the user's votes the incoming
  state moved into it with a card (`ownVotesMovedInto`): counted alone, taking
  one's vote off a group took away the votes a card had just carried in, and a
  vote the server lost read as confirmed (*votes a regrouping moves into a
  group*).
- **A hold lasts only while it can be acted on.** A held card (`draggedTicket`)
  or group (`movingItem`) is put down by Escape, by a phase or type change,
  when the connection drops — the card's own control, the way to cancel, goes
  with the connection while the targets would stay — and when someone else
  deletes what is held: a hold on nothing went on offering targets for a card
  no one could see (`sessionOpenBoard.test.tsx` → *every hold and every drop*).
- **Its participants panel lists who is connected right now, and no one
  else.** `ParticipantsPanel` filters the roster by presence on a board: no
  waiting list (the invite modal records no invitee there), no "has left"
  marking, no progress line; above the list, as in Brainstorm, a line says who
  is writing a card (see *One participants panel*). The session roster is
  still kept as in a guided retro, which is what keeps an anonymous
  participant's number stable from one visit to the next. A board's
  facilitator can change its anonymity from its
  settings; turning it off asks first (`ShowAuthorsDialog`, opened over the
  settings), because it names the author of every card, the ones written while
  the board was anonymous too. The question closes with the settings when the
  board turns guided (from another tab too), and offers no confirm while the
  session reconnects: closed as if done, it would say the authors are shown
  while the write was dropped.
- **Anonymous means no colour by author either**, on a board and in a guided
  retro alike. While a session is anonymous the cards and the comments dialog
  are coloured by topic and "Colour by" offers Author disabled: one colour per
  author tells anyone which cards one person wrote, and whoever knows one of
  them knows the rest. The stored `colorBy` is kept, so the facilitator's
  choice is back as soon as the session names its authors.

Residuals, stated on purpose: a client from before 42.0 that opens a board
during the rolling update draws nothing for the `OPEN_BOARD` phase until it
reloads, and a pod from before 42.0 does not protect `guidedPhase`. A board is
in progress for good, so a participant who joins without a link lands on it when
it is the team's newest retro in progress (`App.tsx` routing is unchanged).

42.0 was deployed only to test this branch, and three things follow from it
where it was. A tab still running 42.0 showed every card of a board and knows
none of the board's settings: it reads hidden cards in clear, keeps voting with
voting off, and shows the totals the facilitator hid, for as long as it stays
open — boards stay open for weeks, and nothing forces a reload, so reload every
open board tab after deploying over 42.0. A pod from before 42.1 protects none
of `unlimitedVotes`, `votingDisabled` and `voteCountHidden`. And a board 42.0
created stored `revealBrainstorm: false` (42.0 showed a board's cards whatever
it said), so it opens with its cards hidden: untick *Hide cards* in its
settings. A board created before 42.2 keeps the settings it started with
(anonymous, its cards shown, one vote per card and no limit): nothing is
migrated, and its facilitator changes them in its settings.

Residuals of the board's own design (42.1), stated on purpose:

- **Turning unlimited votes off takes back the votes above the number without
  asking**, as lowering the number in the Vote phase always has; on a board
  kept for weeks that can be many, so the board's settings say so under the
  box (the guided Vote bar's box carries no such line), and the number can be
  set before the box is unticked.
- **A card written while a search is on, and not matching it, leaves its
  writer's screen** until the search is cleared, while a group whose title its
  reader focused during the search stays on it, uncounted, until the search
  changes, whoever made it stop matching; the bar's count is what says the
  board is filtered.
- **Newest first and most voted first move cards while people work**: a card
  written at the top of its column, or a vote that re-ranks a card, can move
  another one between the moment it is aimed at and the click or the drop.
  Oldest first, the guided phases' order, only ever adds below. EasyRetro has
  the same; freezing the order under the pointer is not built.
- **A card's text left for a press of the mouse is written as the press
  ends** (`pressRef`), in a guided retro too: a connection that drops during
  the press drops it, as no edit made offline is kept, and the editor closes
  on the stored text; a session the click itself takes off the page (signed
  out) does not write it — the exit button writes it in its own write. A
  press held longer than 10 s (`PRESS_LEAVE_SAFETY_MS`) ends without its
  click, and one whose release the browser never sends ends at the next
  press. A word a phone keyboard is still composing when another person's
  write draws the card again may be committed twice: the composition belongs
  to the field React removed.

Found by the review of the board and left as they are, because they predate it
(the board only makes them likelier: everyone votes, groups and moves on one
screen at once):

- **Shared content loses its races, as everywhere** (see *Moving cards on the
  board*): a card's text, a move, or the last keystrokes of a group title whose
  write was refused are healed away and redone by hand. A title slice like
  `reviewSummary`'s would close the group-title case.
- **A vote on a group in the instant someone dissolves it is lost**: the
  group it was for is gone.
- **Two writes of one screen inside one round trip still lose the second**
  when no gesture joins them: the server keeps one write per revision. A
  hold's text written alone at the hold, then a drop tapped before the server
  answered, is one case; the shared timer's editor left for Next Phase or
  another control outside the timer is another (the timer is saved as its
  container is left, in both session types) — pressed again, the click goes.
  Holding the next write behind the one in flight would close them; it changes
  the sync protocol and is not built.
- **A board kept for weeks keeps every card in one session blob.** Past the
  1 MB socket message (`SOCKET_MAX_BUFFER_SIZE`) and the 1 MiB JSON body, its
  writes stop going through: start a new board instead.
- **The presence panel merges participants by name** (`sessionParticipants`,
  which both screens' `getParticipants` call), so two members with the same
  name show once (on an open board, two connected
  ones). The merged row's votes left, check, contribution dots and typing cue
  are the first person's. The other person has no row of their own: no "(you)"
  row, no name on the typing line; their own Vote bar shows their count, beside
  a row that bears their name and shows the other person's. It reaches the
  tint too: on a board coloured by author, the second of two people whose
  names differ only in case is found nowhere and gets white cards, the card
  `cardHue` gives an author the screen does not list
  (`__tests__/cardHue.test.ts`), on the board and in Discuss alike
  (`__tests__/discussTopicTint.test.tsx` → *finds the author where the board
  does, when two people share a name* holds that Discuss paints the card as
  the board does).
- **Taking a card out of a pair hands the card left every vote of the group**,
  including the votes cast for the other card before they were grouped: a
  group does not record which card a vote was for, on purpose — the votes are
  the topic's.
- **A vote claim is a count, not a change.** When a user's vote on a group and
  their own regrouping of a voted card into it both lose their race, the
  regrouping drops the claim and the vote goes (`mergeRemoteSession.test.ts` →
  *drops a group claim when the user then drops one of their voted cards into
  the group*); and a vote that reached a card on the server while this client
  was offline, then moved into a group with it, is not counted in by a claim
  on that group made before. With several votes per item, the other order —
  the user drops a voted card into a group, then votes on the group, and both
  writes lose — re-sends the carried vote as one of their own on the group,
  while the card outside it keeps it too. All three take two of one user's
  writes lost at once; a claim stored as a change would close them.
- **Removing a column that holds cards moves them without asking**: a "Stop"
  card then reads as a "Start" one, and in Brainstorm with "Reveal cards" off
  the facilitator moves cards they cannot read. A confirmation saying how many
  cards move is not built.
The guards: `__tests__/openBoard.test.ts` (with `canDropHeldCard`),
`boardView.test.ts` (the sort and the search), `voteBudget.test.ts`, the
vote-keeping, `deleteGroup` and `removeColumn` cases of
`retroGrouping.test.ts`, `mergeRemoteSession.test.ts` (*votes moved by a
regrouping*, *votes a regrouping moves into a group*, a lost vote re-sent under
one vote per item and against a looser model, the server's word when the vote
model tightened or voting was turned off, *never re-sends more votes than
the voter has*, and *the facilitator's own settings are claimed*),
`sessionOpenBoard.test.tsx` (the screen, the keyboard paths,
the switch, the panel, every hold and every drop — *with the cards hidden*
too, every hold as the cards are hidden — and *sort, search, votes and the
facilitator's settings*, the vote control's focus, the votes field and the
hidden cards' words included, a title or a card's editor only focused
taking a teammate's word, and *the card editor* with what it does *left for
a press of the mouse*), `sessionGroupTouch.test.tsx` (the taps that cancel
the emulated mouse, on a card and on a group container, the field and the
picker they leave, and a click on a control right after typing in a card's
editor, the session left by it included),
`hiddenCardFiller.test.ts`, `i18nOpenBoard.test.tsx`,
`dashboardOpenBoard.test.tsx` (the board type, and the lists' statuses
measured at 4.5:1), `e2e/i18n.spec.ts` (the action bars),
`e2e/retro-touch-card-controls.spec.ts` (a card's controls on a phone and on a
computer, the pencil over no text on either, a grouping tap that clicks
nothing else, an editor left open through the taps keeping its text, on a
card and on a group's blank area, a press that leaves an editor landing
on the control pressed, on a computer and a phone, and a card's corner Delete
lying over none of the controls the card draws at rest while Comments takes a
press at its centre,
on a guided Brainstorm card and on a board's grouped card, with 0 to 6
reactions, with and without a comment: a phone at its one width, a computer
swept from 1100 to 1400px, a card about 7px wider at each step), and
`e2e/retro-open-board.spec.ts` (two browsers, the presence panel, the settings
and their axe audit, hidden cards reaching the participant, a search, a round
trip through the guided retro, and the axe audit of the board).
