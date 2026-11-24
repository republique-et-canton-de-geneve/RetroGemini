# Retrospectives and health checks — one behaviour for what they share

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


The two session types grew as two components (`Session.tsx`,
`HealthCheckSession.tsx`), and every piece one carried a private copy of
drifted. A health-check field report found three at once: health checks
stayed **IN PROGRESS** after they ended, invitations sent from a health check
were never listed as waiting to join, and a feedback image would not open.
The rule now: **a behaviour both session types have is written once, and a
change to it lands in both.**

- **A session that reached Close is finished, and stays finished** —
  `utils/sessionStatus.ts`. Opening Close writes `CLOSED` with the
  facilitator's own phase change, for a retro and a health check alike, and
  nothing reopens it as a side effect: not browsing back through the phases,
  not leaving from an earlier one. Both halves are field bugs. The health
  check used to close only when the facilitator clicked its exit button, so a
  closed tab or that one lost write left it **IN PROGRESS** for good; and the
  retro's exit wrote `IN_PROGRESS` whenever it was left away from Close, which
  is exactly where "View Summary" plus one click back leaves it. Neither is
  cosmetic: a participant who lands on the dashboard is sent into the first
  health check still in progress, before any retro, so a stuck one captured
  people for months. Every status write and every client reader goes through
  `effectiveSessionStatus` / `isSessionInProgress` (a stored `CLOSED` is
  final, and a record at Close reads as closed — that heals the health checks
  saved before the fix without a migration). The super-admin live tab still
  shows the raw server value. Do not describe the status as reaching the team
  record "with the write every participant receives": receivers never write
  the team record, and its HTTP persist drops only a strictly older `_rev`, so
  a racing write can still put an older phase back until the next write.
