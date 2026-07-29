# Load Testing & Rollout Validation

This directory contains a load-test harness that validates RetroGemini before
opening it to a whole organization: **many retrospectives in parallel, up to
50 concurrent users per retro, with a hard guarantee check that no user action
is lost** — every ticket, every vote, every grouping, every action proposal,
every vote on a proposal, every happiness/ROTI score.

The harness does not simulate browsers. It speaks the **exact same protocol**
as the real front-end: team setup over the public REST API, then live
collaboration over Socket.IO (`join-session`, full-blob `update-session`
writes stamped with the last seen `_rev`, `session-ack`, automatic re-join
after reconnection — see `services/syncService.ts`).

## Quick start

```bash
# Terminal 1 — start a server (any deployment works; local example)
AUTH_RATE_LIMIT_MAX=100 PORT=3000 node server.js

# Terminal 2 — sanity check, then the rollout target
node loadtest/run.js --preset smoke
node loadtest/run.js --preset target --json target-report.json
```

Exit code `0` means the run passed. `--help` lists every option.

> **Rate limit**: `POST /api/team/create` is limited to 5 requests / 15 min /
> IP by default. Start the target server with `AUTH_RATE_LIMIT_MAX` at least
> equal to `--retros` (the e2e suite already does the same).

## What one run does

For each retro (one team each, all in parallel), 1 facilitator + N
participants play a complete session:

| Phase | Simulated actions |
|-------|-------------------|
| ICEBREAKER | Everyone connects, joins, registers in the participants roster |
| WELCOME | Every participant submits a happiness score |
| OPEN_ACTIONS | Pass-through (phase broadcast check) |
| BRAINSTORM | Every participant writes T tickets, then marks "finished" |
| GROUP | The facilitator clusters tickets into groups (chunks of 3 per column) |
| VOTE | Every participant spends their full vote budget, vote by vote |
| DISCUSS | Focus selection, one action proposal per participant, everyone votes up/down on proposals, facilitator accepts/rejects each one |
| REVIEW | The facilitator writes the review summary |
| CLOSE | Every participant submits a ROTI score, the facilitator closes the session |

Every intended action is recorded in a **ledger**. After CLOSE, a fresh
"auditor" client joins the session (exactly like a latecomer or a page
refresh) and receives the authoritative persisted state, which is compared
against the ledger item by item. Any missing ticket, vote, group membership,
proposal, proposal vote, happiness or ROTI entry is reported, as is any
unexpected extra data (duplicates). With `--team-persist phase` (default) the
retro is also persisted into the team record at each phase change and the run
verifies the closed retro is present there at the end.

The report also gives write latencies (p50/p95/p99 per phase, from send to
durable ack), phase-change propagation times, the first-attempt success rate
(how often a write wins the optimistic-concurrency race immediately), retry
counts, and reconnect/socket errors.

## The two client modes — run both

**`--client-mode resilient` (default).** When the server rejects a write
built on a stale revision, the harness re-applies the action on the fresh
authoritative state and resends until durably acknowledged (operations are
idempotent, so this converges without duplicates). This validates the
*server-side* guarantees: the compare-and-swap on `_rev` never loses an
accepted action, revisions advance monotonically, and the system converges
under heavy contention. **Any loss in this mode is a server bug and a
rollout blocker.**

**`--client-mode faithful`.** One single send per action, with "sticky" own
data (votes, happiness/ROTI) re-carried on the user's next write. This
replicates the LEGACY front-end (pre-26.5), which never re-sent a rejected
write: whatever this mode loses is what users used to lose. Since 26.5 the
real front-end re-applies the user's own data on top of every healing
snapshot and re-sends it (`components/session/mergeRemoteSession.ts` +
`scheduleSessionResend`), which is what resilient mode models — so treat
faithful mode as a regression yardstick, and resilient mode as the
representative one.

## Recommended validation plan before the org-wide rollout

Run against a **production-like staging environment** (same PostgreSQL, same
pod count, same ingress, Redis/PG Socket.IO adapter if production uses one) —
not against localhost, which hides network latency and multi-pod behaviour.

