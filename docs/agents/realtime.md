# Real-time Events (Socket.IO)

> Part of the agent guide, moved out of `AGENTS.md` so that it is read when its area is touched, not loaded into every session. A section named in italics elsewhere (*Avatars*, *The look*, *Jira*…) is a file of this folder: the index in `AGENTS.md` says which.


| Event | Direction | Description |
|-------|-----------|-------------|
| `join-session` | Client→Server | Join a retrospective/health check. **Authenticated**: the payload must carry the team `sessionToken` the client already holds after login, and that token must be minted for the team owning the session (checked against the persisted session's `teamId` before the socket enters the room, so a refused join leaks no state and receives no roster). A session that does not exist yet cannot be team-checked here; the first `update-session` is instead bound to the credential's team — the one the socket held when the write arrived, so a revocation landing while the write is in flight cannot unbind it — so one team's token can never seed a session claiming another team's id. `syncService` reads the token at emit time, so the automatic re-join after a reconnect (rolling update) presents the current credential. **Decision D3b:** a token a password change revoked, or one whose team was deleted, is refused (`join-denied` with a `cause`), and the socket leaves any room it was in; when the team's session epoch cannot be read (a database outage) the join is accepted on the token's signature and re-checked by the periodic sweep, but a corrupt epoch row is refused. The payload carries a `joinId` (`[A-Za-z0-9_-]{1,64}`, else ignored), echoed in a denial, so the client can tell the denial of an earlier join from its latest one; a client from before it sends none and is sent none. A client re-joins its session when its token changes (the password change made there, a token adopted from another tab) |
| `join-denied` | Server→Client | The join was refused (`unauthenticated` — no/invalid/expired token; `forbidden` — valid token for another team). Retrying cannot help, so `syncService` surfaces it and the session components pause editing instead of leaving the UI looking live while nothing syncs. **Decision D3b:** `{ sessionId, reason, cause?, joinId? }`, with `cause` `session_revoked` (a password change revoked the token) or `team_not_found`; the server also sends it, `reason: 'unauthenticated'` and the join's `joinId`, to a joined socket it **cuts** — out of its room (the others get `member-left`), still connected, so nothing reconnects and every later write is refused `not-joined`. `syncService` ignores a denial naming an earlier `joinId`, resolves `session_revoked` like a `401 session_revoked` (re-join when its token changed since, else revoked: no join, writes held, the shared `useSessionRevoked` banner) and passes every other denial to its subscribers. An older server sends neither field and is read as before |
| `team-sessions-revoked` | Server→Server | Decision D3b. `{ teamId }`, sent with `io.serverSideEmit` by the pod that changed a team's password (when a cross-pod adapter is active) before it cuts its own sockets — the rotation has committed and every pod reads the epoch again, so the others never wait on this pod's sweep. Only a hint: every pod re-reads the team's epoch and cuts the sockets whose token it revokes, so a forged, late or duplicated event cuts nothing current. A 40.x/41.0 pod has no listener. A pod that misses it still cuts within a minute: each pod re-checks its joined sockets every 60 s (`REVOCATION_SWEEP_MS`, a constant), which also covers the joins accepted unverified during an outage, and on `sessions-invalidated`. **No join can stall a sweep.** A sweep waits only for the joins in flight to *decide* (`joinAuthInFlight`, settled once the socket's claims are set, or when the join is refused or throws), never for their roster read or last-connection write, and at most 5 s for all of them together (`JOIN_AUTH_WAIT_MS`); an undecided socket is left to the next sweep. The periodic sweep schedules its next tick before each run, so one run stuck on a query that never answers cannot stop the ones after it |
| `leave-session` | Client→Server | Leave current session |
| `update-session` | Bidirectional | Sync session state. The server runs an optimistic compare-and-swap on the session `_rev`: a write built on a stale revision is **rejected** (not persisted, not broadcast) so an out-of-date client blob cannot clobber newer state; the rejected sender is sent the authoritative state instead. `syncService` stamps outgoing writes with the revision of the state they were built on (an artificially raised stamp would let stale content overwrite newer state), and on `session-ack` it synthesizes the acked blob back to the app so the local revision stays current. When a healing snapshot lacks the user's own recent data, the session components' merge (`components/session/mergeRemoteSession.ts`) re-applies it (own votes, happiness/ROTI, proposal votes, ratings, unconfirmed ticket/proposal creations, and the add-only collections the healed state lost: open/history action snapshot entries and `invitedUsers` — those are only ever *added* to during a session, so a missing entry always means a lost write race, not a removal; without the `invitedUsers` merge a losing invite write silently erased the "waiting to join" list) and schedules a jittered re-send, so a lost optimistic-concurrency race costs a round-trip instead of losing the user's action. **Re-applying own data is gated on the own-change ledger, and that gate is load-bearing** — see *The own-change ledger* below. The server also enforces **role-based authorization** (`server/services/sessionGuard.js`): a write from a non-facilitator (role resolved server-side from the team roster) that changes facilitator-only fields — `phase`, `status`, `name`, `date`, `columns`, `icebreakerQuestion`, `discussionFocusId`, `reviewSummary`, template structure (including `templateLanguage`), and the reveal/vote/timer-allocation settings, plus *adding* an id to `leftUsers` (removing one stays open: every client clears a reconnecting participant's mark) — is **never applied, and never costs the rest of the write**: the server puts those fields back to their stored values (`restoreProtectedFields`), saves the rest through the same compare-and-swap, and sends the saved state to the sender *before* its `session-ack` (so the ack synthesizes nothing the server did not store). Only a write whose sole changes were facilitator-only is healed without a save. Refusing the whole blob is what destroyed a participant's cards in incident ISS (2026-10-12): one drifting field — a title renamed on the Dashboard — took every card down with it, the client re-sent it about three times a second, and each unconfirmed card left the author's screen when its 60 s pending entry expired. The guard runs after a stale pre-check, so a racing write is reported as stale rather than unauthorized; that heal is built from the **freshest** state: the database row when another pod wrote past this pod's cache, the cache when degraded mode left the database behind it, compared *after* the read so a write accepted meanwhile is not lost; the cache only ever moves forward. Restoring is reserved for a sender the roster **confirms** as a participant: when the team record cannot be read to establish the role, the write is refused whole as before (reason `protected-fields`, a heal, nothing saved), so a facilitator's gesture is never split into a saved half and a dropped half. Timer runtime fields (`timerRunning`, `timerSeconds`, `timerStartedAt`, `timerAcknowledged`) and `participantsPanelCollapsed` stay writable by every client because all clients legitimately sync timer expiry, alarm acknowledgement and the panel toggle — in retrospectives and health checks alike, which share one timer (see *One timer* above). `teamId` is immutable for everyone. If persistence fails, the same compare-and-swap runs against the in-memory cache (degraded mode) so live collaboration continues through a database outage without ever letting a stale blob be broadcast. **Known residual, kept on purpose:** `loadSessionState` returns `null` on a database error, so a pod whose cache does not hold the session (a pod started during the rollout, an LRU eviction) has no baseline during an outage, and the write is then accepted unguarded, facilitator-only fields included. The same holds when the pod's only baseline is a cached copy **older than the write itself** (the database read failed): restoring from it would put stale facilitator values into a newer write and broadcast them to the room, reverting a phase change everyone had already seen, so the write is accepted as sent and the unchecked fields are logged. Refusing every write on that pod for the whole outage was judged worse (maintainer decision, 2026-10-12: continuity over the guard in that window). Before any of this, a cheap top-level shape check (`validateSessionUpdateShape` in `socketHandlers.js`) drops blobs that are not plain objects, claim a different session id, or carry a non-finite `_rev` (which would otherwise poison the revision counter through `Number()` coercion). An optional per-socket token-bucket throttle (`SOCKET_UPDATE_RATE`/`SOCKET_UPDATE_BURST`, disabled by default) caps how many writes one client can drive through the DB + broadcast path; a throttled write is healed from cache, never dropped. **No write goes out before the join on the same connection**: `syncService` holds a write queued before (or without) a `join-session` and sends it right behind the join. A fresh page load used to flush its first write on a socket that had joined nothing, which the server dropped with no heal (`update-session received but socket has no sessionId`). Refusal warnings are coalesced per socket and reason (`server/services/logCoalescer.js`): 409 identical lines flushed the 1000-entry log ring during incident ISS and erased its beginning |
| `session-ack` | Server→Client | Acknowledges an accepted `update-session` with its new authoritative `_rev`, so the sender (which does not receive its own broadcast echo) learns the revision advanced. **An ack must be answered with the blob it actually accepted.** The server stores `rev+1` only when the stamp equals the stored revision, so an ack at `R` answers the oldest write the client sent stamped `R-1`; `syncService` keeps a queue of unanswered writes to find it. Holding only the *last* outgoing blob is wrong whenever two writes are in flight — the ack for the first then synthesized the second, telling the app the server held content it had never accepted. The second write is rejected as stale moments later and healed to the first value, and because the app was told its write had landed, the own-change claim protecting it was dropped and the user's newer edit vanished with nothing reporting a problem. The queue is cleared on disconnect: a write whose ack died with the socket can never be matched, and the re-join snapshot carries whatever did land |
| `session-update-refused` | Server→Client | Sent to the writer right before every heal, and when a write arrives on a socket that has joined nothing: `{ sessionId, reason, fields?, rev? }`, `reason` one of `stale`, `protected-fields`, `immutable`, `malformed`, `not-joined`, `throttled`. Clients from before it ignore it. `syncService` reports sync health (`onSyncHealth`) from **re-sends, not refusals**: a write the merge re-sends because the user's own data is missing from the server is flagged (`updateSession(s, { resend: true })`), and health turns **`stalled` once 5 or more re-sends, the first at least 10 s ago, have gone unacknowledged while connected**, `ok` again on the next ack, on leave, on a session switch or on disconnect. Refusals alone never stall: every client writes the timer expiry and the participant upsert at the same instant, all but one lose that race harmlessly, and a refusal count turned a passive participant's screen red in review. From the fifth re-send it backs re-sends off (`getResendDelayMs`, 400 ms doubling to 5 s); on `not-joined` it re-joins (at most once per 2 s). Health is updated before the `onUpdateRefused` subscribers run. Nothing in the ISS loop told anyone that nothing was being saved; `stalled` is what drives the banner (see *One "not saved" banner*) |
| `member-joined` | Server→Client | User joined notification |
| `member-left` | Server→Client | User left notification |
| `member-roster` | Server→Client | Current participants list. Rebuilt (via a cross-pod `fetchSockets()`) and rebroadcast to the room on every join/leave, but **coalesced** behind a debounce window (`ROSTER_BROADCAST_DEBOUNCE_MS`, default 250ms) so a reconnect stampede after a rolling update cannot drive one rebuild+broadcast per client (audit R28). The roster is rebuilt at fire time, so the coalesced broadcast always reflects current membership; `member-joined`/`member-left` stay immediate for incremental UI. Set the window to `0` to broadcast synchronously |
| `participant-activity` | Bidirectional | Ephemeral "is typing" cue (Brainstorm ticket / Discuss proposal); broadcast to other clients only, never persisted, auto-expires on the receiver. Only `'brainstorm'`, `'proposal'` or `null` travels (`utils/participantActivity.js` → `toParticipantActivity`), and only from a joined socket with a user id. The server relays any other value as `null`. `syncService` reads what it receives through the same rule and drops an event that names no user, because a pod from before 43.0 relays raw payloads during a rolling update. A peer's `'__proto__'` used to blank every expanded participants panel of the room. The payload keeps its three fields; only the kind is bounded, and the name is what the join carried (`HARDENING_STATUS.md`, H55). From 43.0 the relay and the client drop an unknown kind (it reads as "stopped"): a new kind needs every pod, then every client, to accept it before any client sends it |

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

