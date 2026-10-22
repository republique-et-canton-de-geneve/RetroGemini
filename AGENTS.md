# AI Agent Instructions for RetroGemini

This document provides guidelines for AI coding assistants (Claude, ChatGPT, Gemini, Copilot, Cursor, etc.) working on this codebase.

> **Single source of truth.** This `AGENTS.md` is the **only** instruction file to
> edit. `CLAUDE.md` is a symlink to it (`CLAUDE.md → AGENTS.md`), so Claude Code and
> every other agent read the exact same content. Never create a separate `CLAUDE.md`
> with its own text — edit `AGENTS.md` and both stay in sync automatically.

## Project Overview

**RetroGemini** is a self-hosted, real-time collaborative retrospectives and team health checks application built with:
- **Frontend**: React 19 + TypeScript + Vite + Tailwind CSS
- **Backend**: Express 5 + Socket.IO + SQLite/PostgreSQL
- **Deployment**: Docker + Railway/Kubernetes/OpenShift

## AI Tooling: gstack

This repo standardizes on [**gstack**](https://github.com/garrytan/gstack), an
open-source Claude Code skill set that adds a virtual engineering team. It is
installed in **team mode (`required`)**, and the repo's `.claude/` bootstrap
makes that real rather than aspirational — see *Enforcement* below.

### The routing rule — read this before anything else

> **Applies to Claude Code only.** gstack is a Claude Code skill set: the
> commands below are invoked through Claude's `Skill` surface, and only
> `.claude/settings.json` installs or reaches them. ChatGPT, Gemini, Copilot,
> Cursor and the other assistants this file addresses **cannot run them** — for
> those, the table stays useful as a description of *what a thorough answer
> covers* (investigate before fixing, review before landing, audit security
> explicitly), and the binding rules for them are the rest of this document:
> TDD, the VERSION/CHANGELOG golden rule, and the before-committing sequence.
> Do not stop work because gstack is unavailable on a non-Claude assistant.

**On Claude Code, every prompt starts by choosing a gstack command.** Nobody
should ever have to write "use gstack" in a request: picking the right command
*is* the first step of answering. The `.claude/hooks/gstack-route.sh` hook
prepends this routing table to every prompt so the choice cannot be skipped
silently:

| The prompt is about… | Command |
|---|---|
| a reported bug, "why does X happen" | `/investigate` |
| a change that is written and about to land | `/review`, then `/ship` |
| security — an audit, a finding, a threat question | `/cso` |
| "what state is the code in", a quality baseline | `/health` |
| exercising the running app and fixing what breaks | `/qa` (`/qa-only` to report only) |
| vague intent that needs pinning down first | `/spec` |
| a plan that deserves a second opinion | `/plan-eng-review` |
| any web browsing at all | `/browse` — never raw `curl`/WebFetch for pages |
| docs to refresh after a change | `/document-release` |

State the chosen command in one line before running it. When none genuinely fits
— a pure question, a one-line edit — say `no gstack command fits: <reason>` and
proceed. What is **not** acceptable is answering as if gstack did not exist.

`/health` and `/cso` are the two the hardening work leans on
(`HARDENING_STATUS.md` §0 asks for them by name), and `/review` before landing.

### Enforcement — how this survives a fresh container

Three hooks in `.claude/settings.json`, all committed:

| Hook | Event | Job |
|---|---|---|
| `session-start.sh` | `SessionStart` | Installs npm deps **and** gstack in a Claude Code on the web container, and records the maintainer's answers to gstack's one-time questions (below). Idempotent; skipped on local machines (`CLAUDE_CODE_REMOTE`). |
| `gstack-route.sh` | `UserPromptSubmit` | Injects the routing table above into every prompt. |
| `check-gstack.sh` | `PreToolUse` on `Skill` | gstack's own team-mode guard: denies skill use when gstack is missing. |

The order matters. `check-gstack.sh` is a *blocker*, not an installer — on its own
it would deny every skill call in a web session, because those containers are
ephemeral and start with no `~/.claude/skills/gstack`. `session-start.sh` is what
makes the guard a safety net instead of a wall; the container state is cached
after it completes, so the install cost is paid per container refresh, not per
session. **Never commit `check-gstack.sh` without `session-start.sh`.**

**gstack's one-time questions are already answered — never ask them.** A web
container does not keep what a session writes in gstack's state directory, so
its one-time questions came back in every session. The maintainer answered them
once (2026-10-20) and `session-start.sh` applies the answers before the first
prompt: **telemetry off**, and **cross-project learnings off** (a container
holds this one project). If a skill's preamble still emits the telemetry
question, run `gstack-config set telemetry off` and continue without asking.

> ⚠️ Re-running `gstack-team-init required` **overwrites** `check-gstack.sh` and
> rewrites `.claude/settings.json`. It does not know about the two hooks above,
> so re-add them to `settings.json` afterwards — otherwise a web session silently
> loses both the auto-install and the routing table.

### Manual install (local machine, once)

```bash
git clone --single-branch --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack \
  && cd ~/.claude/skills/gstack && ./setup --team
```

Skills install under short names (`/qa`, `/review`, `/ship`) — as of gstack
1.60.x no `--no-prefix` flag is needed for that. Re-running `./setup` after a
`git pull` refreshes the install; `--team` also makes gstack self-update at each
session start. Use `~/.claude/skills/gstack/...` for gstack file paths.

> `gstack-team-init` appends its own section to `CLAUDE.md`, which is a symlink to
> this `AGENTS.md`, so the text lands in the single source of truth. Verify the
> symlink survived with `ls -l CLAUDE.md`; if a tool replaced it with a regular
> file, move the section into `AGENTS.md` and recreate the link:
> `rm CLAUDE.md && ln -s AGENTS.md CLAUDE.md`.

To remove gstack later: `~/.claude/skills/gstack/bin/gstack-uninstall` (global),
and drop the repo's `.claude/` bootstrap.

## Zero Downtime Requirements

**CRITICAL**: This application is deployed on OpenShift/Kubernetes with rolling updates. Users may be in the middle of a retrospective session when deployments occur.

### Key Principles
- **Never interrupt active sessions** - All features must support seamless reconnection after pod restarts
- **WebSocket reconnection must be automatic** - The `SyncService` automatically rejoins sessions after reconnection (see `services/syncService.ts`)
- **State must be persistent** - Session state is stored in PostgreSQL/SQLite and synchronized across pods via Socket.IO adapters (Redis or PostgreSQL)

### When Developing New Features
1. **Consider reconnection scenarios** - Will the feature work correctly if the WebSocket disconnects and reconnects mid-operation?
2. **Store necessary state for recovery** - If a feature requires user context, ensure it can be restored after reconnection
3. **Test with rolling updates** - Verify that ongoing sessions survive pod restarts
4. **Use the existing sync patterns** - Follow the `pendingJoin`, `queuedSession`, and auto-rejoin patterns in `syncService.ts`

### Architecture for High Availability
- **Multi-pod support**: Use Redis or PostgreSQL Socket.IO adapter for cross-pod communication
- **Session persistence**: All session state is saved to database on every update
- **Graceful shutdown**: Kubernetes probes (`/health`, `/ready`) ensure proper pod lifecycle management
- **A lost cross-pod adapter is visible, and heals itself**: if the Redis or PostgreSQL Socket.IO adapter fails to initialise, the pod keeps serving with the in-memory adapter (it must — refusing traffic on every pod at once is worse than degraded collaboration), logs the failure loudly, reports it on `/health`, and retries in the background with backoff for roughly ten minutes before leaving the state visible. Alert on `status: 'degraded'`; never gate routing on it

## Security Response Headers (audit H36)

`server/services/securityHeaders.js` sets the headers on **every** response —
it is mounted in `server.js` before the first route, so nothing added later can
escape it. Hand-written rather than `helmet`: it is ten lines of values, and a
production dependency in an air-gapped deployment needs a better reason than
convenience.

**The CSP is enforcing (decision D14), and it is the machine-enforced half of the
offline rule below.** `default-src 'self'` means a CDN font or an external script
added by a future dependency *fails in the browser* instead of failing silently
on the corporate-Wi-Fi phones this product is deployed for. Do not weaken it to
make something load — find the self-hosted equivalent, which the offline rule
requires anyway.

Every directive earns its place, and the four below exist to keep real features working.
Delete one and the feature breaks **silently** — no error, just an empty area of
the UI:

| Directive | Without it |
|---|---|
| `img-src 'self' data:` | Both invite QR codes vanish (`QRCode.toDataURL` produces `data:` URIs), feedback image thumbnails vanish (they are stored and shown as `data:` URIs), and no image too large to send as it is can be attached any more (`utils/feedbackImages.ts` decodes it through a `data:` URL to reduce it, because `blob:` is refused) |
| `style-src 'self' 'unsafe-inline'` | Tailwind's runtime injection is blocked; the app renders as unstyled HTML |
| `connect-src 'self'` | Socket.IO cannot connect — the app loads and never syncs |
| `font-src 'self'` | Material Symbols is blocked; every icon shows its raw ligature name |

**Two test layers, and neither replaces the other.**
`__tests__/securityHeaders.test.ts` pins the header values and that they reach
both an API response and the SPA fallback. It cannot tell you whether the policy
lets the app *run* — for that, `npm run test:e2e:prod`
(`playwright.prod.config.ts` + `e2e-prod/`) builds the frontend, serves it from
`server.js` and drives it in a real browser.

> ⚠️ **The ordinary e2e suite cannot gate a CSP.** `playwright.config.ts` points
> `baseURL` at Vite on :5173 and proxies only `/api` and Socket.IO, so a header
> set by Express never governs what those tests render: the whole suite stays
> green while production is blank. This is not hypothetical — the QR-code case
> above was caught in review, not by tests. Any change to the policy must be
> verified with `npm run test:e2e:prod`, which CI runs on every pull request.

## Accessibility (audit H42)

WCAG 2.1 AA is a conformance obligation for a Geneva public-sector deployment
(eCH-0059), not a polish item. Two rules bind every UI change:

**Every overlay goes through `components/common/ModalDialog.tsx`.** It owns the
`role="dialog"`, `aria-modal`, the accessible name, Escape (topmost dialog only,
via a small stack), a focus trap, and returning focus to whatever opened it.
Call sites pass their own `overlayClassName`/`panelClassName`, so adopting it
changes behaviour without moving a pixel. Hand-rolling `fixed inset-0` again is
exactly how the product reached **thirteen** overlays with **one**
`role="dialog"` between them. A dialog holding unsaved text may pass
`closeOnBackdropClick={false}` — never remove Escape.

> Its focusable-element check walks ancestors instead of reading `offsetParent`
> or `getClientRects()`. Those need a layout engine, so under jsdom they report
> every control as hidden and the trap silently does nothing — which is how a
> focus trap ships broken with a green test suite.

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
claim it.

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
algorithm actually reaches.

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
`contrastRatio`, `readableTextColor` (for any colour a *user* chooses, such as a
column title — no default can fix a value the facilitator picks) and
`bestTextColorOn` (black or white on a coloured surface, guaranteed to clear
4.5:1 for **every** background: black clears it above luminance 0.175 and white
below 0.183, and the ranges overlap). The brand primary is indigo-600, not
500 — white on the 500 measures 4.46:1 against a 4.5:1 floor.

> ⚠️ **A contrast fix is directional, and a global find-and-replace gets half of
> it backwards.** Darkening muted text is right on white and wrong on
> `bg-slate-900`: the sweep that fixed six light screens took the close screens'
> muted grey from 6.78:1 to 3.74:1 and their reveal link from 5.70:1 to 2.76:1.
> Both close screens are now in the axe audit so the next one fails loudly, but
> the rule comes first: **ask which surfaces a token lands on before replacing
> it everywhere.**

## Moving cards on the board — two phases, two meanings

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
  competes with its own textarea.
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

## Retrospectives and health checks — one behaviour for what they share

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
  forgot. Only the facilitator may *add* an id to `leftUsers`, and the server
  enforces it (`sessionGuard.js`); taking one off stays open to every client,
  because every client clears the mark of a participant who reconnects. In an
  anonymous session invitees are counted, never named: a name leaving the
  waiting list as "Participant 3" comes online would say who Participant 3 is.
  Invitees are written with `recordInvitees` and survive a lost
  write race through `restoreLostInvitees`, called by **both** merges. The
  collapsed state is local to each browser in both — the health check used to
  sync it, so the facilitator collapsing the panel collapsed it for everyone.
  Add a panel behaviour to the shared component, never to one session type.
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
- **One timer** — `utils/sessionTimer.ts` (the rules, pure and
  coverage-gated), `components/session/useSessionTimer.ts` (the countdown, the
  expiry write, the alarm, the editor) and `components/session/SessionTimer.tsx`
  (what both headers render). Health checks had no timer at all; they now get
  the retro's, not a copy of it, and `__tests__/sessionTimerShared.test.ts`
  fails the build if timer logic reappears in `Session.tsx`,
  `HealthCheckSession.tsx` or `SessionHeader.tsx`. Five rules:
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

  The timer is not in the own-change ledger, on purpose: it is shared state
  where the server wins, and a facilitator's "running" claim against a
  participant's "ran out" claim is exactly the ping-pong the ledger exists to
  prevent. Add a timer behaviour to the shared files, never to one session
  type.

What is deliberately **not** shared yet: the session headers themselves (the
retro's carries the tips and counts different things, and both are pinned by the
header-fit e2e at five widths) and the close screens. Both headers render the
same `SessionTimer` and use the same breakpoints; bring the rest together with
that test in hand.

## Offline / Air-Gapped Deployment

**CRITICAL**: This application is deployed on internal networks where devices (especially mobile phones on corporate Wi-Fi) have **no internet access**. All resources must be self-hosted.

### Rules
- **NEVER load resources from external URLs** — no CDNs, no Google Fonts, no external APIs, no remotely hosted images, sounds, or scripts
- **All static assets** (fonts, images, sounds, icons) MUST be placed in the `public/` directory and referenced with absolute local paths (e.g. `/fonts/...`, `/assets/...`)
- **All npm dependencies** used in the frontend are bundled by Vite at build time — this is fine and works offline
- **No external service calls from the frontend** — if a feature needs an external API (e.g. QR code generation), use a client-side library instead

### Current Self-Hosted Assets
| Asset | Location | Purpose |
|-------|----------|---------|
| Material Symbols font | `public/fonts/material-symbols-outlined.woff2` | Icon font for all UI icons |
| Timer alert sound | `public/assets/timer-alert.mp3` | Audio notification when a retrospective or health check timer ends |
| Background texture | `public/assets/cubes.png` | Decorative pattern on login page |

### When Adding New Features
1. **Check for external resource dependencies** — if a new library or feature loads something from the internet, find an offline alternative
2. **If you need a new icon** that isn't rendering, the Material Symbols woff2 file may need to be updated — re-download from Google Fonts and replace `public/fonts/material-symbols-outlined.woff2`.
   ⚠️ **That file is a *static* cut with no `FILL` axis**, so it cannot draw a
   filled variant of anything: `star`, `star_border`, `star_outline` and `grade`
   all resolve to the same outlined glyph in it, which is why
   `components/common/StarRating.tsx` is an inline SVG path rather than a
   `<span className="material-symbols-outlined">`. That is the exception, not a
   new convention — an inline path is as offline-safe as the font, but reach for
   it only when the font genuinely cannot draw the thing. Swapping in the
   variable font to recover `FILL` would replace a shared asset every screen
   depends on; check what that costs before proposing it
3. **QR codes** are generated client-side using the `qrcode` npm package — no external API needed
4. **Test with network disabled** — verify that the feature works with no internet access

## Internationalisation (EN/FR)

The interface speaks **English and French**, for the facilitator on the
dashboard and for every guest in a session. Two independent choices exist, and
keeping them apart is the design:

| | Interface language | Template language |
|---|---|---|
| Decides | every label, button, message the screen shows | a retro's column titles and icebreaker question |
| Chosen by | each person, per browser | the facilitator, per retrospective |
| Default | the browser's preference (`navigator.languages`), then the switcher's last choice | the team's previous retro, else the facilitator's interface language |
| Stored | `localStorage` (`retro-language`) — never on the team | on the session (`RetroSession.templateLanguage`) |

Two people in the same retro can read the screens in different languages; the
board content is the same for both. A French-speaking facilitator can run an
English retro and the reverse.

**Chrome versus content — the rule that decides where a string goes.**
Interface text (chrome) goes through `t()` and follows the reader. Text that is
*written onto the session* — template column titles, the icebreaker question —
is content: it lives in `i18n/content/` in both languages, is picked by the
template language, and is never passed through `t()`. Health check templates are
content that already exists in both languages (`team_health_en` /
`team_health_fr`) and are not translated. Anything a user types is data.

**How it is built — no i18n library, on purpose.** Two languages and an offline
deployment do not justify a runtime dependency. `i18n/I18nContext.ts` exposes
`useTranslation()` → `{ t, tp, tRich, language, locale }`:

- `t('ns.key', { param })` — `{param}` placeholders;
- `tp('ns.key', count)` — `ns.key_one` / `ns.key_other` through
  `Intl.PluralRules` (French reads 0 as singular, English does not);
- `tRich('ns.key', { name: <strong/> })` — a sentence that wraps markup. Never
  concatenate translated fragments around markup: French word order differs;
- `locale` — for `toLocaleDateString(locale)` and `Intl` formatting.

Without a provider every component renders English, which is what keeps the
unit tests that render a component alone valid. Pure helpers (no React) that
build visible text take a trailing `t: Translator = enT` parameter.

**Dictionaries are one file per namespace and language**
(`i18n/locales/{en,fr}/<ns>.ts`), assembled in `i18n/messages.ts`. Four rules:

- The French file is typed `Record<keyof typeof en, string>`, so a key missing
  on either side fails `npm run type-check`.
- Every key starts with its namespace (`dashboard.newRetro.title`), and
  `__tests__/i18nDictionaries.test.ts` checks it — the spread in `messages.ts`
  would otherwise let one namespace silently overwrite another — along with
  identical `{placeholders}` in both languages and no empty message.
- **A new user-facing string needs both languages in the same change.** French:
  formal *vous*, sentence-case titles, and the glossary already used
  (rétrospective, bilan de santé, facilitateur, carte, tableau de bord, modèle…)
  — read the namespace you are adding to before inventing a term.
- Errors the data layer throws stay English (tests and logs pin them) and are
  translated where they are displayed, through
  `i18n/errorMessages.ts → translateErrorMessage(err.message, t)`. A new
  message thrown by `services/dataService.ts` that a screen shows needs an entry
  there.

**Content is written in the template language, by every client.** A string a
client writes *onto the session* — the "Re: …" context of an action, a new
column's title, a random icebreaker — goes through
`createTranslator(session.templateLanguage)` (`contentT` in `Session.tsx`),
never the writer's `t`. Otherwise a French facilitator leaves French on an
English retro's board for every participant, and the context text, which is
stored on the action, stays in the writer's language for good. Content is
marked with `lang` in the session (column titles, the icebreaker question) so
a screen reader pronounces it correctly when it differs from the page.

**A stored language is data, not a `Language`.** `templateLanguage` is read
back from retros another pod wrote during a rolling update (a later release may
add a language) or that any team-credential holder posted to
`/api/team/:teamId/retrospective/:retroId`. Narrow it with `toLanguage()` at
every read; the content helpers already fall back to English for an unknown
code, because a throw during the dashboard's first render blanks it for the
whole team (there is no error boundary). A retro with **no** language predates
the feature and reads as English, both in the session and as the next retro's
default.

**A message on screen is stored as what to say, never as the sentence.** The
language switcher stays usable while a validation error or a "saved"
confirmation is visible, so a translated string kept in state would stay in the
old language while the rest of the screen changes. Keep `i18n/notice.ts`'s
`Notice` (a key and its params, or a raw data-layer error) and translate with
`noticeText(notice, t)` when rendering — the Dashboard settings and the login
screen work this way.

**Formats follow the reader's regional settings.** Dates and decimal marks use
`locale` (`intlLocaleFor`), which keeps the browser's regional variant of the
interface language: an en-GB reader sees 06/10/2026, an en-ZA reader 3,5. That
was a deliberate change from the hard-coded en-US some screens used. Scores go
through `i18n/formatNumber.ts → localizeDecimal`, one helper for every screen.
A malformed browser tag (`fr_CH`) is canonicalised before it reaches `Intl`,
which throws on it. Raw server codes the screens used to print (`reset_failed`,
`login_failed`…) now read as sentences in English too.

**French typography is part of the translation.** U+202F before `? ! ;` and
U+00A0 before `:` and inside « » — written as `\u202f` / `\u00a0` escapes so
they stay visible in review. A breaking space lets the mark wrap onto a line
of its own; `i18nDictionaries.test.ts` refuses one, and `emailLanguage.test.ts`
does the same for the French mails. In tests, `getByText`
normalises those spaces in the element but `getByRole({ name })` does not, so a
role query on a French name needs the real characters. Matching a stored
built-in string (`localizeIcebreaker`, `isBuiltInIcebreaker`) ignores the kind
of space, because retros saved before the no-break spaces hold the same
question with an ordinary one.

**Headers are measured, not eyeballed.** French labels run about a quarter
longer than English ones. In the session headers the phase bar is the part that
gives way (it shrinks, scrolls, and brings the current phase back into view when
the phase, the window size or the language changes); the back arrow sits in a
protected `min-w-9` group, the right-hand cluster is `shrink-0`, and secondary
controls appear at staggered breakpoints, the same in both session headers
since both carry the timer (the "live" chip from 400px, the initials from `sm`,
timer +30/+1 and the retro's tips button from `md`, the user's name and the
captions of the tips and participants chips from `2xl`). `e2e/i18n.spec.ts` →
*headers fit in both languages* asserts it for the dashboard, retro and health check headers
and the administration console's title row (the e2e server sets a test-only
`SUPER_ADMIN_PASSWORD` in `playwright.config.ts` to reach it) at
320, 390, 768, 1024 and 1280px in both languages: no horizontal overflow, the
switcher, the invite/logout control and the timer's play button in view (with the timer set to 99:59, its widest), the back arrow the element
actually hit at its centre (a right-edge check passed while the timer covered
it), the active phase in view, and the whole phase bar from 1280px. Three
things about that test are load-bearing:

- **It re-renders, it does not reload.** The headers read `window.innerWidth`
  while rendering, so each width needs a fresh render; switching the language
  gives one with no request. A reload per width spent about 80 of the 120
  `/api/team/*` reads one IP may make per minute, and the invite specs that run
  next in CI were refused their invite link.
- **It renders in DejaVu Sans.** The app asks for Inter, which a developer
  machine may have installed and CI does not; CI's wider fallback overflowed by
  a pixel where the local run had 19 to spare. Pinning the wide font makes the
  test measure the same thing everywhere.
- **Leave headroom.** A header that fits DejaVu Sans by a few pixels fits the
  narrower fonts phones and laptops use, but not by much; extend the test when a
  control joins a header.

**Both dictionaries are bundled.** About 16 kB gzipped per language, kept
static so a switch is synchronous and works offline with no extra request. A
third language should be loaded with a dynamic `import()` instead (a
same-origin hashed chunk, allowed by the CSP).

**What crosses to the server.** `/api/send-invite` and
`/api/send-password-reset` take an optional `language` (the sender's interface
language, read by `dataService` through `getActiveLanguage()`); the mail is
written in it by `server/services/emailTemplates.js`, and anything that is not a
supported code reads as English. Mails to the super administrator stay English.
`templateLanguage` is protected by `sessionGuard.js` like `columns`: it decides
which list "Random" draws icebreakers from. The super-admin console is
translated like every other screen (namespaces `admin` for its shell and
`adminTeams` / `adminFeedbacks` / `adminLive` / `adminLogs` / `adminBackups`
for its tabs) and carries the language switcher in its header; the server log
lines it shows are English machine text and carry `lang="en"`.

**"What's New" is content with a file of its own.** `CHANGELOG.md` is the
list of releases and stays English; `CHANGELOG.fr.md` mirrors it in French,
and the modal shows the French bullets to a French reader, falling back to the
English ones (marked `lang="en"`) for a release that has none. The rules for
writing it are in *Changelog Management → The French mirror*.