1. **Baseline** — `--preset team` (3×8, today's real usage). Must PASS with
   ~100% first-attempt success and low latencies. This is your reference.
2. **Rollout target** — 5 retros × 50 users, everyone votes on every
   proposal. Must PASS (zero loss). Watch p95 write latency and phase
   propagation: users perceive >1–2 s as "laggy". `--preset target` runs the
   five retros from one process; on a small load-generator machine, shard
   instead — one process per retro, like real browsers are distributed:

   ```bash
   for i in 1 2 3 4 5; do
     node loadtest/run.js --url https://staging.example --retros 1 --users 50 \
       --proposal-vote-fanout 0 --pace-ms 1500 --seed $((100+i)) \
       --json report-$i.json &
   done; wait
   ```
3. **Rolling update / zero-downtime** — start `--preset target`, and while
   BRAINSTORM/VOTE are running, trigger a rolling restart of the pods
   (`kubectl rollout restart deployment/...`). Clients auto-reconnect and
   re-join like the real front-end. The run must still PASS. Also run
   `--chaos 0.3` so ~30% of clients drop and reconnect mid-phase on top.
4. **Real-client loss estimate** — `--client-mode faithful --pace-ms 2500`
   at the target size. This tells you how many actions real users would see
   vanish at launch-day contention. Decide whether the number is acceptable.
5. **Ceiling** — `--preset stress` (10×50) to know your margin. It is fine
   for this to degrade; note where.

During runs 2–3, watch on the platform side: pod CPU/memory, PostgreSQL
connections (`PG_POOL_MAX` × pods must stay under `max_connections`),
Socket.IO event loop lag, and network egress (see below).

### Acceptance criteria (suggested)

- Resilient runs: **0 lost actions**, all retros audited OK — hard gate.
- p95 write latency < 2 s and phase propagation p95 < 2 s at target load.
- Rolling restart during a run: still 0 lost actions, reconnect count > 0
  (proves the path was exercised), no stuck clients.
- Faithful run at realistic pace: loss rate you can live with (ideally 0;
  a few % during vote storms may be acceptable for launch, but see below).

## What the architecture implies at 50 users (read before interpreting)

- **Full-blob sync**: every accepted write broadcasts the whole session state
  to every participant. Message size grows with tickets/actions; with 50
  users the DISCUSS phase (everyone voting on everyone's proposals) is the
  heaviest: N² proposal votes, each broadcast to N clients. Bandwidth scales
  ≈ writes/sec × blob size × participants. The harness's latency numbers
  reflect this; watch server egress during the target run.
- **Optimistic concurrency with client self-healing**: at 50 users the
  measured first-attempt success rate drops to roughly half under aggressive
  pacing — the server correctly rejects the losers. Since 26.5 the real
  front-end recovers exactly like this harness's resilient mode: the merge
  re-applies the user's own data (votes, happiness, ROTI, proposal votes,
  unconfirmed tickets/proposals) onto the healing snapshot and re-sends it
  after a jittered delay, so a lost race costs a round-trip, not the user's
  action. The retry rate is still worth watching: a high rate means latency,
  even if nothing is lost.
- **Stamp vs content**: the server accepts any write stamped with a revision
  ≥ its current one, trusting that the sender built its blob on that state.
  While building this harness we reproduced a durable clobber when a client
  stamped a blob with a newer "last seen" revision than the snapshot the
  blob was built from (ack and a newer broadcast delivered in the same TCP
  segment). The front-end used to have that exact window; since 26.5
  `syncService` stamps outgoing writes with the revision of the state they
  were built on (rejected-and-healed instead of silently clobbering) and
  keeps the local revision current by synthesizing the acked state back to
  the app. If resilient runs ever show a lost action that the metrics claim
  was acknowledged, suspect this class of bug first
  (`LT_DEBUG=/tmp/trace.jsonl` dumps a wire trace to investigate).

## How large can a single retrospective be?

Measured on a 4-core sandbox (server + generators sharing the box — staging
numbers will be better, run there for the definitive ones).

> ⚠️ **These absolute numbers are hardware, not a contract — never read a
> deviation from them as a regression.** Re-measured 2026-07-29 on a different
> 4-core container, the first row does not reproduce: DISCUSS p95 lands at
> 1.8–2.3 s (not < 1 s) and about half the runs lose exactly one proposal vote
> out of 2 500 after that write exhausts its 30 retries. Checking out `e027780`
> — the very commit that recorded the row — and running the same shape on the
> same box reproduces the *same* degradation (255 s, 1 lost), so it is the
> generator sharing four cores with the server, not the code. **A/B against a
> known-good commit on your own box before concluding anything about
> performance**; a single absolute number proves nothing. A useful tell: a run
> that loses a write also waits out a 120 s barrier, so wall-clock roughly
> doubles — the slowdown is the loss, not a slower server.

| Shape | Outcome |
|-------|---------|
| 1 retro × 50 users, everyone votes on all 50 proposals, ~1–1.5 s pace | **PASS** — 3 212 writes, 0 lost, DISCUSS p95 < 1 s |
| 20 retros × 50 users in parallel (**1 020 concurrent users**), fanout 6, ~3 s pace | **PASS** — 18 909 writes, 0 lost, all 20 audits clean, 21.5% of writes needed one retry |
| 1 retro × 100 users, fanout 10, ~2 s pace | **FAIL here** — 1.3% of writes exhausted 30 retries, DISCUSS p95 > 10 s |

The pattern is structural: each session is one optimistic-concurrency
revision line and every accepted write rebroadcasts the full session state
to every participant, so contention and bandwidth grow with the *square* of
active participants in one retro, while parallel retros scale linearly.
Practical guidance for the rollout:

- **Cap a single retrospective at ~50–60 active participants** (also the
  human limit of a useful retro conversation). 50 is validated lossless.
- **Scale the organization horizontally**: many parallel retros is the
  validated path (1 020 concurrent users on a 4-core box, zero loss).
- A 1 000-person **single** retro is out of scope by design — split into
  team retros and use the release-analysis feature to synthesize across
  them.

## Options reference

Run `node loadtest/run.js --help`. Highlights:

- `--url` — target server (default `http://localhost:3000`).
- `--retros`, `--users`, `--tickets`, `--max-votes`,
  `--proposal-vote-fanout` (0 = everyone votes on all proposals).
- `--pace-ms` — average think time between one user's actions.
- `--chaos <p>` — probability that each participant drops and reconnects
  mid-phase (rolling-update simulation from the client side).
- `--team-persist off|phase` — whether the facilitator also persists the
  retro into the team record over HTTP at each phase change (default
  `phase`; `off` isolates the pure Socket.IO path).
- `--seed` — reproducible randomness; `--json <file>` — full report;
  `--keep-teams` — keep the `LoadTest <runId> R<n>` teams for inspection
  (they are deleted at the end by default).

## Notes and limits

- **The load generator is itself a bottleneck**: every simulated client
  JSON-parses every full-session broadcast (~100 KB at 50 users), so one
  Node process saturates a core somewhere between 50 and 250 sockets during
  vote storms — and then reports contention that is really its own CPU.
  Measured on a 4-core box: 1×50 in its own process passes cleanly (0 lost,
  DISCUSS p95 < 1 s) while the same retro inside a 255-socket process shows
  multi-second latencies. For anything beyond ~100 sockets, shard one
  process per retro (distinct `--seed` per process; team names never
  collide because each process gets its own run id), ideally across
  machines — which also spreads per-IP HTTP rate limits.
- **Sharding is not free either.** Five 51-socket processes plus the server on
  one 4-core box starve each other badly enough to fail (~200 lost writes per
  shard, first-attempt success down to ~17%), while the *same* shape run one
  process at a time passes with 0 lost. If every shard fails at once, suspect
  the box before the server: check that the generators are not each burning a
  full core (`--quiet` runs still print wall time; one 1×50 run costs ~2 min of
  CPU).
- **Writes are never emitted on a disconnected socket**, mirroring
  `syncService.updateSession`, which parks the update in `queuedSession` and
  flushes it only after the re-join. Handing it to socket.io's offline buffer
  instead would flush it on reconnect *ahead* of the join, and the server would
  refuse a write whose socket has no session yet — a failure mode the shipped
  client cannot have, so measuring it would be measuring the harness.
- The harness covers retrospectives (the heaviest flow). Health checks share
  the same session sync path (`session:{id}` KV + `update-session` CAS), so
  a passing retro run covers the sync engine; add a health-check scenario if
  their usage becomes dominant.
- Timer start/stop and icebreaker typing are not simulated (low write rate,
  facilitator-only or ephemeral). `participant-activity` typing cues are
  ephemeral by design and excluded from integrity checks.
