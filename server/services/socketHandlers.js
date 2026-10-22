import { findProtectedFieldViolations, restoreProtectedFields, isSameSessionState } from './sessionGuard.js';
import { runWithContext, setContextValue } from './logContext.js';
import { createRepeatCoalescer } from './logCoalescer.js';
import { SESSION_REVOKED_ERROR, TeamAuthRowCorruptError, sessionVerdict } from './sessionEpoch.js';
import { NO_OP_SESSION_REVOCATION, TEAM_SESSIONS_REVOKED_EVENT } from './sessionRevocation.js';

// Decision D3b: how often each pod re-checks its joined sockets against their
// team's session epoch. The broadcast of a rotation cuts them at once; this
// covers a pod that missed it (a degraded cross-pod adapter) and the sockets
// joined unverified during a database outage. A constant, not a setting: one
// tiny read per team with live sockets per minute is no capacity question.
const REVOCATION_SWEEP_MS = 60_000;

// A timer that never holds the process open (the adapter's retries do the
// same, socketAdapter.js).
const scheduleUnref = (run, delayMs) => {
  const timer = setTimeout(run, delayMs);
  if (typeof timer.unref === 'function') timer.unref();
};

// The id a client gives its join, echoed in a denial so a client can tell the
// denial of an earlier join from that of its latest one. Anything else is
// ignored: it reaches a log line and goes back over the wire.
const JOIN_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// How long to wait before refreshing a team's `lastConnectionDate` again.
// Without this, every participant join (and every reconnection after a rolling
// update) triggered a team write, producing a write storm when a whole session
// reconnects at once. The timestamp only needs coarse "last seen" granularity.
const LAST_CONNECTION_DEBOUNCE_MS = (() => {
  const parsed = Number(process.env.LAST_CONNECTION_DEBOUNCE_MS);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5 * 60 * 1000;
})();

const shouldRefreshLastConnection = (
  lastConnectionDate,
  now = Date.now(),
  minIntervalMs = LAST_CONNECTION_DEBOUNCE_MS
) => {
  if (!lastConnectionDate) return true;
  const last = new Date(lastConnectionDate).getTime();
  if (Number.isNaN(last)) return true;
  return now - last >= minIntervalMs;
};

// Refreshes the date, and answers whether this call wrote it. The decision is
// taken again inside the update, on the record as the team's write queue hands
// it over: a whole session reconnecting at once all read the stale date before
// the queue, and each would otherwise rewrite the whole team record in turn.
const refreshLastConnectionDate = async (dataStore, teamId) => {
  let refreshed = false;
  await dataStore.atomicTeamUpdate(teamId, (team) => {
    if (!shouldRefreshLastConnection(team.lastConnectionDate)) return null;
    team.lastConnectionDate = new Date().toISOString();
    refreshed = true;
    return team;
  });
  return refreshed;
};

// One refresh per team in flight on this pod. A burst of joins — a whole
// session reconnecting after a rolling update — all read the stale date before
// any of them writes; each would otherwise queue its own update, and every
// queued updater parses the whole team record under the lock before it can
// decline. They share the one refresh instead, so a burst costs one parse and
// one write on this pod (and, through the in-lock decision above, none on the
// next pod). Only the call that started the refresh can answer true, and only
// that call sees its rejection: the others answer false, so a failure is
// logged once.
const createLastConnectionRefresher = (dataStore, refresh = refreshLastConnectionDate) => {
  const inFlight = new Map(); // teamId -> Promise<boolean>
  const run = (teamId) => {
    const running = inFlight.get(teamId);
    if (running) return running.then(() => false, () => false);
    const started = refresh(dataStore, teamId);
    inFlight.set(teamId, started);
    const forget = () => {
      if (inFlight.get(teamId) === started) inFlight.delete(teamId);
    };
    // Both handlers attached: the caller awaits `started` itself, and this
    // branch must not leave a rejection of its own unhandled.
    started.then(forget, forget);
    return started;
  };
  return { run, pending: () => inFlight.size };
};

// --- update-session flood protection (audit PR-12) -------------------------
// A per-socket token bucket caps how many `update-session` writes one client
// can drive through the expensive path (DB read + optimistic-concurrency CAS
// write + room broadcast). It is DISABLED by default (rate 0): enabling it is
// a capacity-sensitive change to the session-sync path, so operators must set
// SOCKET_UPDATE_RATE and run the load test (loadtest/README.md) before relying
// on it in production. When enabled, a throttled write is never silently
// dropped — the sender is healed with the cached authoritative state so its
// `syncService` re-applies its own data and re-sends, costing a round-trip
// instead of a lost action (the same contract as a stale-CAS rejection).
const parseUpdateThrottleConfig = (env = process.env) => {
  const rate = Number(env.SOCKET_UPDATE_RATE);
  const safeRate = Number.isFinite(rate) && rate > 0 ? rate : 0;
  const burst = Number(env.SOCKET_UPDATE_BURST);
  // Burst is a whole token count and must be at least 1: a positive but
  // sub-token value (e.g. 0.5) would cap the bucket below one token so
  // `bucket.tokens >= 1` never holds and every write is throttled forever.
  // A misconfigured or sub-1 burst falls back to the derived 2x-rate default.
  const safeBurst =
    Number.isFinite(burst) && burst >= 1 ? Math.floor(burst) : Math.max(Math.ceil(safeRate * 2), 1);
  return { rate: safeRate, burst: safeBurst };
};

// Refills `bucket` from elapsed wall-clock time and consumes one token,
// mutating it in place. Returns true when a token was available (write
// allowed). A rate of 0 disables throttling (always allowed). Pure apart from
// the passed-in bucket, so it is unit-tested directly.
const consumeUpdateToken = (bucket, { rate, burst }, nowMs) => {
  if (!(rate > 0)) return true;
  if (typeof bucket.tokens !== 'number' || typeof bucket.updatedAt !== 'number') {
    bucket.tokens = burst;
    bucket.updatedAt = nowMs;
  }
  const elapsedSec = Math.max(0, (nowMs - bucket.updatedAt) / 1000);
  bucket.tokens = Math.min(burst, bucket.tokens + elapsedSec * rate);
  bucket.updatedAt = nowMs;
  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return true;
  }
  return false;
};