**Accessibility.** `<html lang>` follows the interface language (WCAG 3.1.1),
and the language switcher names each option in its own language with `lang`
(3.1.2) — see `ACCESSIBILITY.md` → *Languages*. A column title or icebreaker
question carries the template's `lang` **only when the app wrote it**
(`isBuiltInColumnTitle`, `isBuiltInIcebreaker`): one the facilitator typed may
be in any language, and marking it with the template's would have a screen
reader read an English sentence with French phonetics.

**Tests.** Playwright pins `locale: 'en-US'` in both configs, because the
interface follows the browser and a runner with a French locale would otherwise
turn every English selector red; `e2e/i18n.spec.ts` opts into `fr-CH`
explicitly. Each translated area carries an `__tests__/i18n<Area>.test.tsx`
rendering it under `<LanguageProvider initialLanguage="fr">`.

## Language & Code Conventions

### Language
- **Code**: All code, comments, variable names, and function names MUST be in **English**
- **UI text**: The interface is **bilingual, English and French** (see *Internationalisation* below). English is the source language: every user-facing string is written in English in `i18n/locales/en/` and translated in `i18n/locales/fr/`, and reaches the screen through `t()` — never as a literal in JSX
- **Documentation**: All documentation (README, CHANGELOG, comments) MUST be in **English** — with two exceptions: `CHANGELOG.fr.md`, the French mirror of `CHANGELOG.md` that French readers see in "What's New" (see *Changelog Management → The French mirror*), and the English/French catalogue descriptions in `publiccode.yml`

### File Size Guidance
- LLMs struggle with very large files; prefer clean decomposition into smaller, focused modules instead of long single files.

### Code Style
- Use TypeScript strict mode
- Follow existing code patterns in the codebase
- Use functional React components with hooks
- Use Tailwind CSS for styling (follow existing class patterns)
- No external UI component libraries - use native HTML + Tailwind

### File Organization
```
/
├── components/          # React components
│   ├── common/         # Shared UI primitives (ModalDialog — see Accessibility)
│   └── jira/           # Jira controls, settings card and status hook (see Jira)
├── i18n/               # EN/FR interface dictionaries, language detection, bilingual retro content
├── services/           # Business logic (dataService, syncService)
├── __tests__/          # Test files
├── loadtest/           # Load-test harness (see loadtest/README.md)
├── .github/workflows/  # CI/CD pipelines
├── k8s/                # Kubernetes manifests
├── server/             # Backend modules (routes, services, config)
├── server.js           # Express backend
├── App.tsx             # Main React app
├── types.ts            # TypeScript interfaces
├── publiccode.yml      # Swiss open-source catalogue metadata (English and French)
├── VERSION             # Current version (X.Y format)
├── CHANGELOG.md        # Release notes (shown in "What's New")
├── CHANGELOG.fr.md     # The same release notes in French
└── ACCESSIBILITY.md    # Public accessibility statement (standard, method, gaps)
```

## Version Management

> ⚠️ **AI assistants get versioning and the changelog wrong most often.** Read
> the golden rule below and follow it exactly — do not improvise version numbers
> or invent extra changelog entries.

### The golden rule (VERSION ⇄ CHANGELOG)

One question decides **both** files: **is the change visible to end users?**

- **Yes — user-visible** (new feature, UX/behaviour improvement, removed
  feature): bump the **major** `X`, reset `Y` to `0`, **and** add exactly
  **one** consolidated CHANGELOG entry — plus its French counterpart in
  `CHANGELOG.fr.md`, in the same change.
- **No — internal / not user-facing** (bug fix, **security patch**, refactor,
  tests, docs, CI/CD, Docker/deploy, dependency bump, version bookkeeping): bump
  the **minor** `Y`, keep `X`, and add **no** CHANGELOG entry.

In other words: **a CHANGELOG entry exists if and only if you bumped `X`.** A bug
fix or a security patch bumps `Y` and is *never* written in the changelog — the
user cannot see it, so it does not belong in the user-facing "What's New".

### VERSION file

- Located at the repo root: `VERSION`. Format is `X.Y` (current example: `24.0`).
- **Read the current value first**, then move by exactly one step:
  - User-visible change → `X+1` and `Y=0` (e.g. `23.4` → `24.0`).
  - Internal change → `Y+1`, keep `X` (e.g. `23.4` → `23.5`).
- Never skip or invent numbers, never jump more than one step, never pick a
  number because it "looks nicer".
- One unit of work / pull request = **one** version bump, no matter how many
  files it touches. Bundle several user-visible changes into the same next `X`.
- Keep `publiccode.yml`'s `softwareVersion` equal to `VERSION` in the same change.
  The release workflow publishes that version when `VERSION` changes on `main`,
  including internal and documentation changes, so catalogue metadata must
  describe the version the merge will publish.
- The Docker deploy action reads `VERSION`, so every deployable change needs a
  bump (user-visible → `X`, internal → `Y`).
- ⚠️ **Those two rules meet as soon as a version has been deployed, and the
  second one wins.** "One pull request = one bump" describes a branch nobody has
  released yet. The moment a version is built and deployed — which is how the
  maintainer tests a branch before merging it — that number is spent: pushing
  more commits without a further bump makes the deploy action produce the *same
  image tag*, so the new work is untestable and the previous image is silently
  overwritten. So **once a branch has been deployed, every subsequent push that
  is meant to be deployed bumps `Y` again** (`31.1` → `31.2` → …), still with no
  CHANGELOG entry while `X` is unchanged. Do this without being asked: the
  maintainer should never have to request a bump so they can redeploy.
- **A major bump also retags the Kubernetes base manifest.**
  `k8s/base/deployment.yaml` pins the image tag, and **you** rewrite that line —
  decision D7 deleted the auto-commit step that used to do it (it had never once
  executed, and it would have pushed to whatever branch the deploy was dispatched
  from). So the tag lags `VERSION` by the `Y` bumps since the last retag, which is
  fine: `__tests__/deploymentManifestParity.test.ts` only fails when the *majors*
  diverge — the tag had been left 17 majors behind, advertising an image that
  predated many user-visible releases. A `Y` bump needs nothing; an `X` bump
  should retag the manifest in the same pull request.

## Changelog Management