**The facilitator's settings are the seventh instance, claimed by role like
the summary** (`setting:<name>`: anonymity, hidden cards, the colour, voting
off, the hidden count, unlimited votes, the number, one vote per item). Two
clicks in the open board's settings dialog or the Vote bar within one round
trip are two writes from one revision: the server kept the first and healed
the second away, so the second setting reverted — and three presses of the
number's arrow ended one short. Only the facilitator's client claims (the
server puts the fields back when anyone else writes them), and a re-asserted
setting that takes votes back (a lower number, unlimited off, one vote per
item on) takes them back again from the server's votes, through the same
rules as the click (`capVotes`, `keepOneVotePerItem`): the write that lost
carried the cleanup, and the re-sent state would otherwise hold more votes
than it allows. Settings a **phase change** wrote are never claimed: a switch
of type before any card takes the new type's defaults, and entering the board
from Group shows the cards (`recordBoardTypeChange`), in the phase change's
own write. The phase is navigation, where the server wins, so a phase change
that loses its race is healed away whole; claimed, its settings outlived it,
and a guided Brainstorm took the board's defaults — every card shown, as a
board then started (today, voting off and its counts hidden). A number
typed and left for the phase change's button is not one of them:
`updateSession` claims it as a write of its own before the phase change runs.

`__tests__/twoBrowserSessionConvergence.test.ts` is the guard, and it is a
*convergence* test on purpose: it drives the real loop (server CAS, broadcast,
ack, merge, re-send) between two browsers of one participant and fails when the
exchange does not terminate. An assertion on the final state alone passes
mid-flicker — the bug was never a wrong value, it was a value that would not
sit still.