// Cheap, allocation-free top-level shape check run before the CAS/broadcast
// path. Rejects blobs that are not plain objects, that claim a different
// session id, or whose `_rev` is present but not a non-negative safe integer.
// The last case matters because saveSessionState coerces `_rev` with Number()
// and advances it with `+ 1`: a crafted `_rev` such as "abc" (→ NaN), 1e308 or
// 2**53 (finite but unsafe — `+ 1` no longer advances, so the revision line
// freezes and later stale blobs stamped with the same huge value are no longer
// ordered by the CAS) would otherwise poison the optimistic-concurrency CAS for
// that session. Returns null when the blob is acceptable, or a short reason
// string for logging otherwise. Legitimate clients always stamp a non-negative
// integer `_rev` (services/syncService.ts does `Number(...) || 0`; the server
// only ever stores `Math.max(...) + 1`), so this never rejects a real write.
const validateSessionUpdateShape = (sessionData, sessionId) => {
  if (!sessionData || typeof sessionData !== 'object' || Array.isArray(sessionData)) {
    return 'not a plain object';
  }
  if (sessionData.id && sessionData.id !== sessionId) {
    return `blob id ${sessionData.id} does not match joined session ${sessionId}`;
  }
  if (sessionData._rev != null && !(Number.isSafeInteger(sessionData._rev) && sessionData._rev >= 0)) {
    return 'invalid _rev';
  }
  return null;
};

// --- telling a client its write was not saved (incident ISS) ----------------
// Every path that answers an `update-session` with something other than a save
// emits `session-update-refused` to the sender first, immediately before the
// heal (a `session-update` to the sender alone). The heal alone looks exactly
// like an ordinary state delivery, so a client could not tell "my write lost a
// race" from "my writes are being refused, every one of them" — which is how a
// participant's client re-sent the same refused blob three times a second for
// as long as the session lasted, with nothing on screen and the cards in it
// quietly expiring. Old clients ignore an event they do not know, so this is
// safe during a rolling update.
//
// Reasons: 'stale' (built on an older revision), 'protected-fields' (a
// participant write whose only changes were facilitator-only, healed away),
// 'immutable' (teamId changed), 'malformed' (a shape that cannot be checked or
// restored), 'not-joined' (no session on this socket — no heal, there is no
// room to heal from), 'throttled' (SOCKET_UPDATE_RATE).
const REFUSAL_EVENT = 'session-update-refused';

// How a refused field's values read in the log: short scalars are quoted as
// JSON (so a newline or quote in a retro title cannot forge a log line) and cut
// at 60 characters; anything structured is named, not dumped.
const PREVIEW_MAX = 60;
const previewValue = (value) => {
  if (value === undefined) return 'absent';
  if (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) return null;
  const json = JSON.stringify(value);
  return json.length > PREVIEW_MAX ? `${json.slice(0, PREVIEW_MAX - 1)}…` : json;
};

const readFieldPath = (blob, path) => {
  if (!path.startsWith('settings.')) return blob?.[path];
  const settings = blob?.settings;
  return settings && typeof settings === 'object' ? settings[path.slice('settings.'.length)] : undefined;
};

// "name: sent "Retro A" vs stored "Retro B"; columns" — the detail that turns
// "a participant is being refused" into "a participant's client is holding the
// name from before the rename", which is what the incident needed and lacked.
const describeRestoredFields = (fields, sent, stored) =>
  fields
    .map((field) => {
      const sentPreview = previewValue(readFieldPath(sent, field));
      const storedPreview = previewValue(readFieldPath(stored, field));
      return sentPreview !== null && storedPreview !== null
        ? `${field}: sent ${sentPreview} vs stored ${storedPreview}`
        : field;
    })
    .join('; ');

// --- roster rebroadcast coalescing (audit R28) -----------------------------
// During a reconnect stampede — every client of a killed pod rejoining at once
// after a rolling update — each `join-session`/`leave-session` otherwise fires a
// cross-pod `fetchSockets()` plus a full-roster broadcast to the whole room. For
// N near-simultaneous rejoins that is N cross-pod fetches and O(N^2) roster
// messages "in seconds", the first thing to melt at larger rooms. Coalescing
// collapses a burst to at most one rebuild + one broadcast per room per debounce
// window, independent of how many clients churned inside it. The immediate
// `member-joined`/`member-left` signals still give incremental UI feedback, and
// the roster is rebuilt at fire time so the coalesced broadcast always reflects
// current membership.
//
// ROSTER_BROADCAST_DEBOUNCE_MS is the window in ms (default 250). 0 disables the
// debounce window: every join/leave triggers a rebuild immediately (rebuilds are
// still serialized per room, below, so they cannot race). Unlike the
// update-session throttle this never drops or delays a user action — it only
// batches a presence broadcast whose content is unchanged — so it ships enabled
// by default.
const parseRosterBroadcastConfig = (env = process.env) => {
  const raw = env.ROSTER_BROADCAST_DEBOUNCE_MS;
  // Treat unset AND blank/whitespace-only alike: Number('') and Number('  ')
  // are 0, which would silently disable coalescing (the default is enabled at
  // 250ms) and reinstate the O(N^2) reconnect stampede this guards against.
  // Deployment tooling that renders an empty value must fall back to the
  // default; only an explicit "0" disables the feature.
  if (raw == null || String(raw).trim() === '') return 250;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 250;
};

// Coalesces per-room roster rebroadcasts behind a debounce window. `broadcast`
// is the (async) rebuild+emit for one room; timers are injected so the
// coalescing logic is unit-testable without wall-clock waits. A fixed,
// non-resetting window guarantees at most one broadcast per window per room and
// that every join/leave is reflected within one window (the fire rebuilds the
// roster from the sockets connected at that instant). Timer handles are unref'd
// so a pending rebroadcast never keeps the event loop alive.
//
// Rebuilds for one room are also **serialized**: at most one broadcast is in
// flight per room, and any join/leave that arrives while it runs collapses into
// exactly one follow-up rebuild after it settles. Without this, `fire` clears
// the pending entry before the async `broadcast` settles, so a later window
// could start a second `fetchSockets()` for the same room; a cross-pod fetch
// slower than the window could then resolve *after* the newer one and emit a
// stale roster last, leaving clients' connected-set wrong until the next
// membership event (Codex review, PR #390). Serializing keeps emit order = fetch
// order, so the last roster a room emits is always the freshest.
const createRosterBroadcaster = ({
  delayMs,
  broadcast,
  setTimer = setTimeout,
  clearTimer = clearTimeout
}) => {
  const pending = new Map(); // sessionId -> timer handle (a rebuild is scheduled)
  const inFlight = new Set(); // sessionId -> its broadcast has not settled yet
  const rerun = new Set(); // sessionId -> activity arrived during the in-flight rebuild

  // Runs one broadcast for the room; when it settles, runs a single follow-up
  // if join/leave activity was folded in while it was in flight.
  const run = (sessionId) => {
    inFlight.add(sessionId);
    let result;
    try {
      result = broadcast(sessionId);
    } catch (err) {
      console.warn('[Server] Roster rebroadcast failed', err);
    }
    Promise.resolve(result)
      .catch((err) => console.warn('[Server] Roster rebroadcast failed', err))
      .finally(() => {
        inFlight.delete(sessionId);
        if (rerun.delete(sessionId)) run(sessionId);
      });
  };

  const fire = (sessionId) => {
    pending.delete(sessionId);
    // A rebuild for this room is still settling: defer to a single follow-up
    // instead of starting an overlapping fetch that could finish out of order.
    if (inFlight.has(sessionId)) {
      rerun.add(sessionId);
      return;
    }
    run(sessionId);
  };

  const schedule = (sessionId) => {
    if (!sessionId) return;
    // Debounce window disabled: rebuild immediately (still serialized per room).
    if (!(delayMs > 0)) {
      fire(sessionId);
      return;
    }
    // A rebuild is already queued for this room: fold this event into it.
    if (pending.has(sessionId)) return;
    const handle = setTimer(() => fire(sessionId), delayMs);
    if (typeof handle?.unref === 'function') handle.unref();
    pending.set(sessionId, handle);
  };

  const cancelAll = () => {
    for (const handle of pending.values()) clearTimer(handle);
    pending.clear();
  };

  return { schedule, cancelAll, pendingCount: () => pending.size };
};