### CHANGELOG.md Format
The changelog follows [Keep a Changelog](https://keepachangelog.com/) format and is **automatically parsed** by the backend to display announcements to users.

Each released version is **one** `## [X.Y]` block with **one** `###` section and
**one** consolidated bullet:

```markdown
## [X.Y] - YYYY-MM-DD

### Added
- One sentence describing everything new in this version, from the user's point of view
```

The only sections to use for new entries are `### Added`, `### Changed` and
`### Removed`. Do **not** create `### Fixed` or `### Security` entries — bug
fixes and security patches are not user-visible, so they bump `Y` only and stay
out of the changelog (see rules below).

### Changelog Rules — the three that matter most

1. **Exactly ONE entry per version, and ONE bullet.** A release is a single
   `## [X.Y] - YYYY-MM-DD` block with a single `###` section containing **one**
   consolidated bullet that summarises *all* the user-visible changes of that
   version. Never write multiple bullets, and never add multiple `###` sections,
   for the same version — the goal is one readable sentence, not a list of
   technical changes.
2. **Never document bug fixes or security patches.** There is **no `### Fixed`
   or `### Security` entry, ever.** Bug fixes, security patches, refactors,
   tests, docs, CI, deps and deployment config are not user-visible: they only
   bump `Y` and stay out of the changelog entirely.
3. **Every entry has its French counterpart in `CHANGELOG.fr.md`, in the same
   change.** See *The French mirror* below; a test fails the pull request that
   forgets it.

Plus the usual style rules:

3. **Only user-visible changes** - the changelog is displayed to end users in the app
4. **Write from the user's perspective, in present tense** - "Add dark mode", not "Added/Implemented dark-mode feature"
5. **Keep it concise** - 1-2 sentences, no technical jargon or implementation detail
6. **Most recent version at the top**
7. **Choose the single section that fits the release** - `### Added` for a new feature (most common), `### Changed` for improvements to existing behaviour, `### Removed` for a removed feature. If a version mixes a feature with smaller tweaks, use `### Added` and fold them into the one bullet.

### The French mirror (`CHANGELOG.fr.md`)

French readers see "What's New" in French, so every `## [X.Y]` block of
`CHANGELOG.md` has a twin in `CHANGELOG.fr.md`:

- **Same version, same date, same section keyword.** The `### Added` /
  `### Changed` / `### Removed` headings stay in English in the French file:
  they are machine keys the parser maps to an announcement type, not text a
  reader sees.
- **Same number of bullets, in the same order**, each one a faithful French
  sentence: formal *vous*, present tense, the user's point of view. A button,
  phase or tab is named exactly as the French screen shows it — look its label
  up in `i18n/locales/fr/`.
- **Write ordinary spaces** before `? ! : ;` and inside « ». The server
  (`server/services/versionService.js`) inserts the French no-break spaces when
  it parses the file, so authors never type an invisible character.

`/api/version` keeps the English `items` on every announcement — what a client
from before this feature reads during a rolling update — and adds
`localized.fr.items` when the French file has that release. A release missing
from the French file therefore never breaks the modal; it shows in English,
marked `lang="en"`. Completeness is the test's job:
`__tests__/changelogTranslationParity.test.ts` fails when an English release has
no French twin, when the dates, sections or bullet counts differ, when a French
bullet is the English one copied over, or when the French file names a release
the English file does not have. Both files ship in the image (`Dockerfile`,
`.dockerignore`).

### What belongs in the CHANGELOG

| ✅ Document it (and bump `X`) | ❌ Never document it (bump `Y` only) |
|------------------------------|--------------------------------------|
| New user-facing features | Bug fixes |
| UI/UX improvements | Security patches / fixes |
| Removed user-facing features | Internal refactoring (no user impact) |
| | Tests, docs, code comments |
| | GitHub workflow / CI-CD changes |
| | Docker / deployment configuration |
| | Code style / linting fixes |
| | Version & changelog bookkeeping |
| | Dependency updates |

### Section Mapping (for announcements)
| CHANGELOG Section | Announcement Type | Icon Color |
|-------------------|-------------------|------------|
| Added | New Feature | Green |
| Changed | Improvement | Blue |
| Removed | Removed | Gray |
| Fixed | Bug Fix | Amber |
| Security | Security Update | Red |

> `Fixed` and `Security` are listed only so the parser keeps rendering any
> legacy entries. **Do not create new `Fixed` or `Security` entries** — per the
> rules above, bug fixes and security patches are not user-visible and are never
> documented.

## Development Workflow

### Before Starting Work
1. Read the existing code to understand patterns
2. Check `types.ts` for data structures
3. Review similar existing features for patterns
4. If you change retrospective guidance or timebox suggestions, keep `components/session/retroTips.ts`, the related tests, and the automatic phase timer defaults aligned with the intended session flow. A health check's phase timeboxes are `HEALTH_CHECK_PHASE_TIMER_SECONDS` in `utils/sessionTimer.ts`, pinned by `__tests__/sessionTimer.test.ts`. Any value up to 99:59 fits both headers: the header-fit e2e measures them with the timer set to 99:59

### When Fixing a Bug (TDD Approach)
1. **Write a failing test first**: Reproduce the bug with a unit test or e2e test that fails, confirming the bug exists
2. **Fix the issue**: Follow existing patterns to make the failing test pass
3. **Verify the test passes**: Run the test suite to confirm the fix works
4. **Update VERSION**: Increment `Y` only (e.g. `23.4` → `23.5`); never touch `X`
5. **Do NOT touch CHANGELOG.md**: Bug fixes are never documented in the changelog

### When Adding a New Feature (TDD Approach)
1. **Write a failing test first**: Define the expected behavior with a test that fails because the feature doesn't exist yet
2. **Implement the feature**: Write the minimum code to make the test pass
3. **Refactor if needed**: Clean up the implementation while keeping tests green
4. **Update VERSION**: Increment `X`, reset `Y` to `0` (e.g. `23.4` → `24.0`)
5. **Update CHANGELOG**: Add exactly one `## [X.Y]` block with a single consolidated bullet under `### Added` (see the Version & Changelog golden rule), and its French twin in `CHANGELOG.fr.md`

### Before Committing
**CRITICAL**: Ensure that all GitHub CI checks will pass before committing. Run the full CI pipeline locally using `npm run ci` (which runs lint + type-check + test + build). The CI workflow (`.github/workflows/ci.yml`) also runs test coverage and a security audit, so verify those as well:
1. **Run linting**: `npm run lint` — a **two-way** warning ratchet
   (`scripts/lint.mjs`, decision D6). It fails if the warning count rises *and*
   if it falls: when you remove warnings, lower `BUDGET` in that file in the
   same change, otherwise the freed slots are silently spent by the next
   warning to appear. Errors always fail, budget or not.
2. **Run type check**: `npm run type-check`
3. **Run tests with coverage**: `npm run test:coverage`
4. **Run build**: `npm run build`
5. **Run security audit**: `npm audit --omit=dev --audit-level=high` (production dependencies only)
6. **Run e2e tests**: `npm run test:e2e` (end-to-end tests with Playwright)
7. **Run the production CSP gate**: `npm run test:e2e:prod` — required whenever
   you touch `server/services/securityHeaders.js`, `index.html`, or add any
   asset/connection the app loads at runtime. `npm run test:e2e` cannot catch a
   CSP regression: it loads the app from Vite, not from `server.js`
8. **Accessibility ratchets down, never up — and `BASELINE` is now at zero.**
   `npm run lint` carries `eslint-plugin-jsx-a11y` findings inside its two-way
   budget (`scripts/lint.mjs` is the authority: its `BUDGET` and its header
   carry the current figure and composition — no number is repeated here, so
   it cannot go stale), and
   `e2e/accessibility-audit.spec.ts` caps the serious/critical
   WCAG rules axe-core reports on ten screens (two of them **dark**) — **at 0
   since 2026-08-25** — `e2e/jira.spec.ts` on the seven Jira screens, at 0
   since they joined (2026-10-20), and `e2e/admin-team-restore.spec.ts` on the
   console's backup import card (41.0), so
   any new serious or critical rule on those screens fails the pull request.
   Both run `audit()` from `e2e/helpers/axe.ts`, which holds the one
   `BASELINE` table; a screen joins it at 0, and a card added to a screen the
   audit never walked is audited on its own (`{ scope }`), so it neither
   carries that screen's findings nor hides them — list them in
   `ACCESSIBILITY.md` instead.
   When a fix removes a finding, **lower the number in the same change** —
   `BUDGET` in `scripts/lint.mjs`, `BASELINE` in the helper. Never raise either to
   make a change pass: a new accessibility violation is a defect like any other.
   Note the spec counts *rules*, not nodes, on purpose (node counts moved with
   how many teams the test server happened to hold); the node counts are printed
   for review. `ACCESSIBILITY.md` is the public statement — what is claimed,
   what is tested, and what is knowingly missing; keep it true when you change
   the UI

Or use the shorthand: `npm run ci` (lint + type-check + test + build) then `npm run test:coverage`, `npm audit --omit=dev --audit-level=high`, and `npm run test:e2e` separately.

**IMPORTANT**: If your changes impact user-facing behavior (UI, interactions, workflows), you MUST also update the e2e tests in the `e2e/` directory to reflect those changes. E2e tests must pass before committing.

### After Opening a Pull Request

Do not consider a PR done the moment it is pushed. You MUST watch it through to a
green state and address automated feedback:

1. **Wait for and read every CI check**, not just the unit-test job. This repo runs
   `Lint, Type-Check & Test` (on multiple Node majors), `Build Production`,
   `Security Audit`, **CodeQL code-scanning**, and a **Docker image vulnerability
   scan**. A red CodeQL or security check blocks the PR just like a failing test —
   investigate the specific alert (file + line + rule id) and fix the root cause.
2. **Read and act on automated bot review comments** — CodeQL /
   `github-advanced-security`, the Codex reviewer (`chatgpt-codex-connector`),
   Dependabot, etc. For each finding: fix it if it is a real issue, or, if it is a
   false positive, say why (in a brief reply and in `HARDENING_STATUS.md`) and get
   it dismissed rather than silently ignored. There is repo precedent for
   dismissing documented CodeQL false positives — but never restructure code *only*
   to silence a scanner without understanding the alert.
   **Always leave a traceability reply on every bot finding** — fixed *or*
   dismissed — directly on its review thread, stating what was done and pointing
   to the fixing commit and the regression test (e.g. "✅ Addressed in
   `<commit>` — <one-line what changed>; test: `<file> › <test name>`"). Do NOT
   rely on GitHub's "outdated" marker as the signal that a comment was handled:
   "outdated" only means a later commit rewrote the exact diff lines the comment
   was anchored to — a finding can be fully fixed yet not show "outdated" (the
   anchored lines survived the fix), or show "outdated" while ignored (the lines
   changed for unrelated reasons). The human reviewer must be able to see at a
   glance, from the reply on each thread, that every bot finding was consciously
   handled.
3. **Re-run the full local suite before pushing a fix**, not just the files you
   touched: a change in one route (e.g. an auth handler) can break another suite's
   mock. `npm run test` runs all 64 files; do not push after re-running only a
   subset.
4. **Keep pushing until CI is green and bot findings are resolved or explicitly
   dismissed with a rationale.** A pushed-but-red PR is not finished.

### Keep This File Current
- After any change to the project, review and update `AGENTS.md` so it stays accurate and up to date.

## Testing Requirements

- **Always run tests** before committing: `npm run test`
- **`eslint-plugin-jsx-a11y` needs its `overrides` entry to install.** Its
  latest release declares `peer eslint ^3 || … || ^9` while this repo runs
  ESLint 10, so `package.json` carries
  `"overrides": { "eslint-plugin-jsx-a11y": { "eslint": "$eslint" } }` — the
  same pattern `eslint-plugin-react-hooks` already uses. Without it **`npm ci`
  fails**, in CI as well as locally. Do not "fix" that with `--legacy-peer-deps`
  or an `.npmrc`: those disable strict resolution for every dependency and would
  absorb a real conflict silently
- **Add tests** for new functionality in `__tests__/` directory
- **Test naming**: `*.test.ts` or `*.test.tsx`
- **Framework**: Vitest + React Testing Library

### Regression coverage (leave a durable guard, not a throwaway)

Every bug fix, refactor, or feature MUST leave behind at least one **committed**
automated test that fails without the change — this is the safety net that
shrinks future manual regression testing, so never write a test just to verify a
change and then delete it. (A quick, temporary reproduction harness is fine as a
first step, but promote its assertion into a permanent test before finishing;
don't leave the reproduction as the deliverable.)

- **Pick the cheapest level that catches the regression.** Prefer a fast unit
  test (Vitest) that pins the logic/edge case; only reach for e2e (Playwright)
  when the change alters an integrated user-facing flow. Do not add e2e coverage
  for something a unit test can guard.
- **Report, per change, so manual testing stays minimal and non-redundant:**
  1. the **new/updated tests** that prove the change,
  2. the **existing tests** that already cover the touched area (so the human
     does not re-test it by hand),
  3. a short **manual-verification list** — only what automated tests genuinely
     cannot cover (visual/layout, real offline/mobile behaviour, real LLM output
     quality, multi-pod Socket.IO timing).
- **Load / scale validation**: `npm run test:load` (`loadtest/` harness) drives
  many parallel retros with many concurrent users over the real HTTP +
  Socket.IO protocol and audits that no user action is lost. Run it against a
  staging environment before changing the session sync protocol
  (`update-session` / `_rev` CAS) or before a capacity-sensitive rollout —
  see `loadtest/README.md` for the strategy and presets

## Commit Message Convention

Use conventional commits for clarity:

```
feat: Add dark mode toggle to settings
fix: Resolve timer sync issue in retrospectives
improve: Optimize session loading performance
docs: Update README with deployment instructions
refactor: Simplify vote counting logic
test: Add tests for health check session
```

**Prefix meanings** (note: only `feat:` and `improve:` add a changelog entry):
- `feat:` → New feature (bump VERSION `X`, one CHANGELOG `### Added` entry)
- `improve:` → User-visible enhancement (bump VERSION `X`, one CHANGELOG `### Changed` entry)
- `fix:` → Bug fix (bump VERSION `Y`, **no CHANGELOG entry**)
- `security:` → Security patch (bump VERSION `Y`, **no CHANGELOG entry** — not user-visible)
- `refactor:` → Code refactoring (bump VERSION `Y`, no CHANGELOG entry)
- `docs:` → Documentation only (bump VERSION `Y`, no CHANGELOG entry)
- `test:` → Adding/updating tests (bump VERSION `Y`, no CHANGELOG entry)

## Docker & Deployment

### Configuration Parity
When adding, removing, or changing an environment variable, keep all deployment
surfaces aligned in the same change:
- `.env.example` for local/self-hosted configuration examples
- `README.md` and the Environment Variables list in this `AGENTS.md`
- `k8s/base/deployment.yaml` for non-secret/default runtime values
- `k8s/secrets-templates/*.yaml` for secret-backed values
- `k8s/README.md` for Kubernetes/OpenShift operator guidance

A change that opens a **port** or a **network path** has one more surface:
`k8s/base/networkpolicy.yaml`, since the namespace denies ingress by default.

Do not update `.env.example` alone. If a variable is not relevant to Kubernetes,
state why in the PR or commit notes instead of silently skipping the k8s files.

**This rule is now machine-checked.** `__tests__/deploymentManifestParity.test.ts`
holds the parity contract as data: every variable the server reads must be listed
there, and mentioned on every surface it is not explicitly excused from — where
an exemption is a written reason, not a flag. Adding a knob therefore fails the
suite until either the surfaces are updated or the absence is argued for. The
same suite checks that the base image tag has not fallen behind `VERSION`'s major
and that every kustomize overlay patches resource names that actually exist in
`k8s/base` (both `dev` and `prod` had been silently broken by a renamed
Deployment) — and, since H40/H46, the platform posture described below.

### Platform manifests (audit H40, H46)

Three rules that look like details and are not. Each one, got wrong, produces a
**silent** failure: a database that starts empty, a pod the platform refuses, or
an application off the network with nothing in the logs that names the cause.

- **The database's `runAsUser` belongs to its image, not to taste.**
  `postgres:15-alpine` creates its account with UID/GID **70**; the Debian
  variants use **999**. `initdb` calls `getpwuid()` and refuses a UID with no
  passwd entry, so changing the image without the UID stops the database from
  starting. The parity suite checks the pair. The UID is also what lets the
  container drop **all** capabilities: `docker-entrypoint.sh` re-execs through
  `gosu` when it starts as root, and `gosu` needs `CAP_SETUID`/`CAP_SETGID` —
  so `drop: [ALL]` and a root start cannot both be true.
- **`PGDATA` is a subdirectory of the mount, never the mount root.** An ext4
  PersistentVolume arrives with a `lost+found` at its root and `initdb` refuses
  a non-empty directory; `fsGroup` makes the root group-writable and `initdb`
  refuses that too. ⚠️ Changing this back — or forward, on a volume that already
  holds a cluster — makes PostgreSQL initialise an **empty** cluster beside the
  data. `k8s/README.md` → *Moving PGDATA on an existing volume* is the operator
  procedure; link it from any PR that touches the value.
- **The NetworkPolicies are opt-in and `apply -k` must not install them**
  (decision D21) — `k8s/base/kustomization.yaml` deliberately omits the file and
  a test asserts that absence. **A NetworkPolicy cannot deny anything:** the
  model is a union of allows, so a "default deny" works only by being the sole
  policy selecting a pod. The Geneva project carries two platform-applied
  allow-all policies, which made ours inert — proven with a probe, not assumed.
  Installing them there would be worse than installing nothing, because an
  auditor reads three policies and concludes the database is isolated. Before
  adding a policy anywhere, ask **"what NetworkPolicies already exist in this
  namespace, and what do they select?"** — a co-tenant workload is harmless, a
  co-tenant *policy* silently voids yours. They also restrict ingress only: a
  default-deny covering egress takes DNS out first, then SMTP, Redis and the LLM
  endpoint fail quietly one by one because each is optional.

- **TLS on an Ingress is two things, not one.** A `tls:` block offers HTTPS; on
  most controllers the same host keeps answering plain HTTP, so a password still
  crosses the network in clear text. `k8s/base/ingress.yaml` therefore also
  carries `nginx.ingress.kubernetes.io/ssl-redirect`, which is **ingress-nginx's
  and silently ignored by every other controller** — `k8s/README.md` → *TLS*
  lists the equivalents. Both halves are asserted.

**Verify manifest changes offline before landing them.** `kustomize` and
`kubeconform` are single binaries; `k8s/README.md` → *Validating the manifests
without a cluster* has the three commands. They catch a stale patch target and a
malformed policy. They cannot tell you whether the SCC admits the pod or whether
the CNI enforces a policy — those need a non-production project, and that
rollout is the standing item in `HARDENING_STATUS.md` §6 (lot L19b).

### Files to Include in Docker
The following files MUST be included in the Docker image (check `.dockerignore`):
- `VERSION` - For version API
- `CHANGELOG.md` - For announcement system
- `CHANGELOG.fr.md` - The French "What's New" (without it French readers silently get English)
- `server.js` - Backend
- `dist/` - Built frontend

### Environment Variables
See `README.md` for full list. Key ones:
- `PORT` - Server port (default: 3000)
- `DATABASE_URL` - PostgreSQL connection URL (if set, uses PostgreSQL instead of SQLite)
- `POSTGRES_HOST` / `POSTGRES_PORT` / `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` - the same connection as discrete values, used when `DATABASE_URL` is unset (what `k8s/base/deployment.yaml` supplies from the PostgreSQL Secret). Each has a fallback alias, consulted only when the `POSTGRES_*` value is unset, and they are **not** equally useful: `POSTGRESQL_SERVICE_HOST` / `POSTGRESQL_SERVICE_PORT` really do resolve on their own (Kubernetes injects `<SERVICE>_SERVICE_HOST`/`_SERVICE_PORT` for every Service in the namespace, and the bundled Service is named `postgresql`), whereas `POSTGRESQL_USER` / `POSTGRESQL_PASSWORD` / `POSTGRESQL_DATABASE` — the Red Hat PostgreSQL image's own names — are set by the OpenShift overlay on the **database container only** and never reach the application container. Credentials must still come from the Secret; do not document these as a way to skip it
- `DATA_STORE_PATH` - SQLite database path (used when DATABASE_URL is not set)
- `SUPER_ADMIN_PASSWORD` - Enable super admin panel
- `SESSION_TOKEN_SECRET` - Stable HMAC signing secret for team and super-admin session tokens **and invite-link credentials** (stage 7e); set the same value on every pod so tokens and newly minted invite links survive restarts and non-sticky routing (falls back to a process-local random secret when unset, in which case new invite links die with the process). **Effectively required for zero-downtime deployments**: `join-session` authenticates with the same token, so without a stable secret a rolling update or a non-sticky route makes every live participant's automatic re-join fail and drops them out of an in-progress session. **Required to store a team's Jira token**: the token is sealed with a key derived from this secret (`deriveKey('jira-token/v1')`), so without one — or with the templates' example value, `change-me-to-a-long-random-secret` or `change-me`, whose key is public (`canSealSecrets`; the pod logs a warning at startup) — the token route answers `503 jira_secret_unavailable`, and rotating it makes every team enter its token again (see *Jira*). Keep it in a secret store, never beside the database dumps: the two together open every team's token
- `SMTP_*` - Email configuration
- `BACKUP_ENABLED` - Enable automatic server-side backups (default: `true`)
- `BACKUP_INTERVAL_HOURS` - Hours between automatic backups (default: `24`); across multiple pods the scheduled `auto` backup is elected via the shared store (each pod skips if another already wrote an `auto` backup within the interval), so `N` pods produce one backup per interval instead of `N`
- `BACKUP_MAX_COUNT` - Max automatic backups to keep (default: `7`)
- `BACKUP_ON_STARTUP` - Create backup on server start (default: `true`)
- `RESTORE_MAX_BODY_MB` - Max compressed/uploaded super-admin restore or import archive size in MB (default: `128`); bounds both the uploaded whole-store restore and the Backups tab's file import, and the console checks a file against it before sending (`/backups/list` → `limits`)
- `RESTORE_MAX_DECOMPRESSED_MB` - Max decompressed restore or import archive size in MB, for uploaded and stored gzip restores and for imported files (default: `512`)
- `WIFI_SSID` - Wi-Fi network name; when set with `WIFI_PASSWORD`, shows a Wi-Fi QR code in the invite modal
- `WIFI_PASSWORD` - Wi-Fi password; both `WIFI_SSID` and `WIFI_PASSWORD` must be set to enable the feature. Served only to an authenticated team (audit H31) — `/api/wifi-config` is a POST requiring a team credential, so setting these does not publish the password to anyone who can reach the deployment
- `AUTH_RATE_LIMIT_MAX` - Max **rejected** `/api/team/create` and `/api/team/restore-session` credentials per IP per 15 minutes (default: `5`). The meter is scoped to `401` responses alone, so nothing a legitimate user does can consume it — a restored session, a page load with no stored token, a team deleted since, a facilitator colliding on an existing team name. This matters because `restore-session` runs on **every page load** for a returning user, so a request-counting limiter locked whole offices out of running retrospectives. It does **not** cover `/api/super-admin/verify`, which has its own separate limiter fixed at 5 wrong passwords per 15 minutes. Counted **per pod**: `express-rate-limit` runs without a shared store, so `N` replicas admit up to `N × AUTH_RATE_LIMIT_MAX` failures per window; a hard cluster-wide ceiling needs the Ingress/WAF or a Redis store
- `PG_POOL_MAX` - Max PostgreSQL connections per pod (default: `10`); raise for high concurrency, keep under `max_connections / pod count`
- `SESSION_CACHE_MAX` - Max live sessions held in each pod's bounded in-memory cache (default: `500`); only bounds memory since session state is always recoverable from the database
- `SOCKET_MAX_BUFFER_SIZE` - Max Socket.IO message size in bytes (default: `1000000`); caps a single client session-update payload
- `SOCKET_UPDATE_RATE` - Sustained `update-session` writes/second allowed per socket via a per-socket token bucket. **Off by default and deliberately off in `k8s/base/deployment.yaml`** (decision D17): this deployment is internal and not internet-facing, so the hostile client the throttle guards against does not exist here, while its cost — a heal round-trip on a legitimate burst — would be paid by real facilitators. Do not turn it on "to be safe". **Enable it when** the app becomes reachable beyond the internal network, or when a runaway client is actually observed saturating the DB write path: set `20` (timer sync is ~1/s per client, so that keeps an order of magnitude of headroom), roll to staging first, watch for heal round-trips. A throttled write is healed with the authoritative state and re-sent, never dropped, so too tight costs a round-trip rather than a user action
- `SOCKET_UPDATE_BURST` - Momentary burst of `update-session` writes allowed above `SOCKET_UPDATE_RATE` (default: `2 × rate`)
- `LAST_CONNECTION_DEBOUNCE_MS` - Minimum interval between refreshes of a team's `lastConnectionDate` on participant join (default: `300000`); prevents a write storm when a whole session reconnects after a rolling update. The refresh is decided again inside the team update, and shared by every join of one team on a pod (`createLastConnectionRefresher` in `socketHandlers.js`), so a burst of joins costs one team write across the cluster; a join reads the roster from the team summary (`loadTeamSummary`), never the full record
- `ROSTER_BROADCAST_DEBOUNCE_MS` - Debounce window (ms) for coalescing session-roster rebroadcasts (default: `250`). Each join/leave otherwise triggers a cross-pod `fetchSockets()` + a full-roster broadcast, so a reconnect stampede is O(N²) messages and N cross-pod fetches; coalescing caps it to at most one rebuild + broadcast per room per window while the immediate `member-joined`/`member-left` signals still drive incremental UI. Unlike the update-session throttle it never drops or delays a user action (only a presence broadcast whose content is unchanged), so it is on by default. Set to `0` for the pre-optimization synchronous broadcast
- `REDIS_URL` (or `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD`) - Redis connection for the multi-pod Socket.IO adapter; when unset, the PostgreSQL adapter is used automatically if PostgreSQL is the data store (single-pod deployments need neither)
- `PUBLIC_BASE_URL` - Canonical public URL of the deployment, used to build the links the server mails. **The origin of a mailed link is always the server's own, never the caller's** (audit H4). **Required to send password-reset email:** that route is anonymous and its mail carries a *live token*, so with no configured origin the only candidate left is the request `Host` — which the same anonymous caller sets. Rather than trust it, `/api/send-password-reset` answers `501 public_base_url_not_configured` and mails nothing. `/api/send-invite` deliberately keeps the `Host` fallback: it is authenticated and the payload it mails is a credential the caller already holds, so a forged `Host` gains an attacker nothing, while failing closed would break invitations everywhere. When set, the configured value wins over the request for both routes (the caller keeps only the query) and a configured sub-path is preserved. On Kubernetes/OpenShift it is supplied per environment by the `retrogemini-config` ConfigMap (`k8s/config-templates/`, applied once like the Secrets so `apply -k` never overwrites it); `k8s/base/deployment.yaml` references it with `optional: true`, which must stay — without it an environment that has not created the ConfigMap could not start its pods at all, turning "no reset mail" into "no application"
- `LOG_FORMAT` - `json` or `text` (default: `json` when `NODE_ENV=production`, `text` otherwise). `json` emits **one line of JSON per log record** — timestamp, level, source, message and `correlationId` — which is what a cluster log aggregator can query; `text` keeps the human-readable console output. The id comes from `server/services/logContext.js`, an `AsyncLocalStorage` context mounted before every route and wrapped around every socket event, so a handler never mentions it and a message logged three awaits deep still names its request. An inbound `X-Request-Id` is adopted **only** when it matches `[A-Za-z0-9._-]{1,64}` — the header is caller-controlled, and while JSON encoding neutralises log injection, nothing else bounds a megabyte of junk being written by the platform's aggregator on every request. Secrets are blanked at that single choke point, before both stdout **and** the in-memory ring the super admin can export: by *value* for the ones the process holds (`SESSION_TOKEN_SECRET`, `SUPER_ADMIN_PASSWORD`, `POSTGRES_PASSWORD`, `SMTP_PASS`, `REDIS_PASSWORD`, `WIFI_PASSWORD`, `DATABASE_URL`, `REDIS_URL`, and only values of 8+ characters, so a variable holding `true` cannot blank that word out of every line), and by *key pattern* for the ones it does not — the operator's LLM key lives in the database, so only the shape of the line gives it away
- `CORS_ORIGIN` - Restrict Socket.IO CORS to specific origin(s) (default: `*`)
- `TRUST_PROXY` - Express `trust proxy` setting for correct client IPs behind a reverse proxy; rate limiting relies on it (default: `1` in production, `false` otherwise)

## Dependabot / Dependency Updates

### Automated Handling
- A GitHub Actions workflow (`.github/workflows/dependabot-auto-merge.yml`) automatically merges Dependabot PRs for **minor and patch** updates when CI passes
- **Major version** updates are flagged with a comment and require manual review due to potential breaking changes

### Manual Review Required For
- **Major version bumps** (e.g., ESLint 9→10, Tailwind 3→4) — check changelogs for breaking changes, update config files as needed
- **PRs with failing CI** — investigate failures, fix locally, and push fixes to the Dependabot branch
- **GitHub Actions major bumps** (e.g., docker/build-push-action v6→v7) — verify workflow compatibility

### When every Dependabot PR is red at once, look at `main` first

`Security Audit` and the Docker image scan judge the **whole** production
dependency tree, not the diff. An advisory published against a package `main`
already ships turns `main` red without a commit — and with it every open PR,
each failing on a package its own diff never touched. Fixing the Dependabot branches one by one cannot work;
the fix is one lockfile update on `main` (`npm update <pkg>` inside the existing
range — engine.io 6.6.9 → 6.6.11 on 2026-10-02). Two details that bite:

- **Regenerate the lockfile with npm 11** (`npx npm@11 …`), the npm Dependabot
  writes with. npm 10 strips the `"libc"` fields npm 11 wrote on the optional
  per-platform binaries it re-resolved (today the six `@rolldown/binding-linux-*`
  entries) — a gratuitous diff that the next npm 11 update puts back.
- **A Dependabot PR's red unit-test leg is not automatically flakiness.** The
  one that failed beside this audit was a real race in `TeamLogin` that had been
  failing on `main` too (see `HARDENING_STATUS.md` §1, 2026-10-02). Its cousin
  is the vacuous wait: `waitFor` on an element of the *first* render waits for
  nothing — wait on the element that depends on the data you are about to use.

### Some dependencies can only move as a set

Two families in this repo are versioned in lockstep, and a bump that arrives one
package at a time is **not a PR to fix, it is a PR that cannot pass**:

- **vitest.** `@vitest/coverage-v8@X` and `@vitest/ui@X` each declare an *exact*
  `peer vitest@"X"`, so while the three differ `npm ci` fails with `ERESOLVE`
  and every job in every workflow goes red behind the install — lint, tests,
  coverage, audit, build, the Docker scan and the e2e suite alike. The npm
  `vitest` group in `.github/dependabot.yml` covers **majors** for `vitest` and
  `@vitest/*` so they arrive in one PR; it is listed first because a dependency
  joins the first group that matches it.
- **`github/codeql-action/*`.** `init`, `autobuild`, `analyze` and
  `upload-sarif` read one shared config and refuse to run against a config
  written by another major: *"Loaded a configuration file for version 'A', but
  running version 'B'"*. Each sub-action is a separate Dependabot update, so the
  `codeql-action` group in the `github-actions` updater — majors included — is
  what makes them arrive as one PR. **The mismatch is not visible in a job
  conclusion**, because `analyze` carries `continue-on-error: true`: the job
  stays green while CodeQL uploads a *failed execution* and produces no alerts
  at all, and the only symptom is a one-second analysis step. So when you bump
  one, bump all of them in the same change, and read the *step* log rather than
  the job result. `__tests__/deploymentManifestParity.test.ts` →
  *codeql-action revision parity* asserts the four agree, which is the guard for
  what the group cannot cover: a hand-edit, a partial revert, or a conflict
  resolved one side at a time.

### Branch Protection Requirement
For auto-merge to work, the repository must have a branch protection rule on `main` that requires status checks to pass. The checks to mark as required are:
- **`CI Success`** — the single stable aggregate gate from `ci.yml` (see below)
- **`E2E Tests (Playwright)`** — from `e2e.yml`, which runs on every pull
  request (decision D5). It used to be gated to `workflow_dispatch` and
  Dependabot, so requiring it here described a check that never reported; the
  gate was removed rather than the instruction, because the React layer has no
  other automated guard.

Without branch protection, `--auto` merge will not wait for checks to pass.

> ✅ **Require the `CI Success` gate, not the individual matrix legs.** `ci.yml`
> ends with a `ci-success` job (context name `CI Success`) that `needs:` every
> other CI job — `lint-and-test` (the whole Node matrix), `build`, and
> `security-audit` — and, via `if: always()`, always reports a status that fails
> unless *every* dependency succeeded. Because the required check is this one
> stable name, **the Node matrix and the rest of `ci.yml` can change freely in a
> PR without ever touching repo settings.** This is deliberate: it keeps CI
> maintenance (e.g. bumping the Node matrix) in developer-controllable workflow
> files instead of admin-only branch-protection settings.
>
> ⚠️ **Never re-pin required checks to per-version legs** (`Lint, Type-Check & Test
> (22.x)`, `(26.x)`, …). A version that is required but later removed from the
> matrix never reports, so GitHub pins the PR at *"Expected — Waiting for status
> to be reported"* forever — which is exactly the trap the `CI Success` gate
> exists to avoid. Editing the required-checks list is a repo-settings action
> (Settings → Branches → the `main` rule → "Require status checks to pass") and
> cannot be done from a PR.

## Common Pitfalls to Avoid

1. **Get VERSION/CHANGELOG right** - User-visible change → bump `X` + **one** consolidated CHANGELOG bullet, and its French twin in `CHANGELOG.fr.md`. Bug fix / internal change → bump `Y` + **no** CHANGELOG entry. Never write a `### Fixed` entry, and never split one version into multiple bullets.
2. **Keep code and docs in English, and every user-facing string in both languages** - Code, comments and documentation are English (the one French document is `CHANGELOG.fr.md`); UI text goes through `t()` with entries in both `i18n/locales/en/` and `i18n/locales/fr/`, never as a literal in JSX
3. **Don't skip tests** - Run `npm run test` before committing
4. **Don't break the build** - Run `npm run build` to verify
5. **Don't ignore TypeScript errors** - Run `npm run type-check`
6. **Don't add files to Docker without checking `.dockerignore`**

## Quick Reference Commands

```bash
# Development
npm run dev          # Start dev server
npm run build        # Build for production
npm run start        # Start production server

# Quality checks
npm run lint         # Run ESLint with the two-way warning budget (scripts/lint.mjs)
npm run type-check   # TypeScript check
npm run test         # Run tests
npm run test:watch   # Run tests in watch mode

# Full CI check (run before committing)
npm run ci           # lint + type-check + test + build
```

## API Endpoints Reference

All `/api/team/:teamId/*` and `/api/feedbacks/*` endpoints authenticate with the
team password **or** a valid team session token (`sessionToken` in the request
body) minted for that exact team — the token is an alternative credential so
clients can avoid resending the password on every call.

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/version` | GET | Returns version info and changelog for announcements. Each announcement keeps the English `items` and, when `CHANGELOG.fr.md` has that release, adds `localized.fr.items` (French no-break spaces applied by the server) |
| `/api/info-message` | GET | Returns the global info banner configured by the super admin |
| `/api/wifi-config` | POST | Returns Wi-Fi SSID and password (404 if not configured). Requires `teamId` **and** a team credential (`sessionToken` or `password`): the Wi-Fi password is a credential, and the only consumer (`InviteModal`) is reachable after team login, so nothing legitimate needed it anonymously (audit H31). It is a **POST** rather than a GET because that is this codebase's idiom for an authenticated read — the credential belongs in the body, not in a URL that proxies and access logs retain. The `404` sits **behind** the credential too, so an anonymous caller cannot learn whether a deployment has Wi-Fi configured |
| `/api/data` | GET/POST | **Deprecated** (returns `410`) — replaced by the granular `/api/team/*` endpoints |
| `/api/team/create` | POST | Create a team; returns the team and a session token. The `facilitatorEmail` is **required** (37.0): `400 recovery_email_required` when it is absent or blank, `400 invalid_email` when it is not one valid address — both before the name is claimed — and it is stored cleaned by the shared email rule (see *Email addresses*). Only creation insists; `/update` can still clear the address |
| `/api/team/login` | POST | Team login (password or `inviteCredential` from an invite link); returns the team and a session token |
| `/api/team/restore-session` | POST | Restore a team session from a saved session token (never returns a password) |
| `/api/team/list` | GET | Team summaries for the login screen picker |
| `/api/team/exists/:teamName` | GET | Check team-name availability. The name arrives **already percent-decoded** — Express decodes route params — so the handler must not decode it again: a second `decodeURIComponent` threw `URIError` on a bare `%` (answered `500`, and `dataService.renameTeam` fails the rename when this check does not answer, so no team could ever be renamed to "Sprint 50%") and silently answered about a different name when a decoded name still looked encoded |
| `/api/team/:teamId` | POST | Fetch the authenticated team's current state |
| `/api/team/:teamId/update` | POST | Update team fields. A rename claims the new index key, writes the record, then releases the old key (`409 team_name_exists` if another team holds the name) — never the reverse, which left the old name free across the record write and needed a rollback that could evict whoever took it. **It never replaces a list another route owns.** `retrospectives`, `healthChecks`, `globalActions` and `teamFeedbacks` are ignored; `customTemplates` and `customHealthCheckTemplates` are **merged add-only** (a retro template is added unless one with the same name and columns is stored; a health-check template is added by a new id or replaces the stored one with that id; nothing is ever removed); one warning line names what was ignored and what was merged. A whole-list replace from a second tab left on a stale Dashboard erased a live retro from the team record (incident ISS, 2026-10-12), and the template lists had the same flaw. New clients use the template routes below and `/api/feedbacks/*`. The add-only merge exists for the clients from before that fix, which save a template only by sending the whole list: during and after a rolling update their tabs stay open, and stripping the lists silently discarded every template they saved. Their deletes simply do not stick, which is the safe way to be wrong. A `facilitatorEmail` in the updates follows the shared email rule (see *Email addresses*): it is judged before anything is written, the name claim included (`400 invalid_email`), stored cleaned, and `null`, `''` or a blank value **clears** it — the Dashboard sends `null`, because the `undefined` it used to send vanished in JSON and the address could never be emptied. `mergedFrom` is ignored like `passwordHash`: only the super-admin merge writes it. So are `jiraTarget` (written by `/jira/target` alone), `jiraClaims` (server-only, see *Jira*), `jiraParents` and `jiraParentClaims` (each session's parent issue and the claims on parents being created, written by `/jira/issues` alone). A change of `facilitatorEmail` is recorded as `team.recovery-email-change` (that address is where a reset link goes), with the credential `authenticateTeam` actually accepted (`via`), never inferred from the body — a valid token wins over any password sent beside it. A rename also answers `409 team_name_exists` when another **record** displays the name with no index entry, as the super-admin rename does |
| `/api/team/:teamId/retrospective/:retroId` | POST | Persist one retrospective. Carries a rev guard: a blob built on an older `_rev` than the stored one is dropped, and so is a blob with **no** `_rev` over an entry that has one — an invite placeholder must never overwrite a real retro. For an existing entry it **keeps the stored `name`**: every client persists its whole blob here, so the stored title used to be whatever the last saver's cache held. A name is set by creation and by the `/name` route, nowhere else. An action's `jira` is never taken from the blob: the stored value is kept, and a link the record does not hold is dropped, on new actions too (`withoutUnstoredJiraLinks`) |
| `/api/team/:teamId/retrospective/:retroId/name` | POST | Rename one retrospective. **Granular on purpose** (audit H35): renaming by persisting the whole blob sends the caller's cached `_rev`, which is stale for any retro a live session has since advanced, so the rev guard above dropped the entire write and the title reverted with nothing reporting a problem. This route carries no revision, touches only `name`, and deliberately does **not** bump the stored `_rev` — a title change must not make every live client lose its next optimistic-concurrency race. Answers `404 retrospective_not_found` when the id matches nothing; a rename to the name it already has is a success, not a 404. **It also renames the live session** (`server/services/liveSessionRename.js`, wired from `server.js`): when `session:{id}` exists for the same team, the name goes through the session compare-and-swap (which bumps the *session* `_rev`, never the team record's) and the room receives the new state. Best-effort and after the answer, so it never fails or delays the rename (during a rolling update, a rename handled by a pod from before this change reaches the team record only; the next rename heals the session); it runs even when the team record already held the name, which is what heals a session left diverged. Without it, a rename made after the invitations went out left every participant on the old title, and the server refused each of their writes (incident ISS) |
| `/api/team/:teamId/healthcheck/:hcId` | POST | Persist one health check (same rev guard, same rules on a missing `_rev`, on the stored `name` and on `jira`) |
| `/api/team/:teamId/healthcheck/:hcId/name` | POST | Rename one health check — the symmetric case of the route above, live session included, `404 healthcheck_not_found` |
| `/api/team/:teamId/retrospective/:retroId/delete` | POST | Delete one retrospective, promoting its actions to the backlog (an action already there is kept as is). `404 retrospective_not_found`. Granular for the reason `/update` no longer takes lists: deleting by sending the whole list let a stale tab erase every retro it had never seen |
| `/api/team/:teamId/healthcheck/:hcId/delete` | POST | Delete one health check, same promotion, `404 healthcheck_not_found` |
| `/api/team/:teamId/action/delete` | POST | Delete one action (`{ actionId }`) from the backlog, every retrospective and every health check. `404 action_not_found`, `400 missing_action`. The client sends all three deletes through `postAcrossRollout` (the retry the impact route already used): during a rolling update a pod that does not serve the route yet answers Express's HTML 404, which is retried for about 7 s; the route's own 404 means "already gone" and is final |
| `/api/team/:teamId/template/save` | POST | Append one custom retro template `{ template: { name, cols } }`. The name is stored trimmed and only `name` and `cols` are kept; `400 invalid_template` unless the name is non-blank and `cols` is a non-empty array. Granular for the same reason as the delete routes: the template list used to be written whole through `/update`, so a stale tab erased every template saved elsewhere since it loaded. A retry across a rolling update can append a template twice if a save landed but its answer was lost; that leaves a visible duplicate, never a loss |
| `/api/team/:teamId/template/delete` | POST | Remove the **first** stored retro template structurally equal to `{ template }` (name and columns, deep equality insensitive to key order). A `Template` has no id and names are not unique, so its content is its identity, which also means a caller can only delete a template it has actually seen. `404 template_not_found` when none matches; `400 invalid_template` only for a malformed shape (an old template with a blank name stays deletable) |
| `/api/team/:teamId/healthcheck-template/save` | POST | Upsert one custom health-check template by `id` (`400 invalid_template` unless `id` is a non-empty string, the name non-blank and `dimensions` an array; the name is stored trimmed) |
| `/api/team/:teamId/healthcheck-template/delete` | POST | Remove one custom health-check template by `templateId`; `404 healthcheck_template_not_found`, `400 missing_template` without an id |
| `/api/team/:teamId/action` | POST | Persist a global action update. **Additive, not a replace** (`utils/actionImpact.js` → `mergeActionImpactState`): it folds the incoming action onto the stored one so `impactRatings`, `closedAt` and `impactDeferredBy` survive a caller that never read them. Without that, a facilitator renaming an action from a client loaded before anyone voted wipes the whole rating round. It also stamps `closedAt` when *it* is what closes the action, which is what keeps the field correct through a rolling update where an older pod closes an action without stamping — but it never invents one for an action already stored as closed without a stamp, because those are the pre-feature closures and dating them would drag the entire historical backlog into the next rating round. Its `jira` comes from the record only (`withRecordedJiraLink`: the stored copy's value, else another copy's, else none), so a caller can neither drop a link nor plant one |
| `/api/team/:teamId/action/impact` | POST | Record one participant's impact vote on one closed action (`{ actionId, userId, vote }`; `vote: 1 \| 2 \| 3 \| 'abstain' \| null`, `null` clears the caller's own vote). **Deliberately narrow, for the same reason `/retrospective/:retroId/name` is**: `impactRatings` is the first per-user data on the team record and it has one writer per participant, so sending a whole action would make two people voting in the same second race, with the loser's vote vanishing silently. This writes exactly `impactRatings[userId]` inside `atomicTeamUpdate`, so concurrent voters never contend for the same key. Carries no revision, touches no other field, and takes no retro/health-check hint — it scans all three homes, because a hint would be a second way to locate an action that could disagree with the scan. Answers `404 action_not_found` (after the write, never from a preliminary read) and `400 invalid_vote` for anything off the scale, refused rather than coerced. **`{ actionId, reset: true }` drops the whole map for one action** — what a *later* retrospective does when it puts a postponed action back to the team, because "Rate later" promises the question is asked again and a vote left in place is pre-filled next time, so the early answerer is never re-asked. It lives on this route rather than a new one because `impactRatings` is owned here and nowhere else (the whole-action route deliberately cannot touch it), and a clear written elsewhere would be a second owner. The reset is performed at **re-presentation**, never at the deferral: that is what keeps the "Rate later" toggle lossless, so a mis-click stays undoable and the votes only go when the round that would have shown them really reopens. `reset` must be a literal `true`; anything else falls through to the ordinary vote path and its validation |
| `/api/team/:teamId/members` | POST | Update the member roster. Member emails are **cleaned, never refused** by the shared email rule (`cleanRosterEmails`, the function the heal pass uses): a value that does not parse is stored as sent, and so is one whose cleaned form another member already holds — a roster write carries joins, and member emails are identities on the client |
| `/api/team/:teamId/invite-credential` | POST | Derive the team's current invite credential for embedding in invite links (revoked by password rotation) |
| `/api/team/:teamId/password` | POST | Change the team password (password-only; also bumps the invite epoch, revoking outstanding invite links) |
| `/api/team/:teamId/delete` | POST | Delete a team (its feedbacks are preserved as orphaned; its Jira token, `team-secret:{teamId}`, is deleted before the record). The Dashboard waits for the answer: a failure keeps the team signed in and says so, and `team_not_found` (already deleted — a lost answer, another tab, the super admin) counts as done |
| `/api/team/:teamId/jira/status` | POST | The team's Jira state for the screens (`JiraStatus` in `types.ts`): `{ enabled, baseUrl, target, token: { configured, usable, reason, connectedAs, deploymentType, setAt, refusedAt } }`. Never calls Jira and never returns the token. `baseUrl` is returned whenever one is configured, even with Jira off (a stored key still renders as a link). `reason` is `address_changed` (the console's address moved since the token was saved) or `unreadable` (the key changed: `SESSION_TOKEN_SECRET`). The target comes from the summary cache, never the record: every participant reads this on Review entry and on each reconnect. Its own read limiter (120/min per IP); `500 failed_to_load` |
| `/api/team/:teamId/jira/token` | POST | Save or replace the team's Jira token `{ token, email? }` — an email means Jira Cloud (Basic `email:token`), none a Data Center personal access token (Bearer). **Any team credential may** (maintainer decision D1), an invitation-link login included. Checked against Jira first (`serverInfo` then `myself`, authenticated), then sealed and stored (see *Jira*); the team's existence is re-checked after the save, and the secret removed again if it was deleted meanwhile (`401 team_not_found`). Answers `JiraStatus`. `409 jira_not_configured`, `503 jira_secret_unavailable` (no stable `SESSION_TOKEN_SECRET`), `400 jira_token_missing` / `invalid_email` / `jira_auth_failed` (also for a value no Jira accepts, refused without calling it) / `jira_auth_failed_cloud` (a Cloud 401: usually a scoped or expired API token) / `jira_forbidden`, `404 jira_not_found`, `429 jira_rate_limited` (with `retryAfterSeconds`), `502 jira_unreachable` / `jira_unavailable`, `500 failed_to_save`. A Jira 401 is never answered `401`: on these routes that status means *our* credential, and a client reading it so would sign the facilitator out. Recorded as `team.jira-token-change` (`cleared: false`, `via`) |
| `/api/team/:teamId/jira/token/delete` | POST | Remove the team's Jira token; answers `JiraStatus`. Recorded as `team.jira-token-change` (`cleared: true`, `via`) only when a token was stored: a row saying "cleared" for a team that had none would show a removal that never happened. `500 failed_to_delete` |
| `/api/team/:teamId/jira/target` | POST | Store where the team's issues go, `{ target: JiraTarget \| null }` (`null` clears it): `{ mode: 'project' \| 'parent' \| 'sessionParent', projectKey \| parentKey, parentIssueTypeId?, issueTypeId, labels }` (`sessionParent`: a project, the standard type of the parent issue created per session, and the sub-task type of the actions, two different ids), judged by `validateJiraTarget` (`utils/jira.js`, the rule the form applies): `400 invalid_jira_target` / `invalid_jira_labels` (at most 10, no spaces, 255 characters each; an empty list is allowed, and no labels are sent). Written through `atomicTeamUpdate` and only here — `/update` ignores `jiraTarget` — and an unchanged target writes nothing. Answers `JiraStatus` |
| `/api/team/:teamId/jira/issue-types` | POST | The issue types the target form offers, read from Jira with the team's token (createmeta, every page): `{ projectKey }` → **every** type of the project, sub-task types included (the `sessionParent` form needs the standard ones for the parent and the sub-task ones for the actions from one read; every form filters by its mode), with `subtasksIncluded: true` — a pod from before 41.0 answered standard types only, and no flag; `{ parentKey }` → the sub-task types of the parent's project, `400 jira_parent_invalid` when the parent cannot hold sub-tasks: a sub-task, or on Cloud a type above level 0 (an epic). Answers `{ issueTypes: [{ id, name, subtask, hierarchyLevel? }], projectKey, subtasksIncluded? }` (`hierarchyLevel` is Jira Cloud's, −1 to 1 and above; Data Center sends none). `400 invalid_jira_target`, `409 jira_not_configured` / `jira_token_missing` / `jira_token_unusable`, and Jira's failures as on `/jira/token`; a Jira 401 also stamps `refusedAt` on the token that was refused — not on one saved while the call ran |
| `/api/team/:teamId/jira/issues` | POST | Create issues for `{ actionIds (1–10, distinct), target?, sessionId?, requestedBy?, language?, force?, adoptParent?, replaceParents?, forceParentScopes? }` — see *Jira* for the rules. `adoptParent` and `replaceParents` are booleans, and `replaceParents` comes only with `adoptParent`; `forceParentScopes` is a list of scopes (`isJiraParentScope`), each once and at most one per action id (anything else is `400 invalid_request`). Checked in this order: the credential, the body (`400 invalid_request`), the connection and the token (`409 jira_not_configured` / `jira_token_missing` / `jira_token_unusable`), the target, the one-time override or the stored one (`400 jira_target_missing` / `invalid_jira_target` / `invalid_jira_labels`), then `adoptParent` without a `parent`-mode one-time `target` (`400 invalid_request`: there is no parent named to adopt). Every answer past those is `200 { results, remaining, stopped?, retryAfterSeconds?, parents? }`, whatever Jira said. `results` has one entry per id attempted, in order: `created` / `already_linked` (with `key`) / `uncertain` / `in_progress` / `closed` / `not_found` / `refused` (Jira's `jiraMessages`; or `reason: 'no_text'` and no message when the server refused an action with no text without calling Jira — a wordless refusal by Jira has no reason) / `created_not_saved` (the issue exists, its `key` could not be written here) / `parent_uncertain` / `parent_in_progress` / `parent_refused` (`sessionParent` mode: **nothing was sent for the action**, because its session's parent may already be in Jira, is being created by another request, or was refused — with Jira's words). `created` and `created_not_saved` carry `parentKey` in both sub-task modes. A `refused` or `parent_refused` also carries `jiraFields`, the fields Jira's `errors` named, when there are any. `parents` (present when there is one) has one entry per scope met (`retro:<id>`, `healthcheck:<id>`, `backlog`): `{ scope, status: 'created' \| 'adopted' \| 'uncertain' \| 'in_progress' \| 'refused' \| 'not_saved', key?, uncertainSince?, jiraMessages?, jiraFields? }` — `created` names the key the scope holds (a rival's, when its key won, and also when another request stored a parent after this one saw the scope `in_progress` or `uncertain`: the entry always names what the scope holds, since the client caches it), `not_saved` the key that could not be stored. `remaining` holds the ids not attempted; `stopped` is one of `token_refused`, `jira_forbidden`, `jira_not_found`, `jira_rate_limited`, `jira_unavailable`, `jira_unreachable`, `link_not_saved`, `server_restarting`, `client_gone`, `jira_parent_invalid`, `jira_target_refused` (Jira refused a field the target sets — labels, issue type, project, parent — for the action just reported `refused`; every other action would be refused the same way, so they stay in `remaining`), `jira_parent_refused` (Jira refused a session's parent: the same type, project and labels go on every parent). `force: true` lifts the skip of `uncertain` actions and nothing else; `forceParentScopes` lifts the skip of those scopes' uncertain parents and nothing else — never for a scope whose doubt the request found itself (an expired parent claim), whether it is listed or not. `500 failed_to_create` when a claim cannot be written or the route fails unexpectedly: earlier actions of the same request may have been created and linked, so the client treats it as outcome unknown and re-reads the team (`settleUnknown`). Its own write limiter (60 requests/min per IP) |
| `/api/feedbacks/create` / `all` / `comment` / `comment/delete` / `delete` | POST | Team feedback (bug reports / feature requests) CRUD. **Success must follow the write, never the preliminary read**: these handlers look the feedback up once to choose where to write and re-check it inside the compare-and-swap, and an aborted updater reads as "nothing to change", so a handler that trusts the first read reports success for a write that never happened. `comment` answers `404 feedback_not_found` when the target is in neither the owning team's record nor `orphanedFeedbacks` — an author may delete a feedback while someone is replying to it, and answering `200` there discarded the comment *and* the text the client had cleared. `comment/delete` answers `404 comment_not_found` on the same principle, covering all three reasons its updater aborts (feedback gone, comment gone, comment owned by another team — one opaque answer, so the route cannot be used to probe comment ids). `delete` answers `404 feedback_not_found` for the three reasons *its* updater aborts (the team record carries no `teamFeedbacks`, the feedback is not in it, the feedback belongs to another team), again as one opaque answer: reporting success for a refused delete left the entry on the board with the UI reporting no problem, so the user could not tell "deleted" from "not allowed". `TeamFeedback.tsx` reloads on `404` as well as on `ok`, so the board converges either way. **`create` carries its images inline, and the JSON body limit is 1 MiB** (`express.json` in server.js, and ingress-nginx's default): the browser reduces each image before attaching it (`utils/feedbackImages.ts`: at most 1600² pixels and 4096 px a side, WebP or JPEG, stepped down until it fits its share — what is left of an 800,000-character total, divided among the images still to attach, at most 300,000 each; these count data-URL characters, a third more than the file's bytes, so one image is at most about 220 kB of file; a small image and an animation are sent as they are, an animation that does not fit is refused rather than flattened, and its notice names the largest file that would have fitted, computed by `prepareFeedbackImage` from the limit it applied, so the text cannot drift from the constant), decoding through a `data:` URL because the CSP refuses `blob:` images. One ordinary screenshot used to be refused with a 413 after the form had cleared itself, so the feedback and its text were lost; the form now keeps its draft until the server has stored it and says why otherwise. Do not raise the body limit for images instead: they would be stored in the team record, which every team write rewrites. **A retry of `create` is idempotent through an optional `submissionId`** (`/^[A-Za-z0-9_-]{8,64}$/`, anything else is ignored as if absent): it is stored on the feedback, and when the posting team's `teamFeedbacks` already holds it — decided inside the `atomicTeamUpdate` updater, under the row lock, so two racing retries cannot both append — nothing is written and the route answers `200 { success, feedback: <the stored entry>, duplicate: true }`. The form reuses an id only for a resend of exactly the same draft (type, title, description, images): after an edit the server would answer with the old content and the edit would vanish silently, while a new id costs at worst a visible duplicate. A pod from before this change ignores the id, so a retry routed there during a rolling update can store a duplicate — the safe way to be wrong. What the client makes of the answer lives in `services/feedbackSubmission.ts`: a 2xx is `sent` (a duplicate too, and it notifies the admin, since the lost first answer never did), `413` is `too_large`, `401` is `session_expired`, any other status is `not_saved`, and no answer or a 2xx that is not JSON is `offline`; each has its own message on the form. While a send is on its way the draft is locked as it was sent (title and description read-only; type, the image picker, image removal, Cancel and *New Feedback* disabled): the "sent" answer clears the form, and used to erase whatever had been typed meanwhile. An image still being reduced when its draft is cancelled adds nothing to the next one (a draft generation counter), and every refusal of one pick is listed in the form's alert, each naming its file |
| `/api/send-invite` | POST | Send email invitations. Requires `teamId` **and** a team credential (`sessionToken` or `password`) — it mails a caller-supplied link through the deployment's SMTP identity, so it is never anonymous. The team name in the mail comes from the authenticated record, not the request body. Optional `language` (`en`/`fr`, anything else reads as English) writes the mail in the sender's interface language — the invitee reads it before ever seeing the app. **There is deliberately no cap on how many invitations an authenticated team may send** — inviting a whole department in one batch is the normal case. The only meter counts *rejected credentials* per IP (20/15min), scoped to `401`s alone so nothing a real facilitator does (a typo'd address, a deployment without SMTP, a send failure) can trip it; it exists solely to bound the data-store reads an anonymous prober can drive. The address follows the shared email rule (see *Email addresses*): `400 invalid_email` unless it is one valid address, and the mail goes to its cleaned form — nodemailer would otherwise mail every address it can parse out of a pasted list |
| `/api/send-password-reset` | POST | Send password reset email. Optional `language` (`en`/`fr`, anything else reads as English) picks the language of the mail. The typed address must be one valid address (`400 invalid_email`, a blank one included); the team is looked up by its trimmed name; the typed and stored addresses are compared **after both are cleaned** by the shared rule, and the mail goes to the **stored** cleaned address under the stored team name, never to the caller's strings. A stored value holding two addresses never matches (`204`), on purpose: mailing either one would let the anonymous caller choose who receives a live token |
| `/api/password-reset/verify` | POST | Verify a password-reset token |
| `/api/password-reset/confirm` | POST | Set a new team password using a reset token |
| `/api/notify-new-feedback` | POST | Notify the admin email about a new feedback. Requires `teamId` **and** a team credential (`sessionToken` or `password`), for the same reason as `/api/send-invite`: it renders caller-supplied content into a mail sent to the super admin's address through the deployment's SMTP identity, so it must never be anonymous (audit H29). Authentication comes first — before payload validation and before the SMTP capability check — so an anonymous caller learns nothing about the deployment. The `Team:` line in the mail comes from the **authenticated record**, never the request body, so a member of one team cannot file a report the admin reads as another team's. The limiter counts *rejected credentials* only (20/15min per IP): a bug-report burst after a bad release is exactly when the admin most needs the mail, and a whole office shares one egress address |
| `/api/ai-status` | GET | Returns whether AI features are enabled |
| `/api/ai/suggest-group-title` | POST | AI-generated group title suggestion (requires a valid team session token in the body) |
| `/api/ai/suggest-groups` | POST | AI-suggested ticket clusters for facilitator review during the Group phase (requires a valid team session token in the body) |
| `/api/ai/generate-retro-summary` | POST | AI-generated retrospective summary (requires a valid team session token in the body) |
| `/api/ai/generate-release-analysis` | POST | AI-generated synthesis across multiple retrospectives (release-level analysis; requires a valid team session token in the body) |

All four `/api/ai/*` routes answer an upstream failure with `500 { error: 'ai_error' }`
and **no detail field**. The underlying message describes the deployment's internal
LLM — a Node transport error names its host, IP and port, and `aiService` wraps a
non-2xx as `AI API error <status>: <first 200 chars of the upstream body>` — while
these routes need only a team session token, which on a shared team password means
anyone who ever received an invite link. The detail goes to the pod log and the
super-admin log ring instead; `/api/super-admin/test-ai` is the diagnostic path that
*does* return it, because it is gated by the super-admin credential. Do not add a
`message` back to these responses, and do not render one client-side.

| `/api/super-admin/*` | POST | Super admin operations. `feedbacks/comment` and `feedbacks/update` follow the same write-not-read rule as their team-side siblings and answer `404 feedback_not_found` when the team deleted the feedback mid-edit: `feedbacks/comment` previously reported success for a reply stored nowhere **and mailed the team about it**, using a title and address captured from the stale read. `feedbacks/delete` is deliberately exempt — its updater filters unconditionally and never aborts, so its success is honest. `rename-team` obeys the same rule and answers `409 team_name_exists` on a collision: it used to let its index updater refuse the collision and rename the record anyway, reporting success for a team that was then reachable only under the name it no longer displayed. It also answers `409` when another team **record** displays the name with no index entry (a deletion whose last step failed) — the usual end of a merge is renaming the merged team to a deleted source's name, and two records sharing one name leave one unreachable after a restore rebuilds the index. `update-email` and `update-admin-email` follow the shared email rule (see *Email addresses*): the address is stored cleaned, `400 invalid_email` when it is not one valid address, and an empty value clears it (`update-admin-email` stores `''`, which turns the notifications off) |
| `/api/super-admin/merge-teams/preview` | POST | What merging `{ primaryTeamId, secondaryTeamId }` would produce, with nothing written: `{ report, liveSessions, fingerprints, defaults }`. `liveSessions` is `null` when open sessions cannot be known (a cross-pod adapter configured but down, `fetchSockets` failing). `409 related_teams` when one team was built from the other, `422 source_needs_repair` with `anomalies` for a team the planner cannot carry whole, `503 session_read_failed` when a live session row cannot be read. The three routes build their own rate limiters, with the console's read and action settings. See *Merging teams* |
| `/api/super-admin/merge-teams` | POST | Create the merged team (`201 { team: { id, name }, report }`): `{ primaryTeamId, secondaryTeamId, name, passwordSource: 'primary' \| 'secondary' \| 'new', newPassword?, facilitatorEmail?, expectedFingerprints }`. `400 missing_fingerprints` without the preview's fingerprints, `409 sources_changed_since_preview` when either team changed after that preview, `409 related_teams`, `409 team_name_exists` (index **or** any record), `400 team_name_empty` / `team_name_too_long` (`utils/teamNamePolicy.js`, the reset route's cap) / `invalid_password_source` / `password_too_short` / `password_unavailable` (a source with no hashed password) / `invalid_email`. The two teams are never written. A save that throws keeps the name claimed when the record landed anyway |
| `/api/super-admin/delete-team` | POST | Delete a team from the console: `{ teamId, confirmName, mergedInto?, acknowledge?, confirmation? }`. The name is typed back (`400 confirm_name_mismatch`). Every way the deletion could lose something is answered `409 confirmation_required` with `reasons` (`source_changed`, `merge_unverified`, `merged_team_changed`, `sources_deleted`, `sessions_open`, `sessions_unknown`), their facts and a `confirmation` digest of them; it proceeds only when every reason is in `acknowledge` **and** `confirmation` still matches the facts. A protected "Pre-delete snapshot" is taken first (`503 pre_delete_snapshot_failed` when none could be made), then the record is read again: `409 team_changed` when it moved meanwhile, nothing deleted. Feedbacks move into `mergedInto` only when that team's signed provenance names this one; otherwise they are orphaned as on any deletion. `503 failed_to_move_feedbacks` stops before anything is removed |
| `/api/super-admin/backups/list` | POST | List server-side backups and config, and `limits: { maxArchiveBytes, maxUnpackedBytes }` (`RESTORE_MAX_BODY_MB` / `RESTORE_MAX_DECOMPRESSED_MB` in bytes; additive, an older console ignores it). A row's `type` is `auto`, `manual`, `startup` or `imported` |
| `/api/super-admin/backups/create` | POST | Create a manual checkpoint |
| `/api/super-admin/backups/import` | POST | Store an uploaded backup file as a backup row of type `imported` (`server/routes/superAdminBackupImportRoutes.js`). **Raw body**, `application/octet-stream` (a gzip file or plain JSON alike), `application/gzip` or `application/x-gzip` — never `application/json`, which the global parser claims first (H30); the credential in `x-super-admin-session-token` / `x-super-admin-password`, checked before one byte of the body is read; the original file name percent-encoded in `x-backup-label` (a header, not the query string, which lands in access logs), cleaned by `server/services/backupLabel.js` and shown as typed. The file is parsed and checked once (`archiveShapeProblem`); the stored bytes are the upload itself when it is gzip, else its gzip, so a download returns the very file imported. **One `backups` row and nothing else**: no team, KV or session row, no retention (an imported row is never purged), no restore gate, no snapshot, no `backupInProgress`. Answers `200 { success, backup }`; `400 missing_archive` (empty, or a content type the raw parser did not take), `400 invalid_backup_format` (not JSON, not gzip, a truncated or corrupt gzip, a malformed request body), `400 invalid_backup_data` with `reason` (`not_an_object`, `teams_missing`, `team_malformed { count, positions }`, `team_id_duplicated { ids }`, `list_malformed { field }`), `401 unauthorized`, `409 import_in_progress` (this pod's import gate, held until the handler settles), `413 backup_file_too_large { maxBytes }` (JSON, from the route's own error handler), `413 restore_archive_too_large { maxBytes }`, `500 import_failed` (only body-parser errors read as the file's fault). A 413 that is not JSON comes from a proxy in front of the app (k8s/README.md → *Upload size and timeouts*). Recorded as `backup.import` with the new backup id, the counts and the file's SHA-256 |
| `/api/super-admin/backups/download` | POST | Download a specific backup |
| `/api/super-admin/backups/restore` | POST | Restore from a backup. `404 backup_not_found` for an unknown id, answered from the metadata before the gate and before any snapshot; `409 restore_in_progress` while another restore runs on this pod (see *Restoring one team*); after the protected snapshot, the archive is read and checked, and a refusal deletes the snapshot it just took: `422 invalid_backup_data` with `reason` (`unreadable` for a corrupt archive, else an `archiveShapeProblem` reason), `413 restore_archive_too_large`, `404 backup_not_found` (deleted between the check and the read) |
| `/api/super-admin/backups/teams` | POST | The teams a stored backup holds: `{ teams: [{ id, name, status: 'present' \| 'renamed' \| 'deleted', currentName, nameTaken, counts }] }`. `404 backup_not_found`. See *Restoring one team* |
| `/api/super-admin/backups/restore-team` | POST | Restore **one** team `{ backupId, teamId, expected?, name? }` from a stored backup, leaving every other team as it is. `expected` (`'existing'` / `'deleted'`) is what the console showed; `name` is read only for a team deleted since the backup. `404 backup_not_found` / `team_not_in_backup`, `422 archived_team_malformed` with `fields`, `409 team_name_exists` (a deleted team's name taken since), `409 team_changed` (the team was deleted or created again meanwhile, or is not what `expected` says), `400 team_name_empty` / `team_name_too_long`, `503 session_read_failed` / `pre_restore_snapshot_failed` / `team_secret_delete_failed` (a team deleted since the backup still has a Jira secret row its deletion left behind, and it could not be removed before the team is recreated), `409 restore_in_progress` — no refusal leaves team data written (one after the snapshot deletes the snapshot it took). Answers `{ team, recreated, counts, sessionsUpdated, sessionsSeeded, sessionsNotUpdated, feedbacksStillOrphaned, preRestoreSnapshot }`. Recorded as `team.restore` |
| `/api/super-admin/backups/delete` | POST | Delete a backup |
| `/api/super-admin/backups/update` | POST | Update backup label/protection |
| `/api/super-admin/ai-settings` | POST | Load AI/LLM configuration |
| `/api/super-admin/update-ai-settings` | POST | Save AI/LLM configuration |
| `/api/super-admin/test-ai` | POST | Test AI connection. When the body carries an `apiUrl`, the submitted values are saved first (the `ai` key only, through `updateGlobalSettings`); a save that fails answers `500 failed_to_save` and runs no test, which the console reports as a failed save, never as a failed connection |
| `/api/super-admin/jira-settings` | POST | The deployment's Jira connection, `{ enabled, baseUrl, allowSelfSignedCerts }` (a stored address that does not parse reads as `''`). Read strictly: a store error answers `500 failed_to_load`, never "off" |
| `/api/super-admin/update-jira-settings` | POST | Save it. The address goes through `parseJiraBaseUrl` and is stored canonical (`400 invalid_jira_base_url`; empty only with Jira off), so another spelling of the same address keeps every team's token readable and a different one voids them all — which the console warns about and confirms first. `500 failed_to_save`. Recorded as `jira-settings.update` with the stored values |
| `/api/super-admin/test-jira` | POST | Test an address **without saving it**, `{ baseUrl, allowSelfSignedCerts }`: one anonymous `GET <parsed base>/rest/api/2/serverInfo`, no redirect followed, answer capped at 1 MB. Answers `200 { ok: true, version, deploymentType }` or `200 { ok: false, error, status?, location?, messages?, transport?, transportCode? }` — parsed fields only, never the raw body. `transport` (`tls`, `network`, `timeout`, `deadline`, `too_large`) and `transportCode` (the system's or OpenSSL's code, such as `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`) say what stopped a call that got no answer (`jira_unreachable`), so the console can tell a missing CA from a proxy or a host that is down; never the transport's message, which names the host and its port. Super-admin only, like `test-ai`'s detail: the team routes answer a bare `jira_unreachable` and log the codes instead. `400 invalid_jira_base_url`, `500 jira_test_failed`. The one outbound call to an address taken from a request body: CodeQL's `js/request-forgery` alert on it is expected, and its dismissal rationale is in `HARDENING_STATUS.md` (H10) |
| `/health` | GET | Health check. Always answers `200`, and the body is JSON: `{ status: 'ok' | 'degraded', socketAdapter: { strategy, expected, active, attempts, gaveUp } }`. `degraded` means a cross-pod Socket.IO adapter was **configured and is not active** — the case that used to be indistinguishable from a healthy single-pod deployment, where two replicas silently stop sharing broadcasts with every probe green (audit H50). `expected: false` is the correct single-pod answer, not a failure. The status code deliberately never moves: gating readiness on the adapter would empty the Service when *both* pods fail at once, turning degraded collaboration into an outage. The upstream error text is **not** in the response — it names the deployment's internal host and grant, and this endpoint is anonymous; it goes to the pod log and the super-admin log ring, like the `/api/ai/*` detail |
| `/ready` | GET | Readiness check |

## Data Persistence Structure

The application uses a **per-team KV store** architecture to eliminate write contention. Each team is stored in its own KV record, so concurrent updates to different teams never conflict.

### KV Store Keys

| Key Pattern | Description |
|-------------|-------------|
| `team:{teamId}` | One record per team, contains full Team object + `_rev` for optimistic concurrency |
| `team-index` | Maps lowercase team names to team IDs for fast login lookups |
| `retro-meta` | Stores `resetTokens` and `orphanedFeedbacks` (non-team-specific data) |
| `session:{sessionId}` | Real-time session state (retro or health check) |
| `global-settings` | Admin settings (info message, admin email, notifications, AI config). Written only through `updateGlobalSettings` — one key at a time, under the row lock, after a strict read — and read through the lenient `loadGlobalSettings` (see *Key Design Principles*) |
| `jira-settings` | The deployment's Jira connection `{ enabled, baseUrl, allowSelfSignedCerts }`, written by the console. A key of its own, read strictly (see *Jira*); not in archives |
| `team-secret:{teamId}` | A team's sealed Jira token, `{ jira: { v, iv, tag, ct, baseUrl, connectedAs, deploymentType, version, setAt, refusedAt? } }`. Never on the team record, never sent to a client, not in archives (see *Jira*) |

**Two things are SQL tables rather than KV records, and both for the same
reason: a restore rewrites the KV store wholesale.** `backups` holds the archives
themselves (imported files included, `type: 'imported'`); `security_events` (audit H45) holds the audit trail, which would be
worthless if a restore could erase it. Neither is in a backup archive — see
`__tests__/archiveContract.test.ts` for what the archive does and does not carry.

### Team Record Structure (`team:{teamId}`)
```json
{
  "id": "abc123",
  "name": "My Team",
  "passwordHash": "...",
  "_rev": 5,
  "_updatedAt": "2025-01-01T00:00:00.000Z",
  "members": [],
  "retrospectives": [],
  "healthChecks": [],
  "globalActions": [],
  "teamFeedbacks": []
}
```

**The password minimum lives in `utils/passwordPolicy.js` and nowhere else**
(audit H39). Eight characters — NIST SP 800-63B's floor, chosen over ASVS
2.1.1's twelve because this password is a *shared* secret typed by a dozen
people on phone keyboards, and because the login limiter, not the entropy, is
what actually bounds guessing (decision D18) — imported by the four server write paths
(`/api/team/create`, `/api/team/:teamId/password`,
`/api/password-reset/confirm`, `/api/super-admin/update-password`) **and** by
the React forms, so a screen cannot state a rule the route does not enforce. It
is `utils/` rather than `server/services/` precisely because it has consumers on
both sides — `utils/inviteLink.js` is the same pattern. Two rules when touching
it: **never call it from an authentication path** (a team whose password
predates the rule must keep logging in — refusing to verify would lock out the
whole existing user base), and **never call it from
`server/services/passwordMigration.js`** (it re-hashes the short plaintext a
legacy record already contains, so a minimum there would leave those records
unconvertible). Raising the number is a one-line change; the boundary tests are
written as `PASSWORD_MIN_LENGTH ± 1` and follow it.

`passwordHash` holds a scrypt hash (`scrypt$N$r$p$salt$hash`, hashed at rest via
`server/services/passwordHashing.js`). **A stored value that is not a scrypt
record does not authenticate** — `verifyPassword` has no branch comparing a
stored string against a submitted password, and the authentication path performs
no writes at all. The dual-verify fallback and the rehash-on-login upgrade that
covered records predating hashing were removed once production reported the
eager startup migration finding nothing left to convert. Converting a legacy
record is `server/services/passwordMigration.js`'s job alone: it runs at startup
**and after either restore route**, which is what stops a rollback to a
pre-hashing archive from leaving teams unable to log in. It reads only each
team's `id` and `passwordHash` (`dataStore.loadTeamPasswordHashes`, one
projection in SQL, never cached — the summary cache feeds the anonymous login
picker, and a hash there would be one forgotten field away from it), so Node
parses no full record at boot, and its summary line counts only the records it
actually rewrote (an update declined because another pod hashed first answers
success too). Do not reintroduce a
plaintext compare in the auth path. `/api/team/restore-session`
never returns a password; restored sessions are token-only. Invite links embed a
signed, team-scoped **invite credential** derived on demand from
`/api/team/:teamId/invite-credential` and bound to the team record's
`inviteEpoch` counter (absent means `0`; every password rotation bumps it,
revoking all outstanding invite links). `inviteEpoch` is stripped from client
responses and protected against writes through `/api/team/:teamId/update`, like
`passwordHash`.
`mergedFrom`, the provenance a super-admin merge writes on the team it creates
(see *Merging teams*), is server-only in the same way: stripped from every
client response and ignored by `/update`. So is `jiraClaims`, the Jira route's
record of the issues being created right now (see *Jira*), and
`jiraParentClaims`, its twin for the parent issues of `sessionParent` mode.
`jiraTarget`, where the team's issues go, is sent to clients but written by
`/jira/target` alone; `jiraParents`, each session's parent issue keyed by
`retro:<id>`, `healthcheck:<id>` or `backlog` (`{ key, createdAt,
subtaskTypeId? }` or `{ uncertainSince }`), is sent to clients but written by
`/jira/issues` alone. Neither is on a retro entry nor a `session:{id}` row: a
persist replaces the whole entry with a participant's blob, and a session row is
participant-writable.

### Team Index Structure (`team-index`)
```json
{
  "teams": {
    "my team": "abc123",
    "other team": "def456"
  }
}
```

### Metadata Structure (`retro-meta`)
```json
{
  "resetTokens": [],
  "orphanedFeedbacks": []
}
```

### Key Design Principles
- **Per-team atomic updates**: `atomicTeamUpdate(teamId, updater)` only locks the specific team record, not all teams. A team's updates run **one at a time on each pod** (`server/services/keyedQueue.js`), and each one reads, runs the updater and writes **inside one transaction holding the row** (`SELECT … FOR UPDATE` on PostgreSQL, a synchronous transaction on SQLite): the record is parsed once, the updater runs exactly once, and a writer from another pod waits on the row lock instead of failing. It replaced a compare-and-swap retried five times, under which a whole retro writing at once let one writer win per round: measured on PostgreSQL, 9 to 10 of 16 simultaneous writers on a 1 MB team got `max_retries_exceeded`, a 500 the client only logs, and the Dashboard missed what they carried. Three rules: **an updater is synchronous** (it runs inside the transaction; every one is); **one that throws fails alone** (its transaction rolls back, the updates queued behind it run); and the queue is what keeps the lock cheap — without it, sixteen writers of one team hold sixteen pool connections waiting on one row. A pod from an older release still compare-and-swaps through `atomicTeamSave`, which takes the same lock and reads the revision written here, so a rolling update mixes both safely. `__tests__/teamWriteConcurrency.test.ts` holds the contract and runs on PostgreSQL when `TEST_DATABASE_URL` is set (the two-pod case is only meaningful there)
- **A write authenticated by a session token does not load the team** (`authenticateTeam(…, { needsTeam: false })`). The persist routes, the action, template, member and feedback writes only need the verdict, and the write reads the record itself; loading it first parsed the team's whole history once more on every persist of a live session. A valid token is checked against the record's existence (`dataStore.teamExists`, which reads no value), so a deleted team still answers `401 team_not_found`; a password still loads the record to verify the hash. A test double of the data store needs `teamExists` for that path
- **The client sends one save per session at a time** (`queueSessionSave` in `services/dataService.ts`). A save still waiting at the end of the persist queue is replaced by a newer save of the same session — each one carries the whole session, and typing a group or column title saves on every keystroke. A save that has started is never replaced, and anything else queued closes the window, so coalescing never moves a save past another write (an action recorded on a retro must not reach the server before the retro does)
- **Team summaries are cached per pod, and a projection never casts per column** (38.0). `loadTeamSummaries` — the login screen's `/api/team/list`, the console, the boot passes — needs a few fields that live inside each team's record, next to its whole history. On PostgreSQL each `(value::jsonb)->…` column is its own cast, so five projected columns parsed every record five times: **1.7 s for 40 teams holding 25 MB**, growing with every retro run (SQLite's JSON parse cache hid it in CI, at 50 ms). Each pod now keeps every team's projection keyed by a fingerprint that costs no parse — the row's byte length (`octet_length`, read from the row or TOAST header) and its version — and projects only the rows whose fingerprint moved, with **one** cast per row (`OFFSET 0` stops the planner from folding the subquery back into one cast per column). The version is `xmin` on PostgreSQL: it changes with every row version whoever writes it, a pod from an older release included, and owes nothing to a clock (an `updated_at` from `NOW()` is the transaction's *start* time and depends on the column's precision). On SQLite it is `updated_at`, read **only when `PRAGMA data_version` says another connection committed**: the column is stored after the record, so reading it walks every overflow page of the store. This pod's own writes (`kvSet`, `kvDelete`, `atomicTeamSave`) forget their entry, so between foreign writes the length alone is the whole fingerprint. Measured on that data: cold 230 ms, warm 1.5 ms on PostgreSQL. `loadTeamSummary` — one team, read by every socket join (the joiner's role) and by `/jira/status` — follows the same rules on **that one row**: it reads one fingerprint, never every team's (the list path's re-projection of every team written since the previous read would run on every join, while every client of a live retro rewrites its team), an empty value reads as no team as `kvGet` does, and on PostgreSQL concurrent reads of one team at one fingerprint share one projection, so a reconnect wave casts the record once rather than once per joiner. It never moves the SQLite `data_version` marker, which belongs to the whole-list read. Rules: write a new JSON projection with a single cast (`loadAllTeamFeedbacks` follows it); never write a `team:` row without going through those helpers, or the cache cannot forget it; summaries are handed out as copies (a copy per roster row — `User` is flat — and a deep clone of the nested merge provenance). On the client, `dataService.listTeams` answers `null`, never `[]`, when the list could not be loaded, and the picker then says so with a retry: an empty list invites the user to create a team, and `/api/team/list` shares the per-IP read limiter with a whole office behind one address. `__tests__/teamSummaryCache.test.ts` holds the contract, and runs against a real PostgreSQL when `TEST_DATABASE_URL` is set — CI only has SQLite, which is exactly the engine that hid this
- **`global-settings` is written one key at a time, under the row lock, never by a load-then-save.** The row holds independent settings with independent writers (the info banner, the admin email, the new-team switch, the AI configuration; `healAdminEmail` at boot and after restores). They used to load the row, change one key and save the whole blob, and `loadGlobalSettings` answers `{}` on a read error — so one database hiccup while saving the banner wrote `{ infoMessage }` over the row and erased the admin email, the switch and the whole AI configuration, while the route answered success; and two saves on two pods lost each other's change. Every writer now goes through `dataStore.updateGlobalSettings(updater)`: one transaction holding the row (on PostgreSQL an `INSERT … ON CONFLICT DO NOTHING` first, so two first writers lock the same row, then `SELECT … FOR UPDATE`; the synchronous transaction on SQLite), a **strict** read (a query error, a value that does not parse or is not one plain object throws, and nothing is written — the route answers `500 failed_to_save`), a synchronous updater that receives a copy and returns the next settings or null for "nothing to change", and the stored settings as the answer. Each caller spreads the current settings and sets its own key. `loadGlobalSettings` stays lenient **for readers** (the banner, the AI status, the notification mails degrade to "not configured"), and must never feed a write. There is no `saveGlobalSettings` any more, and `__tests__/globalSettingsUpdate.test.ts` → *global-settings writers* fails if any backend file calls one; the same suite holds the store contract on both engines (PostgreSQL when `TEST_DATABASE_URL` is set), and `__tests__/globalSettingsRoutes.test.ts` the five console routes against a real store whose read fails. Rolling-update residual: a pod from before this change still load-then-saves with the lenient read until it is replaced, so a console save it serves can still erase the other settings on a failed read, or overwrite a change another pod made meanwhile — leave the console's settings alone while such a rollout is in progress
- **Team index**: Used for login (name-to-ID lookup) and team creation (uniqueness check). The index and the `team:{teamId}` records are **two separate writes with no transaction between them**, so both handlers that touch the pair carry a compensating write. Creation claims the index entry *before* saving the record and **releases the claim if the record write fails** — keyed on its own team id, so a concurrent creation that legitimately won the name is never evicted. Deletion clears the index entry **first** and **never restores it**: that order is what keeps the record — and therefore the ability to authenticate a retry — alive when the second write fails, and the missing rollback is deliberate. Restoring the mapping after a failed `deleteTeamRecord` recreates the very state this ordering prevents as soon as two deletions overlap (A clears the entry and fails; B sees no entry, deletes the record, succeeds; A restores a mapping to a record that is gone). No re-check closes that, because the record can vanish between the check and the write, so the rule is structural: **a deletion only ever narrows the index.** Deletion clears **every** key mapping to the team, not the first match — a rename in flight legitimately holds two. **Renaming follows the same rule** (`/api/team/:teamId/update` and `/api/super-admin/rename-team`, both through `server/services/teamNameIndex.js`): it *claims* the new key while keeping the old one, writes the record, and only then releases **every key the team held at claim time** — the old name plus any alias a previously lost release left behind, which releasing the old name alone would have left claimed for good. That set is captured *before* the claim, so a key claimed by a concurrent rename of the same team is never in it and two overlapping renames cannot delete each other's claim. No failure path ever has to restore a mapping, and a claim that finds the name already the team's own is not released on failure, because this request did not add it. The rollback it replaces did restore one, and that is what made it dangerous — for the width of the record write the old name was free, so a concurrent creation could take it and then be silently evicted by the rollback (its record survives, its name resolves to the other team, nothing in the UI reaches the state), and a deletion landing in the same window left the restored name pointing at a record that was gone. A compensating write may only ever remove a mapping **it added itself**. The state all these guards exist to prevent is a name that resolves to no record: `/api/team/create` answers `409 team_name_exists` from the index alone, `/api/team/login` answers `401 team_not_found`, `/api/team/list` scans records so the team is invisible, and nothing in the UI can free the name again. Team names are trimmed on creation, on rename and in the availability check, so all three agree on what a name resolves to
- **orphanedFeedbacks**: `TeamFeedback` objects preserved from deleted teams. When a team is deleted, its feedbacks are moved to `retro-meta` so bug reports and feature requests are never lost. All feedback endpoints check both `team.teamFeedbacks` and `orphanedFeedbacks`. The move is an **upsert by feedback id**, because a deletion that fails on a later step is meant to be retried: an unconditional push duplicated every feedback (`/api/feedbacks/all` concatenates team and orphaned feedbacks, so the duplicates show on the board, and every writer resolves an orphan by first match, so only one copy of the pair would ever be updated again), while merely *skipping* an already-preserved id lost data the other way. Every feedback writer — the comment routes and the super-admin status/comment/delete routes — looks in the team record first and only falls back to `orphanedFeedbacks`, so a change made between a failed attempt and its retry lands on the **live** copy; the retry must therefore replace the stale snapshot, not keep it.
- **Automatic migration**: On startup, the server checks for legacy `retro-data` single-blob format and automatically migrates to per-team storage
- **Backup/restore**: Uses `loadPersistedData()` / `savePersistedData()` which reconstruct/decompose the legacy monolithic format for compatibility. **A backup that cannot read every team record fails** — and so does one whose `retro-meta` is present but malformed: the archive readers (`dataStore.iterateArchiveTeams`, `readArchiveMeta`) throw `BACKUP_READ_FAILED` naming the key (never its content), and `loadPersistedData` throws instead of answering `{ teams: [] }`. That used to store an empty archive as a success, and since retention runs only after a stored backup, each failed automatic run purged one good backup. Now `createBackup` answers `null` (`createBackupOutcome` says `'failed'` apart from `'in_progress'`), so every snapshot fails too: both restores and the single-team restore answer `503 pre_restore_snapshot_failed`, console deletion `503 pre_delete_snapshot_failed`, the checkpoint `500 create_failed` (it answered `409` for any failure), the download `500 backup_failed`, and a failed automatic backup runs no retention, so the last good ones are kept. That lasts until the row is repaired or deleted by hand (`k8s/README.md` → *A backup that cannot read a team fails*); the login picker is already down in that state, since the summary projection cannot read the row either. On PostgreSQL the teams are read inside one `REPEATABLE READ READ ONLY` transaction (one snapshot across teams, as the single statement before it gave, at the cost of one pooled connection for the read); on SQLite one row at a time. `retro-meta` is read after the teams on both, so a team deleted mid-backup can show twice (its copy and its orphaned feedbacks), never zero times. Teams come in key order on both engines. Restore is a **faithful replace**, not a merge: `savePersistedData(data, { mode: 'replace' })` upserts the archive's teams/index/meta and then makes the store match the archive exactly — it deletes `team:{id}` records absent from the archive (so a team deleted since the backup no longer lingers as a "ghost" in prefix scans / the super-admin dashboard) and clears all live `session:*` state (a backup never carries session blobs, and a stale session could let a client re-persist pre-restore state). `mode` defaults to `'merge'` (the historical additive behaviour) so non-restore callers are untouched. Both restore routes (`/api/super-admin/restore` and `/api/super-admin/backups/restore`) take a **protected** pre-restore snapshot first (survives retention purge — it may be the only copy of the pre-restore state; prune old ones manually) and **abort with `503 pre_restore_snapshot_failed` if that snapshot cannot be created** (never run the destructive replace with no recovery point); **every path that applies an archive checks it with one rule first**, `archiveShapeProblem` (`server/services/archiveShape.js`): an object, a `teams` array whose every entry has a non-empty string `id` and a string `name` with no id twice, and `resetTokens` / `orphanedFeedbacks` lists when present (extra top-level keys stay inert). `normalizePersistedData` turns a bad `teams` into `[]`, so a malformed upload would otherwise be coerced into a wipe-everything empty restore (an explicit `teams: []` still restores to empty), and a nameless team crashes the replace partway, after the earlier teams are written and before the index, the meta and the cleanup. The uploaded route checks before its snapshot (`400 invalid_backup_data` with `reason`) and answers its body limit as JSON; the import checks at write time; the stored-backup route checks the backup exists **from the metadata alone** before the gate and the snapshot (an unknown id used to leave an orphaned protected snapshot), then reads and checks the archive **after** the snapshot, deleting the snapshot on a refusal — never parse a whole-store archive before the snapshot, which dumps the whole store too and would hold both copies at once. Imported rows (`type: 'imported'`) are never purged and survive every restore: `savePersistedData` never touches the `backups` table. Then, after the replace, they clear this pod's session cache and `io.serverSideEmit('sessions-invalidated')` so **every other pod drops its session cache too** (correct at `replicas:2`; single-pod deployments skip the broadcast), and finally re-run `migrateLegacyPasswords` over the restored records: an archive predating password hashing puts clear-text passwords back into a store the startup migration already cleaned, and the startup pass runs only at boot. The rehash never changes the restore's outcome — a restore that really happened must not be reported as failed. **Nor may the parsed archive still be reachable when that pass runs**: the passes read the store again (projections now, but the parsed archive is still the largest object a restore builds), and an async route's suspended frame keeps every local it declared, so both routes read, check and apply the archive in a helper of their own (`applyStoredArchive`, `applyUploadedArchive`) that answers only the outcome. `__tests__/restoreArchiveRetention.test.ts` observes it with `gc()` in a child `node --expose-gc`. Residual: a client actively connected to a live session at the instant of restore can re-persist its in-memory session once as a fresh row — bounded (a new session, never a ghost team) and expected during a global rollback, so run restores during low activity.
- **Rating a closed action is team-record-owned too, and it is the one place many clients write the same record.** Every other per-user value lives in the session blob behind the `_rev` CAS; `impactRatings` lives on the action, because the dashboard rollup reads the team record and a vote must outlive the session that collected it. Three rules follow. **`closedAt` is stamped only by the paths that actually close an action** (`dataService.toggleGlobalAction`, `updateGlobalAction`, and `/api/team/:teamId/action`) — never from a full-session persist, which carries no reliable closing moment; an action with no `closedAt` is never proposed for rating, which is what keeps the pre-feature backlog out. **A vote goes through the narrow `/action/impact` route**, never a whole-action write. **Both closed-action guards — `reconcileRetroActionState` (client) and its server mirror — preserve `closedAt`, `impactRatings` (union) and `impactDeferredBy`** on top of `done`, because all three are written through routes that do not advance the retro `_rev`, and all three are additive: a session blob never legitimately removes a vote, a closing date or a deferral. Which closed actions a retro asks about is derived, not stamped — an action is "already asked" when it appears in a previous retro's `closedActionsSnapshot`, so there is no moment a fast facilitator can skip past, and `impactDeferredBy` (set by "Rate later") is the only decision that needs storing. **`closedActionsSnapshot` is the list the round *displays*, not the list it *asks about*.** Those were the same thing until the deferral became a toggle, and every consumer that means "the actions we are waiting on answers for" now has to go through `isDeferredInRound` / `rateableRoundActions` in `closedActionsForRating.ts`. Reading `snapshot.length` instead is what made a round of 9 with 2 postponed report `7/9` forever with the green tick unreachable, and the numerator matters as much as the denominator: a participant who answered before the deferral otherwise read `7/7` while someone who had not read `5/7`. **"Rate later" is a toggle and the row stays on screen while it is on** — removing it was the obvious implementation and the wrong one, because the only control that could bring a row back ("Rate now") lives on the *open* actions list, which no longer holds a closed action, so a mis-click cost the round that action with no undo anywhere in the session. Deferring never discards the votes already cast either: they are the participants' answers, and un-deferring has to put the row back as it was. The lag is structural: `selectClosedActionsForRating` excludes anything that was in this session's `openActionsSnapshot`, so an action ticked off right now belongs to the *next* retro's round unless the facilitator explicitly pulls it in with "Rate now"
- **Closing an action is team-record-owned**: An action is closed/re-opened (`done` toggled) through the granular action endpoints (`toggleGlobalAction`, i.e. `/api/team/:teamId/action`), which update the team record first — from the Dashboard **and** from inside a session (`OpenActionsPhase` and `ReviewPhase` both toggle through them, for carried-over *and* newly created actions). A full retro-session persist (`dataService.updateSession` → `/retrospective`) therefore runs `reconcileRetroActionState`, which guards the single `done: true → false` transition: a stale full-session blob — an open Session whose React state predates a close, or a lagging client re-persisting a retro while browsing — can no longer silently re-open a closed action. A *legitimate* re-open still works because it goes through the granular endpoint (which sets the stored record open first, so the guard lets it through). `assigneeId`/`text` and proposal state are deliberately **not** reconciled: several session-only flows (accepting/editing a proposal in Discuss, assigning a ROTI follow-up in Close) legitimately set them through the session blob without a granular endpoint. The `/api/team/:teamId/retrospective/:retroId` server handler enforces the **same** closed-only guard (`/action` does not advance the retro `_rev`, so a full-retro persist from a client that never saw the close would otherwise clear the rev guard and re-open it), which also protects the multi-client case where the reverting client's own cache is stale.

## Email addresses

**One rule, in `utils/emailAddress.js`, for every address the product stores or
mails.** A facilitator stored her team's recovery address as
`elisabeth.trolliet@etat.ge.ch;` — the semicolon Outlook leaves on a copied
recipient. Nothing refused it, `/api/send-password-reset` compared
`trim().toLowerCase()` of both sides, never found a match, and answered its
deliberately silent `204`; she waited for a mail that could never come and
created a second team. Every write path had its own idea of an address (a
permissive regex in two routes, none in the others, trim-and-lowercase on the
client), which is how a value one path accepts becomes one another can never
match. The module is plain JS in `utils/` for the reason `passwordPolicy.js` is:
the routes and the React forms both import it.

- **Clean, then judge.** `cleanEmail` removes what a paste leaves around *one*
  address (a display name and its `<…>`, `mailto:` and its query, quotes and
  brackets, a trailing `;` `,` `.` `:`, no-break and zero-width characters) and
  lowercases it; it never picks one address out of several. `isValidEmail` is
  strict: ASCII, one `@`, no empty or doubled dots, a top-level domain of
  letters (or `xn--`), at most 254 characters — so `a@b` is refused, which
  reverses the "internal single-label domain" an invite test used to accept.
  `parseEmailInput` chains them: `undefined`, `null` or a blank string is a
  **clear**, anything else that is not one valid address is refused.
  `sameEmail` compares two values through the cleaning; the reset route uses it.
- **The server enforces it; the screens only explain it.** `/api/team/create`,
  `/api/team/:teamId/update` (before the name claim), `/api/super-admin/update-email`,
  `/api/super-admin/update-admin-email` and `/api/send-invite` answer
  `400 invalid_email` and store or mail the cleaned address.
  `/api/team/:teamId/members` cleans but **never refuses** — a roster write
  carries joins — and never cleans one member into an address another member
  holds, because member emails are identities on the client. `dataService`
  checks first and throws `INVALID_EMAIL_MESSAGE` (English, translated through
  `i18n/errorMessages.ts` → `errors.invalidEmail`); the client's identity
  matching (`dataService`, `TeamLogin`) goes through `cleanEmail`, a superset of
  the trim-and-lowercase it replaced.
- **A team is created with a recovery address or not at all** (37.0). A team
  without one has no way back from a forgotten password — the facilitator above
  created a second team instead. `/api/team/create` answers
  `400 recovery_email_required` for an absent or blank value
  (`RECOVERY_EMAIL_REQUIRED_ERROR` in `utils/emailAddress.js`, with its English
  sentence for `dataService` and `errors.recoveryEmailRequired` on screen), and
  the create form marks the field `required`. `parseEmailInput` still reads a
  blank value as a clear: creation refuses that clear itself, so every other
  route keeps letting a team remove its address. During a rolling update a
  create form from before this release can omit the address and is refused with
  the raw code — the safe way to be wrong. The rule binds the *team-side*
  creation only: the console's merge takes the address the admin chooses
  (possibly none), and a team deleted since a backup comes back with whatever
  the archive held. Both are super-admin operations on teams that already
  existed, and the console can set the address afterwards.
- **The reset comparison cleans both sides.** Typed and stored values are both
  parsed and must be equal and non-empty; the mail goes to the *stored* cleaned
  address under the stored team name, never to the caller's strings. A stored
  value holding two addresses never matches, on purpose.
- **Stored values are healed, not just new ones.**
  `server/services/emailMigration.js` → `healStoredEmails` cleans each team's
  `facilitatorEmail`, member and archived-member emails, and
  `global-settings.adminEmail`. It runs at startup right after the password
  migration and after both restore routes (an older archive puts dirty values
  back), scans the summaries projection (`loadTeamSummaries({ withArchivedMembers: true })`)
  rather than full records, and follows `passwordMigration.js`: it never throws, re-decides inside
  `atomicTeamUpdate` so a newer edit is never overwritten, prints one summary
  line on every run, and names a value it cannot clean by **team id, never by
  address**. It does not touch `session:*` rows or the participant and invitee
  copies inside retros and health checks: the client compares those through
  `cleanEmail` on both sides, and rewriting a live session row from a startup
  pass would race every client writing it.
- **The Dashboard field commits, it does not stream.**
  `components/dashboard/RecoveryEmailSetting.tsx` keeps a draft, commits on blur
  or Enter, says "saved" or "removed", and ties its error to the field
  (`aria-invalid`, `aria-describedby`). It used to save every keystroke, which
  is how the pasted value was stored as typed. "Saved" means the server stored
  it: `updateFacilitatorEmail` awaits the write (still behind the persist queue)
  and a refusal shows on the field. A Dashboard from the previous
  release still saves every keystroke during a rolling update: its partial values are refused and
  only logged there, and the last valid one lands — the safe way to be wrong.
- **A legacy roster address is kept, not refused, on edits that do not touch
  it.** `updateMember` judges the address only when it changed, so a member
  stored as `jdoe@corp` can still be renamed. Identity lookups prefer the exact
  stored spelling before the cleaned form, because the server keeps
  `a@x.ch;` and `a@x.ch` apart as two members. Inviting by email checks each
  address against the rule first, so an address the server would refuse gets no
  member and no link.

## Merging teams (super-admin)

A facilitator who could not recover her password created a second team rather
than lose the session (see *Email addresses*), and the team then lived in two
halves. The console's **Teams** tab can merge two teams into a **new, third
one**; the admin checks it, then deletes the two originals from the same tab.
`server/services/teamMerge.js` is the planner (pure: no I/O, no clock, ids
injected), `server/services/mergeSources.js` reads a team as the merge sees it,
`server/routes/superAdminTeamMergeRoutes.js` holds the three routes,
`components/admin/` the two dialogs.

**Three promises, and every rule serves one of them.**

- **The sources are never written.** The merge creates one record and touches
  nothing else, so undoing it is deleting the merged team, and checking it is
  comparing it with two teams still exactly as they were. The sources stay
  usable until they are deleted — and what is written there after the merge is
  *not* in the merged team; deletion is what notices (`source_changed`).
- **Nothing is lost.** Every retrospective, health check, action, member,
  archived member and template of both teams is in the result, and
  `assertMergeInvariants` refuses to return a team whose counts do not add up or
  whose ids repeat. A team collection that is present but not an array
  refuses the merge (`422 source_needs_repair`, naming the field) rather than
  be dropped; a malformed member is carried verbatim. **Feedbacks are
  the one exception**: they *move* when a source is deleted, because a copy
  would show twice on every board under the same id.
- **Nothing is overwritten.** Where the two teams collide — a retro or action
  id, a member id, a map key (votes, ratings, `impactDeferredBy`), a template
  name — both are kept, the second re-minted or renamed, and the report says so.

Rules that look like details and are not:

- **A source is its record plus any live session row ahead of it.** Receivers
  never persist and a closed tab never sends its last persist, so the team
  record lags `session:{id}`. A row counts only when it is bound to the same
  team and its *work* differs — who looked at it and where the phase bar stands
  do not count — so "freshened" in the report means the merged team really holds
  something the record lacked. The record still wins for the
  fields only granular routes write — an action's `done`, `assigneeId`, `text`,
  `closedAt`, `impactRatings`, `impactDeferredBy` — exactly as `Session.tsx`
  reconciles them. A row that cannot be *read* is not "no row": the merge
  refuses (`503 session_read_failed`).
- **Retros and health checks get new ids** in the merged team, with `teamId`
  rewritten: `session:{id}` rows are global keys, and reusing an id would put
  the merged team in the sources' live rooms.
- **Members are unified only when it is unambiguous**: the two facilitator
  seats; the same valid email, held by one member on each side; the same name,
  unique on both sides, with no conflicting email. Anything else is kept as two
  members and listed in the preview ("Same name, kept as two members"), and two
  members left apart with one email are reported, because member emails are
  identities on the client.
- **The admin confirms the plan shown, not a later one.** The preview returns
  `fingerprints` of both teams as planned (roster included). The merge requires
  them (`400 missing_fingerprints`) and refuses with
  `409 sources_changed_since_preview` when either moved; the dialog then reloads
  the preview.
- **A team is never merged with a relative** (`409 related_teams`, the preview
  included): one built from the other, or two merges sharing a source. Either
  way both hold the same work, and the merge would copy it twice. The chain is followed at any depth through
  signed provenance, and each entry records its source's own ancestors
  (`ancestorIds`), so it survives the deletion of a team in the middle. The
  remedy for a source changed since its merge is to merge the **original** teams
  again, which is what the deletion dialog says.
- **The name is free in the index and on every record**
  (`teamNameIndex.js` → `nameHeldByAnotherRecord`), claimed before the record is
  saved and released only if this request added it. Two teams cannot share a
  name, so the merged team needs a new one; once the sources are deleted it can
  be renamed — **before** its invitations go out, since an invite names the team.
- **Provenance is signed, all of it.** The merged team carries `mergedFrom`:
  per source, its id and name, the time, a content digest (`fingerprint`), a
  record-only digest (`recordFingerprint`), per-part digests and counts, the
  source's ancestors, and the digest of the merged team as created
  (`mergedFingerprint`, `mergedParts`). The digest ignores what browsing writes
  (presence, the phase bar, the timer), so a participant opening a closed retro
  is not a change — but **reaching Close is**: a stored `CLOSED` is final, and a
  session closed in a source after the merge would otherwise stay IN PROGRESS
  for good in the merged team. The HMAC (`signMergeProvenance`, keyed by
  `SESSION_TOKEN_SECRET`) covers the merged team's id and **every field** of the
  entry in canonical JSON (PostgreSQL's jsonb reorders keys), so an entry can be
  neither copied onto another team nor edited in place. A team could write
  `mergedFrom` through `/update` before this release, so an unsigned or edited
  entry shows as "(not verified)" in the console, can only *add* a warning, and
  never decides anything. Without a stable `SESSION_TOKEN_SECRET` the signatures
  die with the process: every source deletion then asks for an acknowledgement
  (`merge_unverified`) and the feedbacks are orphaned, which is safe.
- **Jira: links travel, the token does not.** An action's `jira` is
  record-owned like `done` (`RECORD_OWNED_ACTION_FIELDS`), the merged team takes
  the primary's `jiraTarget` by the unknown-key rule, and `jiraClaims` and
  `jiraParentClaims` are known keys that are never carried. The session
  parents (`jiraParents`) are **re-keyed** to the merged team's session ids
  through each source's id maps (`mergedJiraParents`): a parent of a session
  the source no longer holds is dropped, and the dashboard's (`backlog`) is the
  primary's, else the secondary's. Carried as an unknown key, the primary's
  would name ids no session has and the secondary's would read as a conflict.
  The token is a row of its own (`team-secret:{teamId}`) and is not copied:
  the merged team enters one. **An
  action that is not in Jira yet keeps its id in the merged team**, so until the
  sources are deleted the source and the merged team can each create an issue
  for it — a residual, not gated (see *Jira*).

**Deleting from the console** (`/api/super-admin/delete-team`) never relies on
the admin having remembered: it says what the deletion would cost, with a digest
of those facts (`confirmation`), and proceeds only when the admin acknowledges
*those* reasons and sends the digest back. Anything that changed meanwhile — a
reason, a session opened, a source's or merged team's work moving on — changes
the digest and the facts are shown again, with a line saying so; a reason not
acknowledged is never waved through by another. The digest deliberately leaves
out the record's revision: a team with a live session writes its record every
few seconds, and binding to that made it impossible to confirm. Facts are
sorted before hashing, since PostgreSQL returns summaries in storage order.

- `source_changed`: the source's effective content matches no **signed** merge
  that lists it, with *what* changed (a retro by name, the backlog, the
  templates). After a restore every live row is gone, so the record-only digest
  stands in — but only when no live copy is ahead of the record now. A source
  that only *lost* retros since its latest merge is unchanged: they are in the
  merged team.
- `merge_unverified`: the team is listed as a merge source only by unsigned
  provenance, so nothing confirms the merged team holds its work.
- `merged_team_changed`: a merged team was used after its merge, so deleting it
  is no longer just undoing the merge.
- `sources_deleted`: a merged team whose sources are gone holds their only copy.
  Neither of these two is asked of a merged team that is itself an unchanged
  source of a later merge: that later team holds all of it.
- `sessions_open` / `sessions_unknown`: someone is in one of its sessions, or
  that cannot be known. Unknown is a reason too, and so is a failed read of the
  merge targets — that answers `500` and deletes nothing.

A protected "Pre-delete snapshot" is taken before anything is removed, and the
record is **read again after it**: a write that landed while the checks and the
whole-store backup ran answers `409 team_changed` with nothing deleted, and the
snapshot taken for it is removed (what
remains is the width of one read and two deletes, as on the team-side
deletion). These snapshots are protected, so retention never prunes them: each
deleted source leaves one full-store archive, pruned by hand like the
pre-restore ones. Feedbacks move only into the merged team the admin confirmed
and the merge signed (the dialog offers one only when exactly one signed merge
lists the team), re-checked under the lock; the moved copy is stamped
`movedFromTeamId`, a retry adds only the comments it lacks and never replaces
it, a colliding id is re-minted, and the comments **this** source wrote become
the merged team's own (once it is gone nobody could delete them) — in every
merged team the merges signed, even when it had no feedback to move. The other
source's comments stay its own until it is deleted in turn. A source deleted
from its own Dashboard knows nothing of merges: its comments in a merged team
stay under its id, deletable by the super admin. The console says so
when feedbacks it announced would move were kept in the Feedbacks tab after all.

**A team deleting itself is unchanged**: `/api/team/:teamId/delete` is never
refused for a merge, and its feedbacks are orphaned as always. The Dashboard now
waits for the answer and shows a failure instead of logging out as if the team
were gone.

During a rolling update a pod from before this release does not serve the merge
routes (the console reports a failure) and its `/update` still accepts
`mergedFrom` — which is what the signature is for — and returns it to team
members. A member could then *remove* the signed provenance through such a pod,
after which a source deletion orphans its feedbacks and checks nothing against
that merge: **do not merge while a rollout from a release before 36.0 is in
progress**, and expect the same exposure after a rollback. Both operations are
recorded: `team.merge` (sources, counts, which password opens the merged team —
as `passwordSource`, because the log redactor blanks keys named like a secret —
and where its recovery address came from, `recoveryEmailSource`, never the
address) and `team.delete` (the snapshot id, the reasons acknowledged, where the
feedbacks went). The merged team's password is its own: changing a source's
password later does not reach it, which the dialog says.

## Restoring one team (super-admin)

The whole-store restore is a faithful replace: right when everything went
wrong, wrong when one team lost a retrospective, because it also rolls every
other team back. The console's **Backups** tab therefore has a second action
per backup, *Restore a team*: `components/admin/TeamRestoreDialog.tsx` lists the
teams the backup holds and what became of each since (still there, renamed,
deleted), `server/routes/superAdminTeamRestoreRoutes.js` holds the two routes,
and `server/services/teamRestore.js` (pure) decides the record it writes.

- **A file is restored by importing it first.** The Backups tab's *Import a
  backup file* card (`components/admin/BackupImportCard.tsx`) sends it to
  `/api/super-admin/backups/import`, which stores it as one row of the shared
  `backups` table, of type `imported` (a violet "imported" badge, the file name
  as its label). Every backup route then reads that row unchanged — this
  dialog, the whole-store *Restore*, the download, the delete — and the console
  opens this dialog on the new row by itself, unless the file holds no team.
  The row holds the uploaded bytes (gzipped first when they were plain JSON),
  validated once at import by the rule every restore applies
  (`archiveShapeProblem`) and read back by the same parser. Nothing is kept in
  memory between requests, so the calls that follow can land on any pod: the
  row is committed before the import answers. Several teams can be restored
  from one import, and the row is deleted by hand when done. A team from
  another deployment comes back as "deleted since the backup", with the
  archive's password and **no feedbacks** (they are never taken from an
  archive). A pod from before 41.0 answers the import with an HTML 404, which
  the console reads as "not available yet, try again in a few minutes"; it
  lists, restores from, downloads and deletes an imported row like any other.
  The upload limits are `RESTORE_MAX_BODY_MB` / `RESTORE_MAX_DECOMPRESSED_MB`;
  in front of the application, ingress-nginx's 1 MiB default and the
  OpenShift Route's 30 s timeout are the operator's (k8s/README.md → *Upload
  size and timeouts*), and the console tells a proxy's HTML 413 from the
  app's JSON one. A lost answer (a 504 at 30 s while the server still works)
  reads as *uncertain*: the list is read now and again 20 s later, because a
  blind retry would leave a duplicate row.
- **Residuals of restoring from a file, stated on purpose.** *Each team
  restored leaves its own protected "Pre-restore snapshot"*, which retention
  never prunes, so restoring five teams from one import leaves five
  whole-store copies to delete by hand, with the imported row; the card says
  so. *A team from another deployment keeps its actions' Jira keys*
  (`ActionItem.jira` is a key, never a URL): they render against **this**
  deployment's Jira address and read as "already in Jira", which is right only
  when both deployments use the same Jira. No archive records which Jira a key
  belongs to, so this is stated, not detected. *It also keeps its Jira target
  and each session's parent issue* (`jiraParents`: a team from another
  deployment comes back as "deleted since the backup", and that branch of
  `planTeamRestore` takes the archive's map whole). Unlike an action's key, a
  parent key routes: in the mode that gives each session a parent, the next
  sends go as sub-tasks under those keys in **this** deployment's Jira, with no
  lookup first (`destinationOf`), and a key this Jira also holds is accepted
  silently. Before sending, check the parent issues the batch dialog and the
  Review step list; to re-point a session, name a parent and tick the replace
  box (`replaceParents`), or change the target in *Settings → Jira*.

- **The work comes back; how people get in does not.** Retrospectives, health
  checks, the backlog, members, archived members, templates and team settings
  (except the Jira target) are the backup's. While the team exists, its **name,
  password, invite epoch, recovery address, feedbacks, merge provenance, last
  connection, Jira target and the server-only `jiraClaims` and
  `jiraParentClaims`** stay as they are now (`KEPT_FROM_CURRENT`): rolling a
  password back locks out everyone who knows the current one, and rolling the
  invite epoch back revives revoked invite links. The current Jira links are
  carried onto the restored actions (`carryJiraLinks`; a current key also
  replaces an archived "may already be in Jira" mark), the session parents too
  (`carryJiraParents`: per session the current key, else the archived key,
  else a mark — the newest routing decision wins, since a session re-pointed
  since must not go back), planned inside the final write so a parent created
  while the restore ran is kept, and the team's Jira token is never touched.
  A team deleted since the backup has no current values, so it returns with
  the archived ones — under its old name, or a name the admin types when another team holds
  it now (`409 team_name_exists` otherwise, with nothing written).
- **Feedbacks are never rolled back.** They are a board shared with the super
  admin, not the team's work. A team that exists keeps its own; a deleted one
  gets back the copies its deletion moved to `orphanedFeedbacks` — with every
  reply since — and never the archive's, which may have moved into a merged
  team meanwhile, and are stamped with the name the team comes back under (the
  board shows a feedback's own `teamName`, and the old name may be another
  team's now). The orphans leave `orphanedFeedbacks` after the record is
  written, and only those still exactly as the plan read them: a reply posted
  to one while the restore ran keeps it there too. A duplicate the admin can see
  beats a reply that vanished (`feedbacksStillOrphaned`).
- **Every restored retro and health check lands above every live copy.** A
  full-blob persist is refused only when its `_rev` is *strictly* older, and the
  live `session:{id}` row runs ahead of the record, so each restored entry gets
  `max(archived, stored, live row) + 1`. Without that, the next persist from a
  participant still holding pre-restore state would undo the restore a second
  later. The live revisions are read **after** the snapshot, which dumps the
  whole store and can take seconds while a session moves on. Every restored
  entry that has been run then gets its row through the session
  compare-and-swap: an existing row is overwritten and sent to its room
  (`session-update`), so people in the session see the restore; a missing one
  is **written** (`sessionsSeeded`) — after a whole-store restore none exist,
  and without one a client whose cached team record predates the restore would
  seed the session from that cache at a revision the record accepts. Rows
  people may be in are written first, so a live session never waits behind the
  seeding of every old retro. A row that lands above the record's revision —
  a socket write reached it between the record write and this one, and its
  sender was acked at the record's revision — has the record entry re-stamped
  at the row's revision, or that sender's next persist would pass the record's
  guard with the pre-restore state. A written row is cached and broadcast only
  while it is still the latest: clients apply
  every `session-update` they receive, so publishing it after a participant's
  newer write would take the room back over that write. Other pods' caches need
  no invalidation because a cache read keeps the higher revision. A row that cannot be *read* stops the restore before anything is
  written (`503 session_read_failed`); a row that cannot be *written* afterwards
  is reported (`sessionsNotUpdated`) and the console asks for a reload. A retro
  created after the backup is not in the restored record, but a participant
  still in it keeps saving it — live work is not destroyed silently, and the
  pre-restore snapshot holds the rest. Its actions come back without the Jira
  links they had: no current copy holds them to carry over (see *Jira* →
  residuals). The re-stamp of a lifted entry carries the record's current Jira
  links first, so a key a batch wrote while the rows were written survives it.
- **The usual safety net.** Checked first (archive, the team's current state
  against what the console showed, the name), then a **protected**
  "Pre-restore snapshot", then the live session rows (a row that cannot be read
  deletes the snapshot and answers `503 session_read_failed`), then one
  compare-and-swap write of the record (`atomicTeamUpdate`, or `atomicTeamSave` at revision 0 for a
  deleted team, so a team that reappeared meanwhile is not overwritten:
  `409 team_changed`). A refusal after the snapshot deletes it; an unexpected
  error keeps it, because the write it guards may have landed. Two restores of
  the same deleted team share one name claim, so a failing one gives the name
  back only while **no record** holds it, and a successful one claims it again
  after its save — releasing on the first one's failure is how the second's
  record would lose the name it logs in by. That re-claim is best-effort: the
  team is recreated by then, and an error there must not answer 500 and skip
  what follows.
- **What the console showed is what happens.** The two cases restore different
  credentials, and the dialog explained one of them, so it sends `expected`; a
  team deleted or recreated since its list was read is refused with
  `409 team_changed` and the dialog reads the list again.
- **One restore at a time.** The three restore routes — this one, the stored
  whole-store restore and the uploaded one — share `server/services/restoreGate.js`
  for their whole run and refuse a second with `409 restore_in_progress`;
  overlapping, a whole-store replace and a team write each report success and
  leave a hybrid of two backups. The gate is **per pod**: two requests routed to
  two replicas do not see each other. A shared lock needs a store record with an
  expiry; restores are rare and deliberate, so that residual is accepted and
  stated here rather than built for. **An import is not a restore**: it writes
  one `backups` row and nothing a restore writes, so it takes its own per-pod
  gate (`createImportGateMiddleware`, `409 import_in_progress`), entered before
  the body is read and **held until the handler settles, not until the client
  leaves** — `res` emits `'close'` when the client disconnects (a gateway 504
  included) while the handler is still gunzipping, parsing and inserting, and
  the retry that follows must not stack a second upload on a 384 Mi pod. Each
  entry has one release, called once: by the handler's `finally`, by the
  body-error handler, or by `'close'` only when the handler never started. It
  bounds import against import; an import beside a restore on the same pod is
  the documented memory ceiling (k8s/README.md → *Automated backups*).
- **The console says every partial outcome.** Sessions not updated (ask for a
  reload) and feedbacks left in two places (delete the extra copy in the
  Feedback tab) each have their own notice, and one notice when both happen. The password and
  email passes of the whole-store restore run afterwards, and the action is
  recorded as `team.restore` — its own name, so the trail tells "the store was
  rolled back" from "one team was".

## Jira

Teams create their actions as Jira issues from the Review step (retrospective
and health check render the same Jira components) and from the Dashboard's
Actions tab. In the Review step one click sends the session's new actions
(`ReviewPhase` passes `newActionsForJira`), and the previous open actions a
retrospective shows are sent one at a time, each from its own row; the
Dashboard's batch sends every open action the tab lists, and each row has its
own control too. The super administrator connects **one** Jira for the
deployment in the console (`components/admin/JiraSettingsCard.tsx`); each team
stores **one** token and a target in *Settings → Jira*
(`components/jira/JiraTeamSettings.tsx`). A target is one of three modes:
`project` (issues in a project), `parent` (sub-tasks of one issue) and
`sessionParent` (sub-tasks of one parent issue per retrospective or health
check, created in a project the first time one of its actions is sent; the
dashboard's actions share one parent for the whole team). The
browser never talks to Jira — the CSP's `connect-src 'self'` forbids it, and
Data Center sends no CORS headers — so every call goes through
`server/routes/jiraRoutes.js` → `server/services/jiraClient.js` →
`server/services/outboundHttp.js`, to the configured address only. The batch is
`server/services/jiraIssues.js`; the browser side is `services/jiraService.ts`
and `components/jira/`. The rules both sides apply — keys, addresses, targets,
what an issue holds — are pure modules in `utils/jira.js` and
`utils/jiraIssueContent.js`. Data Center is served by a personal access token
(Bearer), Cloud by an email and a classic API token (Basic): the scheme follows
the credential, never a stored "deployment" flag. `__tests__/helpers/jiraMock.ts`
is a Jira for tests — mounted under `/jira`, paginated, validating like Jira —
that the unit suites and `e2e/jira.spec.ts` both start.

Rules:

- **A link is a key, never a URL.** `ActionItem.jira` is `{ key, createdAt }`
  or `{ uncertainSince }`. The href is built when rendering, from the
  configured address and a key that passes `JIRA_ISSUE_KEY_PATTERN`
  (`jiraBrowseUrl`); with no known address the screen shows the plain text
  "Jira: KEY", never an `<a>` without href. `actions` is not a protected session
  field, so a stored URL would be a link any participant could plant on the
  facilitator's screen.
- **The token lives in a row of its own, sealed, and bound.**
  `team-secret:{teamId}` holds AES-256-GCM (16-byte tag, checked) under
  `deriveKey('jira-token/v1')` from `SESSION_TOKEN_SECRET`, with the additional
  authenticated data `team-secret:<teamId>|<canonical base URL>`: a row moved
  onto another team, or read after the console changed the address, does not
  open, so a token never travels anywhere but where it was checked
  (`secretBox.js`, `jiraCredentials.js`). Never on the team record, which
  reaches every browser, every merge and every archive. Storing is refused
  without a stable secret (`503 jira_secret_unavailable`): a per-process key
  would die with the pod and differ on every replica — and under the templates'
  example secret, whose key anyone can derive (`tokenService.canSealSecrets`,
  checked before sealing; `hasStableSecret` alone would accept it). No route
  returns it. A dump opens the tokens only together with the secret, so the two
  are kept apart; after a suspected leak of either, teams revoke their token in
  Jira and save a new one, since the old one entered again stays readable from
  every earlier dump.
  Deleting a team deletes its secret **first**; the token route re-checks
  `teamExists` after saving; a startup sweep removes rows whose team is gone.
- **The connection is a key of its own, read strictly.** `jira-settings`, not
  `global-settings`: that blob's writers used to read-modify-write it with a
  read that answers `{}` on error, so one database hiccup would have erased
  Jira. They now go through the strict, locked `updateGlobalSettings` (see
  *Key Design Principles*), and the connection keeps its own key anyway: the
  console writes it whole, and a row nobody else writes cannot lose a
  neighbour's change. A failed
  `loadJiraSettings` answers `500`, never "Jira is off" — which would make every
  team's buttons vanish. Neither key is ever in an archive
  (`__tests__/archiveContract.test.ts`).
- **A stored link always wins, on every path that writes an action.** Only
  `/jira/issues` writes `jira`. `reconcileStoredActions` and
  `mergeActionImpactState` keep the stored value; the retrospective and
  health-check persist handlers drop a link the record does not hold, on new
  actions too (`withoutUnstoredJiraLinks`); `/action` takes it from the record
  (`withRecordedJiraLink`); the client keeps one it knows (`mergeJiraLink`, used
  by `Session.tsx` — the Review-entry snapshot rebuild included — `ReviewPhase`
  and `HealthCheckSession`), and `dataService.updateGlobalAction` never takes
  one from its caller. Both restores carry the current links onto the archived
  copies (`carryJiraLinks`; a current key also replaces an archived uncertain
  mark): the token is not rolled back, so an action restored unlinked would be
  created again. A merge treats `jira` as record-owned. `jiraTarget` and
  `jiraClaims` are kept from the current record in a single-team restore
  (`KEPT_FROM_CURRENT`); `jiraClaims` is server-only (stripped from every
  response, ignored by `/update`, never carried by a merge) and `/update`
  ignores `jiraTarget` too. The session parents follow the same line:
  `jiraParents` (sent to clients) and `jiraParentClaims` (server-only, stripped
  like `jiraClaims`) are on the team record only — never on a retro entry,
  whose persist replaces the whole entry, nor on a session row — written by
  `/jira/issues` alone and ignored by `/update`. The single-team restore keeps
  the current claims and carries the parents, the whole-store restore carries
  them too (`carryJiraParents`), and a merge re-keys them (see *Merging
  teams*).
- **Claim, then call — and a lost answer is "uncertain", never a retry.** Each
  action is claimed inside `atomicTeamUpdate` — the row lock, so the claim is
  exclusive across pods — in `team.jiraClaims[actionId] = { at, requestId }`,
  and that same write links the previous action. Under the lock: a key answers
  `already_linked`, a done action `closed`, a claim younger than
  `JIRA_CLAIM_TTL_MS` (60 s) `in_progress`, and an older claim turns the action
  into `{ uncertainSince }` — its request died mid-creation, and the issue may
  exist. A `201` writes the key on every copy of the action (two retries, then
  `created_not_saved` and the stop `link_not_saved`); when another request
  linked it meanwhile, the key already there wins and the duplicate is logged.
  A definite refusal clears the claim. A `400` belongs to its action and the
  batch goes on — unless Jira named a field the target sets (`labels`,
  `issuetype`, `project`, `parent`): every action would be refused the same
  way, so the batch stops after that one (`jira_target_refused`), and a refusal
  of the labels says where to remove them (plan J-5). A 5xx, or an answer lost once the
  request was sent, marks every copy uncertain, and the screen says "May
  already be in Jira: check it, then create anyway" with a search link; only
  that confirmation sends `force`. An issue is created on a connection of its
  own (`keepAlive: false`): a pooled socket Jira closed at the wrong moment
  would otherwise fake a lost answer.
- **One parent per session, claimed like an action** (`sessionParent` mode).
  An action's scope comes from the very `issueSource` its content is written
  from (`jiraParentScope`): `retro:<id>`, `healthcheck:<id>`, or `backlog` for
  an action no session holds — so an earlier action sent from a later retro's
  Review goes under its own retro's parent. A parent is claimed only for an
  action about to be sent (every skip and refusal is decided first), in
  `team.jiraParentClaims[scope]`, under the same row lock; the action is not
  claimed in that write. The parent's `201` lands in one write that stores
  `jiraParents[scope] = { key, createdAt, subtaskTypeId }`, drops the parent
  claim and claims the action under the key — so each claim spans exactly one
  Jira call, and a key another request stored meanwhile wins (the duplicate is
  logged). Every later send of the scope reuses the key, with no parent call.
  A live foreign claim answers `parent_in_progress`; an expired one marks the
  **scope** `{ uncertainSince }`, dated by the claim, and the action
  `parent_uncertain`. A lost answer marks the scope, never the action (it was
  not sent), keeps an earlier mark, and stops the batch; a marked scope is
  skipped until the facilitator confirms **that scope**
  (`forceParentScopes`), which lifts that skip and nothing else (`force` is
  the action's). A confirmation is for the doubt the dialog showed, never the
  request's: a doubt the server finds during the send — an expired claim,
  which no screen can see, so the dialog previewed that session as "new" — is
  never lifted by it, for the rest of that request (`doubtsFound`), and the
  client stops confirming a scope once an answer reported it in doubt, so the
  next requests of the batch do not lift it either [review F2-1]. The client
  sends with each request only the confirmed scopes of that request's own
  actions, which is what bounds the list to one per action. Any Jira refusal
  of a parent stops the batch (`jira_parent_refused`): the same type, project
  and labels go on every parent — Data Center's required Epic Name is the
  typical case. A parent key that cannot be stored is answered `not_saved` with the key, stops
  `link_not_saved`, and its claim expires into a mark. The sub-task goes in the
  parent's project (`jiraProjectKeyOf`), with the target's sub-task type when
  that is the target's project, else the type recorded with the parent. The
  parent's summary and description are `parentIssueFields`, in the scope's
  content language, labels included; its title is fixed at creation.
- **A parent named at send time is adopted only once Jira took a sub-task
  under it** [R1]. A `parent`-mode one-time target with `adoptParent` sends
  every action under the parent named, and makes it the stored parent of each
  scope with no key (or only a mark, or only an expired claim; with
  `replaceParents`, one with a key too) **in the write that stores the key of a
  sub-task created under it** (`adoptParent` in `jiraIssues.js`) — never in the
  claim write. A refused sub-task, a lost answer or a key that cannot be saved
  changes no scope; a live foreign parent claim is left alone. The adopted key
  is the one Jira's lookup answered, and a parent that cannot hold sub-tasks — a
  sub-task, or on Cloud a type above level 0 (an epic) — is refused once,
  before anything is created (`jira_parent_invalid`, `cannotHoldSubtasks`).
- **A request is short.** At most `JIRA_MAX_ACTIONS_PER_REQUEST` (10) ids; no new
  creation after 10 s (the first always starts, or a slow Jira would answer
  every request with nothing done and the client would loop); 15 s idle and
  15 s wall-clock per Jira call (`outboundHttp`'s `deadlineMs`, not a socket
  idle timeout); nothing new once the caller has gone (`client_gone`) or the pod
  is draining (`server_restarting`, `isShuttingDown`). What was not attempted is
  `remaining`, which the client sends next. In project mode that keeps a batch
  inside an OpenShift Route's 30 s default, where a user would otherwise see an
  error while the server went on creating. With a parent (sub-task) target it
  does not: the parent lookup (up to 15 s) runs inside the budget and the first
  creation always starts, so a slow Jira can push one request past 30 s; the
  Route then answers 504 while the server finishes the call in flight and then
  stops (`client_gone`), and the client reads it as `outcome_unknown`. A
  session's parent counts as one creation: the budget, the caller and the
  drain are read again before the sub-task that follows a fresh parent, and
  once more after the parent's write [R6], so a `SIGTERM` during that write
  releases the action's claim and starts no call; a parent created past the
  budget is stored and its action waits in `remaining`. A Dashboard request of
  ten actions from ten sessions can need twenty calls: the budget cuts it. A
  draining pod is forced out `DEFAULT_SHUTDOWN_TIMEOUT_MS` (20 s) after
  `SIGTERM`: one Jira call (`JIRA_CALL_DEADLINE_MS`) and the write of its key,
  inside the 25 s the manifest's grace period leaves after `preStop`
  (`__tests__/shutdown.test.ts` holds both bounds, and that a claim outlives
  the one call and write it spans).
- **One live-session patch per session per request.** After the loop, each
  session holding an affected action — and the request's `sessionId`, once its
  row's `teamId` matches — is patched once through `createLiveSessionPatch`
  (the rename's compare-and-swap, generalised in `liveSessionRename.js`),
  stamping `jira` on `actions`, `openActionsSnapshot` and
  `historyActionsSnapshot`; a patch with nothing to change writes nothing, and
  a parent, never on a session row, adds nothing to patch. That
  patch is how a participant learns a key: receivers never read the team record
  again, and the previous actions a retro shows exist only in its history
  snapshot. One per issue would move the revision N times and refuse N of the
  facilitator's summary keystrokes; the `reviewSummary` slice of the own-change
  ledger takes care of the one race left.
- **One rule decides what Jira receives, and the dialog previews it.**
  `issueSource` (which copy of an action, in which session) and `issueFields`
  build the summary — one line, at most 255 code points, never half a surrogate
  pair — and the description: session, date, context, requester, every
  interpolated value through `wikiText()` so user text cannot form Jira wiki
  markup. The content language is the session's template language (a retro
  with none reads English), else the team's latest retro's, else the clicker's,
  else English. The server creates with them and the batch dialog previews with
  them, so what the facilitator confirms is what is sent. The context is quoted
  in anonymous sessions too (maintainer decision D2). The dialog sends the
  target it shows — the stored one as last read, or the one-time change — with
  every request of the batch, never "whatever is stored now": any team session
  may save another target meanwhile (D1), and a batch longer than one request
  would otherwise land in two places. It names the stored target's issue type,
  read once when it opens (its id until Jira answers, or when it cannot) — and
  in `sessionParent` mode the parent issue's type too, from the same read.
  In `sessionParent` mode it also lists the parent issue of each session the
  send touches (`jiraParentPreviews`, built from the same `issueSource` →
  `jiraParentScope` → `parentIssueFields` as the server): the existing key, the
  new parent's title (in its own language, marked with `lang`), or a parent in
  doubt with a search for its title and the one box that confirms the rows it
  shows in doubt — those scopes, with the actions listed under each
  (`forceParents` → `forceParentScopes`), never a row it shows as new.
  It reads this browser's copy of the team, so a row can say "new" where the
  server reuses a parent created meanwhile — never the reverse — and the
  confirm button counts the actions plus the new parents [R9]: high by one
  for each session whose parent another window created since this browser read
  the team (several on a Dashboard batch, which spans sessions), never low. A parent a one-time `sessionParent` change creates is stored for its
  session like any other [R3], and the dialog says so whenever a row is new.
- **The parent issue can always be named, and only through the dialog.** In
  both sub-task modes the dialog shows "Parent issue (optional)"
  (`JiraParentField`), never behind "Change the target": checked with Jira on
  leaving the field (`/jira/issue-types {parentKey}`, which refuses a sub-task
  or a Cloud epic), with a required "Sub-task type in …" list when the
  parent's project does not offer the target's type; Create sends nothing for
  a key not checked or without a type, and says so on the field — an error
  that goes once the check it asked for answers, or when the field is left or
  Enter pressed, since a click on Create leaves the field first and can land
  while that check runs [review F2-2]. It is sent as
  the one-time `parent`-mode target, plus `adoptParent` in `sessionParent`
  mode (and `replaceParents` when "Also use … for their later actions" is
  ticked, offered only when a session of the send already has a parent). So in
  the sub-task modes one action's control is "Create in Jira…"
  (`aria-haspopup="dialog"`) and opens the dialog with that one action — "Create
  anyway" too, with `force` — and when it closes after a key landed the
  keyboard goes to the new link. Project mode keeps the one click, and that
  click sends the target its status shows [R2], as the dialog does: a screen
  whose status went stale while someone saved another target creates where it
  said it would, never a session parent with no chance to name it.
- **The discovery note shows once per browser and person, and only where Jira
  exists.** `JiraDiscoveryNote` remembers who dismissed it in `localStorage`
  (`retro-jira-note-seen`, a list of user ids, every access in try/catch) and
  renders nothing until the status says Jira is on: a deployment without Jira
  must never advertise it. Its last sentence follows the reader's role and the
  token's state. The Settings card follows the same rule (nothing where Jira is
  off, unless a token is still stored, which it then offers to remove).
- **The client sends again only what proves nothing ran.**
  `jiraService.createIssues` retries a `404` whose body is not JSON — an older
  pod during a rollout — with the rollout backoff (about 7 s), and nothing
  else: any 5xx or 408 (even with a JSON code), a gateway's page or a network
  error ends the batch as `outcome_unknown`. Whenever an outcome is unknown the
  service then reads the team once (`settleUnknown`, after `whenPersisted`):
  an action the record shows linked comes back `already_linked` with its key,
  and the links go into the cache with `applyJiraLinks` — never the whole
  record — so only what the record cannot explain is left for the facilitator
  to check in Jira. It waits for `dataService.whenPersisted()` first
  (an action typed a moment ago must have reached the record), follows
  `remaining` chunk by chunk, with the same target and flags, and writes what
  came back into every cached copy with `applyJiraLinks` (no persist). The
  parents of `sessionParent` mode follow the same path: each answer's
  `parents` is read (an entry whose scope or key is not one is dropped) and
  kept with its last status per scope; a request that only created a parent
  is progress, never an idle round; `applyJiraParents` caches each `created`
  or `adopted` key and each dated mark — a reported key replaces the cached
  one (a scope's parent can be replaced, unlike an action's issue), a mark
  never replaces a key or an earlier mark, and a `not_saved` key is not cached
  — and `settleUnknown` caches the record's `jiraParents` too. The status is
  read on Review entry, on each reconnect and after a settings save — never
  from `dataService` while rendering (`useJiraStatus`).
- **Who may press is the screens' rule.** The controls show to facilitators,
  on open actions only (the server answers `closed` anyway); a reason line tied
  to an `aria-disabled` control says why a facilitator cannot create (no token,
  enter it again, refused by Jira, no target). The health-check Review closes
  and assigns actions through `toggleGlobalAction` / `updateGlobalAction`, as
  the retro's does: it used to write only the session row, so the Dashboard —
  and the batch — saw closed actions as open. In `sessionParent` mode both
  Review steps show the facilitator the session's parent ("Parent issue in
  Jira:" and its key-only link, or the doubt and a search, `JiraParentLine`);
  never a participant, whose cache never learns a parent created after their
  login. A row's dialog that reported a parent refreshes the step even when
  the action itself is unchanged — a fresh parent whose first sub-task Jira
  refused, a parent left in doubt [review F2-3]. An action held back by its
  parent (`parent_uncertain`, `parent_in_progress`, `parent_refused`) is said as "not sent", in its own
  words, and never as "may already be in Jira" (`jiraBatchResults`,
  `JiraActionControl`): it was not sent.

Residuals, stated on purpose:

- **Facilitator-only is a UI rule** (D1). Any team credential — an
  invitation-link login included — can set, replace and remove the token and
  the team's target, create issues through the routes in any project its
  account reaches, with any requester name in the description (the browser's,
  unverified), and look up through `/jira/issue-types` whether a project or an
  issue key exists, an issue's project and a project's issue types — metadata
  of anything the account can see, never issue content. It can also create one parent issue per session or for the dashboard, send
  under a parent of its choosing anywhere the account reaches, and re-point a
  session's later actions (`adoptParent` with `replaceParents`).
  `SECURITY.md` says so; a technical account limited to the team's projects is
  the mitigation.
- **A session token minted before a password rotation keeps Jira access for up
  to 7 days**, as on every team route. Revoking sessions on a rotation is a
  separate change (D3), for every route and the socket.
- **Merge sources keep their unlinked action ids** (see *Merging teams*): until
  the sources are deleted, a source and the merged team can each create an
  issue for the same action.
- **A team deleted since the backup, brought back by either restore, loses its
  token for good**: the secret went with the deletion, the replace keeps a
  secret only for a team in the archive that existed before it, and the
  single-team restore removes any leftover row.
- **A restore to an older state can bring an action back unlinked.**
  `carryJiraLinks` needs a current record that holds the link, and only covers
  the actions the archive holds. An application archive restored into a new
  database, a team deleted since the backup, a `pg_dump` of an older state, or
  a restore that removed the action while a client still holding it (a
  participant in a retro created after the backup, a client connected during a
  whole-store restore, a stale tab) saves it again: the action reads as not in
  Jira, and its next creation makes a second issue — at once after a `pg_dump`
  restored with the same secret. The runbooks say to check Jira first, and a
  team deleted from the console has its "Pre-delete snapshot", which holds
  every link. A server-side ledger of created keys would close this; it is not
  built.
- **A base URL change means the same Jira at a new address.** Links are
  key-only and re-point; tokens are bound to the address and are entered again.
  Switching to an unrelated Jira is "several instances", out of scope.
- **Older pods during the rollout** answer the Jira routes with an HTML 404
  (retried), do not guard `jira` in their persist handlers — a stale
  whole-session write through one can drop a link written meanwhile; the issue
  still exists and a second click would create another — delete a team without
  its secret (the startup sweep removes it), and restore without links or
  secrets: do not restore while they run.
- **Data Center can lock Basic logins behind a CAPTCHA** after repeated
  failures and then answer `403` (`X-Seraph-LoginReason:
  AUTHENTICATION_DENIED`), which reads as `jira_forbidden`, not as a refused
  token. A personal access token (Bearer) and Cloud are not affected.
- **A key planted on a live session's action** (a participant's write can set
  it: `actions` is not a protected field) shows as that action's link in the
  Review step and hides its button there. No write path stores it on the
  record, the Dashboard still offers the action, and a value that is not a key
  renders nothing.
- **Pods from before 41.0 and `sessionParent`.** They refuse the mode
  everywhere and create nothing (`/jira/target` and an override answer
  `invalid_jira_target`, the stored target reads as `jira_target_missing`,
  the status as no target); they ignore `adoptParent`, so a session sent
  under a named parent through one creates its own parent next time; their
  `/update` accepts `jiraParents` and `jiraParentClaims` (no client sends
  them); their merge carries the primary's parents with stale ids and their
  restores do not carry the current ones, so a second parent follows — do
  not merge or restore during the rollout; their `/jira/issue-types` answers
  no sub-task type for a project and no `subtasksIncluded` (the form then says
  the sub-task types cannot be read yet). A screen of that release whose
  status went stale before a `sessionParent` target was saved still offers its
  one-click, which sends no target: on a new pod it runs the stored target and
  creates the session's parent with no dialog (or reads a `parent_*` status as
  "may already be in Jira"). Nothing is created twice, and a screen of this
  release cannot do it: its one-click sends the target it shows [R2].
- **Empty parent issues can stay in Jira**, always logged with their key: a
  fresh parent whose first sub-task Jira refuses (a type that cannot hold
  sub-tasks, on a Jira that gives no hierarchy level), one whose key could not
  be stored (`not_saved`, also answered), one created by two requests on pods
  whose clocks disagree by more than the claim lifetime (the scope keeps the
  first key), one the facilitator confirmed with `forceParentScopes`.
- **A stored parent deleted or moved in Jira** has every default send of its
  session refused (`jira_target_refused`, Jira names `parent`): the remedy is to
  name a parent and replace (`replaceParents`). A parent Jira refuses
  sub-tasks under never becomes a stored parent in the first place.
- **A deleted session's parent stays on the record**: its unsent actions become
  backlog actions and go under the team's parent, and a single-team restore
  that brings the session back finds its parent again. A merge source keeps
  its parents: a parent a source creates after the merge is not in the merged
  team, which creates its own for that session.

The guards: `__tests__/jiraRouteAuth.test.ts` (every team Jira route, derived
from the router: a forged or foreign credential gets `401`, Jira untouched, no
secret read, no audit row), `jiraIssues.test.ts` and `jiraRoutes.test.ts` (the
batch and the routes against the mock), `secretBox.test.ts` and
`teamSecretStore.test.ts`, `jiraTeamRecordGuards.test.ts` and
`actionJiraLinks.test.ts` (every write path, the session parents included),
`jiraParentsCarry.test.ts` (the parents' carry rule), the `sessionParent`
cases of `jiraUtils.test.ts`, `jiraIssueContent.test.ts`, `jiraIssues.test.ts`
(one parent per session, claimed like an action, adopted only once a sub-task
landed under it), `teamMerge.test.ts` / `superAdminTeamMergeRoutes.test.ts`
(re-keyed parents) and `teamRestore.test.ts` / `superAdminTeamRestoreRoutes.test.ts`
(carried parents), `archiveContract.test.ts`, on the screens
`jiraBatchDialogParents.test.tsx` (the parent field, the parents preview and
their results, the request bodies), `jiraActionControl.test.tsx` (the
one-click's target, the dialog of the sub-task modes, the `parent_*`
outcomes), `jiraTargetFields.test.tsx` (the third mode, and a project form
that never offers a sub-task type from the route's full list),
`jiraService.test.ts` / `dataServiceJira.test.ts` (parents read, cached and
counted as progress), `jiraIssuePreview.test.ts` and `jiraIssues.test.ts` →
*the parent preview and the server agree*, `reviewPhaseJira.test.tsx`,
`healthCheckReviewJira.test.tsx` and `dashboardJira.test.tsx` (the parent line
and the rows' dialog), `i18nJira.test.tsx`,
`jiraBatchSessionConvergence.test.ts`, `jiraErrorCodes.test.ts` (every code
the routes answer reads as a sentence in both languages), `shutdown.test.ts`
(the forced exit outlasts one Jira call and ends inside the grace period),
and `e2e/jira.spec.ts` — the whole flow with two browsers, one parent issue
per retrospective reused for its later actions, the dashboard's own parent and
a parent named for one send, and the axe audit of the seven Jira screens. A local PostgreSQL run of several of the suites that
read `TEST_DATABASE_URL` shares global rows between files: run it with
`--no-file-parallelism`.

## Audit Trail of Privileged Actions (audit H45)

Every privileged action writes one row to `security_events`: the action, the
actor, the outcome, the target, the source IP, the timestamp and the
**correlation id** of the request that produced it (H44's id, so a row joins to
the log lines around it). It survives the pod, which the in-memory log ring does
not — that was the whole finding: after a rolling update there was no evidence
a restore had ever happened.

`server/services/securityEvents.js` owns it. Four rules when you touch it:

- **`record(req, event)` takes the request first, on purpose.** The source IP is
  a required field of every row, and a signature that takes the request cannot
  be called in a way that forgets it. Do not "simplify" it to take a plain
  object.
- **Clearing the log viewer is a recorded action** (`logs.clear`), for a reason
  worth keeping: it is the one action whose *purpose* can be to remove evidence.
  The row lands in the database, which the clear does not touch.
- **The action names are a closed set** (`SECURITY_ACTIONS`). A typo writes a
  row nobody will ever find — a hole in the trail that looks exactly like an
  action that never happened — so an unknown name is refused and logged rather
  than stored. Adding a privileged route means adding its action to that set,
  and `__tests__/securityEventAudit.test.ts` fails if a declared action is never
  emitted.
- **Append-only means the *application* has no path that changes or removes a
  row.** `dataStore` exposes exactly `appendSecurityEvent` and
  `listSecurityEvents`, and a test pins that surface. The database does not
  enforce it; say it that way rather than claiming more.
- **A failed audit write never fails the operation it records.** A restore that
  worked must not be reported as failed because an `INSERT` did not.

> ⚠️ **The registrars default `securityEvents` to a no-op, so the load-bearing
> wiring is in `server.js`.** That default is what lets the other 130 test files
> stay unchanged — and it is also what would let a forgotten `server.js`
> argument leave every suite green while production records nothing. The guard
> is a source assertion in `__tests__/securityEventAudit.test.ts` that reads
> `server.js` and checks each registrar receives it. It proves the argument is
> written, not that it runs — the same limit H44's middleware has.

**Reading the trail is `k8s/README.md` → *Reading the audit trail*.** There is
deliberately no endpoint and no super-admin panel: a viewer is a user-visible
feature (bump `X`, one changelog bullet), and this is a hardening change.

**It stores IP addresses.** That is new persistent personal data in a product
whose position is "no retention rule, internal deployment". Documented in
`SECURITY.md`; revisit it if the application ever becomes reachable from
outside.

## Real-time Events (Socket.IO)

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-session` | Client→Server | Join a retrospective/health check. **Authenticated**: the payload must carry the team `sessionToken` the client already holds after login, and that token must be minted for the team owning the session (checked against the persisted session's `teamId` before the socket enters the room, so a refused join leaks no state and receives no roster). A session that does not exist yet cannot be team-checked here; the first `update-session` is instead bound to the credential's team, so one team's token can never seed a session claiming another team's id. `syncService` reads the token at emit time, so the automatic re-join after a reconnect (rolling update) presents the current credential |
| `join-denied` | Server→Client | The join was refused (`unauthenticated` — no/invalid/expired token; `forbidden` — valid token for another team). Retrying cannot help, so `syncService` surfaces it and the session components pause editing instead of leaving the UI looking live while nothing syncs |
| `leave-session` | Client→Server | Leave current session |
| `update-session` | Bidirectional | Sync session state. The server runs an optimistic compare-and-swap on the session `_rev`: a write built on a stale revision is **rejected** (not persisted, not broadcast) so an out-of-date client blob cannot clobber newer state; the rejected sender is sent the authoritative state instead. `syncService` stamps outgoing writes with the revision of the state they were built on (an artificially raised stamp would let stale content overwrite newer state), and on `session-ack` it synthesizes the acked blob back to the app so the local revision stays current. When a healing snapshot lacks the user's own recent data, the session components' merge (`components/session/mergeRemoteSession.ts`) re-applies it (own votes, happiness/ROTI, proposal votes, ratings, unconfirmed ticket/proposal creations, and the add-only collections the healed state lost: open/history action snapshot entries and `invitedUsers` — those are only ever *added* to during a session, so a missing entry always means a lost write race, not a removal; without the `invitedUsers` merge a losing invite write silently erased the "waiting to join" list) and schedules a jittered re-send, so a lost optimistic-concurrency race costs a round-trip instead of losing the user's action. **Re-applying own data is gated on the own-change ledger, and that gate is load-bearing** — see *The own-change ledger* below. The server also enforces **role-based authorization** (`server/services/sessionGuard.js`): a write from a non-facilitator (role resolved server-side from the team roster) that changes facilitator-only fields — `phase`, `status`, `name`, `date`, `columns`, `icebreakerQuestion`, `discussionFocusId`, `reviewSummary`, template structure (including `templateLanguage`), and the reveal/vote/timer-allocation settings, plus *adding* an id to `leftUsers` (removing one stays open: every client clears a reconnecting participant's mark) — is **never applied, and never costs the rest of the write**: the server puts those fields back to their stored values (`restoreProtectedFields`), saves the rest through the same compare-and-swap, and sends the saved state to the sender *before* its `session-ack` (so the ack synthesizes nothing the server did not store). Only a write whose sole changes were facilitator-only is healed without a save. Refusing the whole blob is what destroyed a participant's cards in incident ISS (2026-10-12): one drifting field — a title renamed on the Dashboard — took every card down with it, the client re-sent it about three times a second, and each unconfirmed card left the author's screen when its 60 s pending entry expired. The guard runs after a stale pre-check, so a racing write is reported as stale rather than unauthorized; that heal is built from the **freshest** state: the database row when another pod wrote past this pod's cache, the cache when degraded mode left the database behind it, compared *after* the read so a write accepted meanwhile is not lost; the cache only ever moves forward. Restoring is reserved for a sender the roster **confirms** as a participant: when the team record cannot be read to establish the role, the write is refused whole as before (reason `protected-fields`, a heal, nothing saved), so a facilitator's gesture is never split into a saved half and a dropped half. Timer runtime fields (`timerRunning`, `timerSeconds`, `timerStartedAt`, `timerAcknowledged`) and `participantsPanelCollapsed` stay writable by every client because all clients legitimately sync timer expiry, alarm acknowledgement and the panel toggle — in retrospectives and health checks alike, which share one timer (see *One timer* above). `teamId` is immutable for everyone. If persistence fails, the same compare-and-swap runs against the in-memory cache (degraded mode) so live collaboration continues through a database outage without ever letting a stale blob be broadcast. **Known residual, kept on purpose:** `loadSessionState` returns `null` on a database error, so a pod whose cache does not hold the session (a pod started during the rollout, an LRU eviction) has no baseline during an outage, and the write is then accepted unguarded, facilitator-only fields included. The same holds when the pod's only baseline is a cached copy **older than the write itself** (the database read failed): restoring from it would put stale facilitator values into a newer write and broadcast them to the room, reverting a phase change everyone had already seen, so the write is accepted as sent and the unchecked fields are logged. Refusing every write on that pod for the whole outage was judged worse (maintainer decision, 2026-10-12: continuity over the guard in that window). Before any of this, a cheap top-level shape check (`validateSessionUpdateShape` in `socketHandlers.js`) drops blobs that are not plain objects, claim a different session id, or carry a non-finite `_rev` (which would otherwise poison the revision counter through `Number()` coercion). An optional per-socket token-bucket throttle (`SOCKET_UPDATE_RATE`/`SOCKET_UPDATE_BURST`, disabled by default) caps how many writes one client can drive through the DB + broadcast path; a throttled write is healed from cache, never dropped. **No write goes out before the join on the same connection**: `syncService` holds a write queued before (or without) a `join-session` and sends it right behind the join. A fresh page load used to flush its first write on a socket that had joined nothing, which the server dropped with no heal (`update-session received but socket has no sessionId`). Refusal warnings are coalesced per socket and reason (`server/services/logCoalescer.js`): 409 identical lines flushed the 1000-entry log ring during incident ISS and erased its beginning |
| `session-ack` | Server→Client | Acknowledges an accepted `update-session` with its new authoritative `_rev`, so the sender (which does not receive its own broadcast echo) learns the revision advanced. **An ack must be answered with the blob it actually accepted.** The server stores `rev+1` only when the stamp equals the stored revision, so an ack at `R` answers the oldest write the client sent stamped `R-1`; `syncService` keeps a queue of unanswered writes to find it. Holding only the *last* outgoing blob is wrong whenever two writes are in flight — the ack for the first then synthesized the second, telling the app the server held content it had never accepted. The second write is rejected as stale moments later and healed to the first value, and because the app was told its write had landed, the own-change claim protecting it was dropped and the user's newer edit vanished with nothing reporting a problem. The queue is cleared on disconnect: a write whose ack died with the socket can never be matched, and the re-join snapshot carries whatever did land |
| `session-update-refused` | Server→Client | Sent to the writer right before every heal, and when a write arrives on a socket that has joined nothing: `{ sessionId, reason, fields?, rev? }`, `reason` one of `stale`, `protected-fields`, `immutable`, `malformed`, `not-joined`, `throttled`. Clients from before it ignore it. `syncService` reports sync health (`onSyncHealth`) from **re-sends, not refusals**: a write the merge re-sends because the user's own data is missing from the server is flagged (`updateSession(s, { resend: true })`), and health turns **`stalled` once 5 or more re-sends, the first at least 10 s ago, have gone unacknowledged while connected**, `ok` again on the next ack, on leave, on a session switch or on disconnect. Refusals alone never stall: every client writes the timer expiry and the participant upsert at the same instant, all but one lose that race harmlessly, and a refusal count turned a passive participant's screen red in review. From the fifth re-send it backs re-sends off (`getResendDelayMs`, 400 ms doubling to 5 s); on `not-joined` it re-joins (at most once per 2 s). Health is updated before the `onUpdateRefused` subscribers run. Nothing in the ISS loop told anyone that nothing was being saved; `stalled` is what drives the banner (see *One "not saved" banner*) |
| `member-joined` | Server→Client | User joined notification |
| `member-left` | Server→Client | User left notification |
| `member-roster` | Server→Client | Current participants list. Rebuilt (via a cross-pod `fetchSockets()`) and rebroadcast to the room on every join/leave, but **coalesced** behind a debounce window (`ROSTER_BROADCAST_DEBOUNCE_MS`, default 250ms) so a reconnect stampede after a rolling update cannot drive one rebuild+broadcast per client (audit R28). The roster is rebuilt at fire time, so the coalesced broadcast always reflects current membership; `member-joined`/`member-left` stay immediate for incremental UI. Set the window to `0` to broadcast synchronously |
| `participant-activity` | Bidirectional | Ephemeral "is typing" cue (Brainstorm ticket / Discuss proposal); broadcast to other clients only, never persisted, auto-expires on the receiver |

### The own-change ledger — one user id is not one client

**A user id identifies a person, not a browser.** Open the invite link twice —
two phones, a laptop and a phone, a duplicated tab — and one participant is two
clients writing under the same id. Every "the local value wins for my own data"
rule in `mergeRemoteSession.ts` has to survive that, and the naive form does
not.

The merge cannot tell the two readings of a difference apart from state alone:
*"the server healed my write away"* and *"another client of mine is ahead of
me"* look **identical**. Reading it only the first way is what produced the bug
this ledger was added for: during Discuss, one browser clicked "Move On", the
other browser read the incoming vote as its own lost write, removed it and
re-sent; the first browser re-added it and re-sent; and the facilitator watched
`1/5 voted to move on` flicker to `0/5` and back every few hundred milliseconds
until the participant clicked in *both* browsers. Nothing in the UI named a
problem, and nothing could: both clients were behaving exactly as designed.

So the merge takes the missing signal from this client's own history instead:
**did I make this change, and is the server still unaware of it?**
`registerOwnRetroChanges` / `registerOwnHealthCheckChanges` claim a slice when
the local `updateSession` actually changed the current user's value for it, and
the merge re-applies a slice only while its claim is live, dropping the claim as
soon as an incoming state agrees (the write landed). A client with nothing
outstanding therefore takes the server's word for its own data — which is how
the second browser learns what the first one did.

Four rules when you touch it:

- **Register from `updateSession`, never from a handler.** Both session
  components diff the state the updater was built on against the state it
  produced, at their single write choke point, so no call site can forget to
  declare its own write and a new own-data field is covered the day it is
  written. Claiming at a call site is how the next slice quietly regresses.
- **A symmetric own-data rule without the gate never converges.** Add-only
  rules (`invitedUsers`, the action snapshots, pending creations) are safe
  because two clients that only ever add agree in one round. Anything where a
  local *removal* also wins — votes, move-on votes, `finished`, a cleared
  rating — is a ping-pong waiting to happen. Add the gate in the same change.
- **`ownChanges` is required in both merge contexts on purpose.** An optional
  field would let a forgotten call site keep a green suite while production
  either loops again or silently drops every healed own write. TypeScript is
  the guard.
- **Claims are per session and mostly id-scoped, but not all of them.**
  `happiness`, `roti` and `finished` are bare keys, so both components clear
  the ledger when `sessionId` changes; without that a claim from the previous
  retro re-asserts stale data into the next one.
- **A claim is confirmed by the server agreeing, so the ack must not lie.**
  The whole gate rests on "an incoming state that matches my value means my
  write landed" — which is only true while `session-ack` is answered with the
  blob it actually accepted. See the `session-ack` row above; that queue is
  load-bearing for this ledger, not a detail of the transport.
- **The TTL counts connected time, not wall-clock time.** Its job is to bound
  how long an unconfirmable claim keeps re-asserting itself, and nothing is
  re-asserted while the client is receiving nothing; editing is paused for the
  whole disconnect, so no new claim is made either. `extendOwnChanges` credits
  the offline span back on reconnect. Without it a slow reconnect burned the
  claim and the re-join snapshot then silently overwrote the user's edit. The
  trade is deliberate and written at the function: a claim that survives a long
  reconnect can also re-assert a value another client of the same user has since
  changed — bounded here, where before the ledger the local value won
  unconditionally and forever.
- **A stall stops the clock too, an ordinary refusal does not.** While
  `syncService` reports `stalled`, every refusal (and the transition itself)
  calls `holdOwnStateWhileRefused` through the shared
  `useHoldOwnStateWhileStalled` hook, which keeps each pending creation and
  own-change claim alive for at least another 60 s. In incident ISS the server
  refused every write of one participant, and each card they wrote left their
  own screen exactly 60 s later, one by one, with nothing on screen saying why.
  Holding on *every* refusal was the first version and it was wrong: in a busy
  session lost races never stop, so no claim could ever expire and the TTL, the
  backstop against two browsers of one user fighting, was gone. A stall needs
  10 s of failing re-sends, so a card written just before it still has most of
  its TTL left when the hold starts. Health-check proposals are pending
  creations too (they were not, and a proposal that lost a race was healed away
  with its text already cleared from the input).
- **The server is the authority for every facilitator-only field.** The session
  components never overwrite a field of an incoming state from local data. They
  used to put the cached team record's title on every incoming session, so a
  participant whose cache predated a Dashboard rename re-sent the old title with
  every write — the trigger of incident ISS. A rename now reaches the live
  session through the server (see the `/name` routes).

**The impact-rating slice is the newest instance, and the third of the same
shape.** `actionImpact:<actionId>` joins `proposalVote` and the health checks'
`rating:<dimensionId>` — a per-user, id-scoped value where a local *removal*
also wins (clearing your own rating), which is exactly the ping-pong shape.
The gate is load-bearing rather than decorative: removing it makes eight
convergence tests fail with `clients never converged` after twenty server
writes, the same infinite exchange the Move On bug produced.

**`closedActionsSnapshot` is the one snapshot that is *not* add-only**, and it is
the fourth instance of the gated shape rather than a sibling of the open/history
snapshots. Those only ever grow; this one is edited in place by the facilitator,
so `mergeSnapshotEntries` turned every edit into a fight — each client still
holding the old row re-added it, marked the state divergent and re-sent. It is
therefore facilitator-claimed through the ledger: the facilitator re-asserts a
round the server has not confirmed, every other client never claims the slice and
simply takes the server's word. Plain "incoming wins" is not the alternative — it
breaks the feature outright, because the round is built once in the phase-entry
effect and any write racing that one heals it away for good.

**What the slice is keyed on is load-bearing.** The signature is
`closedRoundSignature`: the ids **and** each row's `impactDeferredBy`. "Rate
later" is a toggle and leaves the row in the list, so a deferral changes no id —
key the slice on ids alone and the facilitator's own toggle is claimed by nobody
and confirmed by everybody, and the next racing write heals it away silently.
Anything else that becomes editable in place inside this list belongs in that
signature too.

**`columnOrder` is the fifth instance, and the narrowest.** The facilitator's
column reorder (Edit Layout) claims the *relative order of the columns both
states share*: `sameColumnOrder` compares that order in both directions, so a
column added or removed elsewhere is not a disagreement, and the re-assertion
puts the incoming columns — titles and styles as the server has them — in the
local order: only the places the shared columns occupy are refilled, so a
column only the server has stays where the server put it. Claiming the whole
`columns` array would have made the facilitator re-assert stale titles over
another tab's rename.

**`reviewSummary` is the sixth instance, and the only one claimed by role.**
The Review step's summary is facilitator-only content (`sessionGuard.js`), and
typing it is one write per keystroke. A keystroke built on a revision another
write has just moved — a Jira batch stamping its keys into the live session, the
timer's expiry, a participant's vote — is refused and healed, and with incoming
winning the heal took that character away for good:
`__tests__/jiraBatchSessionConvergence.test.ts` pinned exactly one lost
character per batch until this slice existed. Three rules:

- **Only the facilitator's client claims it.** `registerOwnRetroChanges` takes
  `{ isFacilitator }` from `Session.tsx` and claims the slice only then: the
  server puts the field back whenever anyone else writes it, and a
  participant's claim would re-assert the refused value at every heal for as
  long as it lived. No summary and an empty one are the same value.
- **Two facilitator browsers converge like any symmetric slice** — the browser
  that typed re-asserts until the server agrees, the other one never claimed
  and takes the server's word. `twoBrowserSessionConvergence.test.ts` drives it
  (*the facilitator typing the review summary from two browsers*).
- **A state older than the one on screen never takes the summary back.** It is
  the one rule this slice adds to the ledger's: with two pods the heal of a
  keystroke (sent by the pod holding the socket) can overtake a broadcast
  another pod sent earlier through the adapter, so the older state arrives
  after the claim was confirmed. Taken as it came, it put the shorter text back
  on screen and the next keystroke re-asserted that — the character lost after
  all. It compares `_rev` only when both states carry one, and re-sends
  nothing: the server already holds the newer text. The other slices have the
  same exposure in principle, but only typing produces a burst of edits to one
  slice fast enough to meet it.

`__tests__/twoBrowserSessionConvergence.test.ts` is the guard, and it is a
*convergence* test on purpose: it drives the real loop (server CAS, broadcast,
ack, merge, re-send) between two browsers of one participant and fails when the
exchange does not terminate. An assertion on the final state alone passes
mid-flicker — the bug was never a wrong value, it was a value that would not
sit still.

## gstack (REQUIRED — global install)

**Before doing ANY work, verify gstack is installed:**

```bash
test -d ~/.claude/skills/gstack/bin && echo "GSTACK_OK" || echo "GSTACK_MISSING"
```

If GSTACK_MISSING: STOP. Do not proceed. Tell the user:

> gstack is required for all AI-assisted work in this repo.
> Install it:
> ```bash
> git clone --depth 1 https://github.com/garrytan/gstack.git ~/.claude/skills/gstack
> cd ~/.claude/skills/gstack && ./setup --team
> ```
> Then restart your AI coding tool.

Do not skip skills, ignore gstack errors, or work around missing gstack.

Using gstack skills: After install, skills like /qa, /ship, /review, /investigate,
and /browse are available. Use /browse for all web browsing.
Use ~/.claude/skills/gstack/... for gstack file paths (the global path).