- **One participants panel** — `components/session/SessionParticipantsPanel.tsx`.
  It owns the roster, presence, the facilitator's "has left" marking
  (`leftUsers`), the invitees still expected (`invitedUsers`), the collapse
  toggle and the invite button. Each session passes only what differs: the
  row's status for the current phase and the progress line. The retro's
  `ParticipantsPanel` is that adapter plus contribution dots, the typing cue
  and the impact-rating round. `leftUsers` and `invitedUsers` are on both
  session types, and `leftUsers` reaches every counter that waits on people —
  including the proposal vote badge (`ProposalActionRow`,
  `RotiFollowUpActions` take `leftUserIds`), which the health check first
  forgot. A departed participant's avatar turns neutral grey
  (`DEPARTED_AVATAR_CLASSES`) rather than fading, which put its initials below
  4.5:1 on every colour. Only the facilitator may *add* an id to `leftUsers`,
  and the server enforces it (`sessionGuard.js`); taking one off stays open to every client,
  because every client clears the mark of a participant who reconnects. In an
  anonymous session invitees are counted, never named: a name leaving the
  waiting list as "Participant 3" comes online would say who Participant 3 is.
  Invitees are written with `recordInvitees` and survive a lost
  write race through `restoreLostInvitees`, called by **both** merges. The
  collapsed state is local to each browser in both — the health check used to
  sync it, so the facilitator collapsing the panel collapsed it for everyone.
  Add a panel behaviour to the shared component, never to one session type.
  Two retro-only lines reach it through optional props the health check never
  passes, so it looks exactly as before.

  `memberLine` puts words in place of a person's role. In the guided Vote
  phase, until they finish, it shows the votes they can still place: "3
  votes left", `utils/voteBudget.ts` → `votesLeftToPlace`. That is the stored
  number less every vote they cast on cards and groups (`votesCastByVoter`),
  never below 0, and, with one vote per item, never more than the items that
  do not hold their vote yet (`votableItems`, what the Vote phase draws with a
  vote control: `getColumnEntries` over the columns, which a test compares);
  nothing while votes are unlimited. The bar's "N votes remaining", the
  automatic finish and the row all read that one number (`Session.tsx` counts
  with `votesCastByVoter` too), so a person who voted on every item is
  finished on their own instead of being shown "1 vote left" no item will
  take; it is never a card's total. Once they finish, the row goes back to its
  role and the check. The check, the only sign that a person is done, is a
  disc of emerald-700 (strong) or emerald-600 (soft) holding a white tick: 3:1
  on white and on the reader's `bg-indigo-100` row (1.4.11), where -500 and
  -400 measured 1.73 to 2.46:1.

  `typingKind` comes from `utils/typingNow.ts` → `typingKindForPhase`: cards in
  Brainstorm and on an open board, proposals in Discuss, nothing anywhere else.
  It limits the rows' typing cue to that kind. It also pins a line above the
  list, outside its scroll, saying who is typing (`typingMembers`):
  - in the list's order, never the reader nor anyone marked as having left
    (`leftUsers` read as data: a `null` another client wrote is nobody);
  - every name up to three, then two and the number of others, on three
    reserved lines (two cut the third first-and-last name in French);
  - counted, never named, in an anonymous session;
  - "Nobody is writing" when nobody is.

  "Typing" is a focused field holding a draft, from the moment it is focused
  (`reportMyDraft` on the field's focus, not only on its next keystroke): the
  line and the rows' cue count exactly that. A draft left in a field its
  author has left is not counted, as the rows' cue never counted it. A field
  React removes runs no blur, so the sender's keepalive stops the signal once
  the field that raised it is gone or no longer has the focus: the proposal
  input the facilitator's Discuss focus took away, a column removed in Edit
  Layout, a field disabled while the session reconnects (Chromium takes the
  focus off a disabled field; jsdom keeps it, so that test stubs the defocus
  and checks the keepalive's reaction to a field still on the page).
  `__tests__/sessionParticipantActivity.test.tsx` pins each of them, and the
  focus report of both fields.

  The collapsed rail shows the count. Neither line is a live region: other
  people's typing and votes change too often to be announced. The panel, and
  with it the typing line, the rail and the Vote phase's votes left, is drawn
  from `lg` (1024 CSS px) up (`hidden lg:flex`, as before 43.0); below it the
  header chip shows a count only (who is done in a guided phase, who is
  connected on an open board). At every width that count is a status, never a
  control: from `lg`, while the panel is collapsed, the panel's rail expands
  it with its own button, which the keyboard reaches and which keeps the focus
  as it toggles (`__tests__/sessionHeaderLook.test.tsx` → *the participants'
  count*, `__tests__/healthCheckLook.test.tsx` → *the participants' count in
  the header*). A count for narrow screens is not built. In French the votes chip may be cut after its number in a wide font
  with a classic scrollbar; the count comes first and is never cut.

  **Nothing that changes while people work moves a row.** The line keeps one
  height in every state. The cue, the votes line and the role are each one
  16px line. The contribution line is one height with or without cards, and
  it is drawn from the start of Brainstorm, so the session's first card adds
  nothing to any row. The cue's 24px icon, the taller "no tickets" line and
  the line arriving with the first card each used to move every row below
  them, and the hover-revealed *Mark as left* button with them. What still
  moves rows, on purpose: entering Brainstorm draws the contribution line (the
  facilitator's own phase change), the facilitator's own *Mark as left* sends a
  row to the bottom, and presence: on an open board rows come and go with it,
  and in a guided retro someone joining is listed above the departed rows (and
  leaves the waiting list), while a participant marked as having left who
  reconnects is un-marked by every client and goes back to their place.
  `e2e/retro-full-flow.spec.ts` measures the rows.
- **One list of the people a session lists** —
  `components/session/sessionRoster.ts` → `sessionParticipants`. Both
  screens' `getParticipants` is `sessionParticipants(session?.participants,
  currentUser)`, and the Discuss phase calls it too: the session's
  participants, the viewer added when not listed, each id once and each name
  once (trimmed, case-insensitive, the first listed kept). The board finds a
  card's author in it, the health check lists its people with it, and the
  Discuss topic a card becomes finds its author there as the board does, so
  both paint the card alike (see *A card's colour*); each screen used to build
  the list inline. Every client writes the participant list, so its value is
  data: one that is not a list reads as nobody, and the viewer is listed
  alone, as the screens' former copies read `{}` (`sessionRoster.test.ts` →
  *lists the viewer alone when the session's list is not a list*).
  `__tests__/sessionParticipantsShared.test.ts` reads the screens with the
  TypeScript parser and fails when a screen's `getParticipants` is anything
  but that call, when a screen keys a person by a name of its own
  (`x.name.trim().toLowerCase()`), or when Discuss stops calling it.
- **Images open inside the app** — `components/common/ImageGallery.tsx`.
  Feedback images are stored as `data:` URIs, and browsers refuse a
  script-opened top-level navigation to `data:` (Chromium opens no window at
  all), so `window.open(img)` did nothing — only the context menu's "Open
  image in new tab" worked. Never `window.open` a `data:` URL; show it in a
  dialog.
- **One "not saved" banner** — `components/session/SyncStalledBanner.tsx`.
  Both session screens render it below their header while `syncService` reports
  `stalled` (see `session-update-refused` in *Real-time Events*): "Your changes
  are not being saved." with a reload button. It takes no props and subscribes to
  `syncService` itself (`useSyncHealth`), so the two screens cannot drift apart.
  The header chip reads the same hook and says "Not saving" instead of a green
  "Live" during a stall: two opposite statuses on one screen would leave the
  user guessing which one to believe. In incident ISS a
  participant's writes were refused for over half an hour and nothing on any
  screen said so; the team typed its whole brainstorm twice. The member-roster
  merge both screens use is shared too (`components/session/sessionRoster.ts`):
  it writes only when the roster changes the participant list, because every
  client used to write the whole session on every join or leave, all from the
  same revision, so all but one lost the race. `member-joined` goes through the
  same rule (`memberJoinedChange`), read against the latest state rather than a
  mount-time closure. Names are a fallback for one person who came back under a
  new id, never a way to merge two team members whose names only differ in case.
- **One reaction to a password change** — `components/session/useSessionRevoked.ts`
  (decision D3b). When the team's password is changed under a session, both
  screens pause editing and say so in the connection banner and the header chip
  (`JOIN_DENIED_REVOKED` in `SessionConnectionStatus.tsx`), with "Log in again"
  rather than an automatic redirect, so a participant halfway through a card can
  still copy it; a newer token adopted from another tab of the browser makes the
  session live again by itself. Neither screen subscribes to the revocation
  directly (`__tests__/sessionRevokedShared.test.ts`). The signal itself lives in
  `services/sessionRevocation.ts`, a module with no imports, so the suites that
  mock `dataService` keep working. **The Dashboard does the same**: App keeps it
  mounted under `components/dashboard/DashboardRevokedBanner.tsx` (an alert with
  "Log in again", drawn as the session's own band: `BANNER_CLASS`,
  `BANNER_ALERT_CLASS`, `BANNER_ICON_CLASS` and `BANNER_ACTION_CLASS` of
  `SessionConnectionStatus.tsx`, which the stalled banner takes too) instead of
  signing out at once, because a feedback being
  written there — its screenshots, every comment draft — lives only on the
  screen, and the login screen replacing it took the draft before the form could
  say "copy your text" (`__tests__/appSessionRevokedDashboard.test.tsx`). Only a
  view with nothing of the user's on it signs out at once. A request the server
  refuses as revoked while this client holds a newer token by then (another
  tab changed the password and its token was adopted) is sent once more with
  it: `apiCall` does it, and so does what posts outside it — the feedback
  create (`submitTeamFeedback`'s `getSessionToken`) and the feedback board's
  reads and writes (`TeamFeedback` → `postToFeedbackRoute`), once, never in a
  loop.
- **One timer** — `utils/sessionTimer.ts` (the rules, pure and
  coverage-gated), `components/session/useSessionTimer.ts` (the countdown, the
  expiry write, the alarm, the editor) and `components/session/SessionTimer.tsx`
  (what both headers render). Health checks had no timer at all; they now get
  the retro's, not a copy of it, and `__tests__/sessionTimerShared.test.ts`
  fails the build if timer logic reappears in `Session.tsx`,
  `HealthCheckSession.tsx` or `SessionHeader.tsx`. Six rules:
  - **The five `settings.timer*` fields are a wire contract.** Nothing is
    written per tick; every client derives the remaining time from
    `timerStartedAt`, and the previous release's clients read the same fields
    during a rolling update. Add an optional field if you must; never change
    what an existing one means.
  - **A gesture is one write, or none.** Every mutator edits a settings draft
    and says whether it changed anything; the hook dry-runs it on what the user
    is looking at first, so a click with nothing to do sends nothing. Pressing
    play on a timer that ran out used to acknowledge and start in two writes
    stamped with the same revision — the server refused the second, so the
    click only silenced the alarm.
  - **Missing fields are filled in on read, never written for a reader.**
    Health checks stored before this carry no timer fields and read as
    stopped at their phase's default. `timerInitial` is facilitator-only in
    `sessionGuard.js` (for both session types — the guard does not know the
    type), so a participant's client that "repaired" it would have every one
    of its writes refused. The fields appear the first time the facilitator
    sets the timer or changes phase.
  - **Every client writes the expiry, guarded on the run.** The facilitator's
    tab may be closed or throttled in the background, so nobody can be the
    only writer; `finishTimer` applies only to the run (`timerStartedAt`) the
    client watched, and reconnecting re-runs the countdown so an expiry missed
    offline is still written. The alarm sounds once per run, and only for a run
    this client watched with time left — never when a session is opened on a
    timer that ran out long ago.
  - **Each session type keeps its own timeboxes.** A phase change calls
    `resetTimer` with the retro's `retroTips.ts` value or the health check's
    `HEALTH_CHECK_PHASE_TIMER_SECONDS`. Three phase ids exist in both
    (DISCUSS, REVIEW, CLOSE), so a shared lookup would silently hand one
    session type the other's timeboxes.
  - **The ring is a view of the same fields.** The timer's chip draws a
    progress ring from the remaining time and the run's length:
    `useSessionTimer` also returns `initial`, `timerRingFraction` (pure) turns
    the two into the ring's fraction, and nothing is written for it. The last
    ten seconds of a run (`isTimerEnding`) add a frame to the chip: a sign that
    is not a colour alone. The time keeps the classes `font-mono font-bold
    text-lg`, which the header-fit spec finds it by.

  The timer is not in the own-change ledger, on purpose: it is shared state
  where the server wins, and a facilitator's "running" claim against a
  participant's "ran out" claim is exactly the ping-pong the ledger exists to
  prevent. Add a timer behaviour to the shared files, never to one session
  type.

- **One double-gesture guard** — `components/session/doubleGestureGuard.ts`
  (`useDoubleGestureGuard`). The presses that follow the first of a double
  click or a double tap press nothing but what the first pressed (see
  *Accessibility*, *The double-gesture guard*). It lived in `Session.tsx` alone,
  and the health check, which renders the same proposal rows, deleted the
  proposal being edited with a double click on its Cancel, and two with one on
  its Delete. Both screens mount it before anything that listens for a press;
  the retrospective's board asks it about the taps it claims
  (`pressesClaimedTap`).

What is deliberately **not** shared yet: the session headers themselves (the
retro's carries the tips and counts different things, and both are pinned by the
header-fit e2e at five widths) and the close screens. Both headers render the
same `SessionTimer` and use the same breakpoints; bring the rest together with
that test in hand.