const registerSocketHandlers = ({
  io,
  dataStore,
  sessionCache,
  tokenService,
  // Refusal lines are coalesced per socket (logCoalescer.js): a client stuck
  // re-sending a refused write must not be able to flush the 1000-line log
  // ring the super admin investigates from. Injectable for tests.
  refusalLog = createRepeatCoalescer(),
  // Decision D3b — the routes that rotate a password call its
  // `revokeTeamSessions`, which runs the sweep attached below. A no-op by
  // default for the test harnesses; `server.js` is the wiring.
  sessionRevocation = NO_OP_SESSION_REVOCATION,
  // The periodic sweep's interval, 0 to turn it off, and its timer: injectable
  // so a harness can run it fast, or not at all.
  revocationSweepMs = REVOCATION_SWEEP_MS,
  schedule = scheduleUnref
}) => {
  // Per-socket update-session throttle configuration, read once at startup.
  const updateThrottle = parseUpdateThrottleConfig();

  // Shared by every join on this pod (see createLastConnectionRefresher).
  const lastConnectionRefresher = createLastConnectionRefresher(dataStore);

  // Cross-pod session-cache invalidation (audit PR-6 / C-6). A super-admin
  // restore rewrites the shared store, so every pod must drop its in-memory
  // session snapshots — otherwise a replica still holding a stale snapshot
  // could serve or re-persist pre-restore state and resurrect reverted data.
  // The restoring pod clears its own cache directly and broadcasts this
  // server-side event (via the Redis/PostgreSQL adapter) so the other pods
  // clear theirs. serverSideEmit never loops back to the sender, so this
  // listener only ever fires on the *other* replicas; single-pod deployments
  // (in-memory adapter) never emit it.
  //
  // Decision D3b: the restore may also have given teams a new session epoch,
  // so every socket on this pod is re-checked (`sweepRevokedSockets`, below).
  io.on('sessions-invalidated', () => {
    sessionCache.clear();
    console.info('[Server] Cleared session cache after cross-pod restore invalidation');
    sweepRevokedSockets(null).catch((err) => console.warn('[Server] Session revocation sweep after a restore failed', err));
  });

  // Decision D3b: another pod changed a team's password. The payload is only
  // a hint — the decision is always the team's epoch, read again here — so a
  // forged, late or duplicated event can never cut a socket that is current.
  io.on(TEAM_SESSIONS_REVOKED_EVENT, (payload) => {
    if (typeof payload?.teamId !== 'string' || payload.teamId === '') return;
    sweepRevokedSockets(payload.teamId).catch((err) => console.warn('[Server] Session revocation sweep failed', err));
  });

  // The team a role is read from: its summary, never the full record, whose
  // history can weigh megabytes and which a reconnect wave would parse once
  // per joiner. Except when the summary read THROWS: on PostgreSQL the summary
  // is a `value::jsonb` projection, and jsonb refuses text Node's JSON.parse
  // accepts — a lone UTF-16 surrogate escape (an excerpt cut through an emoji)
  // or `\u0000`. Such a row would otherwise leave every socket of the team
  // without a role, and every facilitator-only change refused, until someone
  // repaired the row by hand; the full record still reads, as it did before
  // the summary was used here. A summary that answers null is an answer (the
  // team is gone), never a reason to read the record. The warning is
  // coalesced per team, so a reconnect wave writes one line, not one per
  // joiner; a full record that cannot be read either throws to the caller.
  const loadRosterTeam = async (teamId) => {
    try {
      return await dataStore.loadTeamSummary(teamId);
    } catch (summaryErr) {
      refusalLog.report({
        group: 'team-summary-fallback',
        key: String(teamId),
        message: () => {
          const code = summaryErr?.code ? `${summaryErr.code} ` : '';
          return `[Server] Could not read the team summary of ${teamId} (${code}${summaryErr?.message ?? summaryErr}); reading the roster from the full record instead`;
        },
        label: `[Server] Team summary of ${teamId} unreadable, roster read from the full record`
      });
      return dataStore.loadTeam(teamId);
    }
  };

  // The roster's entry for a user. The summary's `members` is always an array;
  // a full record's is whatever it stores.
  const findRosterMember = (team, userId) =>
    (Array.isArray(team?.members) ? team.members.find((m) => m?.id === userId) : undefined);

  // Resolve the sender's role from the team roster (the database record, not
  // anything the client claims about itself; see loadRosterTeam). Cached on the
  // socket once known; reset on every join-session. A user the roster does not
  // name is a 'participant' — the restrictive default.
  //
  // A failed lookup is 'unknown', not 'participant', and is not cached, so the
  // next write tries again. The two must stay apart because the guard treats
  // them differently: a confirmed participant's write is saved with the
  // facilitator-only fields put back, but doing that to a sender who may be the
  // facilitator splits one gesture in two — a phase change's timer reset saved
  // without the phase — so an unknown sender's write is refused whole instead
  // (see the update-session guard).
  const resolveSenderRole = async (socket, teamId) => {
    if (socket.data.sessionRole) return socket.data.sessionRole;
    try {
      const team = await loadRosterTeam(teamId);
      const member = findRosterMember(team, socket.userId);
      const role = member?.role === 'facilitator' ? 'facilitator' : 'participant';
      socket.data.sessionRole = role;
      return role;
    } catch (err) {
      console.warn('[Server] Failed to resolve sender role from the team record; refusing its facilitator-only changes whole', err);
      return 'unknown';
    }
  };

  const revOf = (state) => Number(state?._rev ?? 0);

  // Whichever of two session states has the higher revision; `current` on a
  // tie, so a state this pod already holds is kept rather than swapped for an
  // equal copy.
  const newerState = (current, candidate) =>
    candidate && (!current || revOf(candidate) > revOf(current)) ? candidate : current;

  // Moves this pod's cache to `state` only when that is a step forward. A heal
  // computed across an await can be older than the cache by the time it is
  // known — a write this pod accepted meanwhile — and writing it back would
  // rewind the cache behind a revision already acknowledged to its sender.
  const advanceSessionCache = (sessionId, state) => {
    if (!state) return;
    const cached = sessionCache.get(sessionId);
    if (!cached || revOf(state) > revOf(cached)) sessionCache.set(sessionId, state);
  };

  // The freshest state for a session that `known` (this pod's view of it,
  // taken before this read) may be lagging. Each pod's cache advances only on
  // writes through that pod, so in a multi-pod deployment the database can be
  // ahead of it; healing a refused write from the cache then hands the client
  // a state older than one already stored. The reverse holds as well: degraded
  // mode accepts writes into the cache alone while the database is down, so
  // once it is back the cache can be *ahead* of the row, and preferring the
  // row would hand out — and, through the caller, cache — the pre-outage state.
  //
  // So the highest revision wins, and the row is compared with the cache as
  // it is once the read returns, not with `known`: a write this pod accepted
  // during the read has moved the cache past both, and the snapshot would lose
  // to a row that write already superseded. `known` stands in when the cache
  // evicted the session meanwhile. loadSessionState answers null on a read
  // failure, so an outage falls back to what the pod knows. The caller moves
  // the cache forward only (advanceSessionCache).
  const freshestSessionState = async (sessionId, known) => {
    const persisted = await dataStore.loadSessionState(sessionId);
    return newerState(newerState(sessionCache.get(sessionId), known), persisted);
  };

  const buildSessionRoster = async (sessionId) => {
    try {
      const sockets = await io.in(sessionId).fetchSockets();
      return sockets
        .map((connectedSocket) => ({
          id: connectedSocket.data.userId,
          name: connectedSocket.data.userName
        }))
        .filter((member) => member.id && member.name);
    } catch (err) {
      console.warn('[Server] Failed to fetch full roster across pods', err);
      const localMembers = [];
      for (const connectedSocket of io.sockets.sockets.values()) {
        if (!connectedSocket.rooms.has(sessionId)) continue;
        if (connectedSocket.data.userId && connectedSocket.data.userName) {
          localMembers.push({
            id: connectedSocket.data.userId,
            name: connectedSocket.data.userName
          });
        }
      }
      return localMembers;
    }
  };

  // Rebuild the roster for one room and broadcast it to everyone in that room.
  // buildSessionRoster never throws (it catches its own fetch errors), so this
  // resolves cleanly; the coalescer still guards against a rejected promise.
  const broadcastRoster = async (sessionId) => {
    const roster = await buildSessionRoster(sessionId);
    io.to(sessionId).emit('member-roster', roster);
  };

  // Coalesce roster rebroadcasts so a reconnect stampede cannot drive one
  // cross-pod fetchSockets() + full-roster broadcast per join (audit R28).
  const rosterBroadcaster = createRosterBroadcaster({
    delayMs: parseRosterBroadcastConfig(),
    broadcast: broadcastRoster
  });

  const leaveCurrentSession = async (socket) => {
    // Whatever this socket had been refusing in a loop is summarised now, in
    // one line, rather than waiting for the window to end.
    refusalLog.flushGroup(socket.id);

    const sessionId = socket.sessionId;
    if (!sessionId) return;

    console.log(`[Server] ${socket.userName || 'Unknown'} leaving session ${sessionId}`);
    socket.leave(sessionId);

    // Debug (stdout only, never the log ring): the leave line above already
    // says who left, and a reconnect wave writes one of each per participant.
    const room = io.sockets.adapter.rooms.get(sessionId);
    console.debug(`[Server] Session ${sessionId} now has ${room?.size || 0} connected clients`);

    socket.to(sessionId).emit('member-left', {
      userId: socket.userId,
      userName: socket.userName
    });

    rosterBroadcaster.schedule(sessionId);

    socket.sessionId = null;
  };

  // ---------------------------------------------------------------------------
  // Decision D3b — cutting the sockets whose token a password rotation revoked
  // ---------------------------------------------------------------------------

  // Takes a joined socket out of its session for good: it leaves the room
  // (the others get `member-left` and a roster), and is told why with the
  // denial its join would get now. It stays *connected*: socket.io clients do
  // not reconnect on their own after a denial, so there is no reconnect storm,
  // and every later write is refused 'not-joined' and persists nothing. Cut
  // once: a second sweep reaching the same socket finds no session and sends
  // nothing, never a denial naming no session.
  const revokeSocket = async (socket, cause) => {
    const sessionId = socket.sessionId;
    if (!sessionId || !socket.data.authClaims) return;
    const joinId = socket.data.joinId ?? undefined;
    socket.data.authClaims = null;
    socket.data.authTeamId = undefined;
    socket.data.sessionRole = undefined;
    socket.data.authUnverified = false;
    await leaveCurrentSession(socket);
    socket.emit('join-denied', { sessionId, reason: 'unauthenticated', cause, ...(joinId ? { joinId } : {}) });
    console.info(`[Server] Signed ${JSON.stringify(socket.userName || 'unknown')} out of session ${sessionId}: ${cause}`);
  };

  // Re-checks this pod's joined sockets — of one team, or of all teams for a
  // null `teamId` — against their team's session epoch, one tiny read per
  // team. A read that fails is "unknown", never "revoked": the socket stays,
  // and the next sweep tries again. A corrupt epoch row is permanent, and is
  // treated as revoked (the HTTP routes refuse every token of that team too).
  const sweepRevokedSockets = async (teamId = null) => {
    const byTeam = new Map();
    // A snapshot: the loop awaits, and the live Map changes meanwhile.
    for (const socket of [...(io.sockets?.sockets?.values?.() ?? [])]) {
      // A join that read the old epoch finishes first, so its socket is
      // judged on the claims it ends up holding.
      if (socket.data.joinInFlight) await socket.data.joinInFlight;
      const claims = socket.data.authClaims;
      if (!claims || !socket.sessionId || (teamId && claims.teamId !== teamId)) continue;
      if (!byTeam.has(claims.teamId)) byTeam.set(claims.teamId, []);
      byTeam.get(claims.teamId).push(socket);
    }
    for (const [tid, sockets] of byTeam) {
      let state;
      try {
        state = await dataStore.loadTeamAuthState(tid);
      } catch (err) {
        if (!(err instanceof TeamAuthRowCorruptError)) {
          console.warn(`[Server] Session revocation sweep: the session epoch of team ${JSON.stringify(tid)} could not be read; its sockets are checked again on the next sweep`, err);
          continue;
        }
        console.error(`[Server] Session revocation sweep: ${err.message}`);
        state = null;
      }
      for (const socket of sockets) {
        // Read after the await: a re-join may have moved it, another sweep
        // may have cut it.
        const claims = socket.data.authClaims;
        if (!claims || !socket.sessionId || claims.teamId !== tid) continue;
        const verdict = state ? sessionVerdict(claims, state) : 'revoked';
        if (verdict === 'current') {
          socket.data.authUnverified = false;
          continue;
        }
        await revokeSocket(socket, verdict === 'team_not_found' ? 'team_not_found' : SESSION_REVOKED_ERROR);
      }
    }
  };

  sessionRevocation.attachLocalSweeper(sweepRevokedSockets);

  if (revocationSweepMs > 0) {
    const sweepPeriodically = () => {
      schedule(() => {
        sweepRevokedSockets(null)
          .catch((err) => console.warn('[Server] Periodic session revocation sweep failed', err))
          .finally(sweepPeriodically);
      }, revocationSweepMs);
    };
    sweepPeriodically();
  }

  io.on('connection', (socket) => {
    // Audit H44, the socket half of the correlation id. The HTTP middleware
    // cannot help here: a socket outlives the request that upgraded it, and
    // the failure H44 describes — "a retrospective lost votes at 14:20" — is
    // almost entirely socket traffic. Every event handler runs inside a
    // context keyed on the socket, and `join-session` fills in the session id
    // once it has authenticated one, so the lines that matter carry both.
    //
    // A wrapper rather than a per-handler edit, for the same reason as the
    // HTTP side: the handlers below stay exactly as they were.
    const on = (event, handler) =>
      socket.on(event, (...args) =>
        runWithContext({ correlationId: socket.id, sessionId: socket.sessionId }, () =>
          handler(...args)
        )
      );

    // Debug: the join line that follows names the user; the disconnect line
    // stays at info.
    console.debug('[Server] Client connected:', socket.id);

    // Audit H1: the socket channel used to have no authentication at all — a
    // join was taken at face value and answered with the full session state,
    // so knowing a session id was enough to read and write a live
    // retrospective. A join must now carry the team session token the client
    // already holds after login, and that token must belong to the team that
    // owns the session. Nothing (not the room membership, not one field of
    // state) happens before both checks pass.
    const handleJoinSession = async ({ sessionId, userId, userName, sessionToken, joinId: rawJoinId }) => {
      console.log(`[Server] User ${userName} (${userId}) joining session ${sessionId}`);
      // Decision D3b: echoed in a denial, so the client can tell the denial of
      // an earlier join (made with a token it has since replaced) from that of
      // its latest one. A client from before it sends none, and is sent none.
      const joinId = typeof rawJoinId === 'string' && JOIN_ID_PATTERN.test(rawJoinId) ? rawJoinId : null;

      const denyJoin = (reason, cause = null) => {
        console.warn(`[Server] Denied join for session ${sessionId} from ${userName || 'unknown'}: ${reason}${cause ? ` (${cause})` : ''}`);
        socket.emit('join-denied', { sessionId, reason, ...(cause ? { cause } : {}), ...(joinId ? { joinId } : {}) });
      };

      if (!sessionId || typeof sessionId !== 'string') {
        return denyJoin('unauthenticated');
      }

      const claims = tokenService.validateSessionToken(sessionToken);
      if (!claims) {
        return denyJoin('unauthenticated');
      }

      // Decision D3b: a token a password rotation revoked joins nothing, and
      // neither does one whose team was deleted. A socket presenting such a
      // credential also leaves the session it is in: its client holds no
      // other token, so whatever it joined with is gone too.
      const denyRevokedJoin = async (cause) => {
        if (socket.sessionId) {
          socket.data.authClaims = null;
          socket.data.authTeamId = undefined;
          socket.data.sessionRole = undefined;
          await leaveCurrentSession(socket);
        }
        denyJoin('unauthenticated', cause);
      };
      // A read error is accepted on the signature, flagged, and re-checked by
      // the periodic sweep once the database answers — continuity over the
      // guard during an outage, the 2026-10-12 precedent. A corrupt row is no
      // outage, it is permanent: accepting on it would let every token of the
      // team join, revoked ones included, for as long as it stays corrupt.
      let authUnverified = false;
      try {
        const verdict = sessionVerdict(claims, await dataStore.loadTeamAuthState(claims.teamId));
        if (verdict === 'revoked') return await denyRevokedJoin(SESSION_REVOKED_ERROR);
        if (verdict === 'team_not_found') return await denyRevokedJoin('team_not_found');
      } catch (err) {
        if (err instanceof TeamAuthRowCorruptError) {
          console.error(`[Server] Join refused: ${err.message}`);
          return await denyRevokedJoin(null);
        }
        console.warn(`[Server] The session epoch of team ${JSON.stringify(claims.teamId)} could not be read; the join is accepted on its token's signature and checked again by the next sweep`, err);
        authUnverified = true;
      }

      // Load the persisted session BEFORE joining the room: the credential has
      // to be checked against the session's owning team, and a socket that
      // fails that check must never have been in the room at all. The loaded
      // blob is reused for the initial sync and the lastConnectionDate
      // bookkeeping below, so this is not an extra read.
      let sessionData = null;
      let fromDatabase = false;
      if (dataStore.usePostgres || dataStore.getSqliteDb()) {
        sessionData = await dataStore.loadSessionState(sessionId);
        fromDatabase = !!sessionData;
        if (!sessionData && sessionCache.has(sessionId)) {
          sessionData = sessionCache.get(sessionId);
        }
      } else if (sessionCache.has(sessionId)) {
        sessionData = sessionCache.get(sessionId);
      }

      // A session with no teamId yet (it does not exist — the facilitator is
      // about to create it) cannot be team-checked here; the first
      // `update-session` is bound to the credential's team instead.
      if (sessionData?.teamId && sessionData.teamId !== claims.teamId) {
        return denyJoin('forbidden');
      }

      if (socket.sessionId && socket.sessionId !== sessionId) {
        await leaveCurrentSession(socket);
      }

      socket.join(sessionId);
      socket.sessionId = sessionId;
      // Audit H44: the join handler entered its context before it knew which
      // session it was joining, so fill it in now — every line this handler
      // logs from here on, and every later event on this socket, names it.
      setContextValue('sessionId', sessionId);
      socket.userId = userId;
      socket.userName = userName;
      socket.data.userId = userId;
      socket.data.userName = userName;
      // The authenticated team, from the signed token — never from the client
      // payload. Bounds every later write on this socket to one team.
      socket.data.authTeamId = claims.teamId;
      // Decision D3b: what the revocation sweep judges this socket by, and the
      // join id its denial would echo.
      socket.data.authClaims = { teamId: claims.teamId, sessionEpoch: claims.sessionEpoch ?? null, createdAt: claims.createdAt };
      socket.data.joinId = joinId;
      socket.data.authUnverified = authUnverified;
      // Role is per session and per claimed user; re-resolve after every join.
      socket.data.sessionRole = undefined;

      rosterBroadcaster.schedule(sessionId);

      // Debug, like the per-write lines: one join used to write four info
      // lines, and a drained pod's 150 participants reconnecting filled the
      // whole 1000-line ring. The join line above stays at info.
      const room = io.sockets.adapter.rooms.get(sessionId);
      console.debug(`[Server] Session ${sessionId} now has ${room?.size || 0} connected clients`);

      if (sessionData) {
        if (fromDatabase) {
          sessionCache.set(sessionId, sessionData);
          console.debug(`[Server] Sending persisted session state to ${userName}`);
        } else {
          console.debug(`[Server] Sending cached session state to ${userName}`);
        }
        // The in-memory-only store keeps its historical behaviour of seeding
        // the join from cache without an initial emit.
        if (dataStore.usePostgres || dataStore.getSqliteDb()) {
          socket.emit('session-update', sessionData);
        }
      }

      socket.to(sessionId).emit('member-joined', { userId, userName });

      // The roster comes from the team summary (the full record only when the
      // summary read throws, see loadRosterTeam): a reconnect wave is one join
      // per participant, and loading the record parsed the team's whole
      // history once per joiner. A failed read leaves the role unset rather
      // than guessing it: resolveSenderRole tries again on the first write that
      // needs it, and answers 'unknown' — never 'participant' — if that read
      // fails too.
      try {
        if (sessionData?.teamId) {
          const team = await loadRosterTeam(sessionData.teamId);
          if (team) {
            const member = findRosterMember(team, userId);
            socket.data.sessionRole = member?.role === 'facilitator' ? 'facilitator' : 'participant';
            if (
              member &&
              member.role !== 'facilitator' &&
              shouldRefreshLastConnection(team.lastConnectionDate)
            ) {
              // Awaited, so a write sent right behind the join waits for it
              // (joinInFlight) — and for at most one coalesced team write.
              if (await lastConnectionRefresher.run(sessionData.teamId)) {
                console.log(`[Server] Updated lastConnectionDate for team ${team.name} (participant ${userName} joined)`);
              }
            }
          }
        }
      } catch (err) {
        console.warn('[Server] Could not read the team roster or refresh lastConnectionDate on session join', err);
      }
    };

    // The join above authorizes the socket against the *persisted* session, so
    // it awaits a database read before assigning `socket.sessionId`. Socket.IO
    // does not wait for one handler to settle before dispatching the next event
    // on the same socket, so a write sent right behind the join — session
    // creation, and the automatic re-join after a rolling update — used to run
    // while `socket.sessionId` was still null and was dropped with no ack and
    // no healing snapshot, the one rejection shape the client cannot recover
    // from. Publishing the in-flight join lets those writes wait for it instead
    // of being lost; a write behind a *denied* join still finds no sessionId
    // and is still refused, so H1 is unchanged.
    on('join-session', (payload) => {
      const pending = handleJoinSession(payload).catch((err) => {
        console.error('[Server] Failed to handle join-session', err);
      });
      socket.data.joinInFlight = pending;
      pending.finally(() => {
        if (socket.data.joinInFlight === pending) socket.data.joinInFlight = null;
      });
    });

    // Never rejects (the handler's own rejection is swallowed above), so
    // awaiting it cannot break the caller.
    const awaitPendingJoin = () => socket.data.joinInFlight ?? Promise.resolve();

    on('leave-session', async (payload) => {
      // Which session the client meant to leave. `syncService.leaveSession`
      // names it on the event; fall back to the room this socket was in when
      // the event arrived, for a caller that sends nothing.
      const requested = typeof payload?.sessionId === 'string' ? payload.sessionId : socket.sessionId;

      await awaitPendingJoin();

      // Switching sessions emits leave(A) immediately followed by join(B), and
      // B can finish while we are waiting on A's in-flight join. Leaving
      // "whatever this socket is in" would then evict it from the room it just
      // joined, and the client — believing it is in B — would have every later
      // write dropped until the next reconnect.
      if (requested && socket.sessionId && socket.sessionId !== requested) return;

      await leaveCurrentSession(socket);
    });

    // Tells the sender why its write was not saved (see REFUSAL_EVENT above).
    // Always emitted immediately before the heal, so a client that counts
    // refusals sees the reason before it sees the state that answers it.
    const refuse = (sessionId, reason, details = {}) => {
      socket.emit(REFUSAL_EVENT, { sessionId, reason, ...details });
    };

    const refuseAndHeal = (sessionId, reason, state, details = {}) => {
      const rev = Number(state?._rev);
      refuse(sessionId, reason, Number.isFinite(rev) ? { ...details, rev } : details);
      if (state) socket.emit('session-update', state);
    };

    // One coalesced line per socket and kind of refusal (logCoalescer.js).
    const logRefusal = (key, message, { level = 'warn', label } = {}) => {
      refusalLog.report({ group: socket.id, key, level, message, label });
    };

    // Publishes an accepted write. The other clients get the new state; the
    // sender gets the ack with the new revision so its next update is stamped
    // current (and is not mistaken for a stale write).
    //
    // When facilitator-only fields were restored, what was saved is not what
    // the sender sent, and the ack alone would let its syncService synthesize
    // its own blob back as the accepted one — the old name and all. So the
    // sender gets the saved state first: its session-update handler raises the
    // delivered revision to the new one, and the ack that follows, at that same
    // revision, then synthesizes nothing.
    const acceptWrite = (sessionId, savedData, restoredFields) => {
      sessionCache.set(sessionId, savedData);

      // Debug (stdout only): one line per accepted write would turn the log
      // ring over in seconds during a live retrospective.
      const room = io.sockets.adapter.rooms.get(sessionId);
      console.debug(`[Server] Broadcasting to ${(room?.size || 1) - 1} other clients in session ${sessionId}`);

      socket.to(sessionId).emit('session-update', savedData);
      if (restoredFields.length > 0) socket.emit('session-update', savedData);
      socket.emit('session-ack', { sessionId, rev: savedData._rev });
    };

    on('update-session', async (sessionData) => {
      await awaitPendingJoin();

      const sessionId = socket.sessionId;
      if (!sessionId) {
        // No session on this socket: a write behind a denied join, or one that
        // outran a join the client believes it made. There is no room and no
        // authoritative state to heal from, but the client is told — before,
        // it was dropped with nothing sent back at all, the one answer a
        // client cannot recover from.
        const claimedId = typeof sessionData?.id === 'string' ? sessionData.id : null;
        logRefusal(
          'not-joined',
          `[Server] update-session received but socket has no sessionId (from ${socket.userName || 'unknown'}, socket ${socket.id}, session ${JSON.stringify(claimedId)})`
        );
        refuse(claimedId, 'not-joined');
        return;
      }

      const shapeError = validateSessionUpdateShape(sessionData, sessionId);
      if (shapeError) {
        logRefusal(
          `shape:${shapeError}`,
          `[Server] Ignored malformed session update from ${socket.userName} for ${sessionId}: ${shapeError}`
        );
        // Nothing is healed: a blob that is not even shaped like this session
        // cannot have been built on its state. The id is the blob's own when it
        // names one, so a write for a session this socket has since left is
        // reported against that session, not the current one.
        refuse(typeof sessionData?.id === 'string' ? sessionData.id : sessionId, 'malformed');
        return;
      }

      // Flood protection: gate the expensive DB + broadcast path behind a
      // per-socket token bucket (disabled unless SOCKET_UPDATE_RATE is set).
      // Only throttle when the session is cached, so a throttled write can
      // always be healed from memory (no DB read, no broadcast). If this pod
      // has no cached snapshot — the very first write, or after a
      // SESSION_CACHE_MAX LRU eviction — let the write through the normal path
      // (which repopulates the cache) rather than dropping it silently, since
      // there would be no authoritative state to heal the sender with.
      if (updateThrottle.rate > 0) {
        const cached = sessionCache.get(sessionId);
        if (cached) {
          const bucket = socket.data.updateBucket || (socket.data.updateBucket = {});
          if (!consumeUpdateToken(bucket, updateThrottle, Date.now())) {
            refuseAndHeal(sessionId, 'throttled', cached);
            logRefusal('throttled', `[Server] Throttled update-session from ${socket.userName} for ${sessionId}`);
            return;
          }
        }
      }

      // What is saved: the sender's blob or — for a participant whose write
      // also touched facilitator-only fields — that blob with those fields put
      // back. Declared out here because the degraded-mode branch below must
      // save the same thing the normal path would have.
      let outgoing = sessionData;
      let restoredFields = [];

      try {
        // Authoritative baseline for authorization: the freshest state this
        // pod knows. The local cache can lag behind the database in a
        // multi-pod deployment (writes landing on another pod), so fall back
        // to the database whenever the cache is missing or older than the
        // revision the client built on — comparing against a lagging baseline
        // would wrongly flag up-to-date writes.
        const baseRev = Number(sessionData._rev ?? 0);
        let authoritative = sessionCache.get(sessionId) ?? null;
        let readDatabase = false;
        // True when the database gave no answer and this pod's copy is older
        // than the revision the sender built on: the baseline is known to be
        // stale, and the only one there is. See the guard below.
        let baselineBehindSender = false;
        if (!authoritative || Number(authoritative._rev ?? 0) < baseRev) {
          readDatabase = true;
          const persisted = await dataStore.loadSessionState(sessionId);
          if (persisted && Number(persisted._rev ?? 0) >= Number(authoritative?._rev ?? 0)) {
            authoritative = persisted;
          }
          baselineBehindSender = !persisted && !!authoritative;
        }

        // teamId is immutable for everyone, the facilitator included: it is
        // what every authorization decision on this session is made against.
        if (authoritative?.teamId && sessionData.teamId !== authoritative.teamId) {
          refuseAndHeal(sessionId, 'immutable', authoritative);
          logRefusal(
            'immutable',
            `[Server] Rejected unauthorized session update from ${socket.userName} for ${sessionId}: teamId is immutable`
          );
          return;
        }

        // Stale before unauthorized. A write built on an older revision is
        // refused by the compare-and-swap below whatever it contains, and it
        // differs from the current state on every field changed since —
        // facilitator-only ones included, the moment the facilitator moves to
        // the next phase. Running the guard first reported an ordinary race as
        // a participant tampering with the phase.
        //
        // The heal is the freshest state, not the baseline: when the baseline
        // came from this pod's cache it can be behind the database (another
        // pod's write), and the compare-and-swap this check short-circuits
        // would have healed from the database row. One read, only on a refusal
        // the cache alone decided. Either way the result is weighed against the
        // cache as it is now, after the await, and the cache only ever moves
        // forward: a write this pod accepted in the meantime is newer than
        // anything read before it.
        if (authoritative && baseRev < Number(authoritative._rev ?? 0)) {
          const freshest = readDatabase
            ? newerState(sessionCache.get(sessionId), authoritative)
            : await freshestSessionState(sessionId, authoritative);
          advanceSessionCache(sessionId, freshest);
          refuseAndHeal(sessionId, 'stale', freshest);
          logRefusal('stale', `[Server] Rejected stale session update from ${socket.userName} for ${sessionId}`, { level: 'log' });
          return;
        }

        // The write is only guarded when there is a session to protect; the
        // very first write (session creation, by the facilitator) has no
        // authoritative state yet. Sessions without a teamId have no roster to
        // resolve roles against, so they cannot be guarded either.
        //
        // Nor when the only baseline is known to be older than the write. That
        // is a database read failing (loadSessionState answers null) on a pod
        // whose cache lags a revision the sender received through another pod
        // — the facilitator's phase change, say. Every facilitator-only field
        // changed since then reads as a violation, and restoring them wrote
        // the *older* values into a write built on the newer ones, which
        // degraded mode then broadcast at a higher revision: the facilitator's
        // change undone for the whole room. Refusing instead would heal the
        // sender with that same older state. So the write is accepted as sent,
        // the decision already made for a cold cache during an outage —
        // continuity over the guard when there is nothing reliable to guard
        // against — and logged with the fields that went unchecked. A database
        // that answers keeps the guard even when its row is older than the
        // sender's stamp: a client that raises its own `_rev` must not be able
        // to switch the guard off.
        if (authoritative?.teamId && baselineBehindSender) {
          const unchecked = findProtectedFieldViolations(sessionData, authoritative);
          if (unchecked.length > 0) {
            logRefusal(
              `unguarded-stale-baseline:${unchecked.join(',')}`,
              `[Server] Accepted session update from ${socket.userName} (${socket.userId}) in session ${sessionId} without checking ${unchecked.join(', ')}: the database could not be read and this pod's copy (rev ${revOf(authoritative)}) is older than the write (built on rev ${baseRev})`
            );
          }
        } else if (authoritative?.teamId) {
          const violations = findProtectedFieldViolations(sessionData, authoritative);
          if (violations.length > 0) {
            const role = await resolveSenderRole(socket, authoritative.teamId);
            if (role === 'unknown') {
              // The team record could not be read, so this may be the
              // facilitator. Restoring would save half of their gesture (a
              // phase change's timer reset without the phase) and report
              // nothing wrong; refusing whole is the pre-restore behaviour. The
              // heal undoes the gesture on their screen, visibly and whole, so
              // it can be repeated once the record reads again — the phase is
              // not own data, so no client re-sends it by itself. Nothing
              // saved, nothing broadcast.
              refuseAndHeal(sessionId, 'protected-fields', authoritative, { fields: violations });
              logRefusal(
                `role-unknown:${violations.join(',')}`,
                `[Server] Refused session update from ${socket.userName} (${socket.userId}) in session ${sessionId} whole: role unknown (team record read failed), facilitator-only fields changed: ${violations.join(', ')}`
              );
              return;
            }
            if (role !== 'facilitator') {
              const restoration = restoreProtectedFields(sessionData, authoritative);
              if (restoration.reject) {
                refuseAndHeal(sessionId, 'malformed', authoritative, { fields: violations });
                logRefusal(
                  'malformed',
                  `[Server] Rejected unauthorized session update from ${socket.userName} for ${sessionId}: malformed ${violations.join(', ')}`
                );
                return;
              }

              // Restore rather than refuse (incident ISS). Refusing the whole
              // blob threw away everything the participant wrote alongside a
              // facilitator-only difference — and that difference is usually
              // not an attack but a client holding an old copy of a field the
              // facilitator changed elsewhere (a Dashboard rename). Restoring is
              // exactly as strict: the guard finds nothing in what is saved.
              outgoing = restoration.blob;
              restoredFields = restoration.restored;
              const nothingElseChanged = isSameSessionState(outgoing, authoritative);
              const outcome = nothingElseChanged ? 'nothing else changed, sender healed' : 'saved the rest of the write';
              logRefusal(
                `restored:${nothingElseChanged ? 'healed' : 'saved'}:${restoredFields.join(',')}`,
                () =>
                  `[Server] Restored facilitator-only fields from ${socket.userName} (${socket.userId}, ${role}) in session ${sessionId}, ${outcome}: ${describeRestoredFields(restoredFields, sessionData, authoritative)}`,
                {
                  label: `[Server] Restored facilitator-only fields (${restoredFields.join(', ')}) from ${socket.userName} in session ${sessionId}, ${outcome}`
                }
              );

              if (nothingElseChanged) {
                // Nothing of the participant's own is left to save, so there is
                // no write: no revision bump, no broadcast. The sender is healed
                // with the state it should have been building on.
                refuseAndHeal(sessionId, 'protected-fields', authoritative, { fields: restoredFields });
                return;
              }
            }
          }
        } else if (
          // Session creation (no authoritative state yet). The guard above has
          // nothing to compare against, so bind the new session to the team the
          // socket authenticated as (audit H1): otherwise one team's credential
          // could seed a session claiming another team's id and inherit that
          // team's roster for role resolution.
          sessionData.teamId &&
          socket.data.authTeamId &&
          sessionData.teamId !== socket.data.authTeamId
        ) {
          console.warn(`[Server] Rejected session creation from ${socket.userName} for ${sessionId}: teamId does not match the authenticated team`);
          return;
        }

        // Logged once the write is known to be going ahead: a refused write is
        // reported (and coalesced) above, and logging it here too put one line
        // per refused write back into the log ring. Debug: stdout only, the
        // per-write trail, never the ring (logService.attachConsole).
        console.debug(`[Server] Session update from ${socket.userName}, phase: ${outgoing.phase}`);

        const result = await dataStore.saveSessionState(sessionId, outgoing);

        if (!result.success && result.stale) {
          // The client built this update on a stale snapshot. Rejecting it is
          // what prevents an out-of-date blob (e.g. an idle participant's
          // automatic roster-sync) from reverting newer state and wiping
          // submitted data. Send the authoritative state back to the sender
          // only, so it resyncs; do not persist or broadcast the stale blob.
          const current = result.data;
          if (current) sessionCache.set(sessionId, current);
          refuseAndHeal(sessionId, 'stale', current);
          logRefusal('stale', `[Server] Rejected stale session update from ${socket.userName} for ${sessionId}`, { level: 'log' });
          return;
        }

        acceptWrite(sessionId, result.data, restoredFields);
      } catch (err) {
        console.error('[Server] Failed to persist session state', err);

        // Degraded mode (database unavailable): apply the same compare-and-
        // swap against the in-memory cache. Live collaboration keeps working
        // through the outage (zero-downtime requirement), but a stale blob
        // still cannot clobber newer state — the old behaviour of caching and
        // broadcasting the raw client blob reintroduced exactly the clobbering
        // the CAS exists to prevent. Revisions advance monotonically, so the
        // first write after recovery persists cleanly.
        const cached = sessionCache.get(sessionId);
        const cachedRev = cached ? Number(cached._rev ?? 0) : 0;
        const baseRev = Number(outgoing._rev ?? 0);

        if (cached && baseRev < cachedRev) {
          refuseAndHeal(sessionId, 'stale', cached);
          logRefusal(
            'stale-degraded',
            `[Server] Rejected stale session update from ${socket.userName} for ${sessionId} (degraded mode)`,
            { level: 'log' }
          );
          return;
        }

        // `outgoing`, not the raw blob: a participant's facilitator-only
        // changes were restored above, so an outage that surfaces here — the
        // throw from saveSessionState — does not let them through.
        //
        // That holds only when the guard ran, and it runs only when this pod
        // had a reliable baseline. loadSessionState does not throw on a
        // database error: it logs and answers null. That leaves two unguarded
        // cases, both accepted here as sent:
        //   - no baseline at all: a pod whose cache does not hold the session
        //     (it never served a write for it, or SESSION_CACHE_MAX evicted
        //     it). The write is treated like session creation — only the
        //     teamId binding to the authenticated team is checked — and the
        //     role guard and the stale check are both skipped;
        //   - a baseline known to be stale: the cache holds the session at a
        //     revision older than the one the write was built on (a write that
        //     landed through another pod and reached this client). Restoring
        //     from it would put older facilitator values into the write, and
        //     this branch would broadcast them at a higher revision — the
        //     facilitator's phase change reverted for the whole room. The
        //     guard skips it and logs the fields it did not check.
        // Both are deliberate: the alternative is refusing every write on that
        // pod for the length of the outage, or undoing newer state for
        // everyone, and availability was chosen over the guard.
        acceptWrite(sessionId, {
          ...outgoing,
          _rev: Math.max(cachedRev, baseRev) + 1,
          _updatedAt: new Date().toISOString()
        }, restoredFields);
      }
    });

    // Ephemeral "is typing" presence signal. Broadcast to the other clients in
    // the session only and never persisted: it is a transient cue that the
    // receivers auto-expire, so it needs no recovery after a reconnection.
    on('participant-activity', (payload) => {
      const sessionId = socket.sessionId;
      if (!sessionId) return;
      const activity = payload && typeof payload === 'object' ? payload.activity ?? null : null;
      socket.to(sessionId).emit('participant-activity', {
        userId: socket.userId,
        userName: socket.userName,
        activity
      });
    });

    on('disconnect', async () => {
      console.log(`[Server] Client disconnected: ${socket.id} (${socket.userName || 'unknown'})`);
      // Flushes this socket's pending refusal summaries too, including the
      // writes of a socket that never joined (no session to leave).
      await leaveCurrentSession(socket);
    });
  });
};

export {
  registerSocketHandlers,
  shouldRefreshLastConnection,
  refreshLastConnectionDate,
  createLastConnectionRefresher,
  validateSessionUpdateShape,
  consumeUpdateToken,
  parseUpdateThrottleConfig,
  parseRosterBroadcastConfig,
  createRosterBroadcaster
};
